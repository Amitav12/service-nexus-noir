
-- Create slots table for time slot management
CREATE TABLE IF NOT EXISTS public.slots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES auth.users(id),
    service_id UUID NOT NULL REFERENCES public.services(id),
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'HOLD', 'BOOKED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create reservations table for temporary slot holds
CREATE TABLE IF NOT EXISTS public.reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    slot_id UUID NOT NULL REFERENCES public.slots(id),
    status TEXT NOT NULL DEFAULT 'HOLD' CHECK (status IN ('HOLD', 'EXPIRED', 'CONFIRMED')),
    hold_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Add RLS policies for slots table
ALTER TABLE public.slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view available slots" ON public.slots
    FOR SELECT USING (status = 'AVAILABLE');

CREATE POLICY "Providers can manage their slots" ON public.slots
    FOR ALL USING (auth.uid() = provider_id);

CREATE POLICY "Admins can manage all slots" ON public.slots
    FOR ALL USING (is_admin(auth.uid()));

-- Add RLS policies for reservations table  
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their reservations" ON public.reservations
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their reservations" ON public.reservations
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their reservations" ON public.reservations
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage all reservations" ON public.reservations
    FOR ALL USING (is_admin(auth.uid()));

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_slots_provider_service ON public.slots(provider_id, service_id);
CREATE INDEX IF NOT EXISTS idx_slots_start_time ON public.slots(start_time);
CREATE INDEX IF NOT EXISTS idx_reservations_user_id ON public.reservations(user_id);
CREATE INDEX IF NOT EXISTS idx_reservations_slot_id ON public.reservations(slot_id);
CREATE INDEX IF NOT EXISTS idx_reservations_expires_at ON public.reservations(hold_expires_at);
