// ChatInterface.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Send, Video } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import VideoCall from '../video/VideoCall';

interface Message {
  id: string;
  sender_id: string;
  message: string;
  created_at: string;
}

interface ChatInterfaceProps {
  chatRoomId: string;
  currentUserId: string;
  otherUserName: string;
  otherUserId: string;
  onBookGeneralPhysician?: () => void;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({
  chatRoomId,
  currentUserId,
  otherUserName,
  otherUserId,
  onBookGeneralPhysician,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);

  // call states
  const [incomingCall, setIncomingCall] = useState<any>(null);
  const [activeCall, setActiveCall] = useState<null | { caller_id: string; receiver_id: string; chat_room_id: string }>(null);
  const [isOutgoingCalling, setIsOutgoingCalling] = useState(false);

  const ringtoneRef = useRef<HTMLAudioElement | null>(null);
  function tryPlayRingtone() {
    if (!ringtoneRef.current) {
      ringtoneRef.current = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA=');
      ringtoneRef.current.loop = true;
    }
    ringtoneRef.current.play().catch(() => {});
  }
  function stopRingtone() {
    ringtoneRef.current?.pause();
    ringtoneRef.current = null;
  }

  // fetch messages & subscribe
  useEffect(() => {
    const fetchMessages = async () => {
      const { data, error } = await supabase.from('messages').select('*').eq('chat_room_id', chatRoomId).order('created_at', { ascending: true });
      if (!error) setMessages(data || []);
    };
    fetchMessages();

    const msgChannel = supabase
      .channel(`chat-${chatRoomId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_room_id=eq.${chatRoomId}` }, (payload) => {
        setMessages((cur) => [...cur, payload.new as Message]);
      })
      .subscribe();

    return () => supabase.removeChannel(msgChannel);
  }, [chatRoomId]);

  // subscribe to call_signals for the chat room to detect incoming offers/accepted/rejected
  useEffect(() => {
    const channel = supabase
      .channel(`call-${chatRoomId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_signals', filter: `chat_room_id=eq.${chatRoomId}` }, (payload) => {
        const row = payload.new as any;

        // incoming call for receiver
        if (row.type === 'call-offer' && row.receiver_id === currentUserId) {
          setIncomingCall(row);
          tryPlayRingtone();
        }

        // accepted by receiver -> both sides should open VideoCall UI
        if (row.type === 'call-accepted') {
          if (row.caller_id === currentUserId || row.receiver_id === currentUserId) {
            setActiveCall({ caller_id: row.caller_id, receiver_id: row.receiver_id, chat_room_id: row.chat_room_id });
            setIncomingCall(null);
            setIsOutgoingCalling(false);
            stopRingtone();
          }
        }

        // rejected
        if (row.type === 'call-rejected' && row.caller_id === currentUserId) {
          toast({ title: 'Call Rejected', description: `${otherUserName} rejected the call.` });
          setIsOutgoingCalling(false);
          stopRingtone();
        }
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [chatRoomId, currentUserId, otherUserName, toast]);

  const sendMessage = async () => {
    if (!newMessage.trim()) return;
    setLoading(true);
    const { error } = await supabase.from('messages').insert({ chat_room_id: chatRoomId, sender_id: currentUserId, message: newMessage.trim() });
    if (error) toast({ title: 'Error', description: 'Failed to send message', variant: 'destructive' });
    else setNewMessage('');
    setLoading(false);
  };

  // start call (caller)
  const startCall = async () => {
    try {
      setIsOutgoingCalling(true);
      setActiveCall({ caller_id: currentUserId, receiver_id: otherUserId, chat_room_id: chatRoomId });

      // insert call-offer
      await supabase.from('call_signals').insert({
        chat_room_id: chatRoomId,
        caller_id: currentUserId,
        receiver_id: otherUserId,
        sender_id: currentUserId,
        type: 'call-offer',
      });

      toast({ title: 'Calling', description: `Ringing ${otherUserName}...` });
    } catch (err) {
      console.error(err);
      toast({ title: 'Error', description: 'Failed to start call' });
      setIsOutgoingCalling(false);
      setActiveCall(null);
    }
  };

  // accept call (receiver)
  const acceptCall = async () => {
    if (!incomingCall) return;
    try {
      stopRingtone();
      await supabase.from('call_signals').insert({
        chat_room_id: chatRoomId,
        caller_id: incomingCall.caller_id,
        receiver_id: incomingCall.receiver_id,
        sender_id: currentUserId,
        type: 'call-accepted',
      });

      setActiveCall({ caller_id: incomingCall.caller_id, receiver_id: incomingCall.receiver_id, chat_room_id: chatRoomId });
      setIncomingCall(null);
    } catch (err) {
      console.error('acceptCall error', err);
      toast({ title: 'Error', description: 'Failed to accept call' });
    }
  };

  // reject call (receiver)
  const rejectCall = async () => {
    if (!incomingCall) return;
    try {
      stopRingtone();
      await supabase.from('call_signals').insert({
        chat_room_id: chatRoomId,
        caller_id: incomingCall.caller_id,
        receiver_id: incomingCall.receiver_id,
        sender_id: currentUserId,
        type: 'call-rejected',
      });
      setIncomingCall(null);
    } catch (err) {
      console.error('rejectCall error', err);
      toast({ title: 'Error', description: 'Failed to reject call' });
    }
  };

  const handleVideoCallClose = () => {
    setActiveCall(null);
    setIsOutgoingCalling(false);
  };

  return (
    <div className="flex flex-col h-[500px] relative">
      {/* Incoming call modal */}
      {incomingCall && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded shadow w-[320px] text-center">
            <h3 className="font-bold">Incoming call</h3>
            <p className="text-sm">{otherUserName} is calling you</p>
            <div className="flex gap-3 mt-4">
              <Button onClick={acceptCall} className="flex-1">Accept</Button>
              <Button onClick={rejectCall} variant="destructive" className="flex-1">Reject</Button>
            </div>
          </div>
        </div>
      )}

      {/* VideoCall modal */}
      {(activeCall || isOutgoingCalling) && (
        <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center">
          <div className="bg-white rounded-lg p-4 w-full max-w-4xl h-[90vh]">
            <VideoCall
              chatRoomId={chatRoomId}
              callerId={activeCall ? activeCall.caller_id : currentUserId}
              receiverId={activeCall ? activeCall.receiver_id : otherUserId}
              currentUserId={currentUserId}
              onClose={handleVideoCallClose}
            />
          </div>
        </div>
      )}

      {/* header */}
      <div className="bg-gradient-to-r from-primary/10 to-secondary/10 p-4 border-b flex justify-between items-center">
        <h3 className="font-semibold">Chat with {otherUserName}</h3>
        <div>
          <Button onClick={startCall} size="sm" variant="secondary">
            <Video className="w-4 h-4 mr-2" /> Start Video Call
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 p-4" ref={scrollAreaRef as any}>
        <div className="space-y-4">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.sender_id === currentUserId ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[70%] rounded-lg p-3 ${msg.sender_id === currentUserId ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'}`}>
                <p className="text-sm break-words">{msg.message}</p>
                <p className="text-xs opacity-70 mt-1">{format(new Date(msg.created_at), 'HH:mm')}</p>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      <div className="p-4 border-t bg-card space-y-3">
        {onBookGeneralPhysician && (
          <Button onClick={onBookGeneralPhysician} variant="outline" className="w-full">Book General Physician Appointment</Button>
        )}

        <div className="flex gap-2">
          <Input value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder="Type a message..." disabled={loading} className="flex-1" />
          <Button onClick={sendMessage} disabled={loading || !newMessage.trim()} size="icon">
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;
