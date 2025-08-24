import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Calendar, Clock, User, Download, Star, CheckCircle, XCircle, AlertCircle, Edit, RotateCcw, Search, Filter } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useBookingsActions } from '@/hooks/useBookingsActions';
import { supabase } from '@/integrations/supabase/client';
import { format, isAfter, isBefore } from 'date-fns';
import BookingStatusBadge from '@/components/BookingStatusBadge';
import RatingReviewForm from '@/components/RatingReviewForm';

interface Booking {
  id: string;
  booking_number: string;
  service_date: string;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'accepted' | 'in_progress' | 'disputed';
  final_price: number;
  duration_minutes: number;
  service_address: string;
  special_instructions?: string;
  cancellation_reason?: string;
  created_at: string;
  provider_user_id: string;
  service_id?: string;
  services?: {
    title: string;
    provider_id: string;
  } | null;
  provider_profiles?: {
    business_name: string;
  } | null;
}

const MyBookings = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { confirmBooking, cancelBooking, loading: actionLoading } = useBookingsActions();
  
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRatingForm, setShowRatingForm] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('date_desc');

  const loadBookings = async () => {
    if (!user?.id) return;

    try {
      setLoading(true);
      console.log('Loading bookings for customer:', user.id);
      
      // First fetch bookings with services
      const { data: bookingsData, error: bookingsError } = await supabase
        .from('bookings')
        .select(`
          *,
          services (
            title,
            provider_id
          )
        `)
        .eq('customer_id', user.id)
        .order('service_date', { ascending: false });

      if (bookingsError) {
        console.error('Error loading bookings:', bookingsError);
        toast({
          title: 'Error',
          description: 'Failed to load bookings. Please try again.',
          variant: 'destructive'
        });
        return;
      }

      if (!bookingsData) {
        setBookings([]);
        return;
      }

      // Get unique provider user IDs
      const providerUserIds = [...new Set(bookingsData.map(booking => booking.provider_user_id))];

      // Fetch provider profiles separately
      const { data: providerProfiles, error: profilesError } = await supabase
        .from('provider_profiles')
        .select('user_id, business_name')
        .in('user_id', providerUserIds);

      if (profilesError) {
        console.error('Error loading provider profiles:', profilesError);
        // Continue without provider profiles rather than failing completely
      }

      // Create a map of provider profiles by user_id
      const profilesMap = new Map();
      if (providerProfiles) {
        providerProfiles.forEach(profile => {
          profilesMap.set(profile.user_id, profile);
        });
      }

      // Combine the data
      const enrichedBookings: Booking[] = bookingsData.map(booking => ({
        ...booking,
        services: booking.services || null,
        provider_profiles: profilesMap.get(booking.provider_user_id) || null
      }));

      console.log('Loaded bookings with enhanced data:', enrichedBookings);
      setBookings(enrichedBookings);
    } catch (error) {
      console.error('Error loading bookings:', error);
      toast({
        title: 'Error',
        description: 'Failed to load bookings. Please try again.',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBookings();

    // Set up real-time subscription for booking updates
    if (!user) return;

    const channel = supabase
      .channel('bookings-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bookings',
          filter: `customer_id=eq.${user.id}`
        },
        (payload) => {
          console.log('Booking change detected:', payload);
          loadBookings();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const handleConfirmBooking = async (bookingId: string) => {
    try {
      await confirmBooking(bookingId);
      loadBookings(); // Refresh the list
    } catch (error) {
      console.error('Error confirming booking:', error);
    }
  };

  const handleCancelBooking = async (bookingId: string) => {
    const reason = prompt('Please provide a reason for cancellation (optional):');
    try {
      await cancelBooking(bookingId, reason || undefined);
      loadBookings(); // Refresh the list
    } catch (error) {
      console.error('Error cancelling booking:', error);
    }
  };

  const handleCompleteBooking = async (bookingId: string) => {
    if (!user?.id) {
      toast({
        title: 'Error',
        description: 'You must be logged in to complete bookings.',
        variant: 'destructive'
      });
      return;
    }

    try {
      console.log('🔄 Completing booking:', bookingId);
      
      // Use the database function for proper status transition
      const { data, error } = await supabase.rpc('update_booking_status', {
        booking_uuid: bookingId,
        new_status: 'completed',
        user_uuid: user.id,
        status_notes: 'Service completed by provider'
      });

      if (error) {
        console.error('❌ Error completing booking:', error);
        throw error;
      }

      console.log('✅ Booking completed successfully');
      toast({
        title: 'Booking Completed',
        description: 'The booking has been marked as completed. Customer will be notified.'
      });
      
      loadBookings(); // Refresh the list
    } catch (error) {
      console.error('❌ Failed to complete booking:', error);
      toast({
        title: 'Error',
        description: 'Failed to complete booking. Please try again.',
        variant: 'destructive'
      });
    }
  };

  const handleDownloadInvoice = (booking: Booking) => {
    toast({
      title: 'Invoice Download',
      description: `Invoice for booking ${booking.booking_number} would be downloaded here. This feature will be fully implemented soon.`
    });
  };

  const handleReschedule = (bookingId: string) => {
    toast({
      title: 'Reschedule Booking',
      description: 'Reschedule functionality will be available soon. Please contact the provider directly for now.'
    });
  };

  const handleRatingSubmitSuccess = () => {
    setShowRatingForm(null);
    loadBookings(); // Refresh to show any updates
    toast({
      title: 'Review Submitted',
      description: 'Thank you for your feedback!'
    });
  };

  // Filter and search bookings
  const filteredBookings = bookings.filter(booking => {
    const matchesSearch = searchTerm === '' || 
      booking.booking_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      booking.services?.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      booking.provider_profiles?.business_name?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = statusFilter === 'all' || booking.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  // Sort bookings
  const sortedBookings = [...filteredBookings].sort((a, b) => {
    switch (sortBy) {
      case 'date_asc':
        return new Date(a.service_date).getTime() - new Date(b.service_date).getTime();
      case 'date_desc':
        return new Date(b.service_date).getTime() - new Date(a.service_date).getTime();
      case 'price_asc':
        return a.final_price - b.final_price;
      case 'price_desc':
        return b.final_price - a.final_price;
      default:
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
  });

  // Separate bookings into upcoming and past
  const now = new Date();
  const upcomingBookings = sortedBookings.filter(booking => 
    isAfter(new Date(booking.service_date), now) && 

    (booking.status === 'pending' || booking.status === 'confirmed' || booking.status === 'accepted' || booking.status === 'in_progress')

  );
  
  const pastBookings = sortedBookings.filter(booking => 
    isBefore(new Date(booking.service_date), now) || 
    booking.status === 'completed' || 
    booking.status === 'cancelled'
  );

  const renderBookingCard = (booking: Booking, isPast: boolean = false) => {
    // Safe access with proper fallbacks
    const serviceName = booking.services?.title || 'Service';
    const providerName = booking.provider_profiles?.business_name || 'Provider';

    return (
      <Card key={booking.id} className="hover:shadow-lg transition-shadow">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <span>{serviceName}</span>
                <BookingStatusBadge status={booking.status as 'pending' | 'confirmed' | 'completed' | 'cancelled'} />
              </CardTitle>
              <CardDescription>
                Booking #{booking.booking_number} • Booked on {format(new Date(booking.created_at), 'PPP')}
              </CardDescription>
              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                <User className="w-4 h-4" />
                <span>Provider: {providerName}</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-teal">${booking.final_price}</div>
              <div className="text-sm text-muted-foreground">Total Price</div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Calendar className="w-4 h-4" />
                  <span>{format(new Date(booking.service_date), 'PPP p')}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="w-4 h-4" />
                  <span>{booking.duration_minutes} minutes</span>
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-sm">
                  <div className="font-medium text-foreground">Service Address:</div>
                  <div className="text-muted-foreground">{booking.service_address}</div>
                </div>
                {booking.special_instructions && (
                  <div className="text-sm">
                    <div className="font-medium text-foreground">Special Instructions:</div>
                    <div className="text-muted-foreground">{booking.special_instructions}</div>
                  </div>
                )}
                {booking.cancellation_reason && (
                  <div className="text-sm">
                    <div className="font-medium text-foreground">Cancellation Reason:</div>
                    <div className="text-muted-foreground text-red-600">{booking.cancellation_reason}</div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-between items-center pt-4 border-t border-border">
              <div className="flex gap-2 flex-wrap">
                {/* Upcoming booking actions */}
                {!isPast && booking.status === 'confirmed' && (
                  <Button
                    onClick={() => handleReschedule(booking.id)}
                    variant="outline"
                    size="sm"
                    className="hover:bg-blue-50"
                  >
                    <RotateCcw className="w-4 h-4 mr-2" />
                    Reschedule
                  </Button>
                )}
                
                {/* Provider can mark confirmed bookings as completed */}
                {!isPast && booking.status === 'confirmed' && user?.id === booking.provider_user_id && (
                  <Button
                    onClick={() => handleCompleteBooking(booking.id)}
                    disabled={actionLoading}
                    size="sm"
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Mark Complete
                  </Button>
                )}
                
                {!isPast && (booking.status === 'pending' || booking.status === 'confirmed') && (
                  <Button
                    onClick={() => handleCancelBooking(booking.id)}
                    disabled={actionLoading}
                    variant="destructive"
                    size="sm"
                  >
                    <XCircle className="w-4 h-4 mr-2" />
                    Cancel
                  </Button>
                )}

                {/* Past booking actions */}
                {isPast && booking.status === 'completed' && (
                  <>
                    <Button
                      onClick={() => handleConfirmBooking(booking.id)}
                      disabled={actionLoading}
                      size="sm"
                      className="bg-green-600 hover:bg-green-700"
                    >
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Confirm Service
                    </Button>
                    <Button
                      onClick={() => setShowRatingForm(booking.id)}
                      variant="outline"
                      size="sm"
                      className="hover:bg-yellow-50"
                    >
                      <Star className="w-4 h-4 mr-2" />
                      Rate & Review
                    </Button>
                  </>
                )}
              </div>
              
              <Button
                onClick={() => handleDownloadInvoice(booking)}
                variant="outline"
                size="sm"
                className="hover:bg-teal/10"
              >
                <Download className="w-4 h-4 mr-2" />
                Invoice
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">My Bookings</h1>
          <p className="text-muted-foreground">Loading your booking history...</p>
        </div>
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">My Bookings</h1>
        <p className="text-muted-foreground">View and manage your service booking history</p>
      </div>

      {/* Search and Filter Section */}
      <div className="flex flex-col sm:flex-row gap-4 p-4 bg-card rounded-lg border">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by booking number, service, or provider..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[150px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="confirmed">Confirmed</SelectItem>
              <SelectItem value="accepted">Accepted</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date_desc">Latest First</SelectItem>
              <SelectItem value="date_asc">Oldest First</SelectItem>
              <SelectItem value="price_desc">Price High to Low</SelectItem>
              <SelectItem value="price_asc">Price Low to High</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs defaultValue="upcoming" className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="upcoming">
            Upcoming Bookings ({upcomingBookings.length})
          </TabsTrigger>
          <TabsTrigger value="past">
            Past Bookings ({pastBookings.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upcoming" className="mt-6">
          {upcomingBookings.length === 0 ? (
            <div className="text-center py-12">
              <Calendar className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No upcoming bookings found.</p>
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              {upcomingBookings.map((booking) => renderBookingCard(booking, false))}
            </motion.div>
          )}
        </TabsContent>

        <TabsContent value="past" className="mt-6">
          {pastBookings.length === 0 ? (
            <div className="text-center py-12">
              <Calendar className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No past bookings found.</p>
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              {pastBookings.map((booking) => renderBookingCard(booking, true))}
            </motion.div>
          )}
        </TabsContent>
      </Tabs>

      {/* Rating Form Modal */}
      {showRatingForm && (
        <RatingReviewForm
          bookingId={showRatingForm}
          providerUserId={bookings.find(b => b.id === showRatingForm)?.provider_user_id || ''}
          serviceName={bookings.find(b => b.id === showRatingForm)?.services?.title || 'Service'}
          providerName={bookings.find(b => b.id === showRatingForm)?.provider_profiles?.business_name || 'Provider'}
          onSubmitSuccess={handleRatingSubmitSuccess}
          onCancel={() => setShowRatingForm(null)}
        />
      )}
    </div>
  );
};

export default MyBookings;