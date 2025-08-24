
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Remove static Redis import; use dynamic import with graceful fallback
const REDIS_URL = Deno.env.get("REDIS_URL") || "";
const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", { apiVersion: "2023-10-16" });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const log = (msg: string, ctx?: Record<string, unknown>) => {
  console.log(`[worker] ${msg}`, ctx ?? {});
};

function parseRedisUrl(url: string) {
  try {
    const u = new URL(url);
    const isTls = u.protocol === "rediss:";
    const hostname = u.hostname;
    const port = Number(u.port || (isTls ? 6380 : 6379));
    const password = u.password || undefined;
    return { hostname, port, password, tls: isTls };
  } catch {
    return null;
  }
}

async function getRedis(): Promise<any | null> {
  if (!REDIS_URL) return null;
  const cfg = parseRedisUrl(REDIS_URL);
  if (!cfg) return null;
  try {
    const mod = await import("https://deno.land/x/redis@v0.36.0/mod.ts");
    const connect = (mod as any).connect as (opts: any) => Promise<any>;
    return await connect({
      hostname: cfg.hostname,
      port: cfg.port,
      password: cfg.password,
      tls: cfg.tls ? {} : undefined,
    });
  } catch (e) {
    console.log("[worker] Redis unavailable", { error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const redis = await getRedis();
    if (!redis) {
      return new Response(JSON.stringify({ error: "Redis is not configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    // Process up to N events per invocation
    const MAX = 50;
    let processed = 0;

    for (let i = 0; i < MAX; i++) {
      const raw = await redis.rpop("queue:webhooks"); // FIFO (lpush + rpop)
      if (!raw) break;
      processed++;

      try {
        const event = JSON.parse(raw);

        if (event.type === "checkout.session.completed") {
          const session = event.data.object as Stripe.Checkout.Session;

          const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
          const sessionId = session.id;

          // Update payments
          await supabase.from("payments").upsert({
            stripe_payment_intent_id: paymentIntentId ?? null,
            stripe_session_id: sessionId,
            status: "SUCCEEDED",
            raw_webhook: event,
            amount: session.amount_total ?? undefined,
            currency: (session.currency || "INR").toUpperCase(),
            user_id: (session?.metadata?.userId as string) || undefined,
            reservation_id: (session?.metadata?.reservationId as string) || undefined,
          }, { onConflict: "stripe_session_id" });

          const reservationId = session?.metadata?.reservationId as string | undefined;
          const userId = session?.metadata?.userId as string | undefined;
          const slotId = session?.metadata?.slotId as string | undefined;
          const serviceId = session?.metadata?.serviceId as string | undefined;
          const providerId = session?.metadata?.providerId as string | undefined;

          if (reservationId && slotId && userId && serviceId && providerId && paymentIntentId) {
            // Transactional consistency (best-effort sequential)
            // 1) Confirm reservation
            await supabase
              .from("reservations")
              .update({ status: "CONFIRMED" })
              .eq("id", reservationId);

            // 2) Mark slot as BOOKED
            await supabase
              .from("slots")
              .update({ status: "BOOKED" })
              .eq("id", slotId);

            // 3) Create booking (idempotent on transaction_id)
            const { error: bookErr } = await supabase.from("bookings").insert({
              user_id: userId,
              service_id: serviceId,
              provider_id: providerId,
              slot_id: slotId,
              status: "PAID",
              transaction_id: paymentIntentId,
            } as any); // table schema enforces uniqueness on transaction_id

            if (bookErr && !String(bookErr.message || "").includes("duplicate")) {
              console.log("[worker] Booking insert error", bookErr);
            }

            // 4) Emit event
            await supabase.from("events").insert({
              topic: "booking_confirmed",
              payload: {
                booking_transaction_id: paymentIntentId,
                reservation_id: reservationId,
                user_id: userId,
                slot_id: slotId,
                service_id: serviceId,
                provider_id: providerId,
              },
            });
          }
        } else if (event.type === "payment_intent.payment_failed") {
          const pi = event.data.object as Stripe.PaymentIntent;
          const paymentIntentId = pi.id;

          await supabase
            .from("payments")
            .upsert({
              stripe_payment_intent_id: paymentIntentId,
              status: "FAILED",
              raw_webhook: event,
            }, { onConflict: "stripe_payment_intent_id" });

          const reservationId = pi.metadata?.reservationId as string | undefined;
          const userId = pi.metadata?.userId as string | undefined;
          const slotId = pi.metadata?.slotId as string | undefined;

          if (reservationId && slotId) {
            // Expire hold if still held
            await supabase
              .from("reservations")
              .update({ status: "EXPIRED" })
              .eq("id", reservationId);

            await supabase
              .from("slots")
              .update({ status: "AVAILABLE" })
              .eq("id", slotId)
              .eq("status", "HOLD");

            await supabase.from("events").insert({
              topic: "payment_failed",
              payload: { reservation_id: reservationId, slot_id: slotId, user_id: userId, payment_intent_id: paymentIntentId },
            });
          }
        } else if (event.type === "charge.refunded") {
          const charge = event.data.object as Stripe.Charge;
          const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;

          await supabase
            .from("payments")
            .upsert({
              stripe_payment_intent_id: paymentIntentId ?? null,
              status: "CANCELED",
              raw_webhook: event,
            }, { onConflict: "stripe_payment_intent_id" });

          // Mark booking refunded (best-effort)
          if (paymentIntentId) {
            await supabase
              .from("bookings")
              .update({ status: "REFUNDED" })
              .eq("transaction_id", paymentIntentId);
          }
        } else {
          // ignore other events
        }
      } catch (e) {
        log("Failed to process webhook event", { error: e instanceof Error ? e.message : String(e) });
      }
    }

    return new Response(JSON.stringify({ processed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (e) {
    log("Unhandled worker error", { error: e instanceof Error ? e.message : String(e) });
    return new Response(JSON.stringify({ error: "Internal error" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
