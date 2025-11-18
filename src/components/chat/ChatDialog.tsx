// ChatDialog.tsx - Clean Daily Version
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MessageSquare, Video } from 'lucide-react';
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

  // Show the video call modal
  const [showCall, setShowCall] = useState(false);

  const DAILY_ROOM_URL = "https://health-test.daily.co/test";

  // -----------------------------------------------------
  // CREATE / GET CHAT ROOM
  // -----------------------------------------------------
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

    appointmentId
      ? query.eq("appointment_id", appointmentId)
      : query.is("appointment_id", null);

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

  // -----------------------------------------------------
  // RENDER
  // -----------------------------------------------------
  return (
    <>
      {/* Daily video call modal */}
      {showCall && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-4xl h-[90vh] bg-white rounded-lg overflow-hidden">
            <VideoCall
              roomUrl={DAILY_ROOM_URL}
              onLeave={() => setShowCall(false)}
            />
          </div>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant={variant} size="sm">
            <MessageSquare className="w-4 h-4 mr-2" />
            Open Chat
          </Button>
        </DialogTrigger>

        <DialogContent className="sm:max-w-[600px] p-0">
          <DialogHeader className="px-6 pt-6 flex justify-between items-center">
            <DialogTitle>Chat</DialogTitle>

            {/* Open video call button */}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setShowCall(true)}
            >
              <Video className="w-4 h-4 mr-1" /> Video Call
            </Button>
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
