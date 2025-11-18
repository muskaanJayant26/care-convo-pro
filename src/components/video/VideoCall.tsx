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
   ICE Servers
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
   VideoCall Component
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
  const subRef = useRef<any>(null);

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
     Start Camera
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
     Insert signal to Supabase
  ----------------------------------------------------------- */
  const insertSignalRow = async (signal: any) => {
    try {
      const { data, error } = await supabase
        .from("call_signals")
        .insert([
          {
            chat_room_id: chatRoomId,
            caller_id: callerId,
            receiver_id: receiverId,
            sender_id: currentUserId,
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
     Create Peer
  ----------------------------------------------------------- */
  const createPeer = (initiator: boolean, local: MediaStream) => {
    if (peerRef.current) return peerRef.current;

    setStatus("connecting");

    const p = new SimplePeer({
      initiator,
      trickle: false,
      stream: local,
      config: { iceServers: ICE_SERVERS },
    });

    p.on("signal", async (s: any) => {
      console.log("signal -> send to DB", { initiator, sType: s?.type });
      await insertSignalRow(s);
    });

    p.on("stream", (stream: MediaStream) => {
      console.log("got remote stream");
      setRemoteStream(stream);

      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
        remoteVideoRef.current.play().catch(() => {});
      }
    });

    p.on("connect", () => {
      console.log("peer connect");
      setStatus("connected");
    });

    p.on("close", () => {
      console.log("peer closed");
      setStatus("idle");
    });

    p.on("error", (err) => {
      console.error("peer error", err);
      setStatus("error");
    });

    peerRef.current = p;
    return p;
  };

  /* -----------------------------------------------------------
     Apply incoming signal
  ----------------------------------------------------------- */
  const applySignal = (signal: any, local: MediaStream) => {
    try {
      if (!peerRef.current) {
        const isOffer = signal?.type === "offer";
        createPeer(!isOffer, local);
      }

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
     Setup WebRTC + Supabase
  ----------------------------------------------------------- */
  useEffect(() => {
    let mounted = true;

    const setup = async () => {
      try {
        const local = await startLocalCamera();

        // Caller initiates immediately
        if (isCaller) {
          createPeer(true, local);
        }

        // Subscribe to Supabase inserts
        const channel = supabase
          .from("call_signals")
          .on("INSERT", (payload) => {
            const row = payload.new;

            if (!row || row.chat_room_id !== chatRoomId) return;
            if (row.sender_id === currentUserId) return;

            const signal = row.signal;
            if (!signal) return;

            if (signal.type === "offer" && isReceiver)
              return applySignal(signal, local);

            if (signal.type === "answer" && isCaller)
              return applySignal(signal, local);

            applySignal(signal, local);
          })
          .subscribe();

        subRef.current = channel;
      } catch (e) {
        console.error("setup error", e);
      }
    };

    setup();

    return () => {
      mounted = false;

      try {
        peerRef.current?.destroy();
      } catch {}

      peerRef.current = null;

      try {
        supabase.removeChannel?.(subRef.current);
      } catch {}

      if (localStream) localStream.getTracks().forEach((t) => t.stop());
      if (remoteStream) remoteStream.getTracks().forEach((t) => t.stop());
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    } catch {}

    if (localStream) localStream.getTracks().forEach((t) => t.stop());
    if (remoteStream) remoteStream.getTracks().forEach((t) => t.stop());

    setLocalStream(null);
    setRemoteStream(null);

    onClose();
  };

  const reconnect = () => {
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
            className="rounded-full px-4 py-2"
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
