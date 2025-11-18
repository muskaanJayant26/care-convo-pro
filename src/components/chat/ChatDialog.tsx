import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MessageSquare } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import ChatInterface from './ChatInterface';
import VideoCall from '../video/VideoCall';


interface ChatDialogProps {
  appointmentId?: string;
  patientId: string;
  doctorId: string;
  currentUserId: string;
  otherUserName: string;
  variant?: 'default' | 'outline' | 'ghost';
  onBookGeneralPhysician?: () => void;
}

export default function ChatDialog({
  appointmentId,
  patientId,
  doctorId,
  currentUserId,
  otherUserName,
  variant = 'default',
  onBookGeneralPhysician
}: ChatDialogProps) {
  const { toast } = useToast();

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

  // -----------------------------------------------------
  // CREATE / SUBSCRIBE TO VIDEO CALL CHANNEL ONCE
  // -----------------------------------------------------
  useEffect(() => {
    if (!chatRoomId) return;

    const channel = supabase.channel(`video_call_${chatRoomId}`, {
      config: { broadcast: { ack: true } },
    });

    channelRef.current = channel;

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        console.log("ChatDialog subscribed to call channel");
      }
    });

    // incoming call listener
    channel.on("broadcast", { event: "incoming_call" }, ({ payload }) => {
      if (payload.from === currentUserId) return;

      setIncomingCall({
        callerId: payload.from,
        callerName: payload.fromName,
        callId: payload.callId
      });
    });

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [chatRoomId]);

  // ------------------------------------------------------------------
  // OPEN CHAT = GET/CREATE CHAT ROOM
  // ------------------------------------------------------------------
  useEffect(() => {
    if (open) {
      getOrCreateChatRoom();
    }
  }, [open]);

  async function getOrCreateChatRoom() {
    const query = supabase
      .from("chat_rooms")
      .select("id")
      .eq("patient_id", patientId)
      .eq("doctor_id", doctorId);

    appointmentId ? query.eq("appointment_id", appointmentId) : query.is("appointment_id", null);

    const { data: existing } = await query.single();

    if (existing) {
      setChatRoomId(existing.id);
      return;
    }

    const { data, error } = await supabase
      .from("chat_rooms")
      .insert({
        appointment_id: appointmentId || null,
        patient_id: patientId,
        doctor_id: doctorId,
      })
      .select()
      .single();

    if (!error) setChatRoomId(data.id);
  }

  // ------------------------------------------------------------------
  // ACCEPT / REJECT
  // ------------------------------------------------------------------
  const handleAccept = () => {
    setInCall(true);
    setCallOtherUserId(incomingCall!.callerId);
    setCallOtherUserName(incomingCall!.callerName);
    setIncomingCall(null);
  };

  const handleReject = () => {
    if (channelRef.current) {
      channelRef.current.send({
        type: "broadcast",
        event: "call_rejected",
        payload: {
          from: currentUserId,
          callId: incomingCall?.callId,
        },
      });
    }
    setIncomingCall(null);
  };

  // ------------------------------------------------------------------
  return (
    <>
      {incomingCall && !inCall && (
        <IncomingCallPopup
          callerName={incomingCall.callerName}
          onAccept={handleAccept}
          onReject={handleReject}
        />
      )}

      {inCall && callOtherUserId && callOtherUserName && (
        <VideoCall
          chatRoomId={chatRoomId!}
          currentUserId={currentUserId}
          otherUserId={callOtherUserId}
          otherUserName={callOtherUserName}
          onCallEnd={() => {
            setInCall(false);
            setCallOtherUserId(null);
            setCallOtherUserName(null);
          }}
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
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
