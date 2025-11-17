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
  /**
   * If you already created a call row and broadcasted `incoming_call`,
   * pass that call id here so VideoCall won't create a duplicate DB row.
   */
  externalCallId?: string | null;
  /**
   * If true, this client is the initiator of the WebRTC offer.
   * If omitted, we use a deterministic ordering based on user ids.
   */
  isInitiator?: boolean;
}

export const VideoCall = ({
  chatRoomId,
  currentUserId,
  otherUserId,
  otherUserName,
  onCallEnd,
  externalCallId = null,
  isInitiator,
}: VideoCallProps) => {
  const { toast } = useToast();

  const peerRef = useRef<SimplePeer.Instance | null>(null);
  const channelRef = useRef<any>(null);
  const pendingSignals = useRef<any[]>([]);
  const sendQueue = useRef<any[]>([]); // queue signals to send until channel.ready

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [callId, setCallId] = useState<string | null>(externalCallId);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  // helper to send via channel or queue
  const safeSend = (payload: any) => {
    try {
      const ch = channelRef.current;
      if (ch && typeof ch.send === "function") {
        ch.send({
          type: "broadcast",
          ...payload,
        });
      } else {
        // queue to send later
        sendQueue.current.push(payload);
      }
    } catch (e) {
      console.warn("Failed to send via channel (queued):", e);
      sendQueue.current.push(payload);
    }
  };

  useEffect(() => {
    initializeCall();
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------
  //  INITIALIZE CALL
  // -------------------------------------------------------------
  const initializeCall = async () => {
    try {
      if (!window.isSecureContext)
        throw new Error("Video calls require HTTPS or localhost");

      // -----------------------------
      // Get local video/audio stream
      // -----------------------------
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      setStream(mediaStream);
      if (localVideoRef.current) localVideoRef.current.srcObject = mediaStream;

      // -----------------------------
      // Create DB record for call (only when externalCallId NOT provided)
      // -----------------------------
      let createdCallId = externalCallId;
      if (!externalCallId) {
        const { data: callData, error: callError } = await supabase
          .from("video_calls")
          .insert({
            chat_room_id: chatRoomId,
            started_by: currentUserId,
            status: "pending",
          })
          .select()
          .single();

        if (callError) {
          console.warn("Failed to create video_calls row:", callError);
          // not fatal for signaling, continue (but show toast)
          toast({
            title: "Call record error",
            description: "Failed to create call record (non-fatal).",
            variant: "destructive",
          });
        } else {
          createdCallId = callData?.id ?? null;
        }
      }
      setCallId(createdCallId ?? null);

      // -----------------------------
      // Create & subscribe to channel
      // -----------------------------
      const channel = supabase.channel(`video_call_${chatRoomId}`, {
        config: { broadcast: { ack: true } },
      });

      // register handlers BEFORE subscribe to avoid missing events
      channel.on(
        "broadcast",
        { event: "signal" },
        ({ payload }: { payload: any }) => {
          // ignore messages from ourselves
          if (!payload) return;
          if (payload.from === currentUserId) return;

          if (peerRef.current) {
            try {
              peerRef.current.signal(payload.signal);
            } catch (err) {
              console.warn("Error applying remote signal:", err);
            }
          } else {
            pendingSignals.current.push(payload.signal);
          }
        }
      );

      channel.on("broadcast", { event: "call_rejected" }, ({ payload }: any) => {
        // If a callId exists and it doesn't match, ignore
        if (payload) {
          if (payload.callId && callId && payload.callId !== callId) return;
          // if caller got rejected, notify and end
          if (payload.to === currentUserId || payload.from === currentUserId || !payload.to) {
            toast({
              title: "Call Rejected",
              description: "The other user declined the call.",
              variant: "destructive",
            });
            cleanup();
            onCallEnd();
          }
        }
      });

      channelRef.current = channel;

      // Now subscribe (no await)
      channel.subscribe((status: string) => {
        if (status !== "SUBSCRIBED") return;

        console.log("Realtime channel subscribed for video:", chatRoomId);

        // flush any queued outgoing messages (like incoming_call or signals)
        while (sendQueue.current.length > 0) {
          const payload = sendQueue.current.shift();
          try {
            channel.send({
              type: "broadcast",
              ...payload,
            });
          } catch (e) {
            console.warn("Failed flushing queued send:", e);
          }
        }

        // Create peer after subscription
        const isInit =
          typeof isInitiator === "boolean"
            ? isInitiator
            : currentUserId < otherUserId;

        const peer = new SimplePeer({
          initiator: isInit,
          trickle: true,
          stream: mediaStream,
        });

        peerRef.current = peer;

        // outgoing signals -> send via supabase channel (or queue)
        peer.on("signal", (signal) => {
          safeSend({
            event: "signal",
            payload: { signal, from: currentUserId },
          });
        });

        peer.on("stream", (remote) => {
          setRemoteStream(remote);
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remote;

          // mark DB as active if we have a callId
          if (createdCallId) {
            supabase.from("video_calls").update({ status: "active" }).eq("id", createdCallId);
          }
        });

        peer.on("error", (err) => {
          console.error("Peer error:", err);
        });

        // process pending signals that arrived while we were creating peer
        pendingSignals.current.forEach((sig) => {
          try {
            peer.signal(sig);
          } catch (e) {
            console.warn("Failed to process queued signal:", e);
          }
        });
        pendingSignals.current = [];
      });

      // NOTE: VideoCall does NOT broadcast incoming_call here.
      // The chat UI / caller should broadcast incoming_call prior to opening VideoCall.
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
    try {
      if (peerRef.current) {
        peerRef.current.removeAllListeners?.();
        try {
          peerRef.current.destroy();
        } catch (e) {
          // ignore
        }
        peerRef.current = null;
      }
    } catch (e) {
      // ignore
    }

    if (stream) {
      try {
        stream.getTracks().forEach((t) => t.stop());
      } catch (e) {
        // ignore
      }
      setStream(null);
    }

    if (channelRef.current) {
      try {
        supabase.removeChannel(channelRef.current);
      } catch (e) {
        // ignore
      }
      channelRef.current = null;
    }

    if (callId) {
      // Update DB status to ended (best-effort)
      supabase
        .from("video_calls")
        .update({
          status: "ended",
          ended_at: new Date().toISOString(),
        })
        .eq("id", callId)
        .then(() => {
          setCallId(null);
        })
        .catch(() => {
          setCallId(null);
        });
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
    // notify remote optionally (best-effort): we could broadcast call_ended if needed
    cleanup();
    onCallEnd();
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex items-center justify-center p-4">
      <Card className="w-full max-w-6xl p-6 space-y-4">
        <h2 className="text-2xl font-semibold">Video Call with {otherUserName}</h2>

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
                <p className="text-muted-foreground">Waiting for {otherUserName}...</p>
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
            <div className="absolute bottom-2 left-2 bg-background/80 px-2 py-1 rounded text-sm">You</div>
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

export default VideoCall;
