// VideoCall.tsx
import React, { useEffect, useRef, useState } from 'react';
import SimplePeer from 'simple-peer/simplepeer.min.js';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { PhoneOff, Mic, MicOff, Video as VideoIcon, VideoOff, RefreshCw } from 'lucide-react';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'turn:global.relay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
];

const log = (msg: string, ...rest: any[]) => console.log('%c[VIDEO CALL] ' + msg, 'color:#60a5fa;font-weight:bold', ...rest);
const err = (msg: string, ...rest: any[]) => console.error('%c[VIDEO CALL] ' + msg, 'color:#f87171;font-weight:bold', ...rest);

interface Props {
  chatRoomId: string;
  callerId: string;
  receiverId: string;
  currentUserId: string;
  onClose: () => void;
}

const insertSignal = async (chatRoomId: string, callerId: string, receiverId: string, senderId: string, signal: any) => {
  try {
    const { data, error } = await supabase.from('call_signals').insert({
      chat_room_id: chatRoomId,
      caller_id: callerId,
      receiver_id: receiverId,
      sender_id: senderId,
      type: 'webrtc-signal',
      signal,
    }).select().single();
    if (error) {
      err('insertSignal error', error);
      return null;
    }
    return data;
  } catch (e) {
    err('insertSignal exception', e);
    return null;
  }
};

const VideoCall: React.FC<Props> = ({ chatRoomId, callerId, receiverId, currentUserId, onClose }) => {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const peerRef = useRef<SimplePeer.Instance | null>(null);
  const channelRef = useRef<any>(null);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [status, setStatus] = useState<'idle'|'starting'|'connecting'|'connected'|'error'>('idle');

  const isCaller = currentUserId === callerId;

  useEffect(() => {
    log('mount', { chatRoomId, callerId, receiverId, currentUserId, isCaller });

    let mounted = true;

    const start = async () => {
      try {
        setStatus('starting');
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (!mounted) return;
        setLocalStream(stream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          localVideoRef.current.muted = true;
          localVideoRef.current.playsInline = true;
          localVideoRef.current.play().catch(()=>{});
        }

        // create peer if caller
        if (isCaller) {
          createPeer(true, stream);
        }

        setStatus('connecting');

        // subscribe to call_signals for this chat_room
        const channel = supabase
          .channel(`webrtc-${chatRoomId}`)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_signals' }, (payload: any) => {
            const row = payload.new as any;

            // only process rows for our chat room
            if (!row || row.chat_room_id !== chatRoomId) return;

            // ignore non-webrtc-signal rows — VideoCall only cares about 'webrtc-signal'
            if (row.type !== 'webrtc-signal') return;

            // ignore our own signals (we inserted them)
            if (row.sender_id === currentUserId) return;

            const signal = row.signal ?? null;
            if (!signal) return;

            applySignal(signal);
          })
          .subscribe((status) => log('supabase subscribe status', status));

        channelRef.current = channel;
      } catch (e) {
        err('start failed', e);
        setStatus('error');
      }
    };

    start();

    return () => {
      mounted = false;
      log('unmount - cleanup');
      try { peerRef.current?.destroy(); } catch (e) {}
      if (localStream) localStream.getTracks().forEach(t => t.stop());
      if (remoteStream) remoteStream.getTracks().forEach(t => t.stop());
      try { if (channelRef.current) supabase.removeChannel(channelRef.current); } catch (e) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createPeer = (initiator: boolean, local: MediaStream) => {
    if (peerRef.current) {
      log('peer already exists');
      return peerRef.current;
    }

    const peer = new SimplePeer({
      initiator,
      trickle: true,
      stream: local,
      config: { iceServers: ICE_SERVERS },
    });

    peer.on('signal', async (signalData: any) => {
      log('peer signal emitted');
      // insert the signal to supabase
      await insertSignal(chatRoomId, callerId, receiverId, currentUserId, signalData);
    });

    peer.on('stream', (s: MediaStream) => {
      log('peer remote stream');
      setRemoteStream(s);
      setTimeout(() => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = s;
          remoteVideoRef.current.playsInline = true;
          remoteVideoRef.current.play().catch(()=>{});
        }
      }, 50);
    });

    peer.on('connect', () => {
      log('peer connected');
      setStatus('connected');
    });

    peer.on('close', () => {
      log('peer closed');
      setStatus('idle');
      onClose();
    });

    peer.on('error', (e) => {
      err('peer error', e);
      setStatus('error');
    });

    peerRef.current = peer;
    return peer;
  };

  const applySignal = (signal: any) => {
    log('applySignal', signal);
    if (!signal) return;

    // If peer doesn't exist yet, ensure local stream exists and create non-initiator peer
    if (!peerRef.current) {
      if (!localStream) {
        err('No local stream yet — cannot create peer to apply incoming signal');
        return;
      }
      createPeer(false, localStream);
    }

    try {
      peerRef.current?.signal(signal);
    } catch (e) {
      err('error applying signal', e);
    }
  };

  const toggleMute = () => {
    if (!localStream) return;
    localStream.getAudioTracks().forEach(t => t.enabled = !t.enabled);
    setMuted(v => !v);
  };

  const toggleCamera = () => {
    if (!localStream) return;
    localStream.getVideoTracks().forEach(t => t.enabled = !t.enabled);
    setCameraOn(v => !v);
  };

  const endCall = () => {
    log('endCall requested');
    try { peerRef.current?.destroy(); } catch (e) {}
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    if (remoteStream) remoteStream.getTracks().forEach(t => t.stop());
    try { if (channelRef.current) supabase.removeChannel(channelRef.current); } catch (e) {}
    onClose();
  };

  const reconnect = () => window.location.reload();

  return (
    <div className="w-full h-full grid grid-cols-12 gap-4 bg-black rounded">
      <div className="col-span-8 bg-black rounded overflow-hidden relative flex items-center justify-center">
        {remoteStream ? (
          <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
        ) : (
          <div className="text-white/70">{status === 'connecting' ? 'Connecting…' : 'Waiting…'}</div>
        )}
      </div>

      <div className="col-span-4 p-4 flex flex-col gap-4">
        <div className="bg-white/5 rounded p-3 flex-1 flex flex-col items-center">
          <div className="w-full h-48 bg-black rounded overflow-hidden">
            <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
          </div>
          <div className="text-white mt-2 text-sm">You ({status})</div>
        </div>

        <div className="bg-white/5 rounded p-3">
          <div className="flex justify-center gap-4">
            <Button onClick={toggleMute} className="w-10 h-10 rounded-full">{muted ? <MicOff /> : <Mic />}</Button>
            <Button onClick={toggleCamera} className="w-10 h-10 rounded-full">{cameraOn ? <VideoIcon /> : <VideoOff />}</Button>
            <Button onClick={reconnect} className="w-10 h-10 rounded-full"><RefreshCw /></Button>
          </div>
        </div>

        <div className="mt-auto flex justify-center">
          <Button onClick={endCall} variant="destructive" className="rounded-full flex items-center gap-2 px-4 py-2">
            <PhoneOff /> End Call
          </Button>
        </div>
      </div>
    </div>
  );
};

export default VideoCall;
