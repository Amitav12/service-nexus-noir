import React, { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useShoppingCart } from '@/hooks/useShoppingCart';
import { useBookingsActions } from '@/hooks/useBookingsActions';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, CreditCard, CheckCircle } from 'lucide-react';

interface PaymentFallbackHandlerProps {
  onBookingsCreated: () => void;
  onError: (error: string) => void;
}

const PaymentFallbackHandler: React.FC<PaymentFallbackHandlerProps> = ({
  onBookingsCreated,
  onError
}) => {
  const { user } = useAuth();
  const { clearCart } = useShoppingCart();
  const { createBookingsFromCart } = useBookingsActions();
  const { toast } = useToast();
  const [processing, setProcessing] = useState(false);

  const handleFallbackProcessing = async () => {
    if (!user?.id) {
      onError('User not authenticated');
      return;
    }

    const pendingItems = sessionStorage.getItem('pendingCheckoutItems');
    const pendingAddress = sessionStorage.getItem('pendingCheckoutAddress');
    const checkoutTimestamp = sessionStorage.getItem('checkoutTimestamp');

    if (!pendingItems || !pendingAddress || !checkoutTimestamp) {
      onError('No pending checkout data found');
      return;
    }

    const timeElapsed = Date.now() - parseInt(checkoutTimestamp);
    if (timeElapsed > 30 * 60 * 1000) { // 30 minutes
      onError('Checkout session expired. Please start a new checkout if needed.');
      return;
    }

    setProcessing(true);
    try {
      const items = JSON.parse(pendingItems);
      const address = JSON.parse(pendingAddress);

      console.log('🔄 Fallback: Creating bookings without session_id');
      
      // Create bookings without session_id (payment verification will be manual)
      await createBookingsFromCart(items, address);
      
      // Clear data after successful creation
      clearCart();
      sessionStorage.removeItem('pendingCheckoutItems');
      sessionStorage.removeItem('pendingCheckoutAddress');
      sessionStorage.removeItem('checkoutTimestamp');
      
      toast({
        title: 'Bookings Created',
        description: 'Your bookings have been created. Payment verification is in progress.',
      });

      onBookingsCreated();
    } catch (error) {
      console.error('❌ Fallback booking creation failed:', error);
      onError('Failed to create bookings. Please contact support.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-yellow-500" />
          <CardTitle>Payment Processing Issue</CardTitle>
        </div>
        <CardDescription>
          We detected that you may have completed a payment, but we're missing some confirmation details.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            If you just completed a payment and were redirected here, click below to create your bookings:
          </p>
        </div>
        
        <div className="flex flex-col gap-2">
          <Button 
            onClick={handleFallbackProcessing}
            disabled={processing}
            className="w-full"
          >
            {processing ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                Creating Bookings...
              </>
            ) : (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                Create My Bookings
              </>
            )}
          </Button>
          
          <Button variant="outline" className="w-full">
            <CreditCard className="h-4 w-4 mr-2" />
            Contact Support
          </Button>
        </div>
        
        <div className="text-xs text-muted-foreground">
          <p>• Your payment will be verified manually</p>
          <p>• You'll receive email confirmation once verified</p>
          <p>• No duplicate charges will occur</p>
        </div>
      </CardContent>
    </Card>
  );
};

export default PaymentFallbackHandler;