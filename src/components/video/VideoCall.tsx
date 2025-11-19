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
  VideoCall Props
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
const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  {
    urls: "turn:openrelay.metered.ca:443",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

/* -----------------------------------------------------------
  Helper: insert signal row into Supabase
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
      console.error("supabase insert error", error);
      return null;
    }
    return data?.[0] ?? null;
  } catch (e) {
    console.error("insertSignalRow exception", e);
    return null;
  }
};

/* -----------------------------------------------------------
  VideoCall Component (rewritten & fixed)
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
    "idle" | "connecting" | "connected" | "error"
  >("idle");

  const isCaller = currentUserId === callerId;
  const isReceiver = currentUserId === receiverId;

  /* -----------------------------------------------------------
    Start local camera & mic
  ----------------------------------------------------------- */
  const startLocalCamera = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      setLocalStream(s);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = s;
        localVideoRef.current.muted = true;
        await localVideoRef.current.play().catch(() => {});
      }

      return s;
    } catch (e) {
      console.error("Failed to getUserMedia", e);
      setStatus("error");
      throw e;
    }
  };

  /* -----------------------------------------------------------
    Create SimplePeer instance
    - Only the caller should be initiator=true
    - Use trickle=true (allows ICE candidates to flow gradually)
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
      // s can be offer/answer or candidate
      try {
        await insertSignalRow(chatRoomId, callerId, receiverId, currentUserId, s);
      } catch (err) {
        console.error("failed to insert signal", err);
      }
    });

    p.on("stream", (stream: MediaStream) => {
      console.log("got remote stream");
      setRemoteStream(stream);
      // attach safely
      setTimeout(() => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream;
          remoteVideoRef.current.play().catch(() => {});
        }
      }, 50);
    });

    p.on("connect", () => {
      console.log("peer connect");
      setStatus("connected");
    });

    p.on("close", () => {
      console.log("peer closed");
      setStatus("idle");
    });

    p.on("error", (err: any) => {
      console.error("peer error", err);
      setStatus("error");
    });

    peerRef.current = p;
    return p;
  };

  /* -----------------------------------------------------------
    Apply incoming signal safely
    - Ensure a single peer instance exists
    - Caller = initiator, Receiver = non-initiator
  ----------------------------------------------------------- */
  const applySignal = (signal: any, local: MediaStream) => {
    try {
      if (!peerRef.current) {
        // Create peer using our role (caller true -> initiator true)
        createPeer(isCaller, local);
      }

      // small delay to avoid race conditions
      setTimeout(() => {
        try {
          peerRef.current?.signal(signal);
        } catch (e) {
          console.error("failed to apply signal", e);
        }
      }, 50);
    } catch (e) {
      console.error("applySignal err", e);
    }
  };

  /* -----------------------------------------------------------
    Setup camera, peer (caller), and Supabase listener
  ----------------------------------------------------------- */
  useEffect(() => {
    let mounted = true;

    const setup = async () => {
      try {
        const local = await startLocalCamera();

        // If caller, create peer immediately (initiator)
        if (isCaller) {
          createPeer(true, local);
        }

        // Create Supabase channel filtered to this chat_room_id only
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
            (payload) => {
              const row = payload.new;
              if (!row) return;

              // ignore our own signals
              if (row.sender_id === currentUserId) return;

              const signal = row.signal;
              if (!signal) return;

              // apply all signals (offers / answers / candidates)
              applySignal(signal, local);
            }
          )
          .subscribe();

        channelRef.current = channel;
      } catch (e) {
        console.error("setup error", e);
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
        console.warn("failed to remove channel", e);
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

    if (localStream) localStream.getTracks().forEach((t) => t.stop());
    if (remoteStream) remoteStream.getTracks().forEach((t) => t.stop());

    setLocalStream(null);
    setRemoteStream(null);

    try {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    } catch {}

    onClose();
  };

  const reconnect = async () => {
    // safer reconnect: destroy + re-init without full reload
    try {
      peerRef.current?.destroy();
    } catch {}
    peerRef.current = null;

    try {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    } catch {}
    channelRef.current = null;

    if (localStream) localStream.getTracks().forEach((t) => t.stop());
    setLocalStream(null);
    setRemoteStream(null);

    // re-setup
    setTimeout(() => {
      // call the same effect by toggling a small state would be ideal, but for simplicity reload
      window.location.reload();
    }, 200);
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
            {status === "connecting" ? "Connecting…" : "Waiting for participant…"}
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
          <Button onClick={endCall} variant="destructive" className="rounded-full px-4 py-2">
            <PhoneOff />
            End Call
          </Button>
        </div>
      </div>
    </div>
  );
};

export default VideoCall;
