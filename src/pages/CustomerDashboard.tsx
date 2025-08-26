
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { User, Calendar, Heart, ShoppingCart, Star, Clock, MapPin, Bell, LogOut, DollarSign, Menu, X } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { useServices } from '@/hooks/useServices';
import { useShoppingCart } from '@/hooks/useShoppingCart';
import ServiceProviderFlow from '@/components/ServiceProviderFlow';
import CartSection from '@/components/CartSection';
import ProfileSettings from '@/components/ProfileSettings';
import MyBookings from '@/components/MyBookings';
import AmountSection from '@/components/AmountSection';

const CustomerDashboard = () => {
  const [activeTab, setActiveTab] = useState('services');
  const [selectedService, setSelectedService] = useState(null);
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [showCart, setShowCart] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
  const { user, signOut } = useAuth();
  const { services, loading, error, silentRefresh } = useServices();
  const { itemCount, initialized } = useShoppingCart();
  const isMobile = useIsMobile();

  console.log('🏠 CustomerDashboard render - cart itemCount:', itemCount, 'initialized:', initialized);

  // Handle URL parameters and state for tab switching
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const tabParam = urlParams.get('tab');
    if (tabParam && ['services', 'bookings', 'amount', 'favorites', 'profile'].includes(tabParam)) {
      setActiveTab(tabParam);
    }
    
    // Handle navigation state
    const state = (window.history.state?.usr);
    if (state?.activeTab) {
      setActiveTab(state.activeTab);
    } else if (state?.tab) {
      setActiveTab(state.tab);
    }
  }, []);

  // Force re-render when cart changes by watching itemCount
  useEffect(() => {
    console.log('🏠 CustomerDashboard - cart count changed to:', itemCount);
  }, [itemCount]);

  const handleServiceSelect = (service) => {
    setSelectedService(service);
  };

  const handleProviderSelect = (provider) => {
    setSelectedProvider(provider);
  };

  const handleBookingComplete = () => {
    setSelectedService(null);
    setSelectedProvider(null);
    setActiveTab('services');
    // Refresh services data after booking completion
    if (silentRefresh) {
      silentRefresh();
    }
  };

  const handleSignOut = async () => {
    await signOut();
  };

  // Group services by category
  const servicesByCategory = services.reduce((acc, service) => {
    const category = service.category || 'Other';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(service);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-background flex">
      {/* Mobile Menu Button */}
      {isMobile && (
        <button
          onClick={() => setMobileMenuOpen(true)}
          className="fixed top-4 left-4 z-50 p-2 bg-card border border-border rounded-lg shadow-lg md:hidden"
        >
          <Menu className="w-6 h-6 text-foreground" />
        </button>
      )}

      {/* Mobile Overlay */}
      {isMobile && mobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`
        ${isMobile ? 'fixed' : 'w-64 fixed'} 
        ${isMobile && !mobileMenuOpen ? '-translate-x-full' : 'translate-x-0'}
        ${isMobile ? 'w-80' : 'w-64'}
        bg-card border-r border-border flex flex-col left-0 top-0 h-full z-50 transition-transform duration-300 ease-in-out
      `}>
        {/* Mobile Close Button */}
        {isMobile && (
          <div className="flex justify-end p-4 border-b border-border">
            <button
              onClick={() => setMobileMenuOpen(false)}
              className="p-2 hover:bg-muted rounded-lg"
            >
              <X className="w-6 h-6 text-foreground" />
            </button>
          </div>
        )}

        {/* User Profile Section */}
        <div className="p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-teal/20 rounded-full flex items-center justify-center">
              <User className="w-6 h-6 text-teal" />
            </div>
            <div>
              <h2 className="font-semibold text-foreground">Welcome back!</h2>
              <p className="text-sm text-muted-foreground truncate">{user?.email}</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-2">
          <button
            onClick={() => {
              setActiveTab('services');
              if (isMobile) setMobileMenuOpen(false);
            }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${
              activeTab === 'services' 
                ? 'bg-teal/10 text-teal border border-teal/20' 
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <Star className="w-5 h-5" />
            Services
          </button>
          
          <button
            onClick={() => {
              setActiveTab('bookings');
              if (isMobile) setMobileMenuOpen(false);
            }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${
              activeTab === 'bookings' 
                ? 'bg-teal/10 text-teal border border-teal/20' 
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <Calendar className="w-5 h-5" />
            My Bookings
          </button>

          <button
            onClick={() => {
              setActiveTab('amount');
              if (isMobile) setMobileMenuOpen(false);
            }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${
              activeTab === 'amount' 
                ? 'bg-teal/10 text-teal border border-teal/20' 
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <DollarSign className="w-5 h-5" />
            Amount
          </button>
          
          <button
            onClick={() => {
              setActiveTab('favorites');
              if (isMobile) setMobileMenuOpen(false);
            }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${
              activeTab === 'favorites' 
                ? 'bg-teal/10 text-teal border border-teal/20' 
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <Heart className="w-5 h-5" />
            Favorites
          </button>

          <button
            onClick={() => {
              setActiveTab('profile');
              if (isMobile) setMobileMenuOpen(false);
            }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${
              activeTab === 'profile' 
                ? 'bg-teal/10 text-teal border border-teal/20' 
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <User className="w-5 h-5" />
            Profile Settings
          </button>
        </nav>

        {/* Cart and Sign Out */}
        <div className="p-4 border-t border-border space-y-2">
          <button
            onClick={() => {
              setShowCart(true);
              if (isMobile) setMobileMenuOpen(false);
            }}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors text-muted-foreground hover:bg-muted hover:text-foreground relative"
          >
            <ShoppingCart className="w-5 h-5" />
            Cart
            {initialized && itemCount > 0 && (
              <Badge 
                key={itemCount} // Force re-render when count changes
                className="ml-auto bg-teal text-white min-w-[24px] h-6 flex items-center justify-center rounded-full"
              >
                {itemCount}
              </Badge>
            )}
          </button>
          
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors text-muted-foreground hover:bg-red-50 hover:text-red-600 hover:border-red-200 border border-transparent"
          >
            <LogOut className="w-5 h-5" />
            Sign Out
          </button>
        </div>
      </div>

      {/* Main Content Area - with left margin to account for fixed sidebar */}
      <div className={`flex-1 ${isMobile ? 'ml-0' : 'ml-64'}`}>
        <div className="h-screen overflow-y-auto">
          <div className={`p-6 ${isMobile ? 'mt-16' : ''}`}>
            {/* Services Tab */}
            {activeTab === 'services' && !selectedService && (
              <div className="space-y-6">
                <div>
                  <h1 className="text-3xl font-bold text-foreground mb-2">Services</h1>
                  <p className="text-muted-foreground">Find the perfect service for your needs</p>
                </div>

                {loading && (
                  <div className="flex items-center justify-center py-12">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal mx-auto mb-4"></div>
                      <p className="text-muted-foreground">Loading services...</p>
                    </div>
                  </div>
                )}

                {error && (
                  <div className="text-center py-12">
                    <p className="text-red-500 mb-4">Error loading services: {error}</p>
                    <Button onClick={() => window.location.reload()} variant="outline">
                      Retry
                    </Button>
                  </div>
                )}

                {!loading && !error && Object.keys(servicesByCategory).length === 0 && (
                  <div className="text-center py-12">
                    <p className="text-muted-foreground">No services available at the moment.</p>
                  </div>
                )}

                {!loading && !error && Object.keys(servicesByCategory).map((category) => (
                  <div key={category} className="space-y-4">
                    <h2 className="text-xl font-semibold text-foreground">{category}</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {servicesByCategory[category].map((service) => (
                        <motion.div
                          key={service.id}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="group"
                        >
                          <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
                            <CardHeader>
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <CardTitle className="flex items-center gap-2">
                                    {service.title}
                                    {service.is_featured && (
                                      <Badge className="bg-yellow-500 text-white">Featured</Badge>
                                    )}
                                    {service.emergency_available && (
                                      <Badge variant="outline" className="text-red-500 border-red-500">Emergency</Badge>
                                    )}
                                  </CardTitle>
                                  <CardDescription className="mt-2">
                                    {service.description}
                                  </CardDescription>
                                </div>
                              </div>
                            </CardHeader>
                            <CardContent>
                              <div className="space-y-4">
                                <div className="flex items-center justify-between text-sm">
                                   <div className="flex items-center gap-4">
                                     <div className="flex items-center gap-1">
                                       <Clock className="w-4 h-4 text-muted-foreground" />
                                       <span>{service.duration_minutes} min</span>
                                     </div>
                                     <div className="flex items-center gap-1">
                                       <User className="w-4 h-4 text-muted-foreground" />
                                       <span>6+ providers</span>
                                     </div>
                                   </div>
                                 </div>
                                 
                                 <div className="flex items-center justify-between">
                                   <div className="text-right">
                                     <span className="text-lg font-bold text-teal">
                                       Starting from ${Math.round(service.base_price * 0.6)}
                                     </span>
                                     <span className="text-muted-foreground">
                                       {service.price_type === 'hourly' ? '/hr' : ''}
                                     </span>
                                   </div>
                                </div>
                                
                                <Button 
                                  onClick={() => handleServiceSelect(service)}
                                  className="w-full bg-teal hover:bg-teal/90"
                                >
                                  View Providers
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Service Provider Selection */}
            {activeTab === 'services' && selectedService && (
              <ServiceProviderFlow
                selectedService={selectedService}
                onBack={() => {
                  setSelectedService(null);
                }}
                onBookService={handleBookingComplete}
                onCartUpdate={silentRefresh}
              />
            )}

            {/* My Bookings */}
            {activeTab === 'bookings' && (
              <MyBookings />
            )}

            {/* Amount Section */}
            {activeTab === 'amount' && (
              <AmountSection />
            )}

            {activeTab === 'favorites' && (
              <div className="space-y-6">
                <h1 className="text-3xl font-bold text-foreground">Favorites</h1>
                <div className="text-center py-12">
                  <p className="text-muted-foreground">No favorites yet. Browse services and save your preferred providers!</p>
                </div>
              </div>
            )}

            {activeTab === 'profile' && (
              <ProfileSettings />
            )}
          </div>
        </div>
      </div>

      {/* Cart Section */}
      <CartSection isOpen={showCart} onClose={() => setShowCart(false)} />
    </div>
  );
};

export default CustomerDashboard;
