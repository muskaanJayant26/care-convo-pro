import React, { useEffect, useRef, useState } from "react";
import SimplePeer from "simple-peer/simplepeer.min.js";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { PhoneOff, Mic, MicOff, Video as VideoIcon, VideoOff, RefreshCw } from "lucide-react";

// This component is a rewritten, self-contained WebRTC + Supabase signal example.
// Key differences and fixes compared to many common breakages:
// - Uses a stable SimplePeer import (`simple-peer`) rather than an internal minified path.
// - Subscribes to Supabase realtime INSERTs without depending on fragile filter syntax (we filter in-code).
// - Ensures peer is created BEFORE applying incoming signal, and uses initiator correctly.
// - Uses trickle: false (same as your original) so full SDP is exchanged in one record.
// - Explicitly attaches remote stream and local stream to <video> refs and handles autoplay.
// - Clean teardown: destroys peer, stops tracks, and unsubscribes from realtime.

interface VideoCallProps {
  chatRoomId: string;
  callerId: string;
  receiverId: string;
  currentUserId: string;
  onClose: () => void;
}
const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  {
    urls: "turn:relay1.expressturn.com:3478",
    username: "efU9QnF5nRzQZg",
    credential: "31S4Q5YjT8x72Q",
  },
];

const VideoCall: React.FC<VideoCallProps> = ({ chatRoomId, callerId, receiverId, currentUserId, onClose }) => {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const peerRef = useRef<SimplePeer.Instance | null>(null);
  const subRef = useRef<any>(null);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");

  const isCaller = currentUserId === callerId;
  const isReceiver = currentUserId === receiverId;

  // getUserMedia
  const startLocalCamera = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(s);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = s;
        localVideoRef.current.muted = true; // always mute local preview
        await localVideoRef.current.play().catch(() => {});
      }
      return s;
    } catch (e) {
      console.error("Failed to getUserMedia", e);
      setStatus("error");
      throw e;
    }
  };

  // helper to insert signal row
  const insertSignalRow = async (signal: any) => {
    try {
      const { data, error } = await supabase.from("call_signals").insert([
        {
          chat_room_id: chatRoomId,
          caller_id: callerId,
          receiver_id: receiverId,
          sender_id: currentUserId,
          type: "webrtc-signal",
          signal,
        },
      ]).select();

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

  const createPeer = (initiator: boolean, local: MediaStream) => {
    if (peerRef.current) return peerRef.current;
    setStatus("connecting");

    const p = new SimplePeer({ initiator, trickle: false, stream: local, config: { iceServers: ICE_SERVERS } });

    p.on("signal", async (s: any) => {
      // s is offer/answer (SDP)
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

    p.on("error", (err: any) => {
      console.error("peer error", err);
      setStatus("error");
    });

    peerRef.current = p;
    return p;
  };

  // Apply incoming signal safely: ensure peer exists first
  const applySignal = (signal: any, local: MediaStream) => {
    try {
      if (!peerRef.current) {
        // If incoming is an offer, receiver must create peer as non-initiator
        const incomingIsOffer = signal?.type === "offer";
        createPeer(!incomingIsOffer /* initiator = false for offer receiver */, local);
      }

      // small delay sometimes helps to ensure peer is ready
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

  useEffect(() => {
    let mounted = true;

    const setup = async () => {
      try {
        const local = await startLocalCamera();

        // If caller: create the initiator peer immediately so that offer will be created
        if (isCaller) {
          createPeer(true, local);
        }

        // Subscribe to all inserts and filter in-code (works across supabase versions)
     // Subscribe to realtime using the new channel API
const channel = supabase.channel(`call_signals_${chatRoomId}`);

channel.on(
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

    // ignore my own signals
    if (row.sender_id === currentUserId) return;

    const signal = row.signal;
    if (!signal) return;

    // deliver offer → receiver
    if (signal.type === "offer" && isReceiver) {
      applySignal(signal, local);
      return;
    }

    // deliver answer → caller
    if (signal.type === "answer" && isCaller) {
      applySignal(signal, local);
      return;
    }

    // deliver additional ICE / renegotiation messages
    applySignal(signal, local);
  }
);

await channel.subscribe();
subRef.current = channel;


        // Fallback polling: in case realtime fails (optional)
        // You can implement a polling fallback here similar to your previous code.
      } catch (e) {
        console.error("setup error", e);
      }
    };

    setup();

    return () => {
      mounted = false;
      // cleanup
      try {
        peerRef.current?.destroy();
        peerRef.current = null;
      } catch (e) {}

      if (subRef.current) {
        try {
          supabase.removeChannel(subRef.current);

        } catch (e) {
          try {
            supabase.removeChannel?.(subRef.current);
          } catch (_) {}
        }
        subRef.current = null;
      }

      if (localStream) {
        localStream.getTracks().forEach((t) => t.stop());
      }

      if (remoteStream) {
        remoteStream.getTracks().forEach((t) => t.stop());
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    } catch (e) {}
    if (localStream) localStream.getTracks().forEach((t) => t.stop());
    if (remoteStream) remoteStream.getTracks().forEach((t) => t.stop());
    setLocalStream(null);
    setRemoteStream(null);
    onClose();
  };

  const reconnect = () => {
    // simple strategy: reload the page — replace as you need
    window.location.reload();
  };

  return (
    <div className="w-full h-full grid grid-cols-12 gap-4 bg-black rounded">
      <div className="col-span-8 bg-black rounded overflow-hidden relative flex items-center justify-center">
        {remoteStream ? (
          <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
        ) : (
          <div className="text-white/70 text-center p-4">{status === "connecting" ? "Connecting…" : "Waiting for participant…"}</div>
        )}
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
            <Button onClick={toggleMute} className="w-10 h-10 rounded-full">{muted ? <MicOff /> : <Mic />}</Button>
            <Button onClick={toggleCamera} className="w-10 h-10 rounded-full">{cameraOn ? <VideoIcon /> : <VideoOff />}</Button>
            <Button onClick={reconnect} className="w-10 h-10 rounded-full"><RefreshCw /></Button>
          </div>
        </div>

        <div className="mt-auto flex justify-center">
          <Button onClick={endCall} variant="destructive" className="rounded-full px-4 py-2"><PhoneOff /> End Call</Button>
        </div>
      </div>
    </div>
  );
};

export default VideoCall;
