
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const log = (msg: string, ctx?: Record<string, unknown>) => {
  console.log(`[reserve-slot] ${msg}`, ctx ?? {});
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
    const { slotId, serviceId, providerId, holdMinutes = 10 } = body || {};
    if (!slotId) {
      return new Response(JSON.stringify({ error: "slotId is required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const supabaseAnon = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    // Get current user
    const { data: userRes, error: userErr } = await supabaseAnon.auth.getUser();
    if (userErr || !userRes?.user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }
    const user = userRes.user;
    log("User authenticated", { userId: user.id });

    // Optional: Validate slot belongs to provided service/provider if given
    if (serviceId || providerId) {
      const { data: slot, error: slotErr } = await supabaseAnon
        .from("service_slots")
        .select("id, service_id, provider_id, status, start_time")
        .eq("id", slotId)
        .maybeSingle();

      if (slotErr) {
        log("Error fetching slot", { error: slotErr });
        return new Response(JSON.stringify({ error: "Failed to load slot" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        });
      }
      if (!slot) {
        return new Response(JSON.stringify({ error: "Slot not found" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 404,
        });
      }
      if (serviceId && slot.service_id !== serviceId) {
        return new Response(JSON.stringify({ error: "Slot does not match serviceId" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        });
      }
      if (providerId && slot.provider_id !== providerId) {
        return new Response(JSON.stringify({ error: "Slot does not match providerId" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        });
      }
    }

    // Call the SQL function (SECURITY DEFINER) to atomically reserve
    const { data: reserveData, error: reserveErr } = await supabaseAnon.rpc("reserve_slot", {
      p_user_id: user.id,
      p_slot_id: slotId,
      p_hold_duration_minutes: holdMinutes,
    });

    if (reserveErr) {
      log("reserve_slot RPC error", { error: reserveErr });
      return new Response(JSON.stringify({ error: "Reservation failed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    if (!reserveData?.success) {
      return new Response(JSON.stringify({ error: reserveData?.error ?? "Slot not available" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 409,
      });
    }

    return new Response(
      JSON.stringify({
        reservationId: reserveData.reservation_id,
        expiresAt: reserveData.expires_at,
      }),
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
