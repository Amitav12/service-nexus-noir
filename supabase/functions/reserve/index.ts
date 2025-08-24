
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Note: remove static Redis import to avoid build-time fetch failures
// We'll load Redis dynamically only when needed.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HOLD_MINUTES = Number(Deno.env.get("HOLD_MINUTES") ?? "10");
const REDIS_URL = Deno.env.get("REDIS_URL") || "";

const log = (msg: string, ctx?: Record<string, unknown>) => {
  console.log(`[reserve] ${msg}`, ctx ?? {});
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

// Helper: conditionally get a Redis client via dynamic import.
// If anything fails (missing URL, import error, connection failure), we gracefully return null.
async function withRedis<T>(fn: (redis: any | null) => Promise<T>): Promise<T> {
  if (!REDIS_URL) {
    return await fn(null);
  }
  const cfg = parseRedisUrl(REDIS_URL);
  if (!cfg) {
    return await fn(null);
  }

  let redis: any | null = null;
  try {
    const mod = await import("https://deno.land/x/redis@v0.36.0/mod.ts");
    const connect = (mod as any).connect as (opts: any) => Promise<any>;
    redis = await connect({
      hostname: cfg.hostname,
      port: cfg.port,
      password: cfg.password,
      tls: cfg.tls ? {} : undefined,
    });
  } catch (e) {
    console.log("[reserve] Redis unavailable, continuing without it", { error: e instanceof Error ? e.message : String(e) });
    return await fn(null);
  }

  try {
    return await fn(redis);
  } finally {
    try {
      redis?.close?.();
    } catch {}
  }
}

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

    const { slotId, holdMinutes } = await req.json();
    if (!slotId) {
      return new Response(JSON.stringify({ error: "slotId is required" }), {
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
    log("User authenticated", { userId: user.id, slotId });

    // Acquire short Redis lock (if available)
    const lockKey = `lock:slot:${slotId}`;
    const requestId = crypto.randomUUID();
    const ttlSeconds = 30;

    const acquire = async (redis: any | null) => {
      if (!redis) return true; // If no Redis configured/available, skip locking.
      const ok = await redis.set(lockKey, requestId, { ex: ttlSeconds, nx: true });
      return ok === "OK";
    };

    const release = async (redis: any | null) => {
      if (!redis) return;
      // delete only if value matches requestId
      const lua = `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          return redis.call("DEL", KEYS[1])
        else
          return 0
        end
      `;
      try {
        await redis.eval(lua, { keys: [lockKey], arguments: [requestId] });
      } catch (e) {
        console.log("[reserve] Redis release error", e);
      }
    };

    return await withRedis<Response>(async (redis) => {
      const locked = await acquire(redis);
      if (!locked) {
        return new Response(JSON.stringify({ error: "Slot is being reserved by another request. Please try again." }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 409,
        });
      }

      try {
        // Use atomic SQL function for reservation
        const { data, error } = await supabaseService.rpc("reserve_slot_with_lock", {
          p_user_id: user.id,
          p_slot_id: slotId,
          p_hold_duration_minutes: Math.max(1, Number(holdMinutes ?? HOLD_MINUTES)),
        });

        if (error) {
          log("reserve_slot_with_lock error", { error });
          return new Response(JSON.stringify({ error: "Reservation failed" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 500,
          });
        }

        if (!data?.success) {
          return new Response(JSON.stringify({ error: data?.error ?? "Slot not available" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 409,
          });
        }

        return new Response(
          JSON.stringify({
            reservationId: data.reservation_id,
            holdExpiresAt: data.expires_at,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      } finally {
        await release(redis);
      }
    });
  } catch (e) {
    log("Unhandled error", { error: e instanceof Error ? e.message : String(e) });
    return new Response(JSON.stringify({ error: "Internal error" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
