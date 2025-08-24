
import React, { useState, useEffect } from 'react';
import { Calendar, Clock, Plus, Trash2, Edit } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { format, parseISO } from 'date-fns';

interface Slot {
  id: string;
  provider_id: string;
  service_id: string;
  start_time: string;
  end_time: string;
  status: 'AVAILABLE' | 'HOLD' | 'BOOKED';
  created_at: string;
}

interface SlotsManagerProps {
  providerId: string;
  serviceId: string;
}

export const SlotsManager: React.FC<SlotsManagerProps> = ({ providerId, serviceId }) => {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSlot, setNewSlot] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    startTime: '09:00',
    endTime: '10:00'
  });
  
  const { toast } = useToast();

  // Use a locally untyped client for tables missing from generated types
  const sb = supabase as any;

  useEffect(() => {
    loadSlots();
  }, [providerId, serviceId]);

  const loadSlots = async () => {
    try {
      setLoading(true);
      const { data, error } = await sb
        .from('slots')
        .select('*')
        .eq('provider_id', providerId)
        .eq('service_id', serviceId)
        .gte('start_time', new Date().toISOString())
        .order('start_time', { ascending: true });

      if (error) throw error;
      setSlots((data || []) as Slot[]);
    } catch (error) {
      console.error('Failed to load slots:', error);
      toast({
        title: 'Error',
        description: 'Failed to load slots',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const createSlot = async () => {
    try {
      const startDateTime = new Date(`${newSlot.date}T${newSlot.startTime}`);
      const endDateTime = new Date(`${newSlot.date}T${newSlot.endTime}`);

      const { data, error } = await sb
        .from('slots')
        .insert({
          provider_id: providerId,
          service_id: serviceId,
          start_time: startDateTime.toISOString(),
          end_time: endDateTime.toISOString(),
          status: 'AVAILABLE'
        })
        .select()
        .single();

      if (error) throw error;

      setSlots([...slots, data as Slot]);
      setShowAddForm(false);
      setNewSlot({
        date: format(new Date(), 'yyyy-MM-dd'),
        startTime: '09:00',
        endTime: '10:00'
      });

      toast({
        title: 'Success',
        description: 'Slot created successfully'
      });
    } catch (error) {
      console.error('Failed to create slot:', error);
      toast({
        title: 'Error',
        description: 'Failed to create slot',
        variant: 'destructive'
      });
    }
  };

  const deleteSlot = async (slotId: string) => {
    try {
      const { error } = await sb
        .from('slots')
        .delete()
        .eq('id', slotId);

      if (error) throw error;

      setSlots(slots.filter(slot => slot.id !== slotId));
      toast({
        title: 'Success',
        description: 'Slot deleted successfully'
      });
    } catch (error) {
      console.error('Failed to delete slot:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete slot',
        variant: 'destructive'
      });
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'AVAILABLE':
        return 'bg-green-100 text-green-800';
      case 'HOLD':
        return 'bg-yellow-100 text-yellow-800';
      case 'BOOKED':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Manage Time Slots</CardTitle>
              <CardDescription>
                Create and manage available booking slots for your service
              </CardDescription>
            </div>
            <Button onClick={() => setShowAddForm(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Slot
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {showAddForm && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="text-lg">Create New Slot</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label htmlFor="date">Date</Label>
                    <Input
                      id="date"
                      type="date"
                      value={newSlot.date}
                      onChange={(e) => setNewSlot({ ...newSlot, date: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="startTime">Start Time</Label>
                    <Input
                      id="startTime"
                      type="time"
                      value={newSlot.startTime}
                      onChange={(e) => setNewSlot({ ...newSlot, startTime: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="endTime">End Time</Label>
                    <Input
                      id="endTime"
                      type="time"
                      value={newSlot.endTime}
                      onChange={(e) => setNewSlot({ ...newSlot, endTime: e.target.value })}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button onClick={createSlot} disabled={loading}>Create Slot</Button>
                  <Button variant="outline" onClick={() => setShowAddForm(false)}>
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {slots.map((slot) => (
              <Card key={slot.id} className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium">
                      {format(parseISO(slot.start_time), 'MMM dd')}
                    </span>
                  </div>
                  <Badge className={getStatusColor(slot.status)}>
                    {slot.status}
                  </Badge>
                </div>
                
                <div className="flex items-center gap-2 mb-3">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm">
                    {format(parseISO(slot.start_time), 'h:mm a')} - {format(parseISO(slot.end_time), 'h:mm a')}
                  </span>
                </div>

                {slot.status === 'AVAILABLE' && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1">
                      <Edit className="w-3 h-3 mr-1" />
                      Edit
                    </Button>
                    <Button 
                      size="sm" 
                      variant="outline" 
                      onClick={() => deleteSlot(slot.id)}
                      className="text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
