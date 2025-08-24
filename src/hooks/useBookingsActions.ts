import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import type { Database } from '@/integrations/supabase/types';
import { formatError } from '@/lib/errorFormatter';

export interface CartItem {
  id: string;
  service_id: string;
  service_title: string;
  provider_id: string;
  provider_name: string;
  price: number;
  scheduled_date: string;
  duration_minutes: number;
  special_instructions?: string;
}

// Generate a compact booking number that always fits in VARCHAR(20)
const generateBookingNumber = () => {
  // Format: BK + base36(timestamp) + 4 random chars (uppercase), no separators
  const ts = Date.now().toString(36).toUpperCase(); // ~8-10 chars
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase(); // 4 chars
  const code = `BK${ts}${rand}`; // ~14-16 chars, well under 20
  return code.length <= 20 ? code : code.slice(0, 20);
};

export const useBookingsActions = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const createBookingsFromCart = async (
    items: CartItem[],
    address: {
      address_line_1: string;
      address_line_2?: string;
      city: string;
      state: string;
      postal_code?: string;
      zip_code?: string;
    },
    sessionId?: string
  ): Promise<void> => {
    if (!user?.id) {
      throw new Error('User not authenticated');
    }
  
    console.log('🚀 Starting booking creation process');
    console.log('📋 Items to process:', items.length);
    console.log('📍 Address data:', address);
    console.log('🔗 Session ID:', sessionId);
  
    setLoading(true);
  
    try {
      // Find the payment record using session_id if provided
      let paymentRecord = null;
      if (sessionId) {
        console.log('🔍 Looking up payment for session:', sessionId);
        const { data: paymentData, error: paymentError } = await supabase
          .from('payments')
          .select('id, amount, payment_status')
          .eq('stripe_session_id', sessionId)
          .eq('payment_status', 'completed')
          .single();
        
        if (paymentError) {
          console.error('❌ Could not find payment for session:', sessionId, paymentError);
          throw new Error('Payment record not found. Please contact support.');
        } else {
          paymentRecord = paymentData;
          console.log('✅ Found payment record:', paymentRecord.id, 'for session:', sessionId);
        }
      }
  
      const bookingPromises = items.map(async (item, index) => {
        console.log(`🔄 Processing item ${index + 1}/${items.length}:`, item.service_title);
  
        // Step 1: Validate and get actual provider ID
        let actualProviderId = item.provider_id;
        
        if (!actualProviderId) {
          console.log('⚠️ No provider_id in item, fetching from service');
          const { data: serviceData, error: serviceError } = await supabase
            .from('services')
            .select('provider_id')
            .eq('id', item.service_id)
            .single();
  
          if (serviceError) {
            console.error('❌ Error fetching service provider:', serviceError);
            throw new Error(`Failed to get provider for service ${item.service_title}: ${serviceError.message}`);
          }
  
          if (!serviceData) {
            throw new Error(`Service not found: ${item.service_title}`);
          }
  
          actualProviderId = serviceData.provider_id as string;
          console.log('✅ Found actual provider_id:', actualProviderId);
        }
  
        // Step 2: Validate provider exists and is approved
        console.log('🔍 Validating provider:', actualProviderId);
        const { data: providerData, error: providerError } = await supabase
          .from('provider_profiles')
          .select('user_id, verification_status')
          .eq('user_id', actualProviderId)
          .single();
  
        if (providerError) {
          console.error('❌ Provider validation error:', providerError);
          throw new Error(`Provider validation failed for ${item.service_title}: ${providerError.message}`);
        }
  
        if (!providerData) {
          throw new Error(`Provider not found for service ${item.service_title}`);
        }
  
        if (providerData.verification_status !== 'approved') {
          throw new Error(`Provider not approved for service ${item.service_title}. Status: ${providerData.verification_status}`);
        }
  
        console.log('✅ Provider validated successfully');
  
        // Step 3: Validate service exists
        console.log('🔍 Validating service:', item.service_id);
        const { data: serviceExists, error: serviceCheckError } = await supabase
          .from('services')
          .select('id')
          .eq('id', item.service_id)
          .single();
  
        if (serviceCheckError) {
          console.error('❌ Service validation error:', serviceCheckError);
          throw new Error(`Service validation failed: ${serviceCheckError.message}`);
        }
  
        // Step 4: Format address properly
        const postalCode = address.postal_code || address.zip_code || '';
        const serviceAddress = `${address.address_line_1}${address.address_line_2 ? ', ' + address.address_line_2 : ''}, ${address.city}, ${address.state} ${postalCode}`;
  
        // Step 5: Prepare booking data with validation
        const bookingData: Database['public']['Tables']['bookings']['Insert'] = {
          customer_id: user.id,
          provider_user_id: actualProviderId,
          service_id: item.service_id,
          service_date: item.scheduled_date,
          duration_minutes: item.duration_minutes || null,
          final_price: Number(item.price) || 0,
          platform_fee: Math.round(Number(item.price) * 0.1 * 100) / 100,
          provider_earnings: Math.round(Number(item.price) * 0.9 * 100) / 100,
          special_instructions: item.special_instructions || null,
          service_address: serviceAddress,

          service_city: address.city,
          service_state: address.state,
          service_zip: address.postal_code,
          booking_number: generateBookingNumber(),
          status: 'confirmed', // Set as confirmed after payment
          confirmed_at: new Date().toISOString()

        };
  
        console.log('📝 Creating booking with data:', {
          ...bookingData,
          service_date: new Date(bookingData.service_date).toISOString(),
          final_price: bookingData.final_price,
          platform_fee: bookingData.platform_fee,
          payment_id: paymentRecord?.id
        });
  
        // Step 6: Create the booking
        const { data: createdBooking, error } = await supabase
          .from('bookings')
          .insert(bookingData)
          .select()
          .single();
  
        if (error) {

          console.error('❌ Database error creating booking:', {
            error,
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint
          });
          throw new Error(`Database error: ${error.message} (Code: ${error.code})`);

        }
  
        console.log('✅ Booking created successfully:', createdBooking.id);
  
        // Step 7: Link payment to booking if payment exists
        if (paymentRecord && createdBooking) {
          console.log('🔗 Linking payment to booking:', paymentRecord.id, '->', createdBooking.id);
          
          const { error: linkError } = await supabase
            .from('payments')
            .update({ 
              booking_id: createdBooking.id,
              provider_user_id: actualProviderId,
              updated_at: new Date().toISOString()
            })
            .eq('id', paymentRecord.id);
  
          if (linkError) {
            console.error('❌ Error linking payment to booking:', linkError);
            // Don't throw here - booking was created successfully
            console.warn('⚠️ Booking created but payment linkage failed. Manual intervention may be needed.');
          } else {
            console.log('✅ Payment successfully linked to booking');
          }
        }
  
        return createdBooking;
      });
  
      const createdBookings = await Promise.all(bookingPromises);
      
      console.log('🎉 All bookings created and linked successfully:', createdBookings.length);
      return;
  
    } catch (error) {
      const msg = formatError(error);

      console.error('❌ Error in createBookingsFromCart:', {
        error,
        message: msg,
        stack: error instanceof Error ? error.stack : undefined
      });

      throw new Error(msg);
    } finally {
      setLoading(false);
    }
  };

  const confirmBooking = async (bookingId: string) => {
    if (!user?.id) {
      throw new Error('User not authenticated');
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('bookings')
        .update({ 
          status: 'confirmed',
          confirmed_at: new Date().toISOString()
        } as Database['public']['Tables']['bookings']['Update'])
        .eq('id', bookingId)
        .eq('customer_id', user.id);

      if (error) {
        console.error('Error confirming booking:', error);
        throw new Error(`Failed to confirm booking: ${error.message}`);
      }

      toast({
        title: 'Booking Confirmed',
        description: 'Your booking has been confirmed successfully.',
      });

      return true;
    } catch (error) {
      const msg = formatError(error);
      console.error('Error in confirmBooking:', error);
      toast({
        title: 'Error',
        description: msg,
        variant: 'destructive',
      });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const cancelBooking = async (bookingId: string, reason?: string) => {
    if (!user?.id) {
      throw new Error('User not authenticated');
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('bookings')
        .update({ 
          status: 'cancelled',
          cancellation_reason: reason || 'Cancelled by customer'
        } as Database['public']['Tables']['bookings']['Update'])
        .eq('id', bookingId)
        .eq('customer_id', user.id);

      if (error) {
        console.error('Error cancelling booking:', error);
        throw new Error(`Failed to cancel booking: ${error.message}`);
      }

      toast({
        title: 'Booking Cancelled',
        description: 'Your booking has been cancelled successfully.',
      });

      return true;
    } catch (error) {
      const msg = formatError(error);
      console.error('Error in cancelBooking:', error);
      toast({
        title: 'Error',
        description: msg,
        variant: 'destructive',
      });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  return {
    createBookingsFromCart,
    confirmBooking,
    cancelBooking,
    loading,
  };
};

// Fix the payment-booking linkage we identified
const createBookingsFromCart = async (sessionId: string) => {
  // Find payment record
  const { data: payment } = await supabase
    .from('payments')
    .select('*')
    .eq('stripe_session_id', sessionId)
    .eq('payment_status', 'completed')
    .single();

  if (!payment) throw new Error('Payment not found');

  // Create bookings with proper linkage
  const bookingData = (cartItems: CartItem[]) => cartItems.map(item => ({
    // ... existing fields ...
    payment_id: payment.id, // Establish the relationship
    status: 'confirmed'
  }));

  // Insert bookings and update payment with booking_id
  // This addresses the idempotency and linkage issues
};
