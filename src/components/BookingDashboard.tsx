
import React, { useState, useEffect } from 'react';
import { Calendar, Clock, User } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { format, parseISO } from 'date-fns';

interface Booking {
  id: string;
  user_id: string;
  service_id: string;
  provider_id: string;
  slot_id: string;
  status: 'PAID' | 'CANCELLED' | 'REFUNDED';
  transaction_id: string;
  created_at: string;
  slots?: {
    start_time: string;
    end_time: string;
  };
  services?: {
    title: string;
    description: string;
  };
  providers?: {
    name: string;
    contact: any;
  };
}

interface Reservation {
  id: string;
  user_id: string;
  slot_id: string;
  status: 'HOLD' | 'EXPIRED' | 'CONFIRMED';
  hold_expires_at: string;
  created_at: string;
  slots?: {
    start_time: string;
    end_time: string;
    services?: {
      title: string;
    };
  };
}

export const BookingDashboard: React.FC = () => {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  // Use a locally untyped client to avoid deep type instantiation issues
  const sb = supabase as any;

  useEffect(() => {
    loadUserData();
  }, []);

  const loadUserData = async () => {
    try {
      setLoading(true);
      const { data: session } = await sb.auth.getSession();
      if (!session.session) return;

      // Load bookings
      const { data: bookingsData, error: bookingsError } = await sb
        .from('bookings')
        .select(`
          *,
          slots (
            start_time,
            end_time
          ),
          services (
            title,
            description
          ),
          providers (
            name,
            contact
          )
        `)
        .eq('user_id', session.session.user.id)
        .order('created_at', { ascending: false });

      if (bookingsError) throw bookingsError;

      // Load active reservations
      const { data: reservationsData, error: reservationsError } = await sb
        .from('reservations')
        .select(`
          *,
          slots (
            start_time,
            end_time,
            services (title)
          )
        `)
        .eq('user_id', session.session.user.id)
        .in('status', ['HOLD', 'CONFIRMED'])
        .order('created_at', { ascending: false });

      if (reservationsError) throw reservationsError;

      setBookings((bookingsData || []) as Booking[]);
      setReservations((reservationsData || []) as Reservation[]);
    } catch (error) {
      console.error('Failed to load booking data:', error);
      toast({
        title: 'Error',
        description: 'Failed to load booking data',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PAID':
      case 'CONFIRMED':
        return 'bg-green-100 text-green-800';
      case 'HOLD':
        return 'bg-yellow-100 text-yellow-800';
      case 'CANCELLED':
      case 'EXPIRED':
        return 'bg-red-100 text-red-800';
      case 'REFUNDED':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const isExpired = (expiresAt: string) => {
    return new Date(expiresAt) < new Date();
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">My Bookings</h1>
        <p className="text-muted-foreground">
          Manage your service bookings and reservations
        </p>
      </div>

      <Tabs defaultValue="bookings" className="space-y-6">
        <TabsList>
          <TabsTrigger value="bookings">Confirmed Bookings</TabsTrigger>
          <TabsTrigger value="reservations">
            Active Reservations ({reservations.filter(r => r.status === 'HOLD' && !isExpired(r.hold_expires_at)).length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="bookings">
          <div className="grid gap-4">
            {bookings.length === 0 ? (
              <Card>
                <CardContent className="text-center py-8">
                  <Calendar className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No bookings yet</h3>
                  <p className="text-muted-foreground">
                    Your confirmed bookings will appear here
                  </p>
                </CardContent>
              </Card>
            ) : (
              bookings.map((booking) => (
                <Card key={booking.id}>
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3 className="text-lg font-semibold">
                          {booking.services?.title}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          Booking ID: {booking.id.slice(0, 8)}...
                        </p>
                      </div>
                      <Badge className={getStatusColor(booking.status)}>
                        {booking.status}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm">
                          {booking.slots && format(parseISO(booking.slots.start_time), 'MMM dd, yyyy')}
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm">
                          {booking.slots && format(parseISO(booking.slots.start_time), 'h:mm a')} - 
                          {booking.slots && format(parseISO(booking.slots.end_time), 'h:mm a')}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm">
                          {booking.providers?.name}
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 flex gap-2">
                      <Button size="sm" variant="outline">
                        View Details
                      </Button>
                      {booking.status === 'PAID' && (
                        <Button size="sm" variant="outline" className="text-red-600">
                          Cancel Booking
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="reservations">
          <div className="grid gap-4">
            {reservations.length === 0 ? (
              <Card>
                <CardContent className="text-center py-8">
                  <Clock className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No active reservations</h3>
                  <p className="text-muted-foreground">
                    Your temporary slot reservations will appear here
                  </p>
                </CardContent>
              </Card>
            ) : (
              reservations.map((reservation) => (
                <Card key={reservation.id}>
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3 className="text-lg font-semibold">
                          {reservation.slots?.services?.title}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          Reservation ID: {reservation.id.slice(0, 8)}...
                        </p>
                      </div>
                      <Badge className={getStatusColor(reservation.status)}>
                        {reservation.status}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm">
                          {reservation.slots && format(parseISO(reservation.slots.start_time), 'MMM dd, yyyy')}
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm">
                          {reservation.slots && format(parseISO(reservation.slots.start_time), 'h:mm a')}
                        </span>
                      </div>
                    </div>

                    {reservation.status === 'HOLD' && new Date(reservation.hold_expires_at) > new Date() && (
                      <div className="mt-4 p-3 bg-yellow-50 rounded-lg">
                        <div className="flex items-center gap-2 text-yellow-800">
                          <Clock className="w-4 h-4" />
                          <span className="text-sm font-medium">
                            Expires {format(parseISO(reservation.hold_expires_at), 'h:mm a')}
                          </span>
                        </div>
                        <p className="text-xs text-yellow-600 mt-1">
                          Complete payment to confirm this booking
                        </p>
                      </div>
                    )}

                    <div className="mt-4 flex gap-2">
                      <Button size="sm">
                        Complete Payment
                      </Button>
                      <Button size="sm" variant="outline">
                        Release Hold
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};
