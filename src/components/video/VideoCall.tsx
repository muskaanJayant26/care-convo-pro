// FILE: VideoCall.tsx
// Updated UI: Google Meet style split view (B3)

import React, { useEffect, useRef, useState } from 'react';
import SimplePeer from 'simple-peer';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { PhoneOff, Mic, MicOff, Video as VideoIcon, VideoOff, RefreshCw } from 'lucide-react';

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
  const peerRef = useRef<any>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [status, setStatus] = useState<'connecting'|'connected'|'idle'|'error'>('idle');
  const [callDuration, setCallDuration] = useState(0);
  const timerRef = useRef<number | null>(null);

  // start local camera immediately (so caller sees UI instantly)
  const startLocalCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(stream);
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      return stream;
    } catch (err) {
      console.error('getUserMedia error', err);
      setStatus('error');
      throw err;
    }
  };

  // start or resume timer
  const startTimer = () => {
    if (timerRef.current) return;
    timerRef.current = window.setInterval(() => setCallDuration((s) => s + 1), 1000);
  };
  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };
  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  useEffect(() => {
    // create peer and subscribe to signaling when component mounts
    let mounted = true;

    const setup = async () => {
      setStatus('connecting');
      // ensure we have local camera on mount
      const stream = await startLocalCamera();

      // decide initiator deterministically (caller starts as initiator)
      const initiator = callerId === currentUserId;

      const p = new SimplePeer({ initiator, trickle: false, stream });
      peerRef.current = p;

      p.on('signal', async (data: any) => {
        try {
// send signal to the *other* user
const targetUserId = currentUserId === callerId ? receiverId : callerId;

await supabase.from("call_signals").insert({
  chat_room_id: chatRoomId,
  sender_id: currentUserId,
  receiver_id: targetUserId,
  type: "webrtc-signal",
  signal: data
});

        } catch (err) {
          console.error('sendSignal error', err);
        }
      });

      p.on('stream', (remote: MediaStream) => {
        if (!mounted) return;
        setRemoteStream(remote);
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remote;
      });

      p.on('connect', () => {
        setStatus('connected');
        startTimer();
      });

      p.on('close', () => {
        setStatus('idle');
        stopTimer();
      });

      p.on('error', (e: any) => {
        console.error('peer error', e);
        setStatus('error');
      });

      // subscribe to webrtc-signal rows for this chat
    const signalChannel = supabase
  .channel(`rtc-${chatRoomId}-${currentUserId}`)
  .on(
    "postgres_changes",
    {
      event: "INSERT",
      schema: "public",
      table: "call_signals",
      filter: `chat_room_id=eq.${chatRoomId},receiver_id=eq.${currentUserId}`
    },
    (payload) => {
      const data = payload.new;
      if (data.type !== "webrtc-signal") return;

      try {
        peerRef.current?.signal(data.signal);
      } catch (err) {
        console.warn("signal apply error", err);
      }
    }
  )
  .subscribe();


      // cleanup
      return () => {
        mounted = false;
        try { peerRef.current?.destroy(); } catch {}
        supabase.removeChannel(signalChannel);
        stopTimer();
        // stop tracks
        try {
          (localVideoRef.current?.srcObject as MediaStream | null)?.getTracks().forEach(t => t.stop());
        } catch {}
      };
    };

    // call setup and keep cleanup function
    const cleanupPromise = setup();
    return () => {
      cleanupPromise && cleanupPromise.then((cleanupFn: any) => {
        // nothing - cleanup handled above
      }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMute = () => {
    const s = localVideoRef.current?.srcObject as MediaStream | null;
    if (!s) return;
    s.getAudioTracks().forEach(t => (t.enabled = !t.enabled));
    setMuted(m => !m);
  };

  const toggleCamera = () => {
    const s = localVideoRef.current?.srcObject as MediaStream | null;
    if (!s) return;
    s.getVideoTracks().forEach(t => (t.enabled = !t.enabled));
    setCameraOn(c => !c);
  };

  const reconnect = async () => {
    // quick reconnect: destroy peer and recreate
    try {
      peerRef.current?.destroy();
    } catch {}
    setStatus('connecting');
    setCallDuration(0);
    stopTimer();

    // recreate peer by reloading the component logic — easiest is a full reload
    window.location.reload();
  };

  const endCall = async () => {
    try {
      await supabase.from('call_signals').insert({ chat_room_id: chatRoomId, caller_id: callerId, receiver_id: receiverId, type: 'call-ended' });
    } catch (err) { console.warn(err); }

    try { peerRef.current?.destroy(); } catch {}
    stopTimer();
    onClose();
  };

  return (
    <div className="w-full h-full grid grid-cols-12 gap-4 bg-black rounded">
      {/* LEFT: Remote large video (takes 8/12) */}
      <div className="col-span-8 bg-black rounded overflow-hidden relative flex items-center justify-center">
        {remoteStream ? (
          <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
        ) : (
          <div className="text-center text-white/70 p-6">
            <div className="text-lg font-semibold mb-2">{status === 'connecting' ? 'Connecting...' : status === 'error' ? 'Connection error' : 'Waiting for participant...'}</div>
            <div className="text-sm">{status === 'connected' ? 'Call connected' : 'Remote video will appear here'}</div>
          </div>
        )}

        {/* Timer (top-left) */}
        <div className="absolute top-4 left-4 bg-white/10 text-white px-3 py-1 rounded-md text-sm">
          {status === 'connected' ? formatDuration(callDuration) : '00:00'}
        </div>
      </div>

      {/* RIGHT: Local preview + info (4/12) */}
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
            <div className="text-sm font-medium text-white">{status === 'connected' ? 'Live' : 'Not connected'}</div>
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

        {/* Bottom center controls - duplicated here for small screens */}
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
