// ChatInterface.tsx
// Replace your existing ChatInterface with this file.
// Requires: simple-peer, date-fns, lucide-react, supabase client, UI components referenced

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

  // Call states
  const [incomingCall, setIncomingCall] = useState<any>(null);
  const [activeCall, setActiveCall] = useState<null | { caller_id: string; receiver_id: string; chat_room_id: string }>(null);
  const [isOutgoingCalling, setIsOutgoingCalling] = useState(false);

  // call duration state & timer ref
  const [callDuration, setCallDuration] = useState(0);
  const callTimerRef = useRef<number | null>(null);

  // start/stop timer when an active call UI is visible (either outgoing or accepted)
  useEffect(() => {
    const visible = Boolean(activeCall) || isOutgoingCalling;
    if (visible) {
      if (callTimerRef.current == null) {
        callTimerRef.current = window.setInterval(() => {
          setCallDuration((t) => t + 1);
        }, 1000);
      }
    } else {
      if (callTimerRef.current != null) {
        clearInterval(callTimerRef.current);
        callTimerRef.current = null;
        setCallDuration(0);
      }
    }

    return () => {
      if (callTimerRef.current != null) {
        clearInterval(callTimerRef.current);
        callTimerRef.current = null;
      }
    };
  }, [activeCall, isOutgoingCalling]);

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // fetch messages on mount / chatRoomId change
  useEffect(() => {
    fetchMessages();

    const msgChannel = supabase
      .channel(`chat-${chatRoomId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `chat_room_id=eq.${chatRoomId}`,
        },
        (payload) => {
          setMessages((current) => [...current, payload.new as Message]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(msgChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatRoomId]);

  // call_signals listener
  useEffect(() => {
    const callChannel = supabase
      .channel(`call-${chatRoomId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'call_signals',
          filter: `chat_room_id=eq.${chatRoomId}`,
        },
        (payload) => {
          const data = payload.new as any;

          // incoming call offer for receiver
          if (data.type === 'call-offer' && data.receiver_id === currentUserId) {
            // show incoming call popup
            setIncomingCall(data);
            tryPlayRingtone();
          }

          // call accepted: notify caller & receiver to open VideoCall UI
          if (data.type === 'call-accepted') {
            if (data.caller_id === currentUserId || data.receiver_id === currentUserId) {
              setActiveCall({ caller_id: data.caller_id, receiver_id: data.receiver_id, chat_room_id: data.chat_room_id });
              setIncomingCall(null);
              setIsOutgoingCalling(false);
              stopRingtone();
            }
          }

          // call rejected: notify caller
          if (data.type === 'call-rejected' && data.caller_id === currentUserId) {
            toast({ title: 'Call Rejected', description: `${otherUserName} rejected the call.` });
            setIsOutgoingCalling(false);
            stopRingtone();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(callChannel);
    };
  }, [chatRoomId, currentUserId, otherUserName, toast]);

  // scroll to bottom when new messages added
  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
    }
  }, [messages]);

  // automated welcome message logic (kept from original)
  useEffect(() => {
    const sendAutomatedMessage = async () => {
      if (messages.length === 0) {
        const { data: profile } = await supabase.from('user_roles').select('role').eq('user_id', currentUserId).single();
        if (profile?.role === 'patient') {
          const automatedMessage = `Welcome! I'm here to help you. If you need immediate consultation with a general physician, please use the \"Book General Physician\" button below.`;
          await supabase.from('messages').insert({ chat_room_id: chatRoomId, sender_id: otherUserId, message: automatedMessage });
        }
      }
    };

    if (messages.length === 0) sendAutomatedMessage();
  }, [messages, chatRoomId, currentUserId, otherUserId]);

  const fetchMessages = useCallback(async () => {
    const { data, error } = await supabase.from('messages').select('*').eq('chat_room_id', chatRoomId).order('created_at', { ascending: true });
    if (error) {
      console.error('Error fetching messages:', error);
      return;
    }
    setMessages(data || []);
  }, [chatRoomId]);

  const sendMessage = async () => {
    if (!newMessage.trim()) return;
    setLoading(true);
    const { error } = await supabase.from('messages').insert({ chat_room_id: chatRoomId, sender_id: currentUserId, message: newMessage.trim() });
    if (error) {
      console.error('Error sending message:', error);
      toast({ title: 'Error', description: 'Failed to send message', variant: 'destructive' });
    } else {
      setNewMessage('');
    }
    setLoading(false);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ringtone helpers
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);
  function tryPlayRingtone() {
    if (!ringtoneRef.current) {
      // simple beep data URI (short). You can replace with hosted mp3.
      ringtoneRef.current = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA=');
      ringtoneRef.current.loop = true;
    }
    ringtoneRef.current.play().catch(() => {
      // autoplay might be blocked; ignore
    });
  }
  function stopRingtone() {
    ringtoneRef.current?.pause();
    ringtoneRef.current = null;
  }

  // startCall triggered by caller (shows VideoCall UI immediately)
  const startCall = async () => {
    try {
      // show caller UI immediately
      setActiveCall({ caller_id: currentUserId, receiver_id: otherUserId, chat_room_id: chatRoomId });
      setIsOutgoingCalling(true);
      setCallDuration(0);

      // insert call offer into call_signals; receiver will see this
      await supabase.from('call_signals').insert({ chat_room_id: chatRoomId, caller_id: currentUserId, receiver_id: otherUserId, type: 'call-offer' });

      toast({ title: 'Calling', description: `Ringing ${otherUserName}...` });
    } catch (err) {
      console.error('startCall error', err);
      toast({ title: 'Error', description: 'Failed to start call' });
      // rollback UI
      setActiveCall(null);
      setIsOutgoingCalling(false);
    }
  };

  const acceptCall = async () => {
    if (!incomingCall) return;
    try {
      stopRingtone();
      // insert accepted signal
      await supabase.from('call_signals').insert({ chat_room_id: chatRoomId, caller_id: incomingCall.caller_id, receiver_id: incomingCall.receiver_id, type: 'call-accepted' });
      // set activeCall for the local client (show VideoCall)
      setActiveCall({ caller_id: incomingCall.caller_id, receiver_id: incomingCall.receiver_id, chat_room_id: chatRoomId });
      setIncomingCall(null);
    } catch (err) {
      console.error('acceptCall error', err);
      toast({ title: 'Error', description: 'Failed to accept call' });
    }
  };

  const rejectCall = async () => {
    if (!incomingCall) return;
    try {
      stopRingtone();
      await supabase.from('call_signals').insert({ chat_room_id: chatRoomId, caller_id: incomingCall.caller_id, receiver_id: incomingCall.receiver_id, type: 'call-rejected' });
      setIncomingCall(null);
    } catch (err) {
      console.error('rejectCall error', err);
      toast({ title: 'Error', description: 'Failed to reject call' });
    }
  };

  // When VideoCall ends it'll call onClose to clear activeCall
  const handleVideoCallClose = () => {
    setActiveCall(null);
    setIsOutgoingCalling(false);
    setCallDuration(0);
  };

  return (
    <div className="flex flex-col h-[500px] relative">
      {/* Incoming call popup */}
      {incomingCall && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg text-center space-y-4 w-[320px]">
            <h3 className="font-bold">Incoming call</h3>
            <p className="text-sm">{otherUserName} is calling you</p>
            <div className="flex justify-center gap-3 mt-4">
              <Button onClick={acceptCall} className="w-[45%]">
                Accept
              </Button>
              <Button onClick={rejectCall} variant="destructive" className="w-[45%]">
                Reject
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* If an active call exists show the VideoCall component overlay */}
      {(activeCall || isOutgoingCalling) && (
        <div className="absolute inset-0 z-40 bg-black/60 flex items-center justify-center">
          <div className="bg-white rounded-lg p-4 w-full max-w-4xl h-[90vh]">
            <div className="text-center text-sm text-muted-foreground mb-2">
              {isOutgoingCalling && !activeCall ? "Calling..." : `Call Duration: ${formatDuration(callDuration)}`}
            </div>

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

      <div className="bg-gradient-to-r from-primary/10 to-secondary/10 p-4 border-b flex justify-between items-center">
        <h3 className="font-semibold text-foreground">Chat with {otherUserName}</h3>
        <div className="flex items-center gap-2">
          <Button onClick={startCall} size="sm" variant="secondary">
            <Video className="w-4 h-4 mr-2" />
            Start Video Call
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
          <Button onClick={onBookGeneralPhysician} variant="outline" className="w-full border-primary/20 hover:bg-primary/10">
            Book General Physician Appointment
          </Button>
        )}

        <div className="flex gap-2">
          <Input value={newMessage} onChange={(e) => setNewMessage(e.target.value)} onKeyPress={handleKeyPress} placeholder="Type a message..." disabled={loading} className="flex-1" />
          <Button onClick={sendMessage} disabled={loading || !newMessage.trim()} size="icon">
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;
