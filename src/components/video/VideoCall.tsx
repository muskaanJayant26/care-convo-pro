// VideoCall.tsx — Receiver debugging + polling fallback
import React, { useEffect, useRef, useState } from "react";
import SimplePeer from "simple-peer/simplepeer.min.js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { PhoneOff, Mic, MicOff, Video as VideoIcon, VideoOff, RefreshCw } from "lucide-react";

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

const POLL_INTERVAL_MS = 2000; // poll every 2s
const POLL_MAX_ATTEMPTS = 10; // give up after ~20s

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

  const getTargetId = () =>
    currentUserId === callerId ? receiverId : callerId;

  // ------------------ CAMERA ---------------------
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
        localVideoRef.current.onloadedmetadata = () =>
          localVideoRef.current?.play().catch(() => {});
      }

      log.info("🎥 Local camera ready");
      return stream;
    } catch (e) {
      log.error("❌ getUserMedia failed", e);
      setStatus("error");
      throw e;
    }
  };

  // ------------------ TIMER ---------------------
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

  // ------------------ PEER ---------------------
  const createPeer = (initiator: boolean, stream: MediaStream) => {
    if (peerRef.current) {
      log.warn("⚠️ Peer already exists, reusing existing instance.");
      return peerRef.current;
    }

    log.info("🛠 Creating peer", { initiator }, initiator ? "(CALLER)" : "(RECEIVER)");
    setStatus("connecting");

    const p = new SimplePeer({
      initiator,
      trickle: false,
      stream,
    });

    // ICE STATE DEBUGGING: note some builds emit different events; best-effort
    try {
      // 'iceStateChange' isn't always emitted by simple-peer; also watch 'signal' and 'connect'
      (p as any).on?.("iceStateChange", (state: any) => log.info("❄ ICE State:", state));
    } catch (e) { /* noop */ }

    p.on("signal", async (data: any) => {
      log.info(initiator ? "📡 CALLER SENDING OFFER/ANSWER" : "📡 RECEIVER SENDING ANSWER", data);
      // Insert signal row
      try {
        const { data: insertData, error } = await supabase
          .from("call_signals")
          .insert({
            chat_room_id: chatRoomId,
            caller_id: currentUserId,
            receiver_id: getTargetId(),
            type: "webrtc-signal",
            signal: data,
          });

        if (error) {
          log.error("❌ supabase insert error:", error);
        } else {
          log.info("📨 Signal inserted successfully (insert result):", insertData);
        }
      } catch (e) {
        log.error("❌ Failed to insert signal", e);
      }
    });

    p.on("stream", (remote: MediaStream) => {
      log.info("🎥 Remote stream received from peer");
      setRemoteStream(remote);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remote;
        remoteVideoRef.current.onloadedmetadata = () =>
          remoteVideoRef.current?.play().catch(() => {});
      }
    });

    p.on("connect", () => {
      log.info("🔗 WebRTC fully connected — streams active");
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

  // ------------------ POLLING FALLBACK ---------------------
  const startPollForOffers = (stream: MediaStream) => {
    // Don't start multiple pollers
    if (pollIntervalRef.current) return;
    pollAttemptsRef.current = 0;

    log.info("🔁 Starting polling fallback for offers (will try up to", POLL_MAX_ATTEMPTS, "times)");

    pollIntervalRef.current = window.setInterval(async () => {
      pollAttemptsRef.current++;
      log.info("🔎 Poll attempt", pollAttemptsRef.current);

      try {
        const { data: rows, error } = await supabase
          .from("call_signals")
          .select("*")
          .eq("chat_room_id", chatRoomId)
          .eq("receiver_id", currentUserId)
          .order("created_at", { ascending: false })
          .limit(5);

        if (error) {
          log.error("❌ Poll supabase error:", error);
        } else {
          log.info("🔎 Poll results count:", rows?.length ?? 0);
        }

        if (rows && rows.length) {
          // inspect rows to find the latest offer-type signal
          for (const r of rows) {
            log.info("🔎 Inspect row:", r.id, r.created_at, r.type, "signal:", r.signal);
            if (r.signal && r.signal.type === "offer") {
              log.info("📩 Found OFFER in DB (poll). Applying it now.");

              // create peer if not existing
              if (!peerRef.current) {
                log.info("🛠 Receiver creating peer from poll-detected offer");
                createPeer(false, stream);
              }

              try {
                peerRef.current?.signal(r.signal);
                log.info("📡 Applied polled offer to peer");
              } catch (e) {
                log.error("❌ Failed applying polled offer to peer", e);
              }

              // Stop polling after we found and applied an offer
              stopPollForOffers();
              return;
            }
          }
        }
      } catch (e) {
        log.error("❌ Exception while polling for offers:", e);
      }

      if (pollAttemptsRef.current >= POLL_MAX_ATTEMPTS) {
        log.warn("⚠️ Poll attempts exhausted. Stopping poller.");
        stopPollForOffers();
      }
    }, POLL_INTERVAL_MS);
  };

  const stopPollForOffers = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
      log.info("🔁 Polling fallback stopped.");
    }
  };

  // ------------------ SETUP ---------------------
  useEffect(() => {
    let signalChannel: any = null;

    const setup = async () => {
      log.info("🚀 Setting up WebRTC");

      log.info("📌 ROLE CHECK:", {
        currentUserId,
        callerId,
        receiverId,
        isCaller: currentUserId === callerId,
        isReceiver: currentUserId === receiverId,
      });

      const stream = await startLocalCamera();

      if (currentUserId === callerId) {
        // Caller flow: create initiator peer immediately
        log.info("📞 Caller → creating OFFER (initiator)");
        createPeer(true, stream);
      } else {
        log.info("📞 Receiver → waiting for offer (realtime). If none arrives, polling will start.");
      }

      // Realtime subscription (fixed filter using & for AND)
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
              log.info("📬 RECEIVED SIGNAL ROW (realtime):", row);

              if (!row || !row.signal) {
                log.warn("⚠️ No signal found in realtime row. Skipping.");
                return;
              }

              const signal = row.signal;

              log.info("📩 INCOMING SIGNAL (realtime):", signal);

              // if this is an offer and we are the receiver, create peer (if not exists)
              if (!peerRef.current && signal.type === "offer") {
                log.info("🛠 Receiver creating peer AFTER realtime OFFER received");
                createPeer(false, stream);
              }

              if (!peerRef.current) {
                log.error("❌ peerRef missing after realtime event. Starting poll as fallback.");
                // start the poller in case realtime was unreliable
                startPollForOffers(stream);
                return;
              }

              try {
                peerRef.current.signal(signal);
                log.info("📡 Signal applied to peer successfully (realtime)");
                // Once we get a realtime signal, no need to poll
                stopPollForOffers();
              } catch (e) {
                log.error("❌ Failed applying realtime signal to peer", e);
              }
            }
          )
          .subscribe((status: any) => {
            // subscribe returns status sometimes; log it
            log.info("📶 Realtime subscription status callback", status);
          });

        // If receiver, start a short poll after a small delay to catch missed offers
        if (currentUserId === receiverId) {
          // start poll after 2 seconds if no offer via realtime
          window.setTimeout(() => {
            if (!peerRef.current) startPollForOffers(stream);
          }, 2000);
        }
      } catch (e) {
        log.error("❌ Error creating realtime subscription:", e);
        // if realtime setup fails entirely, fallback to polling immediately
        if (currentUserId === receiverId) {
          startPollForOffers(stream);
        }
      }
    };

    setup().catch((e) => log.error("❌ Setup failed:", e));

    return () => {
      log.warn("🗑 Cleaning up WebRTC session (receiver)");
      peerRef.current?.destroy();
      stopTimer();
      stopPollForOffers();
      if (signalChannel) supabase.removeChannel(signalChannel);

      (localVideoRef.current?.srcObject as MediaStream | null)
        ?.getTracks()
        .forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // ------------------ UI ---------------------
  return (
    <div className="w-full h-full grid grid-cols-12 gap-4 bg-black rounded">
      <div className="col-span-8 bg-black rounded overflow-hidden relative flex items-center justify-center">
        {remoteStream ? (
          <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
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
