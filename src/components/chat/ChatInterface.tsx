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

console.log("[CHAT] Component Loaded");

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

  console.log("[CHAT] Mount Props", {
    chatRoomId,
    currentUserId,
    otherUserName,
    otherUserId
  });

  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);

  // call states
  const [incomingCall, setIncomingCall] = useState<any | null>(null);
  const [activeCall, setActiveCall] = useState< null | { caller_id: string; receiver_id: string; chat_room_id: string } >(null);
  const [isOutgoingCalling, setIsOutgoingCalling] = useState(false);

  const messagesChannelRef = useRef<any>(null);
  const callsChannelRef = useRef<any>(null);

  // ringtone
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);

  function tryPlayRingtone() {
    console.log("[CHAT] Trying to play ringtone");
    if (!ringtoneRef.current) {
      ringtoneRef.current = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA=');
      ringtoneRef.current.loop = true;
    }
    ringtoneRef.current.play().catch((err) => {
      console.warn("[CHAT] Ringtone auto-play blocked", err);
    });
  }

  function stopRingtone() {
    console.log("[CHAT] Stopping ringtone");
    try {
      ringtoneRef.current?.pause();
    } catch {}
    ringtoneRef.current = null;
  }

  // ----------------------------------
  // FETCH MESSAGES
  // ----------------------------------
  const fetchMessages = useCallback(async () => {
    console.log("[CHAT] Fetching messages...");

    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('chat_room_id', chatRoomId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error("[CHAT] fetchMessages ERROR", error);
      return;
    }

    console.log("[CHAT] Messages fetched:", data?.length);
    setMessages((data as Message[]) || []);
  }, [chatRoomId]);

  // ----------------------------------
  // SUBSCRIBE TO MESSAGES
  // ----------------------------------
  useEffect(() => {
    console.log("[CHAT] Subscribing to messages realtime...");

    fetchMessages();

    const msgChannel = supabase
      .channel(`chat-${chatRoomId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `chat_room_id=eq.${chatRoomId}`
        },
        (payload: any) => {
          console.log("[CHAT] New message realtime:", payload);
          setMessages((cur) => [...cur, payload.new as Message]);
        }
      )
      .subscribe((status) => {
        console.log("[CHAT] Messages channel status:", status);
      });

    messagesChannelRef.current = msgChannel;

    return () => {
      console.log("[CHAT] Cleaning messages channel");
      try {
        if (messagesChannelRef.current) supabase.removeChannel(messagesChannelRef.current);
      } catch (e) {
        console.error("[CHAT] removeChannel messages ERROR", e);
      }
    };
  }, [chatRoomId, fetchMessages]);

  // ----------------------------------
  // SUBSCRIBE TO CALL SIGNALS
  // ----------------------------------
  useEffect(() => {
    console.log("[CHAT] Subscribing to call_signals realtime...");

    const channel = supabase
      .channel(`calls-${chatRoomId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'call_signals',
          filter: `chat_room_id=eq.${chatRoomId}`
        },
        (payload: any) => {
          const row = payload.new as any;
          console.log("[CHAT] Call Signal Received:", row);

          if (!row) return;

          // 🌟 INCOMING CALL
          if (row.type === 'call-offer' && row.receiver_id === currentUserId) {
            console.log("[CHAT] Incoming Call!", row);
            setIncomingCall(row);
            tryPlayRingtone();
            return;
          }

          // 🌟 CALL ACCEPTED
          if (row.type === 'call-accepted') {
            if (row.caller_id === currentUserId || row.receiver_id === currentUserId) {
              console.log("[CHAT] Call Accepted - opening VideoCall UI", row);

              setActiveCall({
                caller_id: row.caller_id,
                receiver_id: row.receiver_id,
                chat_room_id: row.chat_room_id
              });

              setIncomingCall(null);
              setIsOutgoingCalling(false);
              stopRingtone();
            }
            return;
          }

          // 🌟 CALL REJECTED
          if (row.type === 'call-rejected' && row.caller_id === currentUserId) {
            console.log("[CHAT] Call Rejected by receiver");
            toast({
              title: "Call Rejected",
              description: `${otherUserName} rejected your call.`,
            });
            setIsOutgoingCalling(false);
            stopRingtone();
            return;
          }
        }
      )
      .subscribe((status) => {
        console.log("[CHAT] Call channel status:", status);
      });

    callsChannelRef.current = channel;

    return () => {
      console.log("[CHAT] Cleaning call channels...");
      try {
        if (callsChannelRef.current) supabase.removeChannel(callsChannelRef.current);
      } catch (e) {
        console.error("[CHAT] removeChannel calls ERROR", e);
      }
    };
  }, [chatRoomId, currentUserId, otherUserName, toast]);

  // ----------------------------------
  // AUTO SCROLL
  // ----------------------------------
  useEffect(() => {
    try {
      if (scrollAreaRef.current) {
        scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
      }
    } catch {}
  }, [messages]);

  // ----------------------------------
  // SEND MESSAGE
  // ----------------------------------
  const sendMessage = async () => {
    if (!newMessage.trim()) return;

    console.log("[CHAT] Sending message:", newMessage);

    setLoading(true);

    const { error } = await supabase.from('messages').insert({
      chat_room_id: chatRoomId,
      sender_id: currentUserId,
      message: newMessage.trim(),
    });

    if (error) {
      console.error("[CHAT] sendMessage ERROR", error);
      toast({ title: 'Error', description: 'Failed to send message', variant: 'destructive' });
    } else {
      console.log("[CHAT] Message sent!");
      setNewMessage('');
    }

    setLoading(false);
  };

  // ----------------------------------
  // START CALL
  // ----------------------------------
  const startCall = async () => {
    console.log("[CHAT] CALLER starting call", {
      caller: currentUserId,
      receiver: otherUserId
    });

    try {
      setIsOutgoingCalling(true);
      setActiveCall({
        caller_id: currentUserId,
        receiver_id: otherUserId,
        chat_room_id: chatRoomId
      });

      const { error } = await supabase.from('call_signals').insert({
        chat_room_id: chatRoomId,
        caller_id: currentUserId,
        receiver_id: otherUserId,
        sender_id: currentUserId,
        type: 'call-offer'
      });

      if (error) throw error;

      console.log("[CHAT] Call offer inserted!");
      toast({ title: 'Calling...', description: `Ringing ${otherUserName}...` });
    } catch (e) {
      console.error("[CHAT] startCall ERROR", e);
      toast({ title: "Error", description: "Failed to start call", variant: "destructive" });
      setIsOutgoingCalling(false);
      setActiveCall(null);
    }
  };

  // ----------------------------------
  // ACCEPT CALL
  // ----------------------------------
  const acceptCall = async () => {
    console.log("[CHAT] RECEIVER accepting call", incomingCall);

    if (!incomingCall) return;

    try {
      stopRingtone();

      const { error } = await supabase.from('call_signals').insert({
        chat_room_id: chatRoomId,
        caller_id: incomingCall.caller_id,
        receiver_id: incomingCall.receiver_id,
        sender_id: currentUserId,
        type: 'call-accepted'
      });

      if (error) throw error;

      console.log("[CHAT] Call accepted signal inserted!");

      setActiveCall({
        caller_id: incomingCall.caller_id,
        receiver_id: incomingCall.receiver_id,
        chat_room_id: chatRoomId
      });

      setIncomingCall(null);
    } catch (e) {
      console.error("[CHAT] acceptCall ERROR", e);
      toast({ title: "Error", description: "Failed to accept call", variant: "destructive" });
    }
  };

  // ----------------------------------
  // REJECT CALL
  // ----------------------------------
  const rejectCall = async () => {
    console.log("[CHAT] REJECTING call", incomingCall);

    if (!incomingCall) return;

    try {
      stopRingtone();

      const { error } = await supabase.from('call_signals').insert({
        chat_room_id: chatRoomId,
        caller_id: incomingCall.caller_id,
        receiver_id: incomingCall.receiver_id,
        sender_id: currentUserId,
        type: 'call-rejected'
      });

      if (error) throw error;

      console.log("[CHAT] Call rejected signal inserted!");

      setIncomingCall(null);
    } catch (e) {
      console.error("[CHAT] rejectCall ERROR", e);
      toast({ title: "Error", description: "Failed to reject call", variant: "destructive" });
    }
  };

  // ----------------------------------
  // CLOSE VIDEO CALL UI
  // ----------------------------------
  const handleVideoCallClose = () => {
    console.log("[CHAT] Closing video call UI");
    setActiveCall(null);
    setIsOutgoingCalling(false);
  };

  return (
    <div className="flex flex-col h-[500px] relative">

      {/* Incoming Call Popup */}
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

      {/* VideoCall Modal */}
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

      {/* Header */}
      <div className="bg-gradient-to-r from-primary/10 to-secondary/10 p-4 border-b flex justify-between items-center">
        <h3 className="font-semibold">Chat with {otherUserName}</h3>
        <div>
          <Button onClick={startCall} size="sm" variant="secondary">
            <Video className="w-4 h-4 mr-2" /> Start Video Call
          </Button>
        </div>
      </div>

      {/* Messages */}
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

      {/* Input */}
      <div className="p-4 border-t bg-card space-y-3">
        {onBookGeneralPhysician && (
          <Button onClick={onBookGeneralPhysician} variant="outline" className="w-full">
            Book General Physician Appointment
          </Button>
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
