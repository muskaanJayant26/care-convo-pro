// VideoCall.tsx
// Fixed WebRTC signaling and reliable offer/answer flow (works with your call_signals table)

import React, { useEffect, useRef, useState } from "react";
import SimplePeer from "simple-peer";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { PhoneOff, Mic, MicOff, Video as VideoIcon, VideoOff, RefreshCw } from "lucide-react";

interface VideoCallProps {
  chatRoomId: string;
  callerId: string;       // original caller (the user who clicked Start Call)
  receiverId: string;     // original receiver (the user being called)
  currentUserId: string;  // logged-in user viewing this component
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

  // helper: determine the target of any outgoing signal (the other participant)
  const getTargetUserId = () => (currentUserId === callerId ? receiverId : callerId);

  // start local camera immediately
  const startLocalCamera = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(s);
      if (localVideoRef.current) localVideoRef.current.srcObject = s;
      return s;
    } catch (err) {
      console.error("getUserMedia error", err);
      setStatus("error");
      throw err;
    }
  };

  const startTimer = () => {
    if (timerRef.current) return;
    timerRef.current = window.setInterval(() => setCallDuration((c) => c + 1), 1000);
  };
  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60).toString().padStart(2, "0");
    const s = (sec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  // create and wire a SimplePeer instance (initiator decides role)
  const createPeer = (initiator: boolean, stream: MediaStream) => {
    // prevent double creation
    if (peerRef.current) return peerRef.current;

    setStatus("connecting");
    const p = new SimplePeer({ initiator, trickle: false, stream });
    peerRef.current = p;

    p.on("signal", async (data: any) => {
      try {
        // send signal row targeting the other user (populate caller_id & receiver_id as required by schema)
        const targetUserId = getTargetUserId();
        await supabase.from("call_signals").insert({
          chat_room_id: chatRoomId,
          caller_id: callerId,
          receiver_id: targetUserId,
          type: "webrtc-signal",
          signal: data,
        });
      } catch (err) {
        console.error("sendSignal error", err);
      }
    });

    p.on("stream", (remote: MediaStream) => {
      setRemoteStream(remote);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remote;
        // ensure autoplay on some browsers
        remoteVideoRef.current.onloadedmetadata = () => {
          remoteVideoRef.current?.play().catch(() => {});
        };
      }
    });

    p.on("connect", () => {
      setStatus("connected");
      startTimer();
    });

    p.on("close", () => {
      setStatus("idle");
      stopTimer();
    });

    p.on("error", (err: any) => {
      console.error("peer error", err);
      setStatus("error");
    });

    return p;
  };

  useEffect(() => {
    let mounted = true;
    let signalChannel: any = null;

    const setup = async () => {
      // 1) start local camera for both caller & receiver
      const stream = await startLocalCamera();

      // 2) If I'm the caller, create initiator peer immediately
      if (currentUserId === callerId) {
        createPeer(true, stream);
      } else {
        // if receiver: do NOT create peer yet — wait for an offer signal from caller
        // (we still started local camera so we can answer immediately)
      }

      // 3) Subscribe to all signals for this chat_room_id — filter client-side by receiver_id
      signalChannel = supabase
        .channel(`rtc-${chatRoomId}-${currentUserId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "call_signals",
            filter: `chat_room_id=eq.${chatRoomId}`
          },
          async (payload: any) => {
            try {
              const row = payload.new;
              // only process signals intended for *me*
              if (!row || row.receiver_id !== currentUserId) return;
              if (row.type !== "webrtc-signal") return;

              // Avoid processing signals that we ourselves inserted (optional safety)
              // We don't have 'sender_id' in schema, but we have caller_id; if caller_id === currentUserId and currentUserId === callerId
              // then it may be our own signal — skip if so
              // However the robust check is: don't process if row.signal is undefined
              if (!row.signal) return;

              // If we don't have a peer yet (receiver), create non-initiator peer and immediately apply the incoming offer
              if (!peerRef.current) {
                // create peer as non-initiator using our local stream
                createPeer(false, stream);
                // small delay isn't necessary; signal immediately
                peerRef.current?.signal(row.signal);
              } else {
                // peer already exists (caller or receiver after creation) — just feed the signal
                peerRef.current?.signal(row.signal);
              }
            } catch (err) {
              console.warn("signal handler error", err);
            }
          }
        )
        .subscribe();
    };

    // run setup
    setup().catch((e) => {
      console.error("setup error", e);
      setStatus("error");
    });

    return () => {
      mounted = false;
      // cleanup
      try { peerRef.current?.destroy(); } catch {}
      stopTimer();
      if (signalChannel) supabase.removeChannel(signalChannel);
      // stop local tracks
      try {
        (localVideoRef.current?.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // controls
  const toggleMute = () => {
    const s = localVideoRef.current?.srcObject as MediaStream | null;
    if (!s) return;
    s.getAudioTracks().forEach((t) => (t.enabled = !t.enabled));
    setMuted((m) => !m);
  };

  const toggleCamera = () => {
    const s = localVideoRef.current?.srcObject as MediaStream | null;
    if (!s) return;
    s.getVideoTracks().forEach((t) => (t.enabled = !t.enabled));
    setCameraOn((c) => !c);
  };

  const reconnect = async () => {
    try { peerRef.current?.destroy(); } catch {}
    peerRef.current = null;
    setStatus("connecting");
    setCallDuration(0);
    stopTimer();
    // reload to re-run flow — simpler and reliable
    window.location.reload();
  };

  const endCall = async () => {
    try {
      await supabase.from("call_signals").insert({
        chat_room_id: chatRoomId,
        caller_id: callerId,
        receiver_id: receiverId,
        type: "call-ended",
      });
    } catch (err) {
      console.warn(err);
    }

    try { peerRef.current?.destroy(); } catch {}
    stopTimer();
    onClose();
  };

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
