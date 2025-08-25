import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import type { Database } from '@/integrations/supabase/database';
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
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  const code = `BK${ts}${rand}`;
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
      // Since we're here, payment was successful (session_id in URL confirms this)
      // Create payment record if sessionId provided for tracking
      let paymentRecord = null;
      if (sessionId) {
        console.log('🔍 Creating/updating payment record for session:', sessionId);
        
        // Calculate total amount
        const totalAmount = items.reduce((sum, item) => sum + item.price, 0);
        
        // Create payment record for tracking
        const { data: paymentData, error: paymentError } = await supabase
          .from('payments')
          .insert({
            customer_id: user.id,
            amount: totalAmount,
            currency: 'USD',
            payment_status: 'completed',
            stripe_session_id: sessionId,
            processed_at: new Date().toISOString()
          })
          .select('id, amount, payment_status')
          .single();
        
        if (paymentError && paymentError.code !== '23505') { // Ignore duplicate key error
          console.warn('⚠️ Could not create payment record:', paymentError);
          // Don't throw error - bookings are more important than payment tracking
        } else if (paymentData) {
          paymentRecord = paymentData;
          console.log('✅ Created payment record:', paymentRecord.id, 'for session:', sessionId);
        }
      }
  
      const createdBookings = [];
      
      // Process bookings sequentially to avoid conflicts
      for (let index = 0; index < items.length; index++) {
        const item = items[index];
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
  
          if (serviceError || !serviceData) {
            throw new Error(`Failed to get provider for service ${item.service_title}: ${serviceError?.message}`);
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
  
        if (providerError || !providerData) {
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
          throw new Error(`Service validation failed: ${serviceCheckError.message}`);
        }
  
        // Step 4: Format address properly
        const postalCode = address.postal_code || address.zip_code || '';
        const serviceAddress = `${address.address_line_1}${address.address_line_2 ? ', ' + address.address_line_2 : ''}, ${address.city}, ${address.state} ${postalCode}`;
  
        // Step 5: Prepare booking data with CONFIRMED status immediately
        const now = new Date().toISOString();
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
          status: 'confirmed', // Set as confirmed immediately after payment
          confirmed_at: now
        };
  
        console.log('📝 Creating booking with confirmed status:', bookingData.booking_number);
  
        // Step 6: Create the booking
        console.log('📊 Inserting booking data:', JSON.stringify(bookingData, null, 2));
        
        const { data: createdBooking, error } = await supabase
          .from('bookings')
          .insert(bookingData)
          .select()
          .single();

        if (error) {
          console.error('❌ Database error creating booking:', error);
          console.error('❌ Booking data that failed:', bookingData);
          throw new Error(`Database error: ${error.message} (Code: ${error.code}) - Details: ${error.details || 'No details'}`);
        }
  
        console.log('✅ Booking created successfully:', createdBooking.id, 'with status:', createdBooking.status);
        createdBookings.push(createdBooking);
  
        // Step 7: Link payment to booking if payment exists
        if (paymentRecord && createdBooking) {
          console.log('🔗 Linking payment to booking:', paymentRecord.id, '->', createdBooking.id);
          
          const { error: linkError } = await supabase
            .from('payments')
            .update({ 
              booking_id: createdBooking.id,
              provider_user_id: actualProviderId,
              updated_at: now
            })
            .eq('id', paymentRecord.id);

          if (linkError) {
            console.error('❌ Error linking payment to booking:', linkError);
            console.warn('⚠️ Booking created but payment linkage failed. Manual intervention may be needed.');
          } else {
            console.log('✅ Payment successfully linked to booking');
          }
        } else if (createdBooking) {
          console.log('ℹ️ Booking created without payment record linking');
        }
      }
      
      console.log('🎉 All bookings created successfully:', createdBookings.length, 'bookings with confirmed status');
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
