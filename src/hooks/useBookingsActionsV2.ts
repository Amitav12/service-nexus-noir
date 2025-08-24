
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';

interface CancelBookingParams {
  bookingId: string;
  reason: string;
}

export const useBookingsActionsV2 = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Accept booking
  const acceptBooking = useMutation({
    mutationFn: async ({ bookingId, notes }: { bookingId: string; notes?: string }) => {
      console.log('🔄 Accepting booking:', bookingId);
      
      if (!user?.id) {
        throw new Error('User not authenticated');
      }

      const { data: booking, error: fetchError } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', bookingId)
        .single();

      if (fetchError) {
        console.error('❌ Error fetching booking:', fetchError);
        throw new Error('Failed to fetch booking details');
      }

      // FIX: use provider_user_id (schema) instead of provider_id
      if (booking.provider_user_id !== user.id) {
        throw new Error('You are not authorized to accept this booking');
      }

      if (booking.status !== 'pending') {
        throw new Error('This booking cannot be accepted');
      }

      const { error } = await supabase
        .from('bookings')
        .update({ 
          status: 'accepted',
          provider_notes: notes,
          accepted_at: new Date().toISOString()
        })
        .eq('id', bookingId);

      if (error) {
        console.error('❌ Error accepting booking:', error);
        throw error;
      }

      return { bookingId, status: 'accepted' };
    },
    onSuccess: () => {
      console.log('✅ Booking accepted successfully');
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['provider-bookings'] });
      toast({
        title: "Booking Accepted",
        description: "The booking has been accepted successfully.",
      });
    },
    onError: (error) => {
      console.error('❌ Error accepting booking:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to accept booking. Please try again.",
        variant: "destructive",
      });
    }
  });

  // Mark in progress
  const markInProgress = useMutation({
    mutationFn: async ({ bookingId, notes }: { bookingId: string; notes?: string }) => {
      console.log('🔄 Marking booking in progress:', bookingId);
      
      if (!user?.id) {
        throw new Error('User not authenticated');
      }

      const { data: booking, error: fetchError } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', bookingId)
        .single();

      if (fetchError) {
        console.error('❌ Error fetching booking:', fetchError);
        throw new Error('Failed to fetch booking details');
      }

      // FIX: use provider_user_id instead of provider_id
      if (booking.provider_user_id !== user.id) {
        throw new Error('You are not authorized to update this booking');
      }

      if (booking.status !== 'accepted') {
        throw new Error('This booking cannot be marked as in progress');
      }

      const { error } = await supabase
        .from('bookings')
        .update({ 
          status: 'in_progress',
          provider_notes: notes,
          started_at: new Date().toISOString()
        })
        .eq('id', bookingId);

      if (error) {
        console.error('❌ Error updating booking status:', error);
        throw error;
      }

      return { bookingId, status: 'in_progress' };
    },
    onSuccess: () => {
      console.log('✅ Booking marked in progress successfully');
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['provider-bookings'] });
      toast({
        title: "Booking Started",
        description: "The booking has been marked as in progress.",
      });
    },
    onError: (error) => {
      console.error('❌ Error updating booking:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to update booking status. Please try again.",
        variant: "destructive",
      });
    }
  });

  // Complete booking
  const completeBooking = useMutation({
    mutationFn: async ({ bookingId, notes }: { bookingId: string; notes?: string }) => {
      console.log('🔄 Completing booking:', bookingId);
      
      if (!user?.id) {
        throw new Error('User not authenticated');
      }

      const { data: booking, error: fetchError } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', bookingId)
        .single();

      if (fetchError) {
        console.error('❌ Error fetching booking:', fetchError);
        throw new Error('Failed to fetch booking details');
      }

      // FIX: use provider_user_id instead of provider_id
      if (booking.provider_user_id !== user.id) {
        throw new Error('You are not authorized to complete this booking');
      }

      if (booking.status !== 'in_progress') {
        throw new Error('This booking cannot be completed');
      }

      const { error } = await supabase
        .from('bookings')
        .update({ 
          status: 'completed',
          provider_notes: notes,
          completed_at: new Date().toISOString()
        })
        .eq('id', bookingId);

      if (error) {
        console.error('❌ Error completing booking:', error);
        throw error;
      }

      return { bookingId, status: 'completed' };
    },
    onSuccess: () => {
      console.log('✅ Booking completed successfully');
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['provider-bookings'] });
      toast({
        title: "Booking Completed",
        description: "The booking has been marked as completed.",
      });
    },
    onError: (error) => {
      console.error('❌ Error completing booking:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to complete booking. Please try again.",
        variant: "destructive",
      });
    }
  });

  // Cancel booking
  const cancelBooking = useMutation({
    mutationFn: async ({ bookingId, reason }: CancelBookingParams) => {
      console.log('🔄 Cancelling booking:', bookingId, 'Reason:', reason);
      
      if (!user?.id) {
        throw new Error('User not authenticated');
      }

      const { data: booking, error: fetchError } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', bookingId)
        .single();

      if (fetchError) {
        console.error('❌ Error fetching booking:', fetchError);
        throw new Error('Failed to fetch booking details');
      }

      // FIX: use provider_user_id instead of provider_id
      if (booking.provider_user_id !== user.id) {
        throw new Error('You are not authorized to cancel this booking');
      }

      if (['cancelled', 'completed'].includes(booking.status)) {
        throw new Error('This booking cannot be cancelled');
      }

      const { error } = await supabase
        .from('bookings')
        .update({ 
          status: 'cancelled',
          cancellation_reason: reason,
          cancelled_at: new Date().toISOString()
        })
        .eq('id', bookingId);

      if (error) {
        console.error('❌ Error cancelling booking:', error);
        throw error;
      }

      return { bookingId, status: 'cancelled' };
    },
    onSuccess: () => {
      console.log('✅ Booking cancelled successfully');
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['provider-bookings'] });
      toast({
        title: "Booking Cancelled",
        description: "The booking has been cancelled successfully.",
      });
    },
    onError: (error) => {
      console.error('❌ Error cancelling booking:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to cancel booking. Please try again.",
        variant: "destructive",
      });
    }
  });

  return {
    acceptBooking,
    markInProgress,
    completeBooking,
    cancelBooking
  };
};
