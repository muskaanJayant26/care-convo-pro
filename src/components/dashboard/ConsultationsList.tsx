import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { FileText, Pill, Calendar } from 'lucide-react';
import { format } from 'date-fns';

interface Prescription {
  id: string;
  medication_name: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
}

interface Consultation {
  id: string;
  doctor_notes: string;
  ai_summary: string | null;
  created_at: string;
  appointment: {
    appointment_date: string;
    patient: { full_name: string };
    doctor: { full_name: string };
  };
  prescriptions: Prescription[];
}

interface ConsultationsListProps {
  userId: string;
  role: 'patient' | 'doctor';
}

const ConsultationsList = ({ userId, role }: ConsultationsListProps) => {
  const { toast } = useToast();
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchConsultations = async () => {
      // First get appointments for this user
      let appointmentQuery = supabase
        .from('appointments')
        .select('id');

      if (role === 'patient') {
        appointmentQuery = appointmentQuery.eq('patient_id', userId);
      } else {
        appointmentQuery = appointmentQuery.eq('doctor_id', userId);
      }

      const { data: userAppointments } = await appointmentQuery;
      const appointmentIds = userAppointments?.map(a => a.id) || [];

      if (appointmentIds.length === 0) {
        setConsultations([]);
        setLoading(false);
        return;
      }

      // Then get consultations for those appointments
      const { data, error } = await supabase
        .from('consultations')
        .select(`
          id,
          doctor_notes,
          ai_summary,
          created_at,
          appointment:appointments!inner(
            appointment_date,
            patient:profiles!appointments_patient_id_fkey(full_name),
            doctor:profiles!appointments_doctor_id_fkey(full_name)
          ),
          prescriptions(*)
        `)
        .in('appointment_id', appointmentIds)
        .order('created_at', { ascending: false });

      if (error) {
        toast({
          title: 'Error',
          description: error.message,
          variant: 'destructive',
        });
      } else {
        setConsultations(data || []);
      }
      setLoading(false);
    };

    fetchConsultations();
  }, [userId, role]);

  if (loading) {
    return <div className="text-center py-4">Loading consultations...</div>;
  }

  if (consultations.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
        <p>No consultations found</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {consultations.map((consultation) => (
        <Card key={consultation.id}>
          <CardHeader>
            <div className="flex justify-between items-start">
              <div>
                <CardTitle className="text-lg">
                  {role === 'patient'
                    ? `Dr. ${consultation.appointment.doctor.full_name}`
                    : consultation.appointment.patient.full_name}
                </CardTitle>
                <CardDescription className="flex items-center gap-2 mt-1">
                  <Calendar className="w-3 h-3" />
                  {format(new Date(consultation.appointment.appointment_date), 'PPP')}
                </CardDescription>
              </div>
              <Badge>
                {format(new Date(consultation.created_at), 'MMM dd, yyyy')}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {consultation.ai_summary && (
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
                <p className="text-sm font-medium mb-1 text-primary">AI Summary</p>
                <p className="text-sm">{consultation.ai_summary}</p>
              </div>
            )}

            <div>
              <p className="text-sm font-medium mb-2">Consultation Notes</p>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {consultation.doctor_notes}
              </p>
            </div>

            {consultation.prescriptions && consultation.prescriptions.length > 0 && (
              <>
                <Separator />
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Pill className="w-4 h-4" />
                    <p className="text-sm font-medium">Prescriptions</p>
                  </div>
                  <div className="space-y-3">
                    {consultation.prescriptions.map((prescription) => (
                      <div key={prescription.id} className="border rounded-lg p-3 space-y-2">
                        <p className="font-medium">{prescription.medication_name}</p>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <span className="text-muted-foreground">Dosage: </span>
                            {prescription.dosage}
                          </div>
                          <div>
                            <span className="text-muted-foreground">Frequency: </span>
                            {prescription.frequency}
                          </div>
                          <div>
                            <span className="text-muted-foreground">Duration: </span>
                            {prescription.duration}
                          </div>
                          {prescription.instructions && (
                            <div className="col-span-2">
                              <span className="text-muted-foreground">Instructions: </span>
                              {prescription.instructions}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default ConsultationsList;
