
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatError } from "@/lib/errorFormatter";

const FUNCTIONS_BASE = "https://jpvjdpgtpjbrkcamyqie.supabase.co/functions/v1";

export interface ReservationResult {
  reservationId: string;
  holdExpiresAt: string; // ISO string
  // Add expiresAt for compatibility with components expecting this field
  expiresAt: string; // ISO string
}

export const useReservationTimer = (expiresAt?: string | null) => {
  const [remainingMs, setRemainingMs] = useState<number>(0);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (!expiresAt) {
      setRemainingMs(0);
      return;
    }
    const target = new Date(expiresAt).getTime();

    const tick = () => {
      const now = Date.now();
      const diff = Math.max(0, target - now);
      setRemainingMs(diff);
    };

    tick();
    intervalRef.current = window.setInterval(tick, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [expiresAt]);

  const formatted = useMemo(() => {
    const totalSec = Math.floor(remainingMs / 1000);
    const m = Math.floor(totalSec / 60).toString().padStart(2, "0");
    const s = (totalSec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }, [remainingMs]);

  return { remainingMs, formatted };
};

export const useSlotBooking = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reserveSlot = async (params: { slotId: string; holdMinutes?: number; }): Promise<ReservationResult> => {
    const session = (await supabase.auth.getSession()).data.session;
    if (!session) throw new Error("Please log in to book a slot");

    setLoading(true);
    setError(null);
    
    try {
      console.log('🔄 Reserving slot:', params);
      
      const res = await fetch(`${FUNCTIONS_BASE}/reserve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(params),
      });

      const json = await res.json();
      
      if (!res.ok) {
        const errorMsg = json?.error || `HTTP ${res.status}: Failed to reserve slot`;
        console.error('❌ Reserve slot failed:', errorMsg);
        throw new Error(errorMsg);
      }
      
      console.log('✅ Slot reserved successfully:', json);
      return { 
        reservationId: json.reservationId, 
        holdExpiresAt: json.holdExpiresAt,
        expiresAt: json.holdExpiresAt, // alias for UI compatibility
      };
      
    } catch (error) {
      const errorMsg = formatError(error);
      console.error('❌ Reserve slot error:', errorMsg);
      setError(errorMsg);
      throw new Error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const initiateCheckout = async (reservationId: string): Promise<{ url: string; sessionId: string; }> => {
    const session = (await supabase.auth.getSession()).data.session;
    if (!session) throw new Error("Please log in to proceed with payment");

    setLoading(true);
    setError(null);
    
    try {
      console.log('💳 Initiating checkout for reservation:', reservationId);
      
      const origin = window.location.origin;
      const res = await fetch(`${FUNCTIONS_BASE}/pay`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          reservationId,
          successUrl: `${origin}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${origin}/`,
        }),
      });

      const json = await res.json();
      
      if (!res.ok) {
        const errorMsg = json?.error || `HTTP ${res.status}: Failed to create checkout session`;
        console.error('❌ Checkout failed:', errorMsg);
        throw new Error(errorMsg);
      }
      
      console.log('✅ Checkout session created:', json);
      return { url: json.url, sessionId: json.sessionId };
      
    } catch (error) {
      const errorMsg = formatError(error);
      console.error('❌ Checkout error:', errorMsg);
      setError(errorMsg);
      throw new Error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const subscribeToEvents = (onEvent: (payload: any) => void) => {
    console.log('🔔 Subscribing to real-time events');
    
    const channel = supabase
      .channel("slot_booking_events")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "events" },
        (payload) => {
          console.log('📡 Real-time event received:', payload.new);
          try {
            onEvent(payload.new);
          } catch (error) {
            console.error('❌ Error handling real-time event:', error);
          }
        }
      )
      .subscribe((status) => {
        console.log('🔗 Realtime subscription status:', status);
      });

    return () => {
      console.log('🔌 Unsubscribing from real-time events');
      supabase.removeChannel(channel);
    };
  };

  const checkSlotAvailability = async (slotId: string): Promise<boolean> => {
    try {
      // Cast supabase to any to access the slots table
      const sb = supabase as any;
      const { data, error } = await sb
        .from('slots')
        .select('status')
        .eq('id', slotId)
        .maybeSingle();

      if (error) {
        console.error('❌ Error checking slot availability:', error);
        return false;
      }
      
      return data?.status === 'AVAILABLE';
    } catch (error) {
      console.error('❌ Error checking slot availability:', error);
      return false;
    }
  };

  const getActiveReservations = async () => {
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) return [];

      // Cast supabase to any to access the reservations table
      const sb = supabase as any;
      const { data, error } = await sb
        .from('reservations')
        .select(`
          id,
          slot_id,
          status,
          hold_expires_at,
          slots (
            start_time,
            end_time,
            services (title)
          )
        `)
        .eq('user_id', session.session.user.id)
        .eq('status', 'HOLD')
        .gt('hold_expires_at', new Date().toISOString());

      if (error) {
        console.error('❌ Error fetching active reservations:', error);
        return [];
      }
      
      return data || [];
    } catch (error) {
      console.error('❌ Error fetching active reservations:', error);
      return [];
    }
  };

  return {
    loading,
    error,
    reserveSlot,
    initiateCheckout,
    subscribeToEvents,
    checkSlotAvailability,
    getActiveReservations,
  };
};
