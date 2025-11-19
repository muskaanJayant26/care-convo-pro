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

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  {
    urls: "turn:relay1.expressturn.com:3478",
    username: "efgI9RB9qMUSBwDsyX",
    credential: "oxTq3CgTpbxsyVB2",
  },
];

const log = (msg: string, ...rest: any[]) =>
  console.log("%c[VIDEO CALL] " + msg, "color:#60a5fa;font-weight:bold", ...rest);
const err = (msg: string, ...rest: any[]) =>
  console.error("%c[VIDEO CALL] " + msg, "color:#f87171;font-weight:bold", ...rest);

interface Props {
  chatRoomId: string;
  callerId: string;
  receiverId: string;
  currentUserId: string;
  onClose: () => void;
}

const VideoCall: React.FC<Props> = ({
  chatRoomId,
  callerId,
  receiverId,
  currentUserId,
  onClose,
}) => {
  const isCaller = currentUserId === callerId;

  const peerRef = useRef<SimplePeer.Instance | null>(null);
  const channelRef = useRef<any>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const pendingSignals = useRef<any[]>([]); // <— FIX: buffer signals

  const [connected, setConnected] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);

  // ------------------------------------------------------
  // INSERT SIGNAL INTO SUPABASE
  // ------------------------------------------------------
  const sendSignal = async (
    type: "call-offer" | "call-answer" | "webrtc-signal",
    signal: any
  ) => {
    log("Inserting signal", { type, signal });

    const { error } = await supabase.from("call_signals").insert({
      chat_room_id: chatRoomId,
      caller_id: callerId,
      receiver_id: receiverId,
      sender_id: currentUserId,
      type,
      signal,
    });

    if (error) err("insert signal error", error);
  };

  // ------------------------------------------------------
  // CREATE PEER
  // ------------------------------------------------------
  const createPeer = (initiator: boolean) => {
    if (peerRef.current) return peerRef.current;

    log("createPeer()", { initiator });

    const stream = localStreamRef.current!;
    const peer = new SimplePeer({
      initiator,
      trickle: true,
      stream,
      config: { iceServers: ICE_SERVERS },
    });

    peer.on("signal", (data: any) => {
      log("peer emitted signal:", data);

      if (data.type === "offer") sendSignal("call-offer", data);
      else if (data.type === "answer") sendSignal("call-answer", data);
      else sendSignal("webrtc-signal", data);
    });

    peer.on("stream", (remoteStream) => {
      log("remote stream received");
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
        remoteVideoRef.current.play().catch(() => {});
      }
    });

    peer.on("connect", () => {
      log("peer connected!");
      setConnected(true);
    });

    peer.on("error", (e) => err("peer error", e));

    peer.on("close", () => log("peer closed"));

    peerRef.current = peer;

    // After creation → flush pending signals
    setTimeout(() => {
      if (pendingSignals.current.length > 0) {
        log("Flushing pending signals", pendingSignals.current);
        pendingSignals.current.forEach((s) => peer.signal(s));
        pendingSignals.current = [];
      }
    }, 30);

    return peer;
  };

  // ------------------------------------------------------
  // APPLY INCOMING SIGNAL
  // ------------------------------------------------------
  const applyIncomingSignal = async (row: any) => {
    log("applyIncomingSignal row", row);

    const { type, signal, sender_id } = row;
    if (sender_id === currentUserId) return; // ignore own signal

    const peer = peerRef.current;

    // Receiver first receives OFFER → create peer
    if (type === "call-offer") {
      log("Received OFFER → ensure peer and apply offer");

      if (!peer) {
        createPeer(false);
        pendingSignals.current.push(signal); // store until peer ready
      } else {
        peer.signal(signal);
      }
      return;
    }

    // Caller receives ANSWER
    if (type === "call-answer") {
      log("Received ANSWER → applying");
      peer?.signal(signal);
      return;
    }

    // ICE Candidates
    if (type === "webrtc-signal") {
      if (!peer) {
        log("No peer yet — ICE stored");
        pendingSignals.current.push(signal);
        return;
      }
      log("Applying ICE candidate");
      peer.signal(signal);
      return;
    }
  };

  // ------------------------------------------------------
  // INITIAL MOUNT
  // ------------------------------------------------------
  useEffect(() => {
    log("mount", { chatRoomId, callerId, receiverId, currentUserId });

    (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.muted = true;
        localVideoRef.current.play().catch(() => {});
      }

      // Caller immediately creates peer
      if (isCaller) {
        createPeer(true);
      }

      // Realtime subscription
      const channel = supabase
        .channel("webrtc-" + chatRoomId)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "call_signals",
            filter: `chat_room_id=eq.${chatRoomId}`,
          },
          (payload) => {
            log("🔥 realtime payload", payload.new);
            applyIncomingSignal(payload.new);
          }
        )
        .subscribe((status) => log("subscribe status:", status));

      channelRef.current = channel;
    })();

    return () => {
      log("cleanup");
      peerRef.current?.destroy();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, []);

  // ------------------------------------------------------
  // UI HANDLERS
  // ------------------------------------------------------
  const toggleMic = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    stream.getAudioTracks().forEach((t) => (t.enabled = !t.enabled));
    setMicOn((v) => !v);
  };

  const toggleCamera = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    stream.getVideoTracks().forEach((t) => (t.enabled = !t.enabled));
    setCameraOn((v) => !v);
  };

  const endCall = () => {
    peerRef.current?.destroy();
    onClose();
  };

  return (
    <div className="grid grid-cols-12 gap-4 w-full h-full bg-black p-4 rounded">
      {/* Remote Video */}
      <div className="col-span-8 bg-black flex items-center justify-center rounded relative">
        <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
      </div>

      {/* Controls + Local Video */}
      <div className="col-span-4 flex flex-col gap-4">
        <div className="bg-white/5 rounded p-3 flex flex-col items-center">
          <div className="w-full h-48 bg-black rounded mb-2 overflow-hidden">
            <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          </div>
          <div className="text-white text-sm">
            {connected ? "Connected" : "Connecting…"}
          </div>
        </div>

        <div className="bg-white/5 rounded p-4 flex justify-center gap-4">
          <Button onClick={toggleMic} className="w-10 h-10 rounded-full">
            {micOn ? <Mic /> : <MicOff />}
          </Button>

          <Button onClick={toggleCamera} className="w-10 h-10 rounded-full">
            {cameraOn ? <VideoIcon /> : <VideoOff />}
          </Button>

          <Button onClick={() => window.location.reload()} className="w-10 h-10 rounded-full">
            <RefreshCw />
          </Button>
        </div>

        <div className="flex justify-center mt-auto">
          <Button
            onClick={endCall}
            variant="destructive"
            className="rounded-full flex items-center gap-2 px-6 py-2"
          >
            <PhoneOff /> End Call
          </Button>
        </div>
      </div>
    </div>
  );
};

export default VideoCall;
