
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

const log = (msg: string, ctx?: Record<string, unknown>) => {
  console.log(`[stripe-webhook-slots] ${msg}`, ctx ?? {});
};

const mapStripeToPaymentStatus = (status: string) => {
  switch (status) {
    case "requires_action":
    case "requires_payment_method":
      return "REQUIRES_ACTION";
    case "processing":
      return "PROCESSING";
    case "succeeded":
      return "SUCCEEDED";
    case "canceled":
      return "CANCELED";
    default:
      return "PROCESSING";
  }
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY") || "";

  if (!stripeSecret || !webhookSecret) {
    log("Missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET");
    return new Response(JSON.stringify({ error: "Server misconfiguration" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }

  const stripe = new Stripe(stripeSecret, { apiVersion: "2023-10-16" });

  let event: Stripe.Event;

  try {
    const signature = req.headers.get("stripe-signature") ?? "";
    const payload = await req.text();
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (err) {
    log("Webhook signature verification failed", { error: err instanceof Error ? err.message : String(err) });
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }

  try {
    const supabaseService = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    log("Event received", { type: event.type });

    // We only need payment_intent.* here
    if (event.type.startsWith("payment_intent.")) {
      const pi = event.data.object as Stripe.PaymentIntent;
      const paymentIntentId = pi.id;
      const status = pi.status;
      const paymentStatus = mapStripeToPaymentStatus(status);

      // Update payment record with latest status + raw payload
      await supabaseService.from("slot_payments").upsert(
        {
          stripe_payment_intent_id: paymentIntentId,
          status: paymentStatus,
          webhook_payload: event as unknown as Record<string, unknown>,
          amount_cents: typeof pi.amount === "number" ? pi.amount : null,
          currency: (pi.currency || "usd").toUpperCase(),
          user_id: (pi.metadata?.userId as string) || null,
          reservation_id: (pi.metadata?.reservationId as string) || null,
        },
        { onConflict: "stripe_payment_intent_id" }
      );

      if (status === "succeeded") {
        const reservationId = pi.metadata?.reservationId as string | undefined;
        const slotId = pi.metadata?.slotId as string | undefined;
        const userId = pi.metadata?.userId as string | undefined;
        const serviceId = pi.metadata?.serviceId as string | undefined;
        const providerId = pi.metadata?.providerId as string | undefined;

        if (!reservationId || !slotId || !userId || !serviceId || !providerId) {
          log("Missing required metadata, skipping booking creation", { paymentIntentId });
          return new Response(JSON.stringify({ received: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          });
        }

        // Idempotency: has booking already been created?
        const { data: existing, error: existingErr } = await supabaseService
          .from("slot_bookings")
          .select("id")
          .eq("payment_intent_id", paymentIntentId)
          .maybeSingle();

        if (existingErr) {
          log("Error checking existing booking", { error: existingErr });
        }

        if (!existing) {
          // Create booking
          const { error: bookingErr } = await supabaseService.from("slot_bookings").insert({
            user_id: userId,
            service_id: serviceId,
            provider_id: providerId,
            slot_id: slotId,
            reservation_id: reservationId,
            payment_intent_id: paymentIntentId,
            status: "PAID",
          });

          if (bookingErr) {
            log("Error creating booking", { error: bookingErr });
          }

          // Update reservation and slot
          const { error: resUpdateErr } = await supabaseService
            .from("slot_reservations")
            .update({ status: "CONFIRMED" })
            .eq("id", reservationId);

          if (resUpdateErr) {
            log("Error updating reservation", { error: resUpdateErr });
          }

          const { error: slotUpdateErr } = await supabaseService
            .from("service_slots")
            .update({ status: "BOOKED", updated_at: new Date().toISOString() })
            .eq("id", slotId);

          if (slotUpdateErr) {
            log("Error updating slot", { error: slotUpdateErr });
          }

          // Emit event
          const { error: eventErr } = await supabaseService.from("booking_events").insert({
            topic: "booking.created",
            payload: {
              payment_intent_id: paymentIntentId,
              reservation_id: reservationId,
              slot_id: slotId,
              service_id: serviceId,
              provider_id: providerId,
            },
            user_id: userId,
          });

          if (eventErr) {
            log("Error inserting booking event", { error: eventErr });
          }
        }
      }

      if (status === "payment_failed" || status === "canceled") {
        const reservationId = (event.data.object as any)?.metadata?.reservationId as string | undefined;
        const slotId = (event.data.object as any)?.metadata?.slotId as string | undefined;
        const userId = (event.data.object as any)?.metadata?.userId as string | undefined;

        if (reservationId) {
          await supabaseService.from("slot_reservations").update({ status: "EXPIRED" }).eq("id", reservationId);
        }
        if (slotId) {
          await supabaseService
            .from("service_slots")
            .update({ status: "AVAILABLE", updated_at: new Date().toISOString() })
            .eq("id", slotId);
        }
        await supabaseService.from("booking_events").insert({
          topic: "payment.failed",
          payload: { reservation_id: reservationId, slot_id: slotId },
          user_id: userId ?? null,
        });
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (e) {
    log("Unhandled error", { error: e instanceof Error ? e.message : String(e) });
    return new Response(JSON.stringify({ error: "Internal error" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
