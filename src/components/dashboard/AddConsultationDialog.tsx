import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { FileText, Plus } from 'lucide-react';

interface AddConsultationDialogProps {
  appointmentId: string;
  onConsultationAdded: () => void;
}

interface Prescription {
  medication_name: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
}

const AddConsultationDialog = ({ appointmentId, onConsultationAdded }: AddConsultationDialogProps) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [doctorNotes, setDoctorNotes] = useState('');
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([
    { medication_name: '', dosage: '', frequency: '', duration: '', instructions: '' }
  ]);

  const handleAddPrescription = () => {
    setPrescriptions([...prescriptions, { medication_name: '', dosage: '', frequency: '', duration: '', instructions: '' }]);
  };

  const handlePrescriptionChange = (index: number, field: keyof Prescription, value: string) => {
    const updated = [...prescriptions];
    updated[index][field] = value;
    setPrescriptions(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Generate AI summary
      const { data: summaryData, error: summaryError } = await supabase.functions.invoke('generate-consultation-summary', {
        body: { notes: doctorNotes }
      });

      const aiSummary = summaryError ? null : summaryData?.summary;

      // Create consultation
      const { data: consultation, error: consultationError } = await supabase
        .from('consultations')
        .insert({
          appointment_id: appointmentId,
          doctor_notes: doctorNotes,
          ai_summary: aiSummary,
        })
        .select()
        .single();

      if (consultationError) throw consultationError;

      // Add prescriptions
      const validPrescriptions = prescriptions.filter(p => p.medication_name && p.dosage);
      if (validPrescriptions.length > 0) {
        const { error: prescriptionError } = await supabase
          .from('prescriptions')
          .insert(
            validPrescriptions.map(p => ({
              consultation_id: consultation.id,
              ...p
            }))
          );

        if (prescriptionError) throw prescriptionError;
      }

      // Update appointment status
      await supabase
        .from('appointments')
        .update({ status: 'completed' })
        .eq('id', appointmentId);

      // Get patient ID for notification
      const { data: appointment } = await supabase
        .from('appointments')
        .select('patient_id')
        .eq('id', appointmentId)
        .single();

      if (appointment) {
        await supabase.from('notifications').insert({
          user_id: appointment.patient_id,
          title: 'Consultation Added',
          message: 'Your doctor has added consultation notes and prescriptions',
        });
      }

      toast({
        title: 'Success',
        description: 'Consultation and prescriptions saved',
      });

      setOpen(false);
      setDoctorNotes('');
      setPrescriptions([{ medication_name: '', dosage: '', frequency: '', duration: '', instructions: '' }]);
      onConsultationAdded();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    }

    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary" className="w-full">
          <FileText className="w-4 h-4 mr-1" />
          Add Consultation
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Consultation Notes</DialogTitle>
          <DialogDescription>Record consultation details and prescriptions</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="notes">Consultation Notes</Label>
            <Textarea
              id="notes"
              placeholder="Enter detailed consultation notes..."
              value={doctorNotes}
              onChange={(e) => setDoctorNotes(e.target.value)}
              required
              rows={6}
            />
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <Label>Prescriptions</Label>
              <Button type="button" size="sm" variant="outline" onClick={handleAddPrescription}>
                <Plus className="w-4 h-4 mr-1" />
                Add Medication
              </Button>
            </div>

            {prescriptions.map((prescription, index) => (
              <div key={index} className="border rounded-lg p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Medication Name</Label>
                    <Input
                      placeholder="e.g., Amoxicillin"
                      value={prescription.medication_name}
                      onChange={(e) => handlePrescriptionChange(index, 'medication_name', e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Dosage</Label>
                    <Input
                      placeholder="e.g., 500mg"
                      value={prescription.dosage}
                      onChange={(e) => handlePrescriptionChange(index, 'dosage', e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Frequency</Label>
                    <Input
                      placeholder="e.g., Twice daily"
                      value={prescription.frequency}
                      onChange={(e) => handlePrescriptionChange(index, 'frequency', e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Duration</Label>
                    <Input
                      placeholder="e.g., 7 days"
                      value={prescription.duration}
                      onChange={(e) => handlePrescriptionChange(index, 'duration', e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Instructions</Label>
                  <Input
                    placeholder="e.g., Take after meals"
                    value={prescription.instructions}
                    onChange={(e) => handlePrescriptionChange(index, 'instructions', e.target.value)}
                  />
                </div>
              </div>
            ))}
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Saving...' : 'Save Consultation'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default AddConsultationDialog;
