
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";

// Remove static Redis import; we'll dynamic import when needed
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
const REDIS_URL = Deno.env.get("REDIS_URL") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

const log = (msg: string, ctx?: Record<string, unknown>) => {
  console.log(`[stripe-webhook] ${msg}`, ctx ?? {});
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const signature = req.headers.get("stripe-signature") || "";


  try {
    const bodyText = await req.text();
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", { apiVersion: "2023-10-16" });
    const event = stripe.webhooks.constructEvent(bodyText, signature, STRIPE_WEBHOOK_SECRET);

    // Enqueue to Redis for async processing (if configured and available)
    if (REDIS_URL) {
      const cfg = parseRedisUrl(REDIS_URL);
      if (cfg) {

    if (!signature) {
      throw new Error("No signature provided");
    }

    // Verify the webhook signature (in production, you'd set up a webhook endpoint secret)
    let event;
    try {
      // For now, we'll parse the event directly since we're in test mode
      event = JSON.parse(body);
      logStep("Event type received", { type: event.type, id: event.id });
    } catch (err) {
      console.error("Error parsing webhook:", err);
      throw new Error("Invalid webhook payload");
    }

    // Create Supabase client with service role key to bypass RLS
    const supabaseService = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Handle successful payment
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      logStep("Processing successful payment for session", { sessionId: session.id });

      // Extract metadata
      const userId = session.metadata?.user_id;
      const paymentIntentId = session.payment_intent;
      const amountPaid = session.amount_total / 100; // Convert from cents

      if (!userId) {
        logStep("Missing user_id in session metadata");
        return new Response("Missing user_id", { status: 400 });
      }

      logStep("Payment details", { 
        userId, 
        paymentIntentId, 
        amountPaid, 
        currency: session.currency 
      });

      // Record the payment first
      const { data: paymentData, error: paymentError } = await supabaseService
        .from('payments')
        .insert({
          customer_id: userId,
          amount: amountPaid,
          currency: session.currency?.toUpperCase() || 'USD',
          payment_status: 'completed',
          stripe_charge_id: paymentIntentId,
          stripe_session_id: session.id,
          payment_method: 'stripe_checkout',
          processed_at: new Date().toISOString(),
          payment_intent_id: paymentIntentId,
          // booking_id will be set later by the frontend
        })
        .select('id')
        .single();

      if (paymentError) {
        logStep("Error recording payment", { error: paymentError });
        
        // Create automatic refund if payment recording fails

        try {
          const mod = await import("https://deno.land/x/redis@v0.36.0/mod.ts");
          const connect = (mod as any).connect as (opts: any) => Promise<any>;
          const redis = await connect({
            hostname: cfg.hostname,
            port: cfg.port,
            password: cfg.password,
            tls: cfg.tls ? {} : undefined,
          });
          try {
            await redis.lpush("queue:webhooks", JSON.stringify(event));
          } finally {
            try { redis?.close?.(); } catch {}
          }
        } catch (e) {
          console.log("[stripe-webhook] Redis enqueue failed, continuing without queue", { error: e instanceof Error ? e.message : String(e) });
        }

        
        return new Response(JSON.stringify({ 
          error: "Failed to record payment",
          refund_initiated: !!paymentIntentId
        }), { status: 500 });
      }

      logStep("Payment recorded successfully - awaiting booking linkage", { 
        paymentId: paymentData.id,
        sessionId: session.id 
      });

      // The actual booking creation will be handled by the frontend PaymentSuccess component
      // This webhook just ensures the payment is properly recorded

    } else if (event.type === "payment_intent.payment_failed") {
      const paymentIntent = event.data.object;
      logStep("Payment failed", { paymentIntentId: paymentIntent.id });

      // Record the failed payment
      const { error: failedPaymentError } = await supabaseService
        .from('payments')
        .insert({
          customer_id: paymentIntent.metadata?.user_id || null,
          amount: paymentIntent.amount / 100,
          currency: paymentIntent.currency?.toUpperCase() || 'USD',
          payment_status: 'failed',
          payment_intent_id: paymentIntent.id,
          payment_method: 'stripe_checkout',
          processed_at: new Date().toISOString()
        });

      if (failedPaymentError) {
        logStep("Error recording failed payment", { error: failedPaymentError });
      }

    } else if (event.type === "charge.dispute.created") {
      const dispute = event.data.object;
      logStep("Dispute created", { disputeId: dispute.id, chargeId: dispute.charge });

      // Handle dispute by updating payment status
      const { error: disputeError } = await supabaseService
        .from('payments')
        .update({ 
          payment_status: 'disputed',
          updated_at: new Date().toISOString()
        })
        .eq('stripe_charge_id', dispute.charge);

      if (disputeError) {
        logStep("Error updating payment for dispute", { error: disputeError });

      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    log("Webhook signature validation failed", { error: err instanceof Error ? err.message : String(err) });
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
