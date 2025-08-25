import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';

export interface CartItem {
  id: string;
  service_id: string;
  provider_id: string;
  service_title: string;
  provider_name: string;
  price: number;
  duration_minutes: number;
  scheduled_date: string; // Make this required to match useBookingsActions
  special_instructions?: string;
}

const CART_STORAGE_KEY = 'servicenexus_shopping_cart';

export const useShoppingCart = () => {
  const [items, setItems] = useState<CartItem[]>([]);
  const [initialized, setInitialized] = useState(false);
  const { toast } = useToast();

  console.log('🛒 useShoppingCart hook render - items:', items.length, 'initialized:', initialized);

  // Load cart from localStorage on mount
  useEffect(() => {
    console.log('🛒 Initializing cart from localStorage...');
    try {
      const savedCart = localStorage.getItem(CART_STORAGE_KEY);
      if (savedCart) {
        const parsedCart = JSON.parse(savedCart);
        if (Array.isArray(parsedCart)) {
          console.log('📥 Loading cart from storage:', parsedCart);
          
          // Filter out items with invalid scheduled_date
          const validItems = parsedCart.filter((item: CartItem) => {
            if (!item.scheduled_date) {
              console.warn('⚠️ Removing item with missing scheduled_date:', item.service_title);
              return false;
            }
            
            const date = new Date(item.scheduled_date);
            const isValid = !isNaN(date.getTime());
            
            if (!isValid) {
              console.warn('⚠️ Removing item with invalid scheduled_date:', item.service_title, item.scheduled_date);
              return false;
            }
            
            return true;
          });
          
          setItems(validItems);
          console.log('✅ Cart loaded from storage:', validItems.length, 'valid items out of', parsedCart.length, 'total');
          
          // If we filtered out invalid items, show a toast notification
          if (validItems.length < parsedCart.length) {
            toast({
              title: "Cart Updated",
              description: `Removed ${parsedCart.length - validItems.length} item(s) with invalid scheduling data.`,
              variant: "default"
            });
          }
        }
      } else {
        console.log('📭 No existing cart found in storage');
      }
    } catch (error) {
      console.error('❌ Error loading cart from storage:', error);
      localStorage.removeItem(CART_STORAGE_KEY);
    } finally {
      setInitialized(true);
      console.log('✅ Cart initialization complete');
    }
  }, []);

  // Save to localStorage whenever items change (but only after initialization)
  useEffect(() => {
    if (initialized) {
      try {
        console.log('💾 Saving cart to storage:', items);
        localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
        console.log('✅ Cart saved to storage:', items.length, 'items');
      } catch (error) {
        console.error('❌ Error saving cart to storage:', error);
      }
    }
  }, [items, initialized]);

  const addItem = useCallback((itemData: Omit<CartItem, 'id'>, onSuccess?: () => void) => {
    console.log('🛒 ADD ITEM CALLED with:', itemData);
    
    return new Promise<boolean>((resolve) => {
      setItems(currentItems => {
        console.log('🛒 Current items in state:', currentItems.length);
        
        // Check if service already exists with same provider
        const existingItem = currentItems.find(
          item => item.service_id === itemData.service_id && item.provider_id === itemData.provider_id
        );

        if (existingItem) {
          console.log('⚠️ Item already exists in cart');
          toast({
            title: "Already in cart",
            description: "This service from this provider is already in your cart",
            variant: "destructive"
          });
          resolve(false);
          return currentItems;
        }

        // Check if service already exists with different provider
        const serviceExists = currentItems.find(item => item.service_id === itemData.service_id);
        if (serviceExists) {
          console.log('⚠️ Service already exists with different provider');
          toast({
            title: "Service already selected",
            description: "You can only select one provider per service type. Remove the existing one first.",
            variant: "destructive"
          });
          resolve(false);
          return currentItems;
        }

        // Create new item with unique ID
        const newItem: CartItem = {
          ...itemData,
          id: `cart_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        };

        console.log('🛒 Creating new cart item:', newItem);

        const newItems = [...currentItems, newItem];
        console.log('✅ Cart state updated - new count:', newItems.length);
        console.log('✅ New cart items:', newItems.map(i => i.service_title));

        // Show success toast
        toast({
          title: "Added to cart",
          description: `${itemData.service_title} has been added to your cart`,
        });

        console.log('✅ ADD ITEM COMPLETED SUCCESSFULLY');
        
        // Call success callback if provided
        if (onSuccess) {
          setTimeout(onSuccess, 100);
        }
        
        resolve(true);
        return newItems;
      });
    });
  }, [toast]);

  const removeItem = useCallback((itemId: string) => {
    console.log('🗑️ Removing item from cart:', itemId);
    
    setItems(prevItems => {
      const itemToRemove = prevItems.find(item => item.id === itemId);
      const newItems = prevItems.filter(item => item.id !== itemId);
      console.log('✅ Item removed - remaining items:', newItems.length);
      console.log('✅ Remaining items:', newItems.map(i => i.service_title));
      
      if (itemToRemove) {
        toast({
          title: "Removed from cart",
          description: `${itemToRemove.service_title} has been removed from your cart`,
        });
      }
      
      return newItems;
    });
  }, [toast]);

  const updateItem = useCallback((itemId: string, updates: Partial<CartItem>) => {
    console.log('✏️ Updating cart item:', itemId, updates);
    setItems(prevItems => 
      prevItems.map(item => 
        item.id === itemId ? { ...item, ...updates } : item
      )
    );
  }, []);

  const clearCart = useCallback(() => {
    console.log('🧹 Clearing cart - current items:', items.length);
    
    // Clear localStorage immediately and forcefully
    try {
      localStorage.removeItem(CART_STORAGE_KEY);
      // Force a second clear to ensure it's gone
      localStorage.setItem(CART_STORAGE_KEY, '[]');
      localStorage.removeItem(CART_STORAGE_KEY);
      console.log('✅ Cart cleared from localStorage');
    } catch (error) {
      console.error('❌ Error clearing cart from localStorage:', error);
    }
    
    // Clear state immediately
    setItems([]);
    console.log('✅ Cart state cleared - new count:', 0);
    
    // Don't show toast during payment success to avoid confusion
    if (!window.location.pathname.includes('payment-success')) {
      toast({
        title: "Cart cleared",
        description: "All items have been removed from your cart",
      });
    }
  }, [items.length, toast]);

  const getTotalPrice = useCallback(() => {
    const total = items.reduce((sum, item) => sum + item.price, 0);
    console.log('💰 Total price calculated:', total);
    return total;
  }, [items]);

  // Calculate item count directly from items array and memoize it
  const itemCount = items.length;

  console.log('🛒 Hook returning state:', { 
    itemCount, 
    initialized, 
    itemTitles: items.map(i => i.service_title),
    actualItemsCount: items.length 
  });

  return {
    items,
    addItem,
    removeItem,
    updateItem,
    clearCart,
    getTotalPrice,
    itemCount,
    initialized
  };
};
