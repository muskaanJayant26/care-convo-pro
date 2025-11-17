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

  const peerRef = useRef<SimplePeer.Instance | null>(null);
  const channelRef = useRef<any>(null);
  const pendingSignals = useRef<any[]>([]);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [callId, setCallId] = useState<string | null>(null);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    initializeCall();
    return cleanup;
  }, []);

  // -------------------------------------------------------------
  //  INITIALIZE CALL
  // -------------------------------------------------------------
  const initializeCall = async () => {
    try {
      if (!window.isSecureContext)
        throw new Error("Video calls require HTTPS");

      // -----------------------------
      // Get local video/audio stream
      // -----------------------------
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      setStream(mediaStream);
      if (localVideoRef.current)
        localVideoRef.current.srcObject = mediaStream;

      // -----------------------------
      // Create or update DB record
      // -----------------------------
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

      // -----------------------------
      // Subscribe to Supabase channel
      // -----------------------------
      const channel = supabase.channel(`video_call_${chatRoomId}`, {
        config: { broadcast: { ack: true } },
      });

      channelRef.current = channel;

      channel.subscribe(async (status: string) => {
        if (status === "SUBSCRIBED") {
          console.log("Realtime channel subscribed.");

          /** -------------------------------
           *  Create peer ONLY after subscribe
           * --------------------------------
           */
          const isInitiator = currentUserId < otherUserId;

          const peer = new SimplePeer({
            initiator: isInitiator,
            trickle: true,
            stream: mediaStream,
          });

          peerRef.current = peer;

          // Send offers / answers / ICE
          peer.on("signal", (signal) => {
            channel.send({
              type: "broadcast",
              event: "signal",
              payload: {
                signal,
                from: currentUserId,
              },
            });
          });

          // On receiving remote stream
          peer.on("stream", (remote) => {
            setRemoteStream(remote);
            if (remoteVideoRef.current)
              remoteVideoRef.current.srcObject = remote;

            if (callId) {
              supabase
                .from("video_calls")
                .update({ status: "active" })
                .eq("id", callId);
            }
          });

          // Process queued signals
          pendingSignals.current.forEach((sig) => peer.signal(sig));
          pendingSignals.current = [];
        }
      });

      // -----------------------------
      // Incoming signaling handler
      // -----------------------------
      channel.on("broadcast", { event: "signal" }, ({ payload }) => {
        if (payload.from === currentUserId) return;

        if (peerRef.current) {
          peerRef.current.signal(payload.signal);
        } else {
          pendingSignals.current.push(payload.signal);
        }
      });
    } catch (err: any) {
      console.error("Error initializing call:", err);

      toast({
        title: "Video Call Error",
        description: err?.message || "Failed to access camera/microphone",
        variant: "destructive",
      });

      onCallEnd();
    }
  };

  // -------------------------------------------------------------
  //  CLEANUP
  // -------------------------------------------------------------
  const cleanup = () => {
    if (peerRef.current) peerRef.current.destroy();

    if (stream)
      stream.getTracks().forEach((t) => t.stop());

    if (channelRef.current)
      supabase.removeChannel(channelRef.current);

    if (callId) {
      supabase
        .from("video_calls")
        .update({
          status: "ended",
          ended_at: new Date().toISOString(),
        })
        .eq("id", callId);
    }
  };

  const toggleVideo = () => {
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;

    track.enabled = !track.enabled;
    setIsVideoEnabled(track.enabled);
  };

  const toggleAudio = () => {
    if (!stream) return;
    const track = stream.getAudioTracks()[0];
    if (!track) return;

    track.enabled = !track.enabled;
    setIsAudioEnabled(track.enabled);
  };

  const endCall = () => {
    cleanup();
    onCallEnd();
  };

  // -------------------------------------------------------------
  //  UI
  // -------------------------------------------------------------
  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex items-center justify-center p-4">
      <Card className="w-full max-w-6xl p-6 space-y-4">
        <h2 className="text-2xl font-semibold">
          Video Call with {otherUserName}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* REMOTE VIDEO */}
          <div className="relative bg-muted rounded-lg overflow-hidden aspect-video">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
            {!remoteStream && (
              <div className="absolute inset-0 flex items-center justify-center">
                <p className="text-muted-foreground">
                  Waiting for {otherUserName}...
                </p>
              </div>
            )}
          </div>

          {/* LOCAL VIDEO */}
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

        {/* CONTROLS */}
        <div className="flex justify-center gap-4 pt-4">
          <Button
            variant={isVideoEnabled ? "secondary" : "destructive"}
            size="lg"
            onClick={toggleVideo}
            className="rounded-full w-14 h-14"
          >
            {isVideoEnabled ? <Video /> : <VideoOff />}
          </Button>

          <Button
            variant={isAudioEnabled ? "secondary" : "destructive"}
            size="lg"
            onClick={toggleAudio}
            className="rounded-full w-14 h-14"
          >
            {isAudioEnabled ? <Mic /> : <MicOff />}
          </Button>

          <Button
            variant="destructive"
            size="lg"
            onClick={endCall}
            className="rounded-full w-14 h-14"
          >
            <PhoneOff />
          </Button>
        </div>
      </Card>
    </div>
  );
};
