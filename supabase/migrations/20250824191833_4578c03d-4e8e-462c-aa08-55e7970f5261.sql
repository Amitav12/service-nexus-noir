
-- Create enum types for status fields
CREATE TYPE slot_status AS ENUM ('AVAILABLE', 'HOLD', 'BOOKED');
CREATE TYPE reservation_status AS ENUM ('HOLD', 'EXPIRED', 'CONFIRMED');
CREATE TYPE payment_status AS ENUM ('REQUIRES_ACTION', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED');
CREATE TYPE booking_status AS ENUM ('PAID', 'CANCELLED', 'REFUNDED');

-- Service providers table
CREATE TABLE public.service_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  contact_info JSONB,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Services table (enhanced from existing)
CREATE TABLE public.booking_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID REFERENCES public.service_providers(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL, -- Store in smallest currency unit
  duration_minutes INTEGER NOT NULL,
  currency TEXT DEFAULT 'USD',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Time slots for services
CREATE TABLE public.service_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID REFERENCES public.service_providers(id) ON DELETE CASCADE NOT NULL,
  service_id UUID REFERENCES public.booking_services(id) ON DELETE CASCADE NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  status slot_status DEFAULT 'AVAILABLE',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  -- Prevent overlapping slots for same provider
  CONSTRAINT no_overlapping_slots UNIQUE (provider_id, start_time)
);

-- Temporary reservations (holds)
CREATE TABLE public.slot_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  slot_id UUID REFERENCES public.service_slots(id) ON DELETE CASCADE NOT NULL,
  status reservation_status DEFAULT 'HOLD',
  hold_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  
  -- One active reservation per slot
  CONSTRAINT unique_active_reservation UNIQUE (slot_id) DEFERRABLE INITIALLY DEFERRED
);

-- Payment records
CREATE TABLE public.slot_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  reservation_id UUID REFERENCES public.slot_reservations(id) ON DELETE SET NULL,
  stripe_payment_intent_id TEXT UNIQUE,
  amount_cents INTEGER NOT NULL,
  currency TEXT DEFAULT 'USD',
  status payment_status DEFAULT 'REQUIRES_ACTION',
  webhook_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Final bookings
CREATE TABLE public.slot_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  service_id UUID REFERENCES public.booking_services(id) ON DELETE SET NULL NOT NULL,
  provider_id UUID REFERENCES public.service_providers(id) ON DELETE SET NULL NOT NULL,
  slot_id UUID REFERENCES public.service_slots(id) ON DELETE SET NULL NOT NULL,
  reservation_id UUID REFERENCES public.slot_reservations(id) ON DELETE SET NULL,
  payment_intent_id TEXT NOT NULL,
  status booking_status DEFAULT 'PAID',
  booked_at TIMESTAMPTZ DEFAULT now(),
  
  -- One booking per payment intent (idempotency)
  CONSTRAINT unique_payment_intent UNIQUE (payment_intent_id)
);

-- Events/audit log for realtime updates
CREATE TABLE public.booking_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic TEXT NOT NULL,
  payload JSONB NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for performance
CREATE INDEX idx_service_slots_provider_time ON public.service_slots(provider_id, start_time, status);
CREATE INDEX idx_slot_reservations_expires ON public.slot_reservations(hold_expires_at, status);
CREATE INDEX idx_slot_payments_intent ON public.slot_payments(stripe_payment_intent_id);
CREATE INDEX idx_booking_events_user_time ON public.booking_events(user_id, created_at);

-- Enable RLS on all tables
ALTER TABLE public.service_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slot_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slot_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slot_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Service providers: users can view all active providers, only own provider profile
CREATE POLICY "View active providers" ON public.service_providers
  FOR SELECT USING (is_active = true);

CREATE POLICY "Manage own provider profile" ON public.service_providers
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Services: public can view active services, providers manage own
CREATE POLICY "View active services" ON public.booking_services
  FOR SELECT USING (is_active = true);

CREATE POLICY "Providers manage own services" ON public.booking_services
  FOR ALL USING (
    provider_id IN (
      SELECT id FROM public.service_providers 
      WHERE user_id = auth.uid()
    )
  );

-- Slots: public can view available slots, providers manage own
CREATE POLICY "View available slots" ON public.service_slots
  FOR SELECT USING (true);

CREATE POLICY "Providers manage own slots" ON public.service_slots
  FOR ALL USING (
    provider_id IN (
      SELECT id FROM public.service_providers 
      WHERE user_id = auth.uid()
    )
  );

-- Reservations: users see only their own
CREATE POLICY "Users manage own reservations" ON public.slot_reservations
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Payments: users see only their own
CREATE POLICY "Users view own payments" ON public.slot_payments
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "System creates payments" ON public.slot_payments
  FOR INSERT WITH CHECK (true);

CREATE POLICY "System updates payments" ON public.slot_payments
  FOR UPDATE USING (true);

-- Bookings: users and providers see relevant bookings
CREATE POLICY "Users view own bookings" ON public.slot_bookings
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Providers view their bookings" ON public.slot_bookings
  FOR SELECT USING (
    provider_id IN (
      SELECT id FROM public.service_providers 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "System creates bookings" ON public.slot_bookings
  FOR INSERT WITH CHECK (true);

-- Events: users see their own events
CREATE POLICY "Users view own events" ON public.booking_events
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "System creates events" ON public.booking_events
  FOR INSERT WITH CHECK (true);

-- Enable realtime for events table
ALTER PUBLICATION supabase_realtime ADD TABLE public.booking_events;

-- Function to atomically reserve a slot
CREATE OR REPLACE FUNCTION reserve_slot(
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
  UPDATE public.service_slots 
  SET status = 'HOLD', updated_at = now()
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
  INSERT INTO public.slot_reservations (user_id, slot_id, hold_expires_at)
  VALUES (p_user_id, p_slot_id, v_expires_at)
  RETURNING id INTO v_reservation_id;
  
  -- Log event
  INSERT INTO public.booking_events (topic, payload, user_id)
  VALUES (
    'slot.reserved',
    jsonb_build_object(
      'reservation_id', v_reservation_id,
      'slot_id', p_slot_id,
      'expires_at', v_expires_at
    ),
    p_user_id
  );
  
  RETURN jsonb_build_object(
    'success', true,
    'reservation_id', v_reservation_id,
    'expires_at', v_expires_at
  );
END;
$$;

-- Function to clean up expired reservations
CREATE OR REPLACE FUNCTION cleanup_expired_reservations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER := 0;
  v_reservation RECORD;
BEGIN
  -- Get expired reservations
  FOR v_reservation IN 
    SELECT id, slot_id, user_id 
    FROM public.slot_reservations 
    WHERE status = 'HOLD' AND hold_expires_at < now()
  LOOP
    -- Mark reservation as expired
    UPDATE public.slot_reservations 
    SET status = 'EXPIRED'
    WHERE id = v_reservation.id;
    
    -- Free the slot if it's still held
    UPDATE public.service_slots 
    SET status = 'AVAILABLE', updated_at = now()
    WHERE id = v_reservation.slot_id AND status = 'HOLD';
    
    -- Log event
    INSERT INTO public.booking_events (topic, payload, user_id)
    VALUES (
      'reservation.expired',
      jsonb_build_object(
        'reservation_id', v_reservation.id,
        'slot_id', v_reservation.slot_id
      ),
      v_reservation.user_id
    );
    
    v_count := v_count + 1;
  END LOOP;
  
  RETURN v_count;
END;
$$;

-- Schedule cleanup job (requires pg_cron extension)
-- SELECT cron.schedule('cleanup-expired-reservations', '* * * * *', 'SELECT cleanup_expired_reservations();');
