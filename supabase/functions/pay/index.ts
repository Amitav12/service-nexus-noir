
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const log = (msg: string, ctx?: Record<string, unknown>) => {
  console.log(`[pay] ${msg}`, ctx ?? {});
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

    const body = await req.json().catch(() => ({}));
    const { reservationId, successUrl, cancelUrl } = body || {};
    if (!reservationId) {
      return new Response(JSON.stringify({ error: "reservationId is required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );
    const supabaseService = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: userRes, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !userRes?.user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }
    const user = userRes.user;

    // Load reservation
    const { data: reservation, error: resErr } = await supabaseService
      .from("reservations")
      .select("id, user_id, slot_id, status, hold_expires_at")
      .eq("id", reservationId)
      .single();

    if (resErr || !reservation) {
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

    // Validate not expired
    const now = new Date();
    const expiresAt = new Date(reservation.hold_expires_at);
    if (expiresAt.getTime() <= now.getTime()) {
      return new Response(JSON.stringify({ error: "Reservation has expired" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 410,
      });
    }

    // Load slot and service
    const { data: slot, error: slotErr } = await supabaseService
      .from("slots")
      .select("id, service_id, provider_id, start_time, status")
      .eq("id", reservation.slot_id)
      .single();

    if (slotErr || !slot) {
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

    const { data: service, error: svcErr } = await supabaseService
      .from("services")
      .select("id, title, price_amount, currency, duration_minutes")
      .eq("id", slot.service_id)
      .single();

    if (svcErr || !service) {
      return new Response(JSON.stringify({ error: "Service not found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 404,
      });
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", { apiVersion: "2023-10-16" });

    // Create a Checkout session
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: (service.currency || "INR").toLowerCase(),
              product_data: {
                name: service.title || "Service",
              },
              unit_amount: service.price_amount,
            },
            quantity: 1,
          },
        ],
        success_url: successUrl || "https://example.com/payment-success?session_id={CHECKOUT_SESSION_ID}",
        cancel_url: cancelUrl || "https://example.com/checkout",
        metadata: {
          reservationId,
          userId: user.id,
          serviceId: service.id,
          providerId: slot.provider_id,
          slotId: slot.id,
          slotStartTime: slot.start_time,
        },
        // Prefer automatic methods to enable UPI/Wallets where available
        automatic_tax: { enabled: false },
        allow_promotion_codes: false,
        customer_email: user.email ?? undefined,
      },
      { idempotencyKey: `reservation_${reservationId}` }
    );

    // Record payment
    const { error: payErr } = await supabaseService.from("payments").insert({
      user_id: user.id,
      reservation_id: reservationId,
      stripe_session_id: session.id,
      amount: service.price_amount,
      currency: service.currency || "INR",
      status: "PROCESSING",
      raw_webhook: null,
    });

    if (payErr) {
      log("Failed to record payment", { error: payErr });
      return new Response(JSON.stringify({ error: "Failed to record payment" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    return new Response(JSON.stringify({ url: session.url, sessionId: session.id }), {
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
