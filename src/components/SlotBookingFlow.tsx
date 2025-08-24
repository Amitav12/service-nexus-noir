
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar, Clock, CreditCard, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useSlotBooking, useReservationTimer } from '@/hooks/useSlotBooking';
import { useToast } from '@/hooks/use-toast';
import { format, addDays, startOfDay, parseISO } from 'date-fns';

interface Slot {
  id: string;
  start_time: string;
  end_time: string;
  status: 'AVAILABLE' | 'HOLD' | 'BOOKED';
  service_id: string;
  provider_id: string;
  price: number;
}

interface Service {
  id: string;
  title: string;
  description: string;
  duration_minutes: number;
  price_amount: number;
  currency: string;
}

interface SlotBookingFlowProps {
  service: Service;
  provider: {
    id: string;
    name: string;
    rating: number;
  };
  onComplete?: (bookingId: string) => void;
  onCancel?: () => void;
}

export const SlotBookingFlow: React.FC<SlotBookingFlowProps> = ({
  service,
  provider,
  onComplete,
  onCancel
}) => {
  const [step, setStep] = useState<'slots' | 'confirm' | 'payment' | 'processing' | 'success'>('slots');
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [availableSlots, setAvailableSlots] = useState<Slot[]>([]);
  const [reservation, setReservation] = useState<{ reservationId: string; expiresAt: string } | null>(null);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { reserveSlot, initiateCheckout, subscribeToEvents } = useSlotBooking();
  const { remainingMs, formatted } = useReservationTimer(reservation?.expiresAt);
  const { toast } = useToast();

  // Load available slots
  useEffect(() => {
    loadAvailableSlots();
  }, [service.id, provider.id]);

  // Subscribe to real-time events
  useEffect(() => {
    const unsubscribe = subscribeToEvents((event) => {
      console.log('Real-time event:', event);
      
      switch (event.topic) {
        case 'slot_reserved':
          if (event.payload.reservation_id === reservation?.reservationId) {
            setStep('payment');
          }
          break;
        case 'booking_confirmed':
          if (event.payload.reservation_id === reservation?.reservationId) {
            setStep('success');
            onComplete?.(event.payload.booking_transaction_id);
          }
          break;
        case 'hold_expired':
          if (event.payload.reservation_id === reservation?.reservationId) {
            setError('Your reservation has expired. Please select a new time slot.');
            setReservation(null);
            setStep('slots');
            loadAvailableSlots();
          }
          break;
      }
    });

    return unsubscribe;
  }, [reservation, onComplete, subscribeToEvents]);

  // Auto-expire reservation when timer reaches zero
  useEffect(() => {
    if (remainingMs === 0 && reservation) {
      setError('Your reservation has expired. Please select a new time slot.');
      setReservation(null);
      setStep('slots');
      loadAvailableSlots();
    }
  }, [remainingMs, reservation]);

  const loadAvailableSlots = async () => {
    try {
      setLoading(true);
      // Mock API call - replace with actual slot loading
      const mockSlots: Slot[] = Array.from({ length: 20 }, (_, i) => {
        const date = addDays(new Date(), Math.floor(i / 4));
        const hour = 9 + (i % 4) * 2;
        const startTime = new Date(date);
        startTime.setHours(hour, 0, 0, 0);
        const endTime = new Date(startTime);
        endTime.setMinutes(service.duration_minutes);
        
        return {
          id: `slot-${i}`,
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
          status: Math.random() > 0.3 ? 'AVAILABLE' : 'BOOKED',
          service_id: service.id,
          provider_id: provider.id,
          price: service.price_amount / 100
        };
      });
      
      setAvailableSlots(mockSlots.filter(slot => slot.status === 'AVAILABLE'));
    } catch (error) {
      setError('Failed to load available slots. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSlotSelect = async (slot: Slot) => {
    try {
      setLoading(true);
      setError(null);
      
      const result = await reserveSlot({
        slotId: slot.id,
        holdMinutes: 15
      });
      
      setSelectedSlot(slot);
      setReservation(result);
      setStep('confirm');
      
      toast({
        title: 'Slot Reserved',
        description: `Time slot reserved for 15 minutes. Complete payment to confirm.`
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to reserve slot');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmBooking = async () => {
    if (!reservation) return;
    
    try {
      setLoading(true);
      setError(null);
      
      const checkout = await initiateCheckout(reservation.reservationId);
      setPaymentUrl(checkout.url);
      setStep('payment');
      
      // Open Stripe checkout in new tab
      window.open(checkout.url, '_blank');
      
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to initiate payment');
    } finally {
      setLoading(false);
    }
  };

  const renderStepContent = () => {
    switch (step) {
      case 'slots':
        return (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="w-5 h-5" />
                Select Available Time Slot
              </CardTitle>
              <CardDescription>
                Choose a convenient time for your {service.title}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {availableSlots.map((slot) => (
                    <Button
                      key={slot.id}
                      variant="outline"
                      className="h-auto p-3 flex flex-col items-center"
                      onClick={() => handleSlotSelect(slot)}
                      disabled={loading}
                    >
                      <div className="text-sm font-medium">
                        {format(parseISO(slot.start_time), 'MMM dd')}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {format(parseISO(slot.start_time), 'h:mm a')}
                      </div>
                    </Button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );

      case 'confirm':
        return (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5" />
                Confirm Your Booking
              </CardTitle>
              {reservation && (
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-orange-500" />
                  <span className="text-sm text-orange-600">
                    Reserved for {formatted} minutes
                  </span>
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <h3 className="font-medium">Service Details</h3>
                <div className="text-sm text-muted-foreground">
                  <div>{service.title}</div>
                  <div>Duration: {service.duration_minutes} minutes</div>
                  <div>Provider: {provider.name}</div>
                </div>
              </div>
              
              {selectedSlot && (
                <div className="space-y-2">
                  <h3 className="font-medium">Scheduled Time</h3>
                  <div className="text-sm">
                    {format(parseISO(selectedSlot.start_time), 'EEEE, MMMM dd, yyyy')} at{' '}
                    {format(parseISO(selectedSlot.start_time), 'h:mm a')}
                  </div>
                </div>
              )}
              
              <div className="space-y-2">
                <h3 className="font-medium">Total Amount</h3>
                <div className="text-2xl font-bold text-teal">
                  ${(service.price_amount / 100).toFixed(2)} {service.currency}
                </div>
              </div>
              
              <Button 
                onClick={handleConfirmBooking}
                disabled={loading}
                className="w-full"
                size="lg"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <CreditCard className="w-4 h-4 mr-2" />
                )}
                Proceed to Payment
              </Button>
            </CardContent>
          </Card>
        );

      case 'payment':
        return (
          <Card>
            <CardHeader>
              <CardTitle>Payment Processing</CardTitle>
              <CardDescription>
                Complete your payment in the new tab that opened
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center py-8">
              <div className="space-y-4">
                <Loader2 className="w-8 h-8 animate-spin mx-auto" />
                <div>
                  <p className="text-sm">Waiting for payment confirmation...</p>
                  {paymentUrl && (
                    <Button
                      variant="outline"
                      onClick={() => window.open(paymentUrl, '_blank')}
                      className="mt-2"
                    >
                      Reopen Payment Page
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );

      case 'success':
        return (
          <Card>
            <CardHeader>
              <CardTitle className="text-green-600 flex items-center gap-2">
                <CheckCircle className="w-5 h-5" />
                Booking Confirmed!
              </CardTitle>
              <CardDescription>
                Your service has been successfully booked
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-center py-4">
                <div className="text-lg font-medium">
                  Booking confirmed for {selectedSlot && format(parseISO(selectedSlot.start_time), 'EEEE, MMMM dd')}
                </div>
                <div className="text-sm text-muted-foreground">
                  You will receive a confirmation email shortly
                </div>
              </div>
              
              <Button onClick={onCancel} variant="outline" className="w-full">
                Book Another Service
              </Button>
            </CardContent>
          </Card>
        );

      default:
        return null;
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      {error && (
        <Alert className="mb-6" variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.3 }}
        >
          {renderStepContent()}
        </motion.div>
      </AnimatePresence>

      {onCancel && step !== 'success' && (
        <div className="mt-6 text-center">
          <Button variant="ghost" onClick={onCancel}>
            Cancel Booking
          </Button>
        </div>
      )}
    </div>
  );
};
