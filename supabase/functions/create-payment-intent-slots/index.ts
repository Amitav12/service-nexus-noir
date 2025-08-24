
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

const log = (msg: string, ctx?: Record<string, unknown>) => {
  console.log(`[create-payment-intent-slots] ${msg}`, ctx ?? {});
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

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const { reservationId } = await req.json();
    if (!reservationId) {
      return new Response(JSON.stringify({ error: "reservationId is required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const supabaseService = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes?.user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }
    const user = userRes.user;
    log("User authenticated", { userId: user.id });

    // Load reservation
    const { data: reservation, error: resErr } = await supabaseService
      .from("slot_reservations")
      .select("id, user_id, slot_id, status, hold_expires_at")
      .eq("id", reservationId)
      .single();

    if (resErr || !reservation) {
      log("Reservation not found", { reservationId, error: resErr });
      return new Response(JSON.stringify({ error: "Reservation not found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 404,
      });
    }

    if (reservation.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "Not authorized for this reservation" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 403,
      });
    }

    if (reservation.status !== "HOLD") {
      return new Response(JSON.stringify({ error: "Reservation is not in HOLD state" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const now = new Date();
    const expiresAt = new Date(reservation.hold_expires_at);
    if (expiresAt.getTime() <= now.getTime()) {
      return new Response(JSON.stringify({ error: "Reservation has expired" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 410,
      });
    }

    // Load slot to get service id and provider id
    const { data: slot, error: slotErr } = await supabaseService
      .from("service_slots")
      .select("id, service_id, provider_id, start_time, status")
      .eq("id", reservation.slot_id)
      .single();

    if (slotErr || !slot) {
      log("Slot not found", { slotId: reservation.slot_id, error: slotErr });
      return new Response(JSON.stringify({ error: "Slot not found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 404,
      });
    }

    if (slot.status !== "HOLD") {
      return new Response(JSON.stringify({ error: "Slot is not held" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // Load service to get price and currency
    const { data: service, error: svcErr } = await supabaseService
      .from("booking_services")
      .select("id, title, price_cents, currency")
      .eq("id", slot.service_id)
      .single();

    if (svcErr || !service) {
      log("Service not found", { serviceId: slot.service_id, error: svcErr });
      return new Response(JSON.stringify({ error: "Service not found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 404,
      });
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", { apiVersion: "2023-10-16" });

    // Create PaymentIntent with idempotency key per reservation
    const intent = await stripe.paymentIntents.create(
      {
        amount: service.price_cents,
        currency: service.currency?.toLowerCase() || "usd",
        metadata: {
          reservationId,
          userId: user.id,
          serviceId: service.id,
          providerId: slot.provider_id,
          slotId: slot.id,
          slotStartTime: slot.start_time,
        },
      },
      { idempotencyKey: `reservation-${reservationId}` }
    );

    const paymentStatus = mapStripeToPaymentStatus(intent.status);

    // Upsert payment record
    const { error: payErr } = await supabaseService.from("slot_payments").upsert(
      {
        user_id: user.id,
        reservation_id: reservationId,
        stripe_payment_intent_id: intent.id,
        amount_cents: service.price_cents,
        currency: service.currency || "USD",
        status: paymentStatus,
        webhook_payload: null,
      },
      { onConflict: "stripe_payment_intent_id" }
    );

    if (payErr) {
      log("Failed to record payment", { error: payErr });
      return new Response(JSON.stringify({ error: "Failed to record payment" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    return new Response(
      JSON.stringify({ clientSecret: intent.client_secret, paymentIntentId: intent.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (e) {
    log("Unhandled error", { error: e instanceof Error ? e.message : String(e) });
    return new Response(JSON.stringify({ error: "Internal error" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
