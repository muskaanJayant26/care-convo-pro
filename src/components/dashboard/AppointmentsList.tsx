import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { CheckCircle2, XCircle, Calendar, User } from 'lucide-react';
import AddConsultationDialog from './AddConsultationDialog';
import ChatDialog from '../chat/ChatDialog';
import { useNavigate } from 'react-router-dom';

interface Appointment {
  id: string;
  appointment_date: string;
  reason: string;
  status: string;
  patient_id: string;
  doctor_id: string;
  patient: { full_name: string };
  doctor: { full_name: string };
}

interface AppointmentsListProps {
  userId: string;
  role: 'patient' | 'doctor';
}

const AppointmentsList = ({ userId, role }: AppointmentsListProps) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAppointments = async () => {
    const query = supabase
      .from('appointments')
      .select(`
        id,
        appointment_date,
        reason,
        status,
        patient_id,
        doctor_id,
        patient:profiles!appointments_patient_id_fkey(full_name),
        doctor:profiles!appointments_doctor_id_fkey(full_name)
      `)
      .order('appointment_date', { ascending: false });

    if (role === 'patient') {
      query.eq('patient_id', userId);
    } else {
      query.eq('doctor_id', userId);
    }

    const { data, error } = await query;

    if (error) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      setAppointments(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchAppointments();

    const channel = supabase
      .channel('appointments-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'appointments',
          filter: role === 'patient' ? `patient_id=eq.${userId}` : `doctor_id=eq.${userId}`,
        },
        () => {
          fetchAppointments();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, role]);

  const handleConfirm = async (appointmentId: string, patientId: string) => {
    const { error } = await supabase
      .from('appointments')
      .update({ status: 'confirmed' })
      .eq('id', appointmentId);

    if (error) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      await supabase.from('notifications').insert({
        user_id: patientId,
        title: 'Appointment Confirmed',
        message: 'Your appointment has been confirmed by the doctor',
      });

      toast({
        title: 'Success',
        description: 'Appointment confirmed',
      });
      fetchAppointments();
    }
  };

  const handleCancel = async (appointmentId: string, otherUserId: string) => {
    const { error } = await supabase
      .from('appointments')
      .update({ status: 'cancelled' })
      .eq('id', appointmentId);

    if (error) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      await supabase.from('notifications').insert({
        user_id: otherUserId,
        title: 'Appointment Cancelled',
        message: 'An appointment has been cancelled',
      });

      toast({
        title: 'Success',
        description: 'Appointment cancelled',
      });
      fetchAppointments();
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, any> = {
      pending: 'secondary',
      confirmed: 'default',
      completed: 'outline',
      cancelled: 'destructive',
    };

    return (
      <Badge variant={variants[status] || 'secondary'}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  if (loading) {
    return <div className="text-center py-4">Loading appointments...</div>;
  }

  if (appointments.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Calendar className="w-12 h-12 mx-auto mb-2 opacity-50" />
        <p>No appointments found</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {appointments.map((apt) => (
        <div key={apt.id} className="border rounded-lg p-4 space-y-3">
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-muted-foreground" />
                <span className="font-medium">
                  {role === 'patient' ? `Dr. ${apt.doctor.full_name}` : apt.patient.full_name}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="w-4 h-4" />
                {format(new Date(apt.appointment_date), 'PPpp')}
              </div>
            </div>
            {getStatusBadge(apt.status)}
          </div>

          <p className="text-sm">{apt.reason}</p>

          {role === 'doctor' && apt.status === 'pending' && (
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => handleConfirm(apt.id, apt.patient_id)}
                className="flex-1"
              >
                <CheckCircle2 className="w-4 h-4 mr-1" />
                Confirm
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => handleCancel(apt.id, apt.patient_id)}
                className="flex-1"
              >
                <XCircle className="w-4 h-4 mr-1" />
                Cancel
              </Button>
            </div>
          )}

          {role === 'doctor' && apt.status === 'confirmed' && (
            <div className="flex gap-2">
              <AddConsultationDialog appointmentId={apt.id} onConsultationAdded={fetchAppointments} />
              <ChatDialog
                appointmentId={apt.id}
                patientId={apt.patient_id}
                doctorId={apt.doctor_id}
                currentUserId={userId}
                otherUserName={apt.patient.full_name}
                variant="outline"
              />
            </div>
          )}

          {role === 'patient' && apt.status === 'confirmed' && (
            <ChatDialog
              appointmentId={apt.id}
              patientId={apt.patient_id}
              doctorId={apt.doctor_id}
              currentUserId={userId}
              otherUserName={`Dr. ${apt.doctor.full_name}`}
              onBookGeneralPhysician={() => navigate('/dashboard')}
            />
          )}

          {role === 'patient' && apt.status === 'pending' && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleCancel(apt.id, apt.doctor_id)}
            >
              <XCircle className="w-4 h-4 mr-1" />
              Cancel Appointment
            </Button>
          )}
        </div>
      ))}
    </div>
  );
};

export default AppointmentsList;
