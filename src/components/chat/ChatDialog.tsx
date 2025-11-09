import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MessageSquare } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import ChatInterface from './ChatInterface';

interface ChatDialogProps {
  appointmentId: string;
  patientId: string;
  doctorId: string;
  currentUserId: string;
  otherUserName: string;
  variant?: 'default' | 'outline' | 'ghost';
  onBookGeneralPhysician?: () => void;
}

const ChatDialog = ({ 
  appointmentId, 
  patientId, 
  doctorId, 
  currentUserId, 
  otherUserName,
  variant = 'default',
  onBookGeneralPhysician
}: ChatDialogProps) => {
  const [open, setOpen] = useState(false);
  const [chatRoomId, setChatRoomId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      getOrCreateChatRoom();
    }
  }, [open]);

  const getOrCreateChatRoom = async () => {
    // First check if chat room exists
    const { data: existing } = await supabase
      .from('chat_rooms')
      .select('id')
      .eq('appointment_id', appointmentId)
      .single();

    if (existing) {
      setChatRoomId(existing.id);
      return;
    }

    // Create new chat room
    const { data, error } = await supabase
      .from('chat_rooms')
      .insert({
        appointment_id: appointmentId,
        patient_id: patientId,
        doctor_id: doctorId
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating chat room:', error);
      toast({
        title: 'Error',
        description: 'Failed to open chat',
        variant: 'destructive'
      });
      return;
    }

    setChatRoomId(data.id);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size="sm">
          <MessageSquare className="w-4 h-4 mr-2" />
          Open Chat
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>Chat</DialogTitle>
        </DialogHeader>
        {chatRoomId && (
          <ChatInterface 
            chatRoomId={chatRoomId} 
            currentUserId={currentUserId} 
            otherUserName={otherUserName}
            otherUserId={currentUserId === patientId ? doctorId : patientId}
            onBookGeneralPhysician={onBookGeneralPhysician}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ChatDialog;
