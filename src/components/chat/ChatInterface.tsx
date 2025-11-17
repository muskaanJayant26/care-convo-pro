import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Send, Video } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';


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
  onStartVideoCall?: () => void;
}

const ChatInterface = ({ chatRoomId, currentUserId, otherUserName, otherUserId, onBookGeneralPhysician, onStartVideoCall }: ChatInterfaceProps) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchMessages();

    // Set up real-time subscription
    const channel = supabase
      .channel(`chat-${chatRoomId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `chat_room_id=eq.${chatRoomId}`
        },
        (payload) => {
          setMessages((current) => [...current, payload.new as Message]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [chatRoomId]);

  useEffect(() => {
    // Send automated welcome message for patients
    const sendAutomatedMessage = async () => {
      if (messages.length === 0) {
        // Check if this is a patient viewing the chat
        const { data: profile } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', currentUserId)
          .single();

        if (profile?.role === 'patient') {
          const automatedMessage = `Welcome! I'm here to help you. If you need immediate consultation with a general physician, please use the "Book General Physician" button below.`;
          
          // Insert automated message from the doctor
          await supabase
            .from('messages')
            .insert({
              chat_room_id: chatRoomId,
              sender_id: otherUserId,
              message: automatedMessage
            });
        }
      }
    };

    if (messages.length === 0) {
      sendAutomatedMessage();
    }
  }, [messages, chatRoomId, currentUserId, otherUserId]);

  useEffect(() => {
    // Scroll to bottom when new messages arrive
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
    }
  }, [messages]);

  const fetchMessages = async () => {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('chat_room_id', chatRoomId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching messages:', error);
      return;
    }

    setMessages(data || []);
  };

  const sendMessage = async () => {
    if (!newMessage.trim()) return;

    setLoading(true);
    const { error } = await supabase
      .from('messages')
      .insert({
        chat_room_id: chatRoomId,
        sender_id: currentUserId,
        message: newMessage.trim()
      });

    if (error) {
      console.error('Error sending message:', error);
      toast({
        title: 'Error',
        description: 'Failed to send message',
        variant: 'destructive'
      });
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

  return (
    <div className="flex flex-col h-[500px]">
      <div className="bg-gradient-to-r from-primary/10 to-secondary/10 p-4 border-b flex justify-between items-center">
        <h3 className="font-semibold text-foreground">Chat with {otherUserName}</h3>
        {onStartVideoCall && (
          <Button onClick={onStartVideoCall} size="sm" variant="secondary">
            <Video className="w-4 h-4 mr-2" />
            Start Video Call
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1 p-4" ref={scrollAreaRef}>
        <div className="space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.sender_id === currentUserId ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[70%] rounded-lg p-3 ${
                  msg.sender_id === currentUserId
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-foreground'
                }`}
              >
                <p className="text-sm break-words">{msg.message}</p>
                <p className="text-xs opacity-70 mt-1">
                  {format(new Date(msg.created_at), 'HH:mm')}
                </p>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      <div className="p-4 border-t bg-card space-y-3">
        {onBookGeneralPhysician && (
          <Button 
            onClick={onBookGeneralPhysician}
            variant="outline"
            className="w-full border-primary/20 hover:bg-primary/10"
          >
            Book General Physician Appointment
          </Button>
        )}
        <div className="flex gap-2">
          <Input
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Type a message..."
            disabled={loading}
            className="flex-1"
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
