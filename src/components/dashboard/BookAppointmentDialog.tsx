import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar, Plus } from 'lucide-react';
import { format } from 'date-fns';

interface Doctor {
  id: string;
  full_name: string;
  specialization: string;
}

interface BookAppointmentDialogProps {
  userId: string;
  onAppointmentBooked: () => void;
}

const BookAppointmentDialog = ({ userId, onAppointmentBooked }: BookAppointmentDialogProps) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [selectedDoctor, setSelectedDoctor] = useState('');
  const [appointmentDate, setAppointmentDate] = useState('');
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');

  useEffect(() => {
    const fetchDoctors = async () => {
      const { data, error } = await supabase
        .from('user_roles')
        .select('user_id, specialization, profiles(id, full_name)')
        .eq('role', 'doctor');

      console.log('Fetching doctors:', { data, error });

      if (error) {
        console.error('Error fetching doctors:', error);
        return;
      }

      if (data) {
        const doctorList: Doctor[] = data.map((d: any) => ({
          id: d.user_id,
          full_name: d.profiles?.full_name || 'Unknown',
          specialization: d.specialization || 'General Practice',
        }));
        console.log('Doctor list:', doctorList);
        setDoctors(doctorList);
      }
    };
    fetchDoctors();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { data: appointmentData, error } = await supabase
      .from('appointments')
      .insert({
        patient_id: userId,
        doctor_id: selectedDoctor,
        appointment_date: new Date(appointmentDate).toISOString(),
        reason,
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
      setLoading(false);
      return;
    }

    // Create payment record if amount is specified
    if (amount && parseFloat(amount) > 0 && appointmentData) {
      const { error: paymentError } = await supabase
        .from('payments')
        .insert({
          appointment_id: appointmentData.id,
          amount: parseFloat(amount),
          status: 'pending',
        });

      if (paymentError) {
        console.error('Error creating payment:', paymentError);
      }
    }

    // Create notification for doctor
    await supabase.from('notifications').insert({
      user_id: selectedDoctor,
      title: 'New Appointment Request',
      message: `You have a new appointment request for ${format(new Date(appointmentDate), 'PPpp')}${amount ? ` with payment of $${amount}` : ''}`,
    });

    toast({
      title: 'Success',
      description: 'Appointment request sent successfully',
    });
    setOpen(false);
    setSelectedDoctor('');
    setAppointmentDate('');
    setReason('');
    setAmount('');
    onAppointmentBooked();
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg" className="w-full sm:w-auto">
          <Plus className="w-4 h-4 mr-2" />
          Book Appointment
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Book New Appointment</DialogTitle>
          <DialogDescription>Schedule an appointment with a doctor</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="doctor">Select Doctor</Label>
            <Select value={selectedDoctor} onValueChange={setSelectedDoctor} required>
              <SelectTrigger>
                <SelectValue placeholder="Choose a doctor" />
              </SelectTrigger>
              <SelectContent>
                {doctors.map((doctor) => (
                  <SelectItem key={doctor.id} value={doctor.id}>
                    {doctor.full_name} - {doctor.specialization}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="date">Date & Time</Label>
            <input
              id="date"
              type="datetime-local"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={appointmentDate}
              onChange={(e) => setAppointmentDate(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="reason">Reason for Visit</Label>
            <Textarea
              id="reason"
              placeholder="Describe your symptoms or reason for the visit"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              rows={4}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount">Payment Amount (Optional)</Label>
            <input
              id="amount"
              type="number"
              step="0.01"
              min="0"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Booking...' : 'Book Appointment'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default BookAppointmentDialog;
