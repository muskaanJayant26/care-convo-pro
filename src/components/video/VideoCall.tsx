// VideoCall.tsx
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

/* -----------------------------------------------------------
  Helper Loggers
----------------------------------------------------------- */
const LOG = (msg: string, ...rest: any[]) =>
  console.log(`%c[VIDEO CALL] ${msg}`, "color:#4ade80;font-weight:bold", ...rest);

const SIGNAL_LOG = (msg: string, ...rest: any[]) =>
  console.log(`%c[SIGNAL] ${msg}`, "color:#60a5fa;font-weight:bold", ...rest);

const ERROR_LOG = (msg: string, ...rest: any[]) =>
  console.error(`%c[ERROR] ${msg}`, "color:#f87171;font-weight:bold", ...rest);

const DB_LOG = (msg: string, ...rest: any[]) =>
  console.log(`%c[DB] ${msg}`, "color:#facc15;font-weight:bold", ...rest);

/* -----------------------------------------------------------
  Props
----------------------------------------------------------- */
interface VideoCallProps {
  chatRoomId: string;
  callerId: string;
  receiverId: string;
  currentUserId: string;
  onClose: () => void;
}

/* -----------------------------------------------------------
  ICE SERVERS
----------------------------------------------------------- */
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  {
    urls: "turn:global.relay.metered.ca:80",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

/* -----------------------------------------------------------
 Insert Signal Row
----------------------------------------------------------- */
const insertSignalRow = async (
  chatRoomId: string,
  callerId: string,
  receiverId: string,
  senderId: string,
  signal: any
) => {
  DB_LOG("Inserting signal row:", { chatRoomId, senderId, signal });

  try {
    const { data, error } = await supabase
      .from("call_signals")
      .insert([
        {
          chat_room_id: chatRoomId,
          caller_id: callerId,
          receiver_id: receiverId,
          sender_id: senderId,
          type: "webrtc-signal",
          signal,
        },
      ])
      .select();

    if (error) {
      ERROR_LOG("insertSignalRow ERROR:", error);
      return null;
    }

    DB_LOG("insertSignalRow SUCCESS:", data?.[0]);
    return data?.[0] ?? null;
  } catch (e) {
    ERROR_LOG("insertSignalRow exception:", e);
    return null;
  }
};

/* -----------------------------------------------------------
 Extract Signal Utility
----------------------------------------------------------- */
const extractSignalFromRow = (row: any) => {
  DB_LOG("Extracting signal from row:", row);
  if (!row) return null;
  return row.signal ?? null;
};

/* -----------------------------------------------------------
 Component
----------------------------------------------------------- */
const VideoCall: React.FC<VideoCallProps> = ({
  chatRoomId,
  callerId,
  receiverId,
  currentUserId,
  onClose,
}) => {
  LOG("Component mounted", { chatRoomId, callerId, receiverId, currentUserId });

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const peerRef = useRef<SimplePeer.Instance | null>(null);
  const channelRef = useRef<any>(null);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [status, setStatus] = useState<
    "idle" | "starting" | "connecting" | "connected" | "error"
  >("idle");

  const isCaller = currentUserId === callerId;
  LOG("User role:", { isCaller });

  /* -----------------------------------------------------------
    Start Local Camera
  ----------------------------------------------------------- */
  const startLocalCamera = async () => {
    LOG("Requesting local camera + mic...");
    setStatus("starting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      LOG("Local media acquired:", stream);

      setLocalStream(stream);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.muted = true;
        localVideoRef.current.playsInline = true;
        localVideoRef.current.play().catch(() => {});
      }

      return stream;
    } catch (e) {
      ERROR_LOG("getUserMedia FAILED:", e);
      setStatus("error");
      throw e;
    }
  };

  /* -----------------------------------------------------------
    Create Peer
  ----------------------------------------------------------- */
  const createPeer = (initiator: boolean, local: MediaStream) => {
    LOG("Creating peer:", { initiator, local });

    if (peerRef.current) {
      LOG("Peer already exists → using existing peer");
      return peerRef.current;
    }

    setStatus("connecting");

    const peer = new SimplePeer({
      initiator,
      trickle: true,
      stream: local,
      config: { iceServers: ICE_SERVERS },
    });

    LOG("Peer instance created:", peer);

    peer.on("signal", async (s: any) => {
      SIGNAL_LOG("Generated SIGNAL (offer/answer/candidate):", s);
      await insertSignalRow(chatRoomId, callerId, receiverId, currentUserId, s);
    });

    peer.on("stream", (stream: MediaStream) => {
      LOG("Received REMOTE STREAM");
      setRemoteStream(stream);

      setTimeout(() => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream;
          remoteVideoRef.current.playsInline = true;
          remoteVideoRef.current.play().catch(() => {});
        }
      }, 50);
    });

    peer.on("connect", () => {
      LOG("PEER CONNECTED (WebRTC established)");
      setStatus("connected");
    });

    peer.on("close", () => {
      LOG("Peer closed");
      setStatus("idle");
      onClose();
    });

    peer.on("error", (err: any) => {
      ERROR_LOG("Peer ERROR:", err);
      setStatus("error");
    });

    peerRef.current = peer;
    return peer;
  };

  /* -----------------------------------------------------------
    Apply Incoming Signal
  ----------------------------------------------------------- */
  const applySignal = (signal: any) => {
    SIGNAL_LOG("Applying incoming signal:", signal);

    if (!signal) {
      ERROR_LOG("applySignal called with empty signal");
      return;
    }

    if (!peerRef.current) {
      LOG("Peer missing → re-creating peer before applying signal");

      if (!localStream) {
        ERROR_LOG("applySignal attempted before localStream ready");
        return;
      }

      createPeer(isCaller, localStream);
    }

    setTimeout(() => {
      try {
        peerRef.current?.signal(signal);
        SIGNAL_LOG("Signal applied successfully");
      } catch (e) {
        ERROR_LOG("Error applying signal to peer:", e);
      }
    }, 20);
  };

  /* -----------------------------------------------------------
    Setup (onMount)
  ----------------------------------------------------------- */
  useEffect(() => {
    LOG("Setting up component...");

    const init = async () => {
      try {
        const stream = await startLocalCamera();

        if (isCaller) {
          LOG("User is CALLER → creating peer as initiator");
          createPeer(true, stream);
        }

        LOG("Subscribing to Supabase Realtime...");

        const channel = supabase
          .channel(`webrtc-${chatRoomId}`)
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "call_signals",
              filter: `chat_room_id=eq.${chatRoomId}`,
            },
            (payload: any) => {
              DB_LOG("Realtime CALLBACK triggered:", payload);

              if (payload.new.sender_id === currentUserId) {
                DB_LOG("Ignoring own signal");
                return;
              }

              const signal = extractSignalFromRow(payload.new);
              applySignal(signal);
            }
          )
          .subscribe((status) => LOG("Supabase subscription status:", status));

        channelRef.current = channel;
      } catch (e) {
        ERROR_LOG("init failed:", e);
      }
    };

    init();

    return () => {
      LOG("Cleaning up component...");

      try {
        peerRef.current?.destroy();
      } catch (e) {
        ERROR_LOG("Error destroying peer:", e);
      }

      if (localStream) localStream.getTracks().forEach((t) => t.stop());
      if (remoteStream) remoteStream.getTracks().forEach((t) => t.stop());

      try {
        if (channelRef.current) {
          LOG("Removing Supabase channel...");
          supabase.removeChannel(channelRef.current);
        }
      } catch (e) {
        ERROR_LOG("removeChannel failed:", e);
      }
    };
  }, []);

  /* -----------------------------------------------------------
    Controls
  ----------------------------------------------------------- */
  const toggleMute = () => {
    LOG("Toggling Mute… before:", muted);
    if (!localStream) return;
    localStream.getAudioTracks().forEach((t) => (t.enabled = !t.enabled));
    setMuted((v) => !v);
  };

  const toggleCamera = () => {
    LOG("Toggling Camera… before:", cameraOn);
    if (!localStream) return;
    localStream.getVideoTracks().forEach((t) => (t.enabled = !t.enabled));
    setCameraOn((v) => !v);
  };

  const endCall = () => {
    LOG("Ending call manually…");

    try {
      peerRef.current?.destroy();
    } catch (e) {
      ERROR_LOG("Error destroying peer:", e);
    }

    if (localStream) localStream.getTracks().forEach((t) => t.stop());
    if (remoteStream) remoteStream.getTracks().forEach((t) => t.stop());

    setLocalStream(null);
    setRemoteStream(null);

    try {
      if (channelRef.current) {
        LOG("Removing channel on endCall()");
        supabase.removeChannel(channelRef.current);
      }
    } catch (e) {}

    onClose();
  };

  const reconnect = () => {
    LOG("FORCE RECONNECT triggered");
    window.location.reload();
  };

  /* -----------------------------------------------------------
    UI
  ----------------------------------------------------------- */
  return (
    <div className="w-full h-full grid grid-cols-12 gap-4 bg-black rounded">
      {/* Remote Video */}
      <div className="col-span-8 bg-black rounded overflow-hidden relative flex items-center justify-center">
        {remoteStream ? (
          <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
        ) : (
          <div className="text-white/70">{status === "connecting" ? "Connecting…" : "Waiting…"}</div>
        )}
      </div>

      {/* Sidebar */}
      <div className="col-span-4 p-4 flex flex-col gap-4">
        <div className="bg-white/5 rounded p-3 flex-1 flex flex-col items-center">
          <div className="w-full h-48 bg-black rounded overflow-hidden">
            <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
          </div>
          <div className="text-white mt-2 text-sm">You ({status})</div>
        </div>

        <div className="bg-white/5 rounded p-3">
          <div className="flex justify-center gap-4">
            <Button onClick={toggleMute} className="w-10 h-10 rounded-full">
              {muted ? <MicOff /> : <Mic />}
            </Button>
            <Button onClick={toggleCamera} className="w-10 h-10 rounded-full">
              {cameraOn ? <VideoIcon /> : <VideoOff />}
            </Button>
            <Button onClick={reconnect} className="w-10 h-10 rounded-full">
              <RefreshCw />
            </Button>
          </div>
        </div>

        <div className="mt-auto flex justify-center">
          <Button onClick={endCall} variant="destructive" className="rounded-full flex items-center gap-2 px-4 py-2">
            <PhoneOff /> End Call
          </Button>
        </div>
      </div>
    </div>
  );
};

export default VideoCall;
