import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MessageSquare } from 'lucide-react';
import ChatDialog from '../chat/ChatDialog';
import { useToast } from '@/hooks/use-toast';

interface GeneralPhysicianChatProps {
  patientId: string;
}

const GeneralPhysicianChat = ({ patientId }: GeneralPhysicianChatProps) => {
  const [generalPhysician, setGeneralPhysician] = useState<any>(null);
  const { toast } = useToast();

  useEffect(() => {
    const fetchGeneralPhysician = async () => {
      // Fetch a doctor with "General Physician" specialization
      const { data, error } = await supabase
        .from('user_roles')
        .select(`
          user_id,
          specialization,
          profiles!inner (
            id,
            full_name
          )
        `)
        .eq('role', 'doctor')
        .ilike('specialization', '%general%')
        .limit(1)
        .single();

      if (error) {
        console.error('Error fetching general physician:', error);
        toast({
          title: 'Notice',
          description: 'No general physician available at the moment',
          variant: 'default'
        });
        return;
      }

      if (data) {
        setGeneralPhysician({
          id: data.user_id,
          name: data.profiles.full_name,
          specialization: data.specialization
        });
      }
    };

    fetchGeneralPhysician();
  }, [patientId, toast]);

  if (!generalPhysician) {
    return null;
  }

  return (
    <Card className="border-secondary/30 bg-gradient-to-br from-secondary/5 to-background hover:shadow-lg transition-shadow">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <MessageSquare className="w-5 h-5 text-secondary" />
          Quick Consultation
        </CardTitle>
        <CardDescription>
          Chat with our general physician anytime
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChatDialog
          patientId={patientId}
          doctorId={generalPhysician.id}
          currentUserId={patientId}
          otherUserName={`Dr. ${generalPhysician.name}`}
          variant="default"
        />
      </CardContent>
    </Card>
  );
};

export default GeneralPhysicianChat;
