import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MessageSquare } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import ChatInterface from './ChatInterface';
import { VideoCall } from '@/components/video/VideoCall';
import IncomingCallPopup from '../incomingCall/incomingCallPopup';

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
  onBookGeneralPhysician,
}: ChatDialogProps) => {
  const [open, setOpen] = useState(false);
  const [chatRoomId, setChatRoomId] = useState<string | null>(null);

  const [incomingCall, setIncomingCall] = useState<null | {
    callerId: string;
    callerName: string;
    callId: string;
  }>(null);

  const [inCall, setInCall] = useState(false);
  const [callOtherUserId, setCallOtherUserId] = useState<string | null>(null);
  const [callOtherUserName, setCallOtherUserName] = useState<string | null>(null);

  const channelRef = useRef<any>(null);
  const { toast } = useToast();

  // -----------------------------
  // Create / Load Chat Room
  // -----------------------------
  useEffect(() => {
    if (open) getOrCreateChatRoom();
  }, [open]);

  const getOrCreateChatRoom = async () => {
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

    const { data, error } = await supabase
      .from('chat_rooms')
      .insert({
        appointment_id: appointmentId || null,
        patient_id: patientId,
        doctor_id: doctorId,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating chat room:', error);
      toast({
        title: 'Error',
        description: 'Failed to open chat',
        variant: 'destructive',
      });
      return;
    }

    setChatRoomId(data.id);
  };

  // -----------------------------
  // Subscribe to incoming calls
  // -----------------------------
  useEffect(() => {
    if (!chatRoomId) return;

    const channel = supabase.channel(`video_call_${chatRoomId}`, {
      config: { broadcast: { ack: true } },
    });

    channelRef.current = channel;

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('Subscribed to video_call channel:', chatRoomId);
      }
    });

    // Incoming call event
    channel.on('broadcast', { event: 'incoming_call' }, ({ payload }) => {
      if (payload.from === currentUserId) return;

      setIncomingCall({
        callerId: payload.from,
        callerName: payload.fromName || 'Caller',
        callId: payload.callId,
      });
    });

    // Caller was rejected
    channel.on('broadcast', { event: 'call_rejected' }, ({ payload }) => {
      if (payload.to === currentUserId) {
        toast({
          title: 'Call Rejected',
          description: `${otherUserName} rejected your call.`,
        });
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [chatRoomId]);

  // -----------------------------
  // Start outgoing video call
  // -----------------------------
  const handleStartVideoCall = async () => {
    if (!chatRoomId) return;

    const callId = crypto.randomUUID();

    channelRef.current?.send({
      type: 'broadcast',
      event: 'incoming_call',
      payload: {
        from: currentUserId,
        fromName: otherUserName,
        callId,
      },
    });

    // open video UI immediately
    setInCall(true);
    setCallOtherUserId(currentUserId === patientId ? doctorId : patientId);
    setCallOtherUserName(otherUserName);
  };

  // -----------------------------
  // End the call
  // -----------------------------
  const handleEndVideoCall = () => {
    setInCall(false);
    setCallOtherUserId(null);
    setCallOtherUserName(null);
  };

  return (
    <>
      {/* Incoming Call Popup */}
      {incomingCall && !inCall && (
        <IncomingCallPopup
          callerName={incomingCall.callerName}
          onAccept={() => {
            setInCall(true);
            setCallOtherUserId(incomingCall.callerId);
            setCallOtherUserName(incomingCall.callerName);
            setIncomingCall(null);
          }}
          onReject={() => {
            channelRef.current?.send({
              type: 'broadcast',
              event: 'call_rejected',
              payload: {
                from: currentUserId,
                to: incomingCall.callerId,
                callId: incomingCall.callId,
              },
            });
            setIncomingCall(null);
          }}
        />
      )}

      {/* Video Call */}
      {inCall && callOtherUserId && callOtherUserName && chatRoomId && (
        <VideoCall
          chatRoomId={chatRoomId}
          currentUserId={currentUserId}
          otherUserId={callOtherUserId}
          otherUserName={callOtherUserName}
          onCallEnd={handleEndVideoCall}
        />
      )}

      {/* Chat Dialog */}
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
