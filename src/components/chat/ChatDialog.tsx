import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MessageSquare } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import ChatInterface from './ChatInterface';
import { VideoCall } from '@/components/video/VideoCall';

interface ChatDialogProps {
  appointmentId?: string;
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
  const [isVideoCallActive, setIsVideoCallActive] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      getOrCreateChatRoom();
    }
  }, [open]);

  const getOrCreateChatRoom = async () => {
    // First check if chat room exists
    const query = supabase
      .from('chat_rooms')
      .select('id')
      .eq('patient_id', patientId)
      .eq('doctor_id', doctorId);
    
    if (appointmentId) {
      query.eq('appointment_id', appointmentId);
    } else {
      query.is('appointment_id', null);
    }

    const { data: existing } = await query.single();

    if (existing) {
      setChatRoomId(existing.id);
      return;
    }

    // Create new chat room
    const { data, error } = await supabase
      .from('chat_rooms')
      .insert({
        appointment_id: appointmentId || null,
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

  const handleStartVideoCall = () => {
    setIsVideoCallActive(true);
  };

  const handleEndVideoCall = () => {
    setIsVideoCallActive(false);
  };

  return (
    <>
      {isVideoCallActive && chatRoomId && (
        <VideoCall
          chatRoomId={chatRoomId}
          currentUserId={currentUserId}
          otherUserId={currentUserId === patientId ? doctorId : patientId}
          otherUserName={otherUserName}
          onCallEnd={handleEndVideoCall}
        />
      )}
      
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
              onStartVideoCall={handleStartVideoCall}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ChatDialog;
