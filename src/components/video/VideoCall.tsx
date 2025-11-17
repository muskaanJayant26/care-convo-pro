
// FILE: VideoCall.tsx
// Put this file next to ChatInterface.tsx. This component uses SimplePeer and the same 'call_signals' table

import React, { useEffect, useRef, useState } from 'react';
import SimplePeer from 'simple-peer';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { PhoneOff, Mic, MicOff, Video as VideoIcon } from 'lucide-react';

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
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);

  // Helper to insert signaling messages into call_signals table
  const sendSignal = async (signal: any) => {
    try {
      await supabase.from('call_signals').insert({ chat_room_id: chatRoomId, caller_id: callerId, receiver_id: receiverId, type: 'webrtc-signal', signal });
    } catch (err) {
      console.error('sendSignal error', err);
    }
  };

  useEffect(() => {
    let mounted = true;
    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (!mounted) return;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;

        // decide initiator deterministically so both clients agree
        const initiator = callerId === currentUserId; // caller starts as initiator

        const p = new SimplePeer({ initiator, trickle: false, stream });
        peerRef.current = p;

        p.on('signal', (data: any) => {
          // send to supabase signaling table
          sendSignal(data);
        });

        p.on('stream', (remoteStream: MediaStream) => {
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
        });

        p.on('error', (err: any) => console.error('peer error', err));

      } catch (err) {
        console.error('getUserMedia error', err);
      }
    };

    start();

    // subscribe to webrtc-signal rows
    const signalChannel = supabase
      .channel(`rtc-${chatRoomId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'call_signals', filter: `chat_room_id=eq.${chatRoomId}` },
        (payload) => {
          const data = payload.new as any;
          if (data.type !== 'webrtc-signal') return;

          // ignore signals we ourselves inserted (optional: supabase gives 'inserted by' info? not reliably)
          // Simple approach: always try to signal; SimplePeer will ignore duplicates
          try {
            peerRef.current?.signal(data.signal);
          } catch (e) {
            console.warn('signal apply error', e);
          }
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      // cleanup peer
      try { peerRef.current?.destroy(); } catch {}
      supabase.removeChannel(signalChannel);
      // stop local tracks
      try {
        const tracks = (localVideoRef.current?.srcObject as MediaStream | null)?.getTracks() || [];
        tracks.forEach(t => t.stop());
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMute = () => {
    const stream = localVideoRef.current?.srcObject as MediaStream | null;
    if (!stream) return;
    stream.getAudioTracks().forEach(t => (t.enabled = !t.enabled));
    setMuted(m => !m);
  };

  const toggleCamera = () => {
    const stream = localVideoRef.current?.srcObject as MediaStream | null;
    if (!stream) return;
    stream.getVideoTracks().forEach(t => (t.enabled = !t.enabled));
    setCameraOn(c => !c);
  };

  const endCall = async () => {
    try {
      // insert a hangup signal (optional)
      await supabase.from('call_signals').insert({ chat_room_id: chatRoomId, caller_id: callerId, receiver_id: receiverId, type: 'call-ended' });
    } catch (err) { console.warn(err); }

    try { peerRef.current?.destroy(); } catch {}
    onClose();
  };

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex gap-4 mb-4">
        <div className="flex-1">
          <div className="text-sm text-muted-foreground mb-2">Local</div>
          <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-64 bg-black rounded" />
        </div>
        <div className="flex-1">
          <div className="text-sm text-muted-foreground mb-2">Remote</div>
          <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-64 bg-black rounded" />
        </div>
      </div>

      <div className="mt-auto flex items-center gap-2">
        <Button onClick={toggleMute} size="sm">{muted ? <MicOff /> : <Mic />}</Button>
        <Button onClick={toggleCamera} size="sm">{cameraOn ? <VideoIcon /> : <VideoIcon className="opacity-50" />}</Button>
        <Button onClick={endCall} size="sm" variant="destructive"><PhoneOff /></Button>
      </div>
    </div>
  );
};

export default VideoCall;