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
  const [incomingCall, setIncomingCall] = useState<any | null>(null);
  const [activeCall, setActiveCall] = useState< null | { caller_id: string; receiver_id: string; chat_room_id: string } >(null);
  const [isOutgoingCalling, setIsOutgoingCalling] = useState(false);

  // channels refs so we can cleanup
  const messagesChannelRef = useRef<any>(null);
  const callsChannelRef = useRef<any>(null);

  // simple ringtone
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);
  function tryPlayRingtone() {
    if (!ringtoneRef.current) {
      // tiny beep as data URI — replace with your mp3 if needed
      ringtoneRef.current = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA=');
      ringtoneRef.current.loop = true;
    }
    ringtoneRef.current.play().catch(() => {
      /* autoplay blocked - ignore */
    });
  }
  function stopRingtone() {
    if (ringtoneRef.current) {
      try {
        ringtoneRef.current.pause();
      } catch {}
      ringtoneRef.current = null;
    }
  }

  // fetch messages
  const fetchMessages = useCallback(async () => {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('chat_room_id', chatRoomId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('fetchMessages error', error);
      return;
    }
    setMessages((data as Message[]) || []);
  }, [chatRoomId]);

  // On mount -> fetch messages + subscribe to new messages
  useEffect(() => {
    fetchMessages();

    const msgChannel = supabase
      .channel(`chat-${chatRoomId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_room_id=eq.${chatRoomId}` },
        (payload: any) => {
          setMessages((cur) => [...cur, payload.new as Message]);
        }
      )
      .subscribe((status) => {
        // Optionally log status
      });

    messagesChannelRef.current = msgChannel;

    return () => {
      try {
        if (messagesChannelRef.current) supabase.removeChannel(messagesChannelRef.current);
      } catch (e) {
        console.error('remove messages channel failed', e);
      }
    };
  }, [chatRoomId, fetchMessages]);

  // subscribe to call_signals for offers/accepted/rejected (UI-level events)
  useEffect(() => {
    const channel = supabase
      .channel(`calls-${chatRoomId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'call_signals', filter: `chat_room_id=eq.${chatRoomId}` },
        (payload: any) => {
          const row = payload.new as any;

          if (!row) return;

          // If it's an offer and the current user is the receiver -> show incoming popup
          if (row.type === 'call-offer' && row.receiver_id === currentUserId) {
            setIncomingCall(row);
            tryPlayRingtone();
            return;
          }

          // If someone accepted the call -> both sides should open VideoCall UI
          if (row.type === 'call-accepted') {
            // if this user is either caller or receiver for this row, set active call
            if (row.caller_id === currentUserId || row.receiver_id === currentUserId) {
              setActiveCall({ caller_id: row.caller_id, receiver_id: row.receiver_id, chat_room_id: row.chat_room_id });
              setIncomingCall(null);
              setIsOutgoingCalling(false);
              stopRingtone();
            }
            return;
          }

          // If rejected and current user is caller -> show rejection toast
          if (row.type === 'call-rejected' && row.caller_id === currentUserId) {
            toast({ title: 'Call Rejected', description: `${otherUserName} rejected your call.` });
            setIsOutgoingCalling(false);
            stopRingtone();
            return;
          }

          // Note: VideoCall component listens to 'webrtc-signal' rows itself; we don't need to forward them here.
        }
      )
      .subscribe((status) => {
        // optional logging
      });

    callsChannelRef.current = channel;

    return () => {
      try {
        if (callsChannelRef.current) supabase.removeChannel(callsChannelRef.current);
      } catch (e) {
        console.error('remove calls channel failed', e);
      }
    };
  }, [chatRoomId, currentUserId, otherUserName, toast]);

  // scroll to bottom when messages change
  useEffect(() => {
    if (scrollAreaRef.current) {
      try {
        scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
      } catch {}
    }
  }, [messages]);

  const sendMessage = async () => {
    if (!newMessage.trim()) return;
    setLoading(true);
    const { error } = await supabase.from('messages').insert({
      chat_room_id: chatRoomId,
      sender_id: currentUserId,
      message: newMessage.trim(),
    });
    if (error) {
      console.error('sendMessage error', error);
      toast({ title: 'Error', description: 'Failed to send message', variant: 'destructive' });
    } else {
      setNewMessage('');
    }
    setLoading(false);
  };

  // start call (caller) -> insert call-offer
  const startCall = async () => {
    try {
      setIsOutgoingCalling(true);
      setActiveCall({ caller_id: currentUserId, receiver_id: otherUserId, chat_room_id: chatRoomId });

      const { error } = await supabase.from('call_signals').insert({
        chat_room_id: chatRoomId,
        caller_id: currentUserId,
        receiver_id: otherUserId,
        sender_id: currentUserId,
        type: 'call-offer',
      });

      if (error) {
        throw error;
      }

      toast({ title: 'Calling', description: `Ringing ${otherUserName}...` });
    } catch (e) {
      console.error('startCall error', e);
      toast({ title: 'Error', description: 'Failed to start call', variant: 'destructive' });
      setIsOutgoingCalling(false);
      setActiveCall(null);
    }
  };

  // accept call (receiver) -> insert call-accepted
  const acceptCall = async () => {
    if (!incomingCall) return;
    try {
      stopRingtone();
      const { error } = await supabase.from('call_signals').insert({
        chat_room_id: chatRoomId,
        caller_id: incomingCall.caller_id,
        receiver_id: incomingCall.receiver_id,
        sender_id: currentUserId,
        type: 'call-accepted',
      });

      if (error) {
        throw error;
      }

      setActiveCall({ caller_id: incomingCall.caller_id, receiver_id: incomingCall.receiver_id, chat_room_id: chatRoomId });
      setIncomingCall(null);
    } catch (e) {
      console.error('acceptCall error', e);
      toast({ title: 'Error', description: 'Failed to accept call', variant: 'destructive' });
    }
  };

  // reject call (receiver) -> insert call-rejected
  const rejectCall = async () => {
    if (!incomingCall) return;
    try {
      stopRingtone();
      const { error } = await supabase.from('call_signals').insert({
        chat_room_id: chatRoomId,
        caller_id: incomingCall.caller_id,
        receiver_id: incomingCall.receiver_id,
        sender_id: currentUserId,
        type: 'call-rejected',
      });

      if (error) {
        throw error;
      }

      setIncomingCall(null);
    } catch (e) {
      console.error('rejectCall error', e);
      toast({ title: 'Error', description: 'Failed to reject call', variant: 'destructive' });
    }
  };

  // when VideoCall triggers close -> clear call UI
  const handleVideoCallClose = () => {
    setActiveCall(null);
    setIsOutgoingCalling(false);
  };

  return (
    <div className="flex flex-col h-[500px] relative">
      {/* incoming call modal */}
      {incomingCall && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded shadow w-[320px] text-center">
            <h3 className="font-bold text-lg">Incoming call</h3>
            <p className="text-sm mt-2">{otherUserName} is calling you</p>
            <div className="flex gap-3 mt-4">
              <Button className="flex-1" onClick={acceptCall}>Accept</Button>
              <Button className="flex-1" variant="destructive" onClick={rejectCall}>Reject</Button>
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
          <Input
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message..."
            disabled={loading}
            className="flex-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
          />
          <Button onClick={sendMessage} disabled={loading || !newMessage.trim()} size="icon">
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;
