
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useShoppingCart } from '@/hooks/useShoppingCart';
import { useBookingsActions } from '@/hooks/useBookingsActions';
import { useToast } from '@/hooks/use-toast';
import BookingResultModal from './BookingResultModal';
import PaymentFallbackHandler from './PaymentFallbackHandler';
import { useAuth } from '@/hooks/useAuth';
import { formatError } from '@/lib/errorFormatter';

const PAYMENT_PROCESSED_FLAG = 'payment_success_processed';

const PaymentSuccess = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const { clearCart } = useShoppingCart();
  const { createBookingsFromCart } = useBookingsActions();
  const { toast } = useToast();

  const [creating, setCreating] = useState(false);
  const [bookingsCreated, setBookingsCreated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAttempts, setRetryAttempts] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [showFallback, setShowFallback] = useState(false);

  // Prevent duplicate execution (StrictMode double-mounts + reloads)
  const hasTriggeredRef = useRef(false);

  const processPaymentSuccess = async (isRetry = false) => {
    // Guard if already processed in this session and not a retry
    if (!isRetry && (hasTriggeredRef.current || sessionStorage.getItem(PAYMENT_PROCESSED_FLAG) === 'true')) {
      console.log('ℹ️ Payment success already processed. Showing success state.');
      setBookingsCreated(true);
      setShowModal(true);
      return;
    }

    // Require authenticated user
    if (!user?.id) {
      console.log('❌ Cannot process without authenticated user');
      setError('You are not signed in. Please sign in to finalize your bookings.');
      setShowModal(true);
      return;
    }

    // Get stored checkout data created before redirecting to Stripe
    const pendingItems = sessionStorage.getItem('pendingCheckoutItems');
    const pendingAddress = sessionStorage.getItem('pendingCheckoutAddress');

    console.log('🔄 Processing payment success - pendingItems:', !!pendingItems, 'pendingAddress:', !!pendingAddress);

    if (!pendingItems || !pendingAddress) {
      console.log('❌ No pending checkout data found');
      setError('No checkout data found. Please contact support if you were charged.');
      setShowModal(true);
      return;
    }

    // Extract session_id from URL parameters - this confirms payment was successful
    const sessionId = searchParams.get('session_id') || new URLSearchParams(window.location.search).get('session_id');
    
    console.log('🔍 Session ID check:');
    console.log('  - From searchParams:', searchParams.get('session_id'));
    console.log('  - From URL directly:', new URLSearchParams(window.location.search).get('session_id'));
    console.log('  - Final sessionId:', sessionId);
    console.log('  - Current URL:', window.location.href);
    
    // If no session_id, check if we have pending data and user is authenticated
    // This might be a direct access or browser back button scenario
    if (!sessionId) {
      console.log('❌ No session_id found in URL parameters');
      console.log('   - Search params:', Object.fromEntries(searchParams.entries()));
      console.log('   - Direct URL params:', Object.fromEntries(new URLSearchParams(window.location.search).entries()));
      console.log('   - Full URL:', window.location.href);
      
      // Check if this might be a legitimate post-payment scenario with stored data
      const checkoutTimestamp = sessionStorage.getItem('checkoutTimestamp');
      const timeElapsed = Date.now() - (checkoutTimestamp ? parseInt(checkoutTimestamp) : 0);
      
      if (checkoutTimestamp && timeElapsed < 10 * 60 * 1000) { // Within 10 minutes
        console.log('⚠️ Recent checkout detected without session_id. This might be a browser back/forward issue.');
        setError('Payment session not found. If you just completed a payment, please check your email for confirmation or contact support.');
      } else {
        setError('Payment session not found. Please contact support if you were charged.');
      }
      setShowModal(true);
      return;
    }
  
    try {
      hasTriggeredRef.current = true;
      setCreating(true);
      setError(null);
      console.log('🧾 User:', user.id, '🔄 Creating bookings after successful payment with session:', sessionId);
  
      const items = JSON.parse(pendingItems);
      const address = JSON.parse(pendingAddress);
  
      console.log('📝 Creating bookings with items:', items.length, 'address:', address, 'sessionId:', sessionId);
  
      // Create bookings with confirmed status - since we reached here, payment was successful
      await createBookingsFromCart(items, address, sessionId);
  
      console.log('✅ Bookings created successfully with confirmed status');

      // Mark processed to avoid duplicates on refresh
      sessionStorage.setItem(PAYMENT_PROCESSED_FLAG, 'true');

      // Clear cart and temp data AFTER successful booking creation
      console.log('🧹 Clearing cart and session data...');
      
      // Clear the cart first (localStorage)
      clearCart();
      
      // Then clear session storage
      sessionStorage.removeItem('pendingCheckoutItems');
      sessionStorage.removeItem('pendingCheckoutAddress');
      sessionStorage.removeItem('checkoutTimestamp');

      // Set success state
      setBookingsCreated(true);
      setShowModal(true);

      toast({
        title: 'Payment & Booking Successful!',
        description: `${items.length} booking${items.length !== 1 ? 's' : ''} created with confirmed status.`,
      });

      console.log('🎉 Payment success process completed successfully');
    } catch (err) {
      const friendly = formatError(err);
      console.error('❌ Error creating bookings after payment:', err, '->', friendly);
      setError(`Booking creation failed: ${friendly}`);
      setShowModal(true);
  
      toast({
        title: 'Booking Creation Failed',
        description: 'Your payment was processed successfully, but we encountered an issue creating your bookings. Our team has been notified and will process a refund within 3-5 business days if needed.',
        variant: 'destructive',
        duration: 10000,
      });
    } finally {
      setCreating(false);
    }
  };

  const handleRetry = async () => {
    // Allow new attempt
    sessionStorage.removeItem(PAYMENT_PROCESSED_FLAG);

    if (retryAttempts >= 3) {
      toast({
        title: 'Maximum Retries Reached',
        description: 'Please contact support for assistance. We will ensure your payment is properly handled.',
        variant: 'destructive',
      });
      return;
    }

    setRetryAttempts((prev) => prev + 1);
    await processPaymentSuccess(true);
  };

  const handleViewBookings = () => {
    navigate('/customer-dashboard?tab=bookings');
  };

  const handleViewDashboard = () => {
    navigate('/customer-dashboard');
  };

  // Only proceed when auth is ready and user is known
  useEffect(() => {
    const sessionId = searchParams.get('session_id') || new URLSearchParams(window.location.search).get('session_id');
    const currentUrl = window.location.href;
    const urlParams = new URLSearchParams(window.location.search);
    
    console.log('🚀 PaymentSuccess mounted:');
    console.log('  - Auth loading:', authLoading);
    console.log('  - User:', !!user?.id);
    console.log('  - Current URL:', currentUrl);
    console.log('  - URL params:', Object.fromEntries(urlParams.entries()));
    console.log('  - SessionId from searchParams:', searchParams.get('session_id'));
    console.log('  - SessionId from direct URL params:', urlParams.get('session_id'));
    console.log('  - Final sessionId:', sessionId);
    
    // Special handling for edge cases
    if (!authLoading && !user) {
      console.log('❌ User not authenticated');
      setError('You are not signed in. Please sign in to view your bookings.');
      setShowModal(true);
      return;
    }

    if (!authLoading && user?.id) {
      if (sessionId) {
        console.log('✅ All conditions met, processing payment success');
        processPaymentSuccess();
      } else {
        // Check if there's pending checkout data that might indicate a payment flow
        const pendingItems = sessionStorage.getItem('pendingCheckoutItems');
        const pendingAddress = sessionStorage.getItem('pendingCheckoutAddress');
        const checkoutTimestamp = sessionStorage.getItem('checkoutTimestamp');
        
        if (pendingItems && pendingAddress && checkoutTimestamp) {
          const timeElapsed = Date.now() - parseInt(checkoutTimestamp);
          if (timeElapsed < 30 * 60 * 1000) { // Within 30 minutes
            console.log('⚠️ Found recent pending data but no session_id - showing fallback handler');
            setShowFallback(true);
            return;
          }
        }
        
        console.log('❌ No session_id and no valid pending data');
        setError('No payment session found. Please contact support if you were charged.');
        setShowModal(true);
      }
    } else {
      console.log('⏳ Waiting for conditions: authLoading=', authLoading, 'user=', !!user?.id, 'sessionId=', !!sessionId);
    }
  }, [authLoading, user?.id, searchParams]);

  const handleFallbackSuccess = () => {
    setBookingsCreated(true);
    setShowFallback(false);
    setShowModal(true);
  };

  const handleFallbackError = (error: string) => {
    setError(error);
    setShowFallback(false);
    setShowModal(true);
  };

  // Show fallback handler if no session_id but pending data exists
  if (showFallback) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <PaymentFallbackHandler
          onBookingsCreated={handleFallbackSuccess}
          onError={handleFallbackError}
        />
      </div>
    );
  }
  // Show loading state if still processing
  if ((authLoading || creating) && !showModal && !showFallback) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal mx-auto mb-4"></div>
          <p className="text-muted-foreground">
            {authLoading ? 'Preparing your account...' : 'Processing your payment and creating bookings...'}
          </p>
        </div>
      </div>
    );
  }

  // Show modal for success or error
  if (showModal) {
    return (
      <BookingResultModal
        type={bookingsCreated ? 'success' : 'error'}
        title={bookingsCreated ? 'Payment Successful!' : 'Booking Creation Failed'}
        message={
          bookingsCreated
            ? 'Thank you for your payment. Your bookings have been confirmed and you will receive confirmation emails shortly.'
            : 'Your payment was processed successfully, but we encountered an issue creating your bookings.'
        }
        errorDetails={error || undefined}
        onViewBookings={handleViewBookings}
        onRetry={!bookingsCreated ? handleRetry : undefined}
        onGoToDashboard={handleViewDashboard}
        retryAttempts={retryAttempts}
        isRetrying={creating}
      />
    );
  }

  // Fallback loading state
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal mx-auto mb-4"></div>
        <p className="text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
};

export default PaymentSuccess;
