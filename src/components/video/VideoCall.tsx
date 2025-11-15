import { useEffect, useRef, useState } from "react";
import SimplePeer from "simple-peer";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Video, VideoOff, Mic, MicOff, PhoneOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface VideoCallProps {
  chatRoomId: string;
  currentUserId: string;
  otherUserId: string;
  otherUserName: string;
  onCallEnd: () => void;
}

export const VideoCall = ({
  chatRoomId,
  currentUserId,
  otherUserId,
  otherUserName,
  onCallEnd,
}: VideoCallProps) => {
  const { toast } = useToast();
  const [peer, setPeer] = useState<SimplePeer.Instance | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [callId, setCallId] = useState<string | null>(null);
  
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const channelRef = useRef<any>(null);

  useEffect(() => {
    initializeCall();
    return () => {
      cleanup();
    };
  }, []);

  const initializeCall = async () => {
    try {
      // Get user media
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      setStream(mediaStream);
      
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = mediaStream;
      }

      // Create video call record
      const { data: callData, error: callError } = await supabase
        .from("video_calls")
        .insert({
          chat_room_id: chatRoomId,
          started_by: currentUserId,
          status: "pending",
        })
        .select()
        .single();

      if (callError) throw callError;
      setCallId(callData.id);

      // Set up realtime signaling channel
      const channel = supabase.channel(`video_call_${chatRoomId}`);
      channelRef.current = channel;

      channel
        .on("broadcast", { event: "signal" }, ({ payload }) => {
          if (payload.from !== currentUserId && peer) {
            peer.signal(payload.signal);
          }
        })
        .subscribe();

      // Initialize peer connection
      const isInitiator = currentUserId < otherUserId; // Deterministic initiator
      const peerInstance = new SimplePeer({
        initiator: isInitiator,
        stream: mediaStream,
        trickle: true,
      });

      peerInstance.on("signal", (signal) => {
        channel.send({
          type: "broadcast",
          event: "signal",
          payload: { signal, from: currentUserId },
        });
      });

      peerInstance.on("stream", (remoteStream) => {
        setRemoteStream(remoteStream);
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
        }
        
        // Update call status to active
        if (callId) {
          supabase
            .from("video_calls")
            .update({ status: "active" })
            .eq("id", callId)
            .then();
        }
      });

      peerInstance.on("error", (err) => {
        console.error("Peer error:", err);
        toast({
          title: "Connection Error",
          description: "Failed to establish video connection",
          variant: "destructive",
        });
      });

      setPeer(peerInstance);
    } catch (error) {
      console.error("Error initializing call:", error);
      toast({
        title: "Error",
        description: "Failed to access camera/microphone",
        variant: "destructive",
      });
      onCallEnd();
    }
  };

  const cleanup = () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    if (peer) {
      peer.destroy();
    }
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }
    if (callId) {
      supabase
        .from("video_calls")
        .update({ status: "ended", ended_at: new Date().toISOString() })
        .eq("id", callId)
        .then();
    }
  };

  const toggleVideo = () => {
    if (stream) {
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoEnabled(videoTrack.enabled);
      }
    }
  };

  const toggleAudio = () => {
    if (stream) {
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioEnabled(audioTrack.enabled);
      }
    }
  };

  const endCall = () => {
    cleanup();
    onCallEnd();
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex items-center justify-center p-4">
      <Card className="w-full max-w-6xl p-6 space-y-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-semibold">Video Call with {otherUserName}</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Remote Video */}
          <div className="relative bg-muted rounded-lg overflow-hidden aspect-video">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
            {!remoteStream && (
              <div className="absolute inset-0 flex items-center justify-center">
                <p className="text-muted-foreground">Waiting for {otherUserName} to join...</p>
              </div>
            )}
          </div>

          {/* Local Video */}
          <div className="relative bg-muted rounded-lg overflow-hidden aspect-video">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            {!isVideoEnabled && (
              <div className="absolute inset-0 flex items-center justify-center bg-muted">
                <VideoOff className="w-12 h-12 text-muted-foreground" />
              </div>
            )}
            <div className="absolute bottom-2 left-2 bg-background/80 px-2 py-1 rounded text-sm">
              You
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="flex justify-center gap-4 pt-4">
          <Button
            variant={isVideoEnabled ? "secondary" : "destructive"}
            size="lg"
            onClick={toggleVideo}
            className="rounded-full w-14 h-14"
          >
            {isVideoEnabled ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
          </Button>
          
          <Button
            variant={isAudioEnabled ? "secondary" : "destructive"}
            size="lg"
            onClick={toggleAudio}
            className="rounded-full w-14 h-14"
          >
            {isAudioEnabled ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
          </Button>
          
          <Button
            variant="destructive"
            size="lg"
            onClick={endCall}
            className="rounded-full w-14 h-14"
          >
            <PhoneOff className="w-6 h-6" />
          </Button>
        </div>
      </Card>
    </div>
  );
};
