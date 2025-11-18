// VideoCall.tsx — Fixed version (uses your call_signals schema)
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
  callerId: string; // original caller's id for this chat
  receiverId: string; // original receiver's id for this chat
  currentUserId: string; // currently authenticated user id (auth.uid())
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

  // ------------------ Helpers -------------------
  const dbInsertSignal = async (signalObj: any) => {
    // Always insert with canonical caller_id & receiver_id (table schema)
    const insertRow = {
      chat_room_id: chatRoomId,
      caller_id: callerId,
      receiver_id: receiverId,
      type: "webrtc-signal",
      signal: signalObj,
      sender_id: currentUserId,
    };

    try {
      // Insert and request returned row (use .select() to get inserted row)
      const { data, error } = await supabase
        .from("call_signals")
        .insert([insertRow])
        .select();
      if (error) {
        log.error("❌ supabase insert error:", error);
        return null;
      }
      log.info("📨 Signal inserted (db returned):", data);
      return data?.[0] ?? null;
    } catch (e) {
      log.error("❌ Failed to insert signal", e);
      return null;
    }
  };

  // ------------------ PEER ---------------------
  const createPeer = (initiator: boolean, stream: MediaStream) => {
    if (peerRef.current) {
      log.warn("⚠️ Peer already exists; reusing existing instance.");
      return peerRef.current;
    }

    log.info("🛠 Creating peer", { initiator }, initiator ? "(CALLER)" : "(RECEIVER)");
    setStatus("connecting");

    // ICE servers (STUN + TURN). Use reliable TURN for production.
    const ICE_SERVERS = [
      { urls: "stun:stun.l.google.com:19302" },
      // Example public/pooled TURNs for testing — replace with your TURN credentials for production
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

    const p = new SimplePeer({
      initiator,
      trickle: false,
      stream,
      config: { iceServers: ICE_SERVERS },
    });

    // debug native ice state too (some builds expose _pc)
    try {
      (p as any).on?.("iceStateChange", (state: any) => log.info("❄ ICE State:", state));
      (p as any)._pc && ((p as any)._pc.oniceconnectionstatechange = () =>
        log.info("🔥 native ICE conn state:", (p as any)._pc.iceConnectionState));
    } catch (e) { /* ignore */ }

    // when peer has local SDP (offer/answer)
    p.on("signal", async (data: any) => {
      log.info(initiator ? "📡 CALLER SENDING OFFER" : "📡 RECEIVER SENDING ANSWER", {
        type: data?.type ?? "unknown",
      });

      // insert canonical row into DB (type = 'webrtc-signal')
      await dbInsertSignal(data);
    });

    // remote stream attached
    p.on("stream", (remote: MediaStream) => {
      log.info("🎥 Remote stream received");
      setRemoteStream(remote);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remote;
        remoteVideoRef.current.onloadedmetadata = () =>
          remoteVideoRef.current?.play().catch(() => {});
      }
    });

    p.on("connect", () => {
      log.info("🔗 WebRTC fully connected");
      setStatus("connected");
      startTimer();
      // force attach in case
      setTimeout(() => {
        if (remoteVideoRef.current && remoteStream) {
          remoteVideoRef.current.srcObject = remoteStream;
          remoteVideoRef.current.play().catch(() => {});
        }
      }, 300);
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

  // ------------------ POLLING ---------------------
  const startPollForSignalType = (wantedSignalType: "offer" | "answer", stream: MediaStream) => {
    if (pollIntervalRef.current) return;
    pollAttemptsRef.current = 0;

    log.info("🔁 Starting polling fallback for", wantedSignalType);

    pollIntervalRef.current = window.setInterval(async () => {
      pollAttemptsRef.current++;
      log.info("🔎 Poll attempt", pollAttemptsRef.current);

      try {
        const { data: rows, error } = await supabase
          .from("call_signals")
          .select("*")
          .eq("chat_room_id", chatRoomId)
          // we want rows that are intended for this session (we only store canonical caller/receiver fields)
          .filter("signal->>type", "eq", wantedSignalType) // checks JSON field "signal.type"
          .order("created_at", { ascending: false })
          .limit(5);

        if (error) {
          log.error("❌ Poll supabase error:", error);
        } else {
          log.info("🔎 Poll results count:", rows?.length ?? 0);
        }

        if (rows && rows.length) {
          for (const r of rows) {
            log.info("🔎 Inspect row:", r.id, r.signal?.type, r.signal?.sdp ? "(sdp present)" : "");
            if (r.signal && r.signal.type === wantedSignalType) {
              log.info(`📩 Found ${wantedSignalType.toUpperCase()} in DB via polling`);

              // create peer if missing
              if (!peerRef.current) {
                log.info("🛠 Creating peer to apply polled signal");
                createPeer(wantedSignalType === "offer" ? false : true, stream);
              }

              try {
                peerRef.current?.signal(r.signal);
                log.info("📡 Applied polled signal to peer");
              } catch (e) {
                log.error("❌ Failed applying polled signal", e);
              }

              stopPollForOffers();
              return;
            }
          }
        }
      } catch (e) {
        log.error("❌ Exception while polling:", e);
      }

      if (pollAttemptsRef.current >= POLL_MAX_ATTEMPTS) {
        log.warn("⚠️ Poll attempts exhausted");
        stopPollForOffers();
      }
    }, POLL_INTERVAL_MS);
  };

  const stopPollForOffers = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
      log.info("🔁 Polling stopped");
    }
  };

  // ------------------ SETUP ---------------------
  useEffect(() => {
    let signalChannel: any = null;

    const setup = async () => {
      log.info("🚀 Setting up WebRTC (full flow)");

      log.info("📌 ROLE CHECK:", {
        currentUserId,
        callerId,
        receiverId,
        isCaller,
        isReceiver,
      });

      const stream = await startLocalCamera();

      // If caller, create initiator peer immediately (it will generate offer and insert it)
      if (isCaller) {
        log.info("📞 Caller → creating initiator peer (will emit OFFER)");
        createPeer(true, stream);
      } else {
        log.info("📞 Receiver → waiting for OFFER (realtime). If none arrives, poll.");
      }

      // Realtime subscription for rows intended for this user:
      // filter by chat_room_id & receiver_id (AND) — use & for AND
      try {
        signalChannel = supabase
          .channel(`rtc-${chatRoomId}-${currentUserId}`)
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "call_signals",
              // NB: AND must be encoded with & (not comma)
              filter: `chat_room_id=eq.${chatRoomId}&receiver_id=eq.${currentUserId}`,
            },
            async (payload: any) => {
              const row = payload.new;
              log.info("📬 SIGNAL (realtime):", row);

              if (!row || !row.signal) {
                log.warn("⚠️ realtime row missing signal -> skipping");
                return;
              }

              const signalObj = row.signal;

              // if it's an OFFER and we're receiver -> create peer non-initiator and apply it
              if (signalObj.type === "offer") {
                log.info("📩 INCOMING OFFER (realtime)");
                if (!peerRef.current) {
                  log.info("🛠 Creating receiver peer because we received an offer");
                  createPeer(false, stream);
                }
                try {
                  peerRef.current?.signal(signalObj);
                  log.info("📡 Applied OFFER (realtime) to peer");
                } catch (e) {
                  log.error("❌ Failed to apply OFFER (realtime)", e);
                }
                stopPollForOffers();
                return;
              }

              // if it's an ANSWER and we're caller -> apply it
              if (signalObj.type === "answer") {
                log.info("📩 INCOMING ANSWER (realtime)");
                if (!peerRef.current) {
                  log.error("❌ Caller has no peerRef to apply ANSWER to");
                  return;
                }
                try {
                  peerRef.current?.signal(signalObj);
                  log.info("📡 Applied ANSWER (realtime) to peer");
                } catch (e) {
                  log.error("❌ Failed to apply ANSWER (realtime)", e);
                }
                stopPollForOffers();
                return;
              }

              // otherwise just attempt to apply any other signal types
              try {
                if (peerRef.current) {
                  peerRef.current.signal(signalObj);
                  log.info("📡 Applied generic signal (realtime)");
                }
              } catch (e) {
                log.error("❌ Failed applying generic realtime signal", e);
              }
            }
          )
          .subscribe((status: any) => {
            log.info("📶 subscription status:", status);
          });

        // Poll fallback:
        // - If receiver: poll for OFFERs
        // - If caller: poll for ANSWERs
        if (isReceiver) {
          setTimeout(() => {
            if (!peerRef.current) {
              startPollForSignalType("offer", stream);
            }
          }, 1500);
        } else if (isCaller) {
          setTimeout(() => {
            // start polling for answer if none arrives in realtime
            if (!peerRef.current) {
              startPollForSignalType("answer", stream);
            }
          }, 1500);
        }
      } catch (e) {
        log.error("❌ subscription error:", e);
        if (isReceiver) startPollForSignalType("offer", stream);
        if (isCaller) startPollForSignalType("answer", stream);
      }
    };

    setup().catch((e) => log.error("❌ Setup failed:", e));

    return () => {
      log.warn("🗑 cleanup WebRTC");
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
};

export default VideoCall;
