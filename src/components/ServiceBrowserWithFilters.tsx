import React, { useState, useMemo } from 'react';
import { Search, Filter, MapPin, Clock, DollarSign } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import ServiceCard from '@/components/ServiceCard';

interface Service {
  id: string;
  title: string;
  description: string;
  category: string;
  subcategory?: string;
  base_price: number;
  duration_minutes: number;
  price_type: 'fixed' | 'hourly' | 'custom';
  images?: string[];
  provider_profile?: {
    business_name: string;
    rating: number;
    total_reviews: number;
  };
}

interface ServiceBrowserWithFiltersProps {
  services: Service[];
  loading?: boolean;
  onServiceSelect?: (service: Service) => void;
}

const ServiceBrowserWithFilters: React.FC<ServiceBrowserWithFiltersProps> = ({
  services,
  loading = false,
  onServiceSelect
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [priceRangeFilter, setPriceRangeFilter] = useState('all');
  const [sortBy, setSortBy] = useState('relevance');
  const [locationFilter, setLocationFilter] = useState('');

  // Get unique categories
  const categories = useMemo(() => {
    const uniqueCategories = [...new Set(services.map(service => service.category))];
    return uniqueCategories.sort();
  }, [services]);

  // Filter and search services
  const filteredServices = useMemo(() => {
    let filtered = services.filter(service => {
      const matchesSearch = searchTerm === '' || 
        service.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        service.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        service.provider_profile?.business_name?.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesCategory = categoryFilter === 'all' || service.category === categoryFilter;

      const matchesPriceRange = (() => {
        if (priceRangeFilter === 'all') return true;
        const price = service.base_price;
        switch (priceRangeFilter) {
          case 'under_50': return price < 50;
          case '50_100': return price >= 50 && price <= 100;
          case '100_200': return price >= 100 && price <= 200;
          case 'over_200': return price > 200;
          default: return true;
        }
      })();

      return matchesSearch && matchesCategory && matchesPriceRange;
    });

    // Sort services
    switch (sortBy) {
      case 'price_asc':
        filtered.sort((a, b) => a.base_price - b.base_price);
        break;
      case 'price_desc':
        filtered.sort((a, b) => b.base_price - a.base_price);
        break;
      case 'rating':
        filtered.sort((a, b) => (b.provider_profile?.rating || 0) - (a.provider_profile?.rating || 0));
        break;
      case 'duration_asc':
        filtered.sort((a, b) => a.duration_minutes - b.duration_minutes);
        break;
      case 'duration_desc':
        filtered.sort((a, b) => b.duration_minutes - a.duration_minutes);
        break;
      default:
        // Keep original order for relevance
        break;
    }

    return filtered;
  }, [services, searchTerm, categoryFilter, priceRangeFilter, sortBy]);

  const clearFilters = () => {
    setSearchTerm('');
    setCategoryFilter('all');
    setPriceRangeFilter('all');
    setSortBy('relevance');
    setLocationFilter('');
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse space-y-4">
          <div className="h-12 bg-gray-200 rounded"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-64 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Search and Filter Section */}
      <Card>
        <CardContent className="p-4">
          <div className="space-y-4">
            {/* Search Bar */}
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search services, providers, or descriptions..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Filters Row */}
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger>
                    <Filter className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {categories.map(category => (
                      <SelectItem key={category} value={category}>
                        {category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={priceRangeFilter} onValueChange={setPriceRangeFilter}>
                  <SelectTrigger>
                    <DollarSign className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="Price Range" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Prices</SelectItem>
                    <SelectItem value="under_50">Under $50</SelectItem>
                    <SelectItem value="50_100">$50 - $100</SelectItem>
                    <SelectItem value="100_200">$100 - $200</SelectItem>
                    <SelectItem value="over_200">Over $200</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sort by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="relevance">Relevance</SelectItem>
                    <SelectItem value="price_asc">Price: Low to High</SelectItem>
                    <SelectItem value="price_desc">Price: High to Low</SelectItem>
                    <SelectItem value="rating">Highest Rated</SelectItem>
                    <SelectItem value="duration_asc">Duration: Short to Long</SelectItem>
                    <SelectItem value="duration_desc">Duration: Long to Short</SelectItem>
                  </SelectContent>
                </Select>

                <Button 
                  variant="outline" 
                  onClick={clearFilters}
                  className="whitespace-nowrap"
                >
                  Clear Filters
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results Summary */}
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          Showing {filteredServices.length} of {services.length} services
        </p>
      </div>

      {/* Services Grid */}
      {filteredServices.length === 0 ? (
        <div className="text-center py-12">
          <Search className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">No services found</h3>
          <p className="text-muted-foreground">
            Try adjusting your search or filter criteria
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredServices.map((service) => (
            <ServiceCard
              key={service.id}
              icon="🔧"
              title={service.title}
              provider={service.provider_profile?.business_name || 'Unknown Provider'}
              rating={service.provider_profile?.rating || 0}
              reviews={service.provider_profile?.total_reviews || 0}
              price={service.price_type === 'hourly' ? `$${service.base_price}/hr` : `$${service.base_price}`}
              location="Local Area"
              image={service.images?.[0]}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default ServiceBrowserWithFilters;
