
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';

export interface Favorite {
  id: string;
  customer_id: string;
  provider_user_id: string;
  created_at: string;
}

export const useFavorites = () => {
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();

  // Load user's favorites
  const loadFavorites = useCallback(async () => {
    if (!user?.id) {
      setFavorites([]);
      return;
    }

    try {
      setLoading(true);
      console.log('🔄 Loading favorites for user:', user.id);
      
      const { data, error } = await supabase
        .from('favorites')
        .select('*')
        .eq('customer_id', user.id);

      if (error) {
        console.error('❌ Error loading favorites:', error);
        toast({
          title: 'Error',
          description: 'Failed to load favorites. Please try again.',
          variant: 'destructive'
        });
        return;
      }

      console.log('✅ Loaded favorites:', data);
      setFavorites(data || []);
    } catch (error) {
      console.error('❌ Error loading favorites:', error);
      toast({
        title: 'Error',
        description: 'An unexpected error occurred while loading favorites.',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  }, [user?.id, toast]);

  // Add provider to favorites
  const addToFavorites = useCallback(async (providerUserId: string) => {
    if (!user?.id) {
      toast({
        title: 'Authentication Required',
        description: 'Please log in to add favorites.',
        variant: 'destructive'
      });
      return false;
    }

    try {
      console.log('➕ Adding to favorites:', providerUserId);
      
      // Check if already in favorites
      const existingFavorite = favorites.find(fav => fav.provider_user_id === providerUserId);
      if (existingFavorite) {
        toast({
          title: 'Already in Favorites',
          description: 'This provider is already in your favorites.',
          variant: 'destructive'
        });
        return false;
      }

      const { data, error } = await supabase
        .from('favorites')
        .insert({
          customer_id: user.id,
          provider_user_id: providerUserId
        })
        .select()
        .single();

      if (error) {
        console.error('❌ Error adding to favorites:', error);
        toast({
          title: 'Error',
          description: 'Failed to add to favorites. Please try again.',
          variant: 'destructive'
        });
        return false;
      }

      console.log('✅ Added to favorites:', data);
      setFavorites(prev => [...prev, data]);
      toast({
        title: 'Added to Favorites',
        description: 'Provider has been added to your favorites.',
      });
      return true;
    } catch (error) {
      console.error('❌ Error adding to favorites:', error);
      toast({
        title: 'Error',
        description: 'Failed to add to favorites. Please try again.',
        variant: 'destructive'
      });
      return false;
    }
  }, [user?.id, favorites, toast]);

  // Remove provider from favorites
  const removeFromFavorites = useCallback(async (providerUserId: string) => {
    if (!user?.id) return false;

    try {
      console.log('➖ Removing from favorites:', providerUserId);
      
      const { error } = await supabase
        .from('favorites')
        .delete()
        .eq('customer_id', user.id)
        .eq('provider_user_id', providerUserId);

      if (error) {
        console.error('❌ Error removing from favorites:', error);
        toast({
          title: 'Error',
          description: 'Failed to remove from favorites. Please try again.',
          variant: 'destructive'
        });
        return false;
      }

      console.log('✅ Removed from favorites');
      setFavorites(prev => prev.filter(fav => fav.provider_user_id !== providerUserId));
      toast({
        title: 'Removed from Favorites',
        description: 'Provider has been removed from your favorites.',
      });
      return true;
    } catch (error) {
      console.error('❌ Error removing from favorites:', error);
      toast({
        title: 'Error',
        description: 'Failed to remove from favorites. Please try again.',
        variant: 'destructive'
      });
      return false;
    }
  }, [user?.id, toast]);

  // Check if provider is in favorites
  const isFavorite = useCallback((providerUserId: string) => {
    return favorites.some(fav => fav.provider_user_id === providerUserId);
  }, [favorites]);

  // Load favorites when user changes and set up real-time updates
  useEffect(() => {
    loadFavorites();

    // Set up real-time subscription for favorites updates
    if (!user?.id) return;

    console.log('🔔 Setting up real-time favorites subscription for user:', user.id);
    
    const channel = supabase
      .channel('favorites-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'favorites',
          filter: `customer_id=eq.${user.id}`
        },
        (payload) => {
          console.log('🔄 Favorites change detected:', payload);
          loadFavorites();
        }
      )
      .subscribe();

    return () => {
      console.log('🔕 Cleaning up favorites subscription');
      supabase.removeChannel(channel);
    };
  }, [loadFavorites, user?.id]);

  return {
    favorites,
    loading,
    addToFavorites,
    removeFromFavorites,
    isFavorite,
    refetch: loadFavorites
  };
};
