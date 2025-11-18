import React, { useEffect, useRef, useState } from "react";
import SimplePeer from "simple-peer/simplepeer.min.js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  PhoneOff,
  Mic,
  MicOff,
  Video as VideoIcon,
  VideoOff,
  RefreshCw,
} from "lucide-react";

localStorage.debug = "simple-peer*";

const log = {
  info: (...m: any[]) => console.log("%c[RTC]", "color:#4ade80;font-weight:bold;", ...m),
  warn: (...m: any[]) => console.warn("%c[RTC]", "color:#facc15;font-weight:bold;", ...m),
  error: (...m: any[]) => console.error("%c[RTC]", "color:#ef4444;font-weight:bold;", ...m),
};

interface VideoCallProps {
  chatRoomId: string;
  callerId: string;
  receiverId: string;
  currentUserId: string;
  onClose: () => void;
}

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  {
    urls: "turn:openrelay.metered.ca:443",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:relay1.expressturn.com:3478",
    username: "efBnwpMNpiPqfMp1eG",
    credential: "lo1Q2M28tQerNmuT",
  },
];

export default function VideoCall({
  chatRoomId,
  callerId,
  receiverId,
  currentUserId,
  onClose,
}: VideoCallProps) {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const peerRef = useRef<SimplePeer.Instance | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [status, setStatus] = useState("connecting");

  const isCaller = currentUserId === callerId;
  const isReceiver = currentUserId === receiverId;

  // -----------------------------------------------------
  // GET LOCAL MEDIA
  // -----------------------------------------------------
  const getLocalMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      localStreamRef.current = stream;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        await localVideoRef.current.play().catch(() => {});
      }

      log.info("Local media ready", stream);
      return stream;
    } catch (err) {
      log.error("Failed to get user media", err);
      throw err;
    }
  };

  // -----------------------------------------------------
  // CREATE PEER (always attaches tracks correctly)
  // -----------------------------------------------------
  const createPeer = (initiator: boolean, stream: MediaStream) => {
    log.info("Creating peer. Initiator:", initiator);

    const p = new SimplePeer({
      initiator,
      trickle: false,
      config: { iceServers: ICE_SERVERS },
    });

    // ⭐ CRITICAL FIX: ALWAYS add tracks manually
    stream.getTracks().forEach((track) => {
      p.addTrack(track, stream);
      log.info("Track added manually:", track.kind);
    });

    p.on("signal", async (signal) => {
      log.info("Sending signal:", signal.type);
      await supabase.from("call_signals").insert({
        chat_room_id: chatRoomId,
        caller_id: callerId,
        receiver_id: receiverId,
        type: "webrtc-signal",
        signal,
        sender_id: currentUserId,
      });
    });

    p.on("stream", (remote) => {
      log.info("Remote stream received");
      setRemoteStream(remote);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remote;
        remoteVideoRef.current.play().catch(() => {});
      }
    });

    p.on("connect", () => {
      log.info("WebRTC connected!");
      setStatus("connected");
    });

    p.on("error", (err) => {
      log.error("Peer error:", err);
      setStatus("error");
    });

    p.on("close", () => {
      log.warn("Peer closed");
      setStatus("disconnected");
    });

    peerRef.current = p;
    return p;
  };

  // -----------------------------------------------------
  // START LISTENING FOR SIGNALS
  // -----------------------------------------------------
  const subscribeToSignals = (stream: MediaStream) => {
    return supabase
      .channel(`rtc-${chatRoomId}-${currentUserId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "call_signals",
          filter: `chat_room_id=eq.${chatRoomId}&receiver_id=eq.${currentUserId}`,
        },
        async (payload) => {
          const signal = payload.new.signal;
          log.info("Incoming signal:", signal.type);

          if (!peerRef.current) {
            const initiator = signal.type === "offer" ? false : true;
            log.info("Creating peer because signal arrived");
            createPeer(initiator, stream);
          }

          peerRef.current?.signal(signal);
        }
      )
      .subscribe();
  };

  // -----------------------------------------------------
  // SETUP LOGIC
  // -----------------------------------------------------
  useEffect(() => {
    let channel: any;

    (async () => {
      const stream = await getLocalMedia();

      // Caller creates peer immediately
      if (isCaller) {
        log.info("I am the caller → creating peer now");
        createPeer(true, stream);
      }

      // Listen for signals
      channel = subscribeToSignals(stream);
    })();

    return () => {
      channel && supabase.removeChannel(channel);

      peerRef.current?.destroy();
      peerRef.current = null;

      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      log.info("Cleanup done");
    };
  }, []);

  // -----------------------------------------------------
  // UI CONTROLS
  // -----------------------------------------------------
  const toggleMute = () => {
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !t.enabled));
    setMuted((m) => !m);
  };

  const toggleCamera = () => {
    localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = !t.enabled));
    setCameraOn((c) => !c);
  };

  const endCall = () => {
    peerRef.current?.destroy();
    onClose();
  };

  // -----------------------------------------------------
  // UI
  // -----------------------------------------------------
  return (
    <div className="w-full h-full grid grid-cols-12 gap-4 bg-black rounded">
      <div className="col-span-8 bg-black rounded overflow-hidden relative flex items-center justify-center">
        {remoteStream ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="text-white/70 text-center p-4">
            {status === "connecting" ? "Connecting…" : "Waiting for participant…"}
          </div>
        )}
      </div>

      <div className="col-span-4 p-4 flex flex-col gap-4">
        <div className="bg-white/5 rounded p-3 flex-1 flex flex-col items-center">
          <div className="w-full h-48 bg-black rounded overflow-hidden">
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-cover"
            />
          </div>
          <div className="text-white mt-2 text-sm">You</div>
        </div>

        <div className="bg-white/5 rounded p-3">
          <div className="flex justify-between text-white mb-3">
            <div>Status</div>
            <div>{status}</div>
          </div>

          <div className="flex justify-center gap-3">
            <Button onClick={toggleMute} className="w-10 h-10 rounded-full">
              {muted ? <MicOff /> : <Mic />}
            </Button>
            <Button onClick={toggleCamera} className="w-10 h-10 rounded-full">
              {cameraOn ? <VideoIcon /> : <VideoOff />}
            </Button>
            <Button onClick={() => window.location.reload()} className="w-10 h-10 rounded-full">
              <RefreshCw />
            </Button>
          </div>
        </div>

        <div className="mt-auto flex justify-center">
          <Button
            onClick={endCall}
            variant="destructive"
            className="rounded-full px-4 py-2"
          >
            <PhoneOff /> End Call
          </Button>
        </div>
      </div>
    </div>
  );
}
