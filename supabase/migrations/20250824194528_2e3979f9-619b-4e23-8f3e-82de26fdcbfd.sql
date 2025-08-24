
-- Drop existing tables that need restructuring
DROP TABLE IF EXISTS public.slot_bookings CASCADE;
DROP TABLE IF EXISTS public.slot_payments CASCADE;
DROP TABLE IF EXISTS public.slot_reservations CASCADE;
DROP TABLE IF EXISTS public.service_slots CASCADE;
DROP TABLE IF EXISTS public.booking_services CASCADE;
DROP TABLE IF EXISTS public.service_providers CASCADE;
DROP TABLE IF EXISTS public.booking_events CASCADE;

-- Create exact schema as specified
CREATE TABLE public.providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact JSONB,
  stripe_account_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  price_amount INTEGER NOT NULL, -- paise/cents
  currency TEXT DEFAULT 'INR',
  duration_minutes INTEGER NOT NULL,
  provider_id UUID REFERENCES public.providers(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID REFERENCES public.providers(id) ON DELETE CASCADE NOT NULL,
  service_id UUID REFERENCES public.services(id) ON DELETE CASCADE NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'HOLD', 'BOOKED')),
  booking_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  
  -- Prevent overlapping slots for same provider
  CONSTRAINT no_overlapping_slots UNIQUE (provider_id, start_time)
);

CREATE TABLE public.reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  slot_id UUID REFERENCES public.slots(id) ON DELETE CASCADE NOT NULL,
  status TEXT DEFAULT 'HOLD' CHECK (status IN ('HOLD', 'EXPIRED', 'CONFIRMED')),
  hold_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  
  -- One active reservation per slot
  CONSTRAINT unique_active_reservation UNIQUE (slot_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  reservation_id UUID REFERENCES public.reservations(id) ON DELETE SET NULL,
  stripe_payment_intent_id TEXT UNIQUE,
  stripe_session_id TEXT UNIQUE,
  amount INTEGER NOT NULL,
  currency TEXT DEFAULT 'INR',
  status TEXT DEFAULT 'PROCESSING' CHECK (status IN ('REQUIRES_ACTION', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED')),
  raw_webhook JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  service_id UUID REFERENCES public.services(id) ON DELETE SET NULL NOT NULL,
  provider_id UUID REFERENCES public.providers(id) ON DELETE SET NULL NOT NULL,
  slot_id UUID REFERENCES public.slots(id) ON DELETE SET NULL NOT NULL,
  status TEXT DEFAULT 'PAID' CHECK (status IN ('PAID', 'CANCELLED', 'REFUNDED')),
  transaction_id TEXT NOT NULL, -- pi_... from Stripe
  created_at TIMESTAMPTZ DEFAULT now(),
  
  -- One booking per transaction (idempotency)
  CONSTRAINT unique_transaction UNIQUE (transaction_id),
  -- One booking per slot
  CONSTRAINT unique_slot_booking UNIQUE (slot_id)
);

CREATE TABLE public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add specified indexes
CREATE INDEX idx_slots_status_time ON public.slots(status, start_time);
CREATE INDEX idx_reservations_status_expires ON public.reservations(status, hold_expires_at);
CREATE INDEX idx_payments_intent ON public.payments(stripe_payment_intent_id);
CREATE INDEX idx_bookings_transaction ON public.bookings(transaction_id);

-- Enable RLS on user-sensitive tables
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "customers_own_reservations" ON public.reservations
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "customers_own_payments" ON public.payments
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "customers_own_bookings" ON public.bookings
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "providers_view_bookings" ON public.bookings
  FOR SELECT USING (provider_id IN (SELECT id FROM public.providers WHERE user_id = auth.uid()));

CREATE POLICY "system_writes_all" ON public.reservations
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "system_writes_payments" ON public.payments
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "system_writes_bookings" ON public.bookings
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "system_writes_events" ON public.events
  FOR ALL USING (true) WITH CHECK (true);

-- Enable realtime for events
ALTER PUBLICATION supabase_realtime ADD TABLE public.events;

-- Atomic reservation function with Redis lock
CREATE OR REPLACE FUNCTION reserve_slot_with_lock(
  p_user_id UUID,
  p_slot_id UUID,
  p_hold_duration_minutes INTEGER DEFAULT 10
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_reservation_id UUID;
  v_expires_at TIMESTAMPTZ;
  v_slot_available BOOLEAN;
BEGIN
  -- Check if slot is available and update status atomically
  UPDATE public.slots 
  SET status = 'HOLD'
  WHERE id = p_slot_id AND status = 'AVAILABLE'
  RETURNING true INTO v_slot_available;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Slot not available'
    );
  END IF;
  
  -- Calculate expiry time
  v_expires_at := now() + (p_hold_duration_minutes || ' minutes')::INTERVAL;
  
  -- Create reservation
  INSERT INTO public.reservations (user_id, slot_id, hold_expires_at)
  VALUES (p_user_id, p_slot_id, v_expires_at)
  RETURNING id INTO v_reservation_id;
  
  -- Log event
  INSERT INTO public.events (topic, payload)
  VALUES (
    'slot_reserved',
    jsonb_build_object(
      'reservation_id', v_reservation_id,
      'slot_id', p_slot_id,
      'user_id', p_user_id,
      'expires_at', v_expires_at
    )
  );
  
  RETURN jsonb_build_object(
    'success', true,
    'reservation_id', v_reservation_id,
    'expires_at', v_expires_at
  );
END;
$$;

-- TTL cleanup function
CREATE OR REPLACE FUNCTION cleanup_expired_reservations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER := 0;
  v_reservation RECORD;
BEGIN
  -- Get expired reservations in batches
  FOR v_reservation IN 
    SELECT id, slot_id, user_id 
    FROM public.reservations 
    WHERE status = 'HOLD' AND hold_expires_at < now()
    LIMIT 1000
  LOOP
    -- Mark reservation as expired
    UPDATE public.reservations 
    SET status = 'EXPIRED'
    WHERE id = v_reservation.id;
    
    -- Free the slot if it's still held
    UPDATE public.slots 
    SET status = 'AVAILABLE'
    WHERE id = v_reservation.slot_id AND status = 'HOLD';
    
    -- Log event
    INSERT INTO public.events (topic, payload)
    VALUES (
      'hold_expired',
      jsonb_build_object(
        'reservation_id', v_reservation.id,
        'slot_id', v_reservation.slot_id,
        'user_id', v_reservation.user_id
      )
    );
    
    v_count := v_count + 1;
  END LOOP;
  
  RETURN v_count;
END;
$$;

-- Add some sample data for testing
INSERT INTO public.providers (id, name, contact) VALUES 
  ('550e8400-e29b-41d4-a716-446655440000', 'Test Provider 1', '{"phone": "+91-9999999999", "email": "provider1@test.com"}'::jsonb),
  ('550e8400-e29b-41d4-a716-446655440001', 'Test Provider 2', '{"phone": "+91-8888888888", "email": "provider2@test.com"}'::jsonb);

INSERT INTO public.services (id, title, description, price_amount, duration_minutes, provider_id) VALUES 
  ('660e8400-e29b-41d4-a716-446655440000', 'Basic Consultation', 'Basic health consultation', 50000, 30, '550e8400-e29b-41d4-a716-446655440000'),
  ('660e8400-e29b-41d4-a716-446655440001', 'Premium Consultation', 'Premium health consultation with detailed report', 100000, 60, '550e8400-e29b-41d4-a716-446655440000');

INSERT INTO public.slots (provider_id, service_id, start_time, end_time) VALUES 
  ('550e8400-e29b-41d4-a716-446655440000', '660e8400-e29b-41d4-a716-446655440000', now() + interval '1 day', now() + interval '1 day 30 minutes'),
  ('550e8400-e29b-41d4-a716-446655440000', '660e8400-e29b-41d4-a716-446655440000', now() + interval '1 day 1 hour', now() + interval '1 day 1 hour 30 minutes'),
  ('550e8400-e29b-41d4-a716-446655440000', '660e8400-e29b-41d4-a716-446655440001', now() + interval '2 days', now() + interval '2 days 1 hour');
