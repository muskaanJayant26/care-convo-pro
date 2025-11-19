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
  ICE SERVERS (keep/extend these as needed)
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
  Insert a signal row into call_signals (uses `signal` JSONB)
----------------------------------------------------------- */
const insertSignalRow = async (
  chatRoomId: string,
  callerId: string,
  receiverId: string,
  senderId: string,
  signal: any
) => {
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
      console.error("insertSignalRow error:", error);
      return null;
    }
    return data?.[0] ?? null;
  } catch (e) {
    console.error("insertSignalRow exception:", e);
    return null;
  }
};

/* -----------------------------------------------------------
  Simple extractor (here we trust `signal` column exists)
  Add extra parsing if your app stores other shapes later.
----------------------------------------------------------- */
const extractSignalFromRow = (row: any) => {
  if (!row) return null;
  if (row.signal) return row.signal;
  return null;
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

  /* -----------------------------------------------------------
    Start local camera & mic
  ----------------------------------------------------------- */
  const startLocalCamera = async () => {
    try {
      setStatus("starting");
      const s = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      setLocalStream(s);
      // attach to local video element
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = s;
        localVideoRef.current.muted = true;
        localVideoRef.current.playsInline = true;
        localVideoRef.current.play().catch(() => {});
      }
      return s;
    } catch (e) {
      console.error("getUserMedia failed", e);
      setStatus("error");
      throw e;
    }
  };

  /* -----------------------------------------------------------
    Create SimplePeer instance
  ----------------------------------------------------------- */
  const createPeer = (initiator: boolean, local: MediaStream) => {
    if (peerRef.current) return peerRef.current;

    setStatus("connecting");

    const p = new SimplePeer({
      initiator,
      trickle: true,
      stream: local,
      config: { iceServers: ICE_SERVERS },
    });

    p.on("signal", async (s: any) => {
      // store raw offer/answer/candidate into DB
      try {
        await insertSignalRow(chatRoomId, callerId, receiverId, currentUserId, s);
      } catch (err) {
        console.error("failed to insert signal", err);
      }
    });

    p.on("stream", (stream: MediaStream) => {
      setRemoteStream(stream);
      // attach to remote element safely
      setTimeout(() => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream;
          remoteVideoRef.current.playsInline = true;
          remoteVideoRef.current.play().catch(() => {});
        }
      }, 50);
    });

    p.on("connect", () => {
      console.log("Peer connected");
      setStatus("connected");
    });

    p.on("close", () => {
      console.log("Peer closed");
      setStatus("idle");
      // trigger parent close so UI removes VideoCall overlay
      onClose();
    });

    p.on("error", (err: any) => {
      console.error("Peer error:", err);
      setStatus("error");
    });

    peerRef.current = p;
    return p;
  };

  /* -----------------------------------------------------------
    Apply incoming signal
  ----------------------------------------------------------- */
  const applySignal = (signal: any) => {
    if (!signal) return;
    try {
      if (!peerRef.current) {
        // create peer using our role:
        // caller should already have created peer when opening UI,
        // but if not, create with `initiator = isCaller`
        if (!localStream) {
          console.warn("applySignal called before localStream ready — queued by subscription until local stream ready");
          return;
        }
        createPeer(isCaller, localStream);
      }
      // small delay to avoid race with peer creation
      setTimeout(() => {
        try {
          peerRef.current?.signal(signal);
        } catch (e) {
          console.error("Error applying signal to peer:", e);
        }
      }, 20);
    } catch (e) {
      console.error("applySignal error:", e);
    }
  };

  /* -----------------------------------------------------------
    Setup on mount:
      - start local camera
      - if caller: create peer immediately (initiator)
      - subscribe to call_signals inserts for this chatRoom
  ----------------------------------------------------------- */
  useEffect(() => {
    let mounted = true;

    const setup = async () => {
      try {
        const local = await startLocalCamera();

        // caller should create peer right away (so they generate an offer)
        if (isCaller) {
          createPeer(true, local);
        }

        // subscribe to new rows in call_signals for this chat room
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
              const row = payload.new;
              if (!row) return;

              // ignore our own inserted rows
              if (row.sender_id === currentUserId) return;

              const signal = extractSignalFromRow(row);
              if (!signal) {
                console.warn("Incoming call_signals row had no usable signal:", row);
                return;
              }

              // apply incoming signal
              applySignal(signal);
            }
          )
          .subscribe();

        channelRef.current = channel;
      } catch (e) {
        console.error("setup error:", e);
      }
    };

    setup();

    return () => {
      mounted = false;

      try {
        peerRef.current?.destroy();
      } catch (e) {
        // ignore
      }
      peerRef.current = null;

      try {
        if (channelRef.current) supabase.removeChannel(channelRef.current);
      } catch (e) {
        console.warn("removeChannel failed", e);
      }

      if (localStream) localStream.getTracks().forEach((t) => t.stop());
      if (remoteStream) remoteStream.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatRoomId, callerId, receiverId, currentUserId]);

  /* -----------------------------------------------------------
    Controls
  ----------------------------------------------------------- */
  const toggleMute = () => {
    if (!localStream) return;
    localStream.getAudioTracks().forEach((t) => (t.enabled = !t.enabled));
    setMuted((m) => !m);
  };

  const toggleCamera = () => {
    if (!localStream) return;
    localStream.getVideoTracks().forEach((t) => (t.enabled = !t.enabled));
    setCameraOn((c) => !c);
  };

  const endCall = () => {
    try {
      peerRef.current?.destroy();
    } catch (e) {
      // ignore
    }
    peerRef.current = null;

    if (localStream) localStream.getTracks().forEach((t) => t.stop());
    if (remoteStream) remoteStream.getTracks().forEach((t) => t.stop());

    setLocalStream(null);
    setRemoteStream(null);

    try {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    } catch (e) {
      // ignore
    }

    onClose();
  };

  const reconnect = async () => {
    // quick reconnect: destroy and reload component state
    try {
      peerRef.current?.destroy();
    } catch {}
    peerRef.current = null;

    try {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    } catch {}

    if (localStream) localStream.getTracks().forEach((t) => t.stop());
    setLocalStream(null);
    setRemoteStream(null);

    // simple reload to get clean state — you can implement finer-grained reconnection later
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
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="text-white/70 text-center p-4">
            {status === "connecting"
              ? "Connecting…"
              : status === "starting"
              ? "Starting camera…"
              : "Waiting for participant…"}
          </div>
        )}
      </div>

      {/* Sidebar */}
      <div className="col-span-4 p-4 flex flex-col gap-4">
        {/* Local Video */}
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

        {/* Status + Controls */}
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

            <Button onClick={reconnect} className="w-10 h-10 rounded-full">
              <RefreshCw />
            </Button>
          </div>
        </div>

        {/* End Call */}
        <div className="mt-auto flex justify-center">
          <Button
            onClick={endCall}
            variant="destructive"
            className="rounded-full px-4 py-2 flex items-center gap-2"
          >
            <PhoneOff />
            End Call
          </Button>
        </div>
      </div>
    </div>
  );
};

export default VideoCall;
