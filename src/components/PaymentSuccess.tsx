
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
    const sessionId = new URLSearchParams(window.location.search).get('session_id');
    
    console.log('🔍 Session ID check:');
    console.log('  - SessionId:', sessionId);
    console.log('  - Current URL:', window.location.href);
    console.log('  - Parsed URL search params:', Object.fromEntries(new URLSearchParams(window.location.search).entries()));
    
    // CRITICAL: If no session_id found, this might not be a legitimate payment success
    // Only proceed without session_id in very specific fallback scenarios
    if (!sessionId) {
      console.log('❌ No session_id found in URL parameters');
      console.log('   - This suggests the user reached this page without completing Stripe checkout');
      console.log('   - OR there was a technical issue with the redirect');
      
      // Check if this is a recent checkout attempt
      const checkoutTimestamp = sessionStorage.getItem('checkoutTimestamp');
      const timeElapsed = checkoutTimestamp ? Date.now() - parseInt(checkoutTimestamp) : Infinity;
      
      if (checkoutTimestamp && timeElapsed < 5 * 60 * 1000) { // Within 5 minutes
        console.log('⚠️ Recent checkout detected without session_id - possible technical issue');
        console.log('   Time elapsed since checkout:', timeElapsed / 1000, 'seconds');
        setError('Payment verification failed. This might be due to a technical issue. Please try the fallback option or contact support if you were charged.');
      } else {
        console.log('❌ No recent checkout or session expired');
        setError('No payment session found. Please contact support if you were charged.');
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
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session_id');
    const currentUrl = window.location.href;
    
    console.log('🚀 PaymentSuccess mounted:');
    console.log('  - Auth loading:', authLoading);
    console.log('  - User:', !!user?.id);
    console.log('  - Current URL:', currentUrl);
    console.log('  - URL params:', Object.fromEntries(urlParams.entries()));
    console.log('  - SessionId:', sessionId);
    
    // Special handling for edge cases
    if (!authLoading && !user) {
      console.log('❌ User not authenticated');
      setError('You are not signed in. Please sign in to view your bookings.');
      setShowModal(true);
      return;
    }

    if (!authLoading && user?.id) {
      if (sessionId) {
        console.log('✅ All conditions met, processing payment success with session_id:', sessionId);
        processPaymentSuccess();
      } else {
        console.log('❌ No session_id found, checking for pending data...');
        
        // Check if there's pending checkout data that might indicate a payment flow
        const pendingItems = sessionStorage.getItem('pendingCheckoutItems');
        const pendingAddress = sessionStorage.getItem('pendingCheckoutAddress');
        const checkoutTimestamp = sessionStorage.getItem('checkoutTimestamp');
        
        console.log('📦 Pending data check:');
        console.log('  - pendingItems:', !!pendingItems);
        console.log('  - pendingAddress:', !!pendingAddress);
        console.log('  - checkoutTimestamp:', checkoutTimestamp);
        
        if (pendingItems && pendingAddress && checkoutTimestamp) {
          const timeElapsed = Date.now() - parseInt(checkoutTimestamp);
          console.log('⏰ Time elapsed since checkout:', timeElapsed / 1000 / 60, 'minutes');
          
          if (timeElapsed < 30 * 60 * 1000) { // Within 30 minutes
            console.log('⚠️ Found recent pending data but no session_id - this suggests a technical issue');
            console.log('   Showing fallback handler to allow manual booking creation');
            setShowFallback(true);
            return;
          } else {
            console.log('⏰ Pending data is too old (>30 minutes), ignoring');
          }
        }
        
        console.log('❌ No session_id and no valid pending data - likely invalid access');
        setError('No payment session found. Please contact support if you were charged.');
        setShowModal(true);
      }
    } else {
      console.log('⏳ Waiting for conditions: authLoading=', authLoading, 'user=', !!user?.id, 'sessionId=', !!sessionId);
    }
  }, [authLoading, user?.id]);

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
