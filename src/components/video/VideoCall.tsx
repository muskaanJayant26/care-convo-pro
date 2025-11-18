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

const log = {
  info: (...m: any[]) => console.log("%c[RTC]", "color:#4ade80;font-weight:bold;", ...m),
  warn: (...m: any[]) => console.warn("%c[RTC]", "color:#facc15;font-weight:bold;", ...m),
  error: (...m: any[]) => console.error("%c[RTC]", "color:#ef4444;font-weight:bold;", ...m),
};

localStorage.debug = "simple-peer*";

interface VideoCallProps {
  chatRoomId: string;
  callerId: string;
  receiverId: string;
  currentUserId: string;
  onClose: () => void;
}

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 12;

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

  const pollIntervalRef = useRef<number | null>(null);
  const pollAttemptsRef = useRef(0);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [status, setStatus] = useState<"connecting" | "connected" | "idle" | "error">("idle");

  const [callDuration, setCallDuration] = useState(0);
  const timerRef = useRef<number | null>(null);

  const isCaller = currentUserId === callerId;
  const isReceiver = currentUserId === receiverId;

  // ------------------ CAMERA ---------------------
  const startLocalCamera = async () => {
    log.info("🎥 Requesting user media...");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      log.info("Local tracks:", stream.getTracks());
      setLocalStream(stream);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.play().catch((e) => log.error("Local video play error:", e));
      }

      log.info("🎥 Local camera ready");
      return stream;
    } catch (e) {
      log.error("❌ getUserMedia failed", e);
      setStatus("error");
      throw e;
    }
  };

  // ------------------ REMOTE VIDEO ATTACH ---------------------
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current
        .play()
        .then(() => log.info("🎥 Remote video playing"))
        .catch((e) => log.warn("Autoplay blocked, trying muted playback:", e));
    }
  }, [remoteStream]);

  // ------------------ TIMER ---------------------
  const startTimer = () => {
    if (timerRef.current) return;
    timerRef.current = window.setInterval(() => setCallDuration((c) => c + 1), 1000);
  };
  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };
  const formatTime = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, "0");
    const sec = (s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  };

  // ------------------ DB SIGNAL ---------------------
  const dbInsertSignal = async (signalObj: any) => {
    const insertRow = {
      chat_room_id: chatRoomId,
      caller_id: callerId,
      receiver_id: receiverId,
      type: "webrtc-signal",
      signal: signalObj,
      sender_id: currentUserId,
    };
    try {
      const { data, error } = await supabase.from("call_signals").insert([insertRow]).select();
      if (error) log.error("❌ supabase insert error:", error);
      return data?.[0] ?? null;
    } catch (e) {
      log.error("❌ Failed to insert signal", e);
      return null;
    }
  };

  // ------------------ PEER ---------------------
  const createPeer = (initiator: boolean, stream: MediaStream) => {
    if (peerRef.current) return peerRef.current;

    log.info("🛠 Creating peer", initiator ? "(CALLER)" : "(RECEIVER)");
    setStatus("connecting");

    const ICE_SERVERS = [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
      { urls: "turn:relay1.expressturn.com:3478", username: "efBnwpMNpiPqfMp1eG", credential: "lo1Q2M28tQerNmuT" },
    ];

    const p = new SimplePeer({ initiator, trickle: false, stream, config: { iceServers: ICE_SERVERS } });

    p.on("signal", async (data) => {
      log.info("📡 Sending signal", data?.type);
      await dbInsertSignal(data);
    });

    p.on("stream", (remote: MediaStream) => {
      log.info("🎥 Remote stream received", remote.getTracks());
      setRemoteStream(remote);
    });

    p.on("connect", () => {
      log.info("🔗 Peer connected");
      setStatus("connected");
      startTimer();
    });

    p.on("close", () => {
      log.warn("🔚 Peer connection closed");
      setStatus("idle");
      stopTimer();
    });

    p.on("error", (err) => {
      log.error("❌ Peer error", err);
      setStatus("error");
    });

    peerRef.current = p;
    return p;
  };

  // ------------------ SETUP ---------------------
  useEffect(() => {
    let signalChannel: any = null;

    const setup = async () => {
      log.info("🚀 Setting up WebRTC");
      const stream = await startLocalCamera();
      if (isCaller) createPeer(true, stream);

      try {
        signalChannel = supabase
          .channel(`rtc-${chatRoomId}-${currentUserId}`)
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "call_signals",
              filter: `chat_room_id=eq.${chatRoomId}&receiver_id=eq.${currentUserId}`,
            },
            async (payload: any) => {
              const row = payload.new;
              if (!row?.signal) return;

              const signalObj = row.signal;
              if (signalObj.type === "offer" && isReceiver) {
                if (!peerRef.current) createPeer(false, stream);
                peerRef.current?.signal(signalObj);
                return;
              }
              if (signalObj.type === "answer" && isCaller) {
                peerRef.current?.signal(signalObj);
                return;
              }
              peerRef.current?.signal(signalObj);
            }
          )
          .subscribe();
      } catch (e) {
        log.error("❌ subscription error:", e);
      }
    };

    setup().catch((e) => log.error("❌ Setup failed:", e));

    return () => {
      peerRef.current?.destroy();
      stopTimer();
      if (signalChannel) supabase.removeChannel(signalChannel);
      localVideoRef.current?.srcObject &&
        (localVideoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
    };
  }, []);

  // ------------------ UI CONTROLS ---------------------
  const toggleMute = () => {
    const s = localVideoRef.current?.srcObject as MediaStream | null;
    if (s) s.getAudioTracks().forEach((t) => (t.enabled = !t.enabled));
    setMuted((m) => !m);
  };
  const toggleCamera = () => {
    const s = localVideoRef.current?.srcObject as MediaStream | null;
    if (s) s.getVideoTracks().forEach((t) => (t.enabled = !t.enabled));
    setCameraOn((c) => !c);
  };
  const reconnect = () => window.location.reload();
  const endCall = () => {
    peerRef.current?.destroy();
    stopTimer();
    onClose();
  };

  return (
    <div className="w-full h-full grid grid-cols-12 gap-4 bg-black rounded">
      <div className="col-span-8 bg-black rounded overflow-hidden relative flex items-center justify-center">
        {remoteStream ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            muted // ensures autoplay works
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="text-white/70 text-center p-4">
            {status === "connecting" ? "Connecting…" : "Waiting for participant…"}
          </div>
        )}
        <div className="absolute top-4 left-4 text-white bg-white/10 px-2 py-1 rounded text-sm">
          {status === "connected" ? formatTime(callDuration) : "00:00"}
        </div>
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
            <Button onClick={reconnect} className="w-10 h-10 rounded-full">
              <RefreshCw />
            </Button>
          </div>
        </div>

        <div className="mt-auto flex justify-center">
          <Button onClick={endCall} variant="destructive" className="rounded-full px-4 py-2">
            <PhoneOff /> End Call
          </Button>
        </div>
      </div>
    </div>
  );
};

export default VideoCall;
