// VideoCall.tsx — FINAL FIXED VERSION WITH INSERT LOGS

import React, { useEffect, useRef, useState } from "react";
import SimplePeer from "simple-peer/simplepeer.min.js"; // ✅ Browser build
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { PhoneOff, Mic, MicOff, Video as VideoIcon, VideoOff, RefreshCw } from "lucide-react";

// Debug logger
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

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [status, setStatus] = useState<"connecting" | "connected" | "idle" | "error">("idle");

  const [callDuration, setCallDuration] = useState(0);
  const timerRef = useRef<number | null>(null);

  const getTargetId = () =>
    currentUserId === callerId ? receiverId : callerId;

  // ------------------ Local Camera ---------------------
  const startLocalCamera = async () => {
    log.info("🎥 Requesting user media...");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      setLocalStream(stream);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.onloadedmetadata = () => {
          localVideoRef.current?.play().catch(() => {});
        };
      }

      log.info("🎥 Local camera ready");
      return stream;
    } catch (e) {
      log.error("❌ getUserMedia failed", e);
      setStatus("error");
      throw e;
    }
  };

  // ------------------ Timer ---------------------
  const startTimer = () => {
    if (timerRef.current) return;
    timerRef.current = window.setInterval(
      () => setCallDuration((c) => c + 1),
      1000
    );
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

  // ------------------ Create Peer ---------------------
  const createPeer = (initiator: boolean, stream: MediaStream) => {
    if (peerRef.current) return peerRef.current;

    log.info("🛠 Creating peer (initiator = " + initiator + ")");
    setStatus("connecting");

    const p = new SimplePeer({
      initiator,
      trickle: false,
      stream,
    });

    // --- Send Signal ---
    p.on("signal", async (data: any) => {
      log.info("📡 OUTGOING SIGNAL:", data);

      // ✅ ADDED LOG HERE
      log.info("📨 INSERTING SIGNAL ROW →", {
        chat_room_id: chatRoomId,
        caller_id: currentUserId,
        receiver_id: getTargetId(),
        type: "webrtc-signal",
        signalType: data.type,
      });

      try {
        await supabase.from("call_signals").insert({
          chat_room_id: chatRoomId,
          caller_id: currentUserId,
          receiver_id: getTargetId(),
          type: "webrtc-signal",
          signal: data,
        });
      } catch (e) {
        log.error("❌ Failed to insert signal", e);
      }
    });

    // --- Remote Stream ---
    p.on("stream", (remote: MediaStream) => {
      log.info("🎥 Remote stream received");
      setRemoteStream(remote);

      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remote;
        remoteVideoRef.current.onloadedmetadata = () => {
          remoteVideoRef.current?.play().catch(() => {});
        };
      }
    });

    p.on("connect", () => {
      log.info("🔗 WebRTC Connected");
      setStatus("connected");
      startTimer();
    });

    p.on("close", () => {
      log.warn("🔚 Peer connection closed");
      setStatus("idle");
      stopTimer();
    });

    p.on("error", (err: any) => {
      log.error("❌ Peer error", err);
      setStatus("error");
    });

    peerRef.current = p;
    return p;
  };

  // ------------------ Setup WebRTC ---------------------
  useEffect(() => {
    let signalChannel: any = null;

    const setup = async () => {
      log.info("🚀 Setting up WebRTC");

      const stream = await startLocalCamera();

      if (currentUserId === callerId) {
        log.info("📞 Caller → create initiator peer");
        createPeer(true, stream);
      } else {
        log.info("📞 Receiver → waiting for offer...");
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
            if (!row || !row.signal) return;

            log.info("📩 INCOMING SIGNAL:", row.signal);

            const signal = row.signal;

            if (!peerRef.current && signal.type === "offer") {
              log.info("🛠 Receiver creating peer after receiving OFFER");
              createPeer(false, stream);
            }

            if (peerRef.current) {
              peerRef.current.signal(signal);
            }
          }
        )
        .subscribe();
    };

    setup().catch((e) => log.error("❌ Setup failed:", e));

    return () => {
      log.warn("🗑 Cleaning up WebRTC");
      peerRef.current?.destroy();
      stopTimer();
      if (signalChannel) supabase.removeChannel(signalChannel);

      (localVideoRef.current?.srcObject as MediaStream | null)
        ?.getTracks()
        .forEach((t) => t.stop());
    };
  }, []);

  // ------------------ UI Controls ---------------------
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

  const endCall = async () => {
    peerRef.current?.destroy();
    stopTimer();
    onClose();
  };

  // ------------------ UI ---------------------
  return (
    <div className="w-full h-full grid grid-cols-12 gap-4 bg-black rounded">
      <div className="col-span-8 bg-black rounded overflow-hidden relative flex items-center justify-center">
        {remoteStream ? (
          <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
        ) : (
          <div className="text-white/70 text-center p-4">
            {status === "connecting"
              ? "Connecting…"
              : "Waiting for participant…"}
          </div>
        )}

        <div className="absolute top-4 left-4 text-white bg-white/10 px-2 py-1 rounded text-sm">
          {status === "connected" ? formatTime(callDuration) : "00:00"}
        </div>
      </div>

      <div className="col-span-4 p-4 flex flex-col gap-4">
        <div className="bg-white/5 rounded p-3 flex-1 flex flex-col items-center">
          <div className="w-full h-48 bg-black rounded overflow-hidden">
            <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
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
