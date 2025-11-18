// VideoCall.tsx
// Added complete WebRTC Debug Logging

import React, { useEffect, useRef, useState } from "react";
import SimplePeer from "simple-peer";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { PhoneOff, Mic, MicOff, Video as VideoIcon, VideoOff, RefreshCw } from "lucide-react";

// --- ✅ WebRTC Debug Logger ---
const log = {
  info: (...msg: any[]) => console.log("%c[RTC]", "color:#4ade80;font-weight:bold;", ...msg),
  warn: (...msg: any[]) => console.warn("%c[RTC]", "color:#facc15;font-weight:bold;", ...msg),
  error: (...msg: any[]) => console.error("%c[RTC]", "color:#ef4444;font-weight:bold;", ...msg),
};

// Optional SimplePeer internal logs
localStorage.debug = "simple-peer*";

interface VideoCallProps {
  chatRoomId: string;
  callerId: string;
  receiverId: string;
  currentUserId: string;
  onClose: () => void;
}

const VideoCall: React.FC<VideoCallProps> = ({ chatRoomId, callerId, receiverId, currentUserId, onClose }) => {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const peerRef = useRef<SimplePeer.Instance | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [status, setStatus] = useState<"connecting" | "connected" | "idle" | "error">("idle");
  const [callDuration, setCallDuration] = useState(0);
  const timerRef = useRef<number | null>(null);

  const getTargetUserId = () => (currentUserId === callerId ? receiverId : callerId);

  // --- Start Local Camera ---
  const startLocalCamera = async () => {
    log.info("🎥 Requesting user media...");
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      log.info("🎥 Local stream received:", s);

      setLocalStream(s);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = s;
        localVideoRef.current.onloadedmetadata = () => {
          localVideoRef.current?.play().catch(() => {});
        };
      }

      return s;
    } catch (err) {
      log.error("❌ getUserMedia failed:", err);
      setStatus("error");
      throw err;
    }
  };

  // --- Timer ---
  const startTimer = () => {
    log.info("⏱ Timer started");
    if (timerRef.current) return;
    timerRef.current = window.setInterval(() => setCallDuration((c) => c + 1), 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    log.info("⏹ Timer stopped");
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60).toString().padStart(2, "0");
    const s = (sec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  // --- Create SimplePeer ---
  const createPeer = (initiator: boolean, stream: MediaStream) => {
    if (peerRef.current) return peerRef.current;

    log.info(`🛠 Creating peer (initiator = ${initiator})`);
    setStatus("connecting");

    const p = new SimplePeer({
      initiator,
      trickle: false,
      stream,
    });

    // --- SimplePeer logs ---
    p.on("signal", async (data: any) => {
      if (data.type === "offer") log.info("📡 OFFER created:", data);
      if (data.type === "answer") log.info("📡 ANSWER created:", data);
      if (data.candidate) log.info("❄ ICE candidate created:", data);

      // Send to DB
      const targetUserId = getTargetUserId();
      log.info("📨 Sending signal →", targetUserId);

      try {
        await supabase.from("call_signals").insert({
          chat_room_id: chatRoomId,
          caller_id: callerId,
          receiver_id: targetUserId,
          type: "webrtc-signal",
          signal: data,
        });
      } catch (err) {
        log.error("❌ Failed to insert signal:", err);
      }
    });

    p.on("stream", (remote: MediaStream) => {
      log.info("🎥 Remote stream received:", remote);
      setRemoteStream(remote);

      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remote;
        remoteVideoRef.current.onloadedmetadata = () => {
          remoteVideoRef.current?.play().catch(() => {});
        };
      }
    });

    p.on("connect", () => {
      log.info("🔗 WebRTC Peer Connected!");
      setStatus("connected");
      startTimer();
    });

    p.on("close", () => {
      log.warn("🔚 Peer connection closed");
      setStatus("idle");
      stopTimer();
    });

    p.on("error", (err: any) => {
      log.error("❌ Peer error:", err);
      setStatus("error");
    });

    // --- Low-level ICE logs ---
    p._pc.oniceconnectionstatechange = () => {
      log.info("🌐 ICE State →", p._pc.iceConnectionState);
    };

    p._pc.onconnectionstatechange = () => {
      log.info("🔌 Connection State →", p._pc.connectionState);
    };

    peerRef.current = p;
    return p;
  };

  // --- Setup WebRTC Flow ---
  useEffect(() => {
    let signalChannel: any = null;

    const setup = async () => {
      log.info("🚀 Setting up WebRTC");

      const stream = await startLocalCamera();

      if (currentUserId === callerId) {
        log.info("📞 Caller → creating initiator peer");
        createPeer(true, stream);
      } else {
        log.info("📞 Receiver → waiting for caller's offer...");
      }

      signalChannel = supabase
        .channel(`rtc-${chatRoomId}-${currentUserId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "call_signals",
            filter: `chat_room_id=eq.${chatRoomId},receiver_id=eq.${currentUserId}`,

          },
          async (payload: any) => {
            const row = payload.new;
            if (!row || row.receiver_id !== currentUserId) return;

            log.info("📩 Received Signal:", row.signal);

           // Only create peer when the RECEIVER gets the OFFER
if (!peerRef.current && row.signal?.type === "offer") {
  log.info("🛠 Creating non-initiator peer (only on OFFER)");
  createPeer(false, stream);
}

// Apply signal only AFTER peer exists
if (peerRef.current) {
  peerRef.current.signal(row.signal);
}
          }
        )
        .subscribe();
    };

    setup().catch((e) => log.error("❌ Setup failed:", e));

    return () => {
      log.warn("🗑 Cleanup WebRTC");
      peerRef.current?.destroy();
      stopTimer();
      if (signalChannel) supabase.removeChannel(signalChannel);

      (localVideoRef.current?.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // --- UI Controls ---
  const toggleMute = () => {
    log.info("🎙 Toggle Mute");
    const s = localVideoRef.current?.srcObject as MediaStream | null;
    if (!s) return;
    s.getAudioTracks().forEach((t) => (t.enabled = !t.enabled));
    setMuted((m) => !m);
  };

  const toggleCamera = () => {
    log.info("📷 Toggle Camera");
    const s = localVideoRef.current?.srcObject as MediaStream | null;
    if (!s) return;
    s.getVideoTracks().forEach((t) => (t.enabled = !t.enabled));
    setCameraOn((c) => !c);
  };

  const reconnect = () => {
    log.warn("🔄 Reconnect pressed");
    window.location.reload();
  };

  const endCall = async () => {
    log.warn("📞 Ending call...");

    await supabase.from("call_signals").insert({
      chat_room_id: chatRoomId,
      caller_id: callerId,
      receiver_id: receiverId,
      type: "call-ended",
    });

    peerRef.current?.destroy();
    stopTimer();
    onClose();
  };

  // --- UI ---
  return (
    <div className="w-full h-full grid grid-cols-12 gap-4 bg-black rounded">
      <div className="col-span-8 bg-black rounded overflow-hidden relative flex items-center justify-center">
        {remoteStream ? (
          <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
        ) : (
          <div className="text-center text-white/70 p-6">
            <div className="text-lg font-semibold mb-2">
              {status === "connecting" ? "Connecting..." : status === "error" ? "Connection error" : "Waiting for participant..."}
            </div>
            <div className="text-sm">{status === "connected" ? "Call connected" : "Remote video will appear here"}</div>
          </div>
        )}

        <div className="absolute top-4 left-4 bg-white/10 text-white px-3 py-1 rounded-md text-sm">
          {status === "connected" ? formatDuration(callDuration) : "00:00"}
        </div>
      </div>

      <div className="col-span-4 p-4 flex flex-col gap-4">
        <div className="bg-white/5 rounded p-3 flex-1 flex flex-col items-center justify-center">
          <div className="w-full h-48 bg-black rounded overflow-hidden flex items-center justify-center">
            <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
          </div>
          <div className="mt-3 text-sm text-white/80">You</div>
          <div className="text-xs text-white/50">{currentUserId}</div>
        </div>

        <div className="bg-white/5 rounded p-3">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-sm text-white">Status</div>
              <div className="text-xs text-white/60">{status}</div>
            </div>
            <div className="text-sm font-medium text-white">{status === "connected" ? "Live" : "Not connected"}</div>
          </div>

          <div className="flex items-center justify-center gap-3 mt-3">
            <Button size="sm" onClick={toggleMute} className="flex items-center justify-center w-10 h-10 rounded-full">
              {muted ? <MicOff /> : <Mic />}
            </Button>
            <Button size="sm" onClick={toggleCamera} className="flex items-center justify-center w-10 h-10 rounded-full">
              {cameraOn ? <VideoIcon /> : <VideoOff />}
            </Button>
            <Button size="sm" onClick={reconnect} className="flex items-center justify-center w-10 h-10 rounded-full">
              <RefreshCw />
            </Button>
          </div>
        </div>

        <div className="mt-auto flex justify-center">
          <Button onClick={endCall} variant="destructive" className="px-4 py-2 rounded-full flex items-center gap-2">
            <PhoneOff /> End Call
          </Button>
        </div>
      </div>
    </div>
  );
};

export default VideoCall;
