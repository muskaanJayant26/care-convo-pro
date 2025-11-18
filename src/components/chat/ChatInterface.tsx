// ChatInterface.tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Video } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import VideoCall from "../video/VideoCall";

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

// Your Daily room (static)
const DAILY_ROOM_URL = "https://health-test.daily.co/test";

const ChatInterface: React.FC<ChatInterfaceProps> = ({
  chatRoomId,
  currentUserId,
  otherUserName,
  otherUserId,
  onBookGeneralPhysician,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const { toast } = useToast();

  const [showCall, setShowCall] = useState(false);

  const scrollAreaRef = useRef<HTMLDivElement | null>(null);

  // Fetch messages + realtime updates
  useEffect(() => {
    fetchMessages();

    const channel = supabase
      .channel(`chat-${chatRoomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `chat_room_id=eq.${chatRoomId}`,
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

  // scroll chat to bottom on update
  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
    }
  }, [messages]);

  const fetchMessages = useCallback(async () => {
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("chat_room_id", chatRoomId)
      .order("created_at", { ascending: true });

    if (!error) setMessages(data || []);
  }, [chatRoomId]);

  const sendMessage = async () => {
    if (!newMessage.trim()) return;

    const { error } = await supabase.from("messages").insert({
      chat_room_id: chatRoomId,
      sender_id: currentUserId,
      message: newMessage.trim(),
    });

    if (error) {
      console.error("Message error:", error);
      toast({
        title: "Error sending",
        description: "Failed to send message",
        variant: "destructive",
      });
    } else {
      setNewMessage("");
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-[500px] relative">
      {/* Video Call Modal */}
      {showCall && (
        <div className="absolute inset-0 z-40 bg-black/60 flex items-center justify-center">
          <div className="bg-white rounded-lg p-4 w-full max-w-4xl h-[90vh]">
            <VideoCall
              roomUrl={DAILY_ROOM_URL}
              onLeave={() => setShowCall(false)}
            />
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-gradient-to-r from-primary/10 to-secondary/10 p-4 border-b flex justify-between items-center">
        <h3 className="font-semibold text-foreground">Chat with {otherUserName}</h3>
        <Button size="sm" variant="secondary" onClick={() => setShowCall(true)}>
          <Video className="w-4 h-4 mr-2" />
          Start Video Call
        </Button>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4" ref={scrollAreaRef as any}>
        <div className="space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${
                msg.sender_id === currentUserId ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[70%] rounded-lg p-3 ${
                  msg.sender_id === currentUserId
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground"
                }`}
              >
                <p className="text-sm break-words">{msg.message}</p>
                <p className="text-xs opacity-70 mt-1">
                  {format(new Date(msg.created_at), "HH:mm")}
                </p>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Input */}
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
            className="flex-1"
          />
          <Button onClick={sendMessage} disabled={!newMessage.trim()} size="icon">
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;
