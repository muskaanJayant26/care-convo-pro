// VideoCall.tsx
import React, { useEffect, useRef, useState } from 'react';
import SimplePeer from 'simple-peer/simplepeer.min.js';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { PhoneOff, Mic, MicOff, Video as VideoIcon, VideoOff, RefreshCw } from 'lucide-react';

/**
 * Option A — Simple, robust VideoCall component with verbose logging
 *
 * Requirements:
 *  - Table `call_signals` with columns at least:
 *      chat_room_id, caller_id, receiver_id, sender_id, type (webrtc-signal), signal
 *  - Signaling rows inserted by peer 'signal' handler (this file uses insertSignal())
 *
 * Behavior:
 *  - Caller creates peer as initiator when local camera ready
 *  - Receiver waits for incoming offer rows, creates non-initiator peer and applies offer
 *  - All signals (offer/answer/candidate) are inserted in call_signals by insertSignal()
 *  - Incoming rows are parsed (JSON.parse if string) before feeding into peer.signal()
 */

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'turn:global.relay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
];

const LOG = (m: string, ...rest: any[]) => console.log('%c[VIDEO CALL] ' + m, 'color:#60a5fa;font-weight:bold', ...rest);
const SIGNAL_LOG = (m: string, ...rest: any[]) => console.log('%c[SIGNAL] ' + m, 'color:#7dd3fc;font-weight:600', ...rest);
const ERROR_LOG = (m: string, ...rest: any[]) => console.error('%c[VIDEO CALL ERROR] ' + m, 'color:#f87171;font-weight:bold', ...rest);
const DB_LOG = (m: string, ...rest: any[]) => console.log('%c[DB] ' + m, 'color:#facc15;font-weight:600', ...rest);

interface Props {
  chatRoomId: string;
  callerId: string;
  receiverId: string;
  currentUserId: string;
  onClose: () => void;
}

const insertSignal = async (
  chatRoomId: string,
  callerId: string,
  receiverId: string,
  senderId: string,
  signal: any
) => {
  try {
    DB_LOG('insertSignal -> inserting row', { chatRoomId, senderId, type: 'webrtc-signal' });
    const payload = {
      chat_room_id: chatRoomId,
      caller_id: callerId,
      receiver_id: receiverId,
      sender_id: senderId,
      type: 'webrtc-signal',
      signal,
    };
    const { data, error } = await supabase.from('call_signals').insert([payload]).select().single();
    if (error) {
      ERROR_LOG('insertSignal DB error', error);
      return null;
    }
    DB_LOG('insertSignal success', data);
    return data;
  } catch (e) {
    ERROR_LOG('insertSignal exception', e);
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
  const [status, setStatus] = useState<'idle' | 'starting' | 'connecting' | 'connected' | 'error'>('idle');

  const isCaller = currentUserId === callerId;
  LOG(`mount`, { chatRoomId, callerId, receiverId, currentUserId, isCaller });

  // start local camera
  const startLocalCamera = async () => {
    setStatus('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      LOG('Local media acquired', stream);
      setLocalStream(stream);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.muted = true;
        localVideoRef.current.playsInline = true;
        localVideoRef.current.play().catch(() => {});
      }
      return stream;
    } catch (e) {
      ERROR_LOG('getUserMedia failed', e);
      setStatus('error');
      throw e;
    }
  };

  // create peer (initiator = true for caller)
  const createPeer = (initiator: boolean, local: MediaStream) => {
    LOG('createPeer', { initiator });
    if (peerRef.current) {
      LOG('peer already exists -> reusing');
      return peerRef.current;
    }

    setStatus('connecting');

    const peer = new SimplePeer({
      initiator,
      trickle: true,
      stream: local,
      config: { iceServers: ICE_SERVERS },
    });

    peer.on('signal', async (signalData: any) => {
      SIGNAL_LOG('local peer signal emitted', signalData && signalData.type ? signalData.type : typeof signalData);
      // Always send the raw object; don't stringify here — DB stores JSON object (your DB can accept JSON)
      // If your DB stores strings, insertSignal will still work — Supabase will accept JS object and convert.
      await insertSignal(chatRoomId, callerId, receiverId, currentUserId, signalData);
    });

    peer.on('stream', (stream: MediaStream) => {
      LOG('remote stream received');
      setRemoteStream(stream);
      setTimeout(() => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream;
          remoteVideoRef.current.playsInline = true;
          remoteVideoRef.current.play().catch(() => {});
        }
      }, 50);
    });

    peer.on('connect', () => {
      LOG('peer connected');
      setStatus('connected');
    });

    peer.on('close', () => {
      LOG('peer closed');
      setStatus('idle');
      onClose();
    });

    peer.on('error', (e: any) => {
      ERROR_LOG('peer error', e);
      setStatus('error');
    });

    peerRef.current = peer;
    return peer;
  };

  // parse incoming signal robustly (handles stringified JSON or object)
  const normalizeSignal = (rawSignal: any) => {
    if (rawSignal == null) return null;
    if (typeof rawSignal === 'object') return rawSignal;
    if (typeof rawSignal === 'string') {
      try {
        return JSON.parse(rawSignal);
      } catch (e) {
        // Some DBs store escaped quoted JSON or double-encoded; try one more attempt (strip quotes)
        try {
          const stripped = rawSignal.replace(/^"(.+)"$/, '$1').replace(/\\"/g, '"');
          return JSON.parse(stripped);
        } catch (ee) {
          ERROR_LOG('Failed to parse signal string', ee, rawSignal);
          return null;
        }
      }
    }
    ERROR_LOG('Unknown signal type', typeof rawSignal, rawSignal);
    return null;
  };

  // incoming signal handler: apply to peer (create peer if not present)
  const applySignal = (rawSignal: any) => {
    const signal = normalizeSignal(rawSignal);
    SIGNAL_LOG('applySignal received', signal && signal.type ? signal.type : typeof signal);

    if (!signal) {
      ERROR_LOG('applySignal: no usable signal');
      return;
    }

    // if peer doesn't exist yet, create non-initiator peer (receiver side)
    if (!peerRef.current) {
      if (!localStream) {
        ERROR_LOG('No local stream yet - cannot create peer to apply incoming signal. Signal queued?');
        return;
      }
      LOG('Peer missing - creating non-initiator peer to apply incoming signal');
      createPeer(false, localStream);
    }

    try {
      peerRef.current?.signal(signal);
      SIGNAL_LOG('signal applied to peer');
    } catch (e) {
      ERROR_LOG('Error applying signal to peer', e);
    }
  };

  // setup on mount: start camera, create peer (if caller), subscribe to supabase
  useEffect(() => {
    let mounted = true;
    LOG('setup start');

    const init = async () => {
      try {
        const local = await startLocalCamera();
        if (!mounted) return;

        // If user is caller, create peer right away as initiator.
        if (isCaller) {
          LOG('User is caller -> creating initiator peer');
          createPeer(true, local);
        } else {
          LOG('User is receiver -> waiting for incoming offer');
        }

        // Subscribe to call_signals table for our chat_room_id
        // We also check chat_room_id server-side via filter to reduce traffic:
        const chan = supabase
          .channel(`webrtc-${chatRoomId}`)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'call_signals',
              filter: `chat_room_id=eq.${chatRoomId}`, // Supabase will filter for this chat room
            },
            (payload: any) => {
              DB_LOG('Realtime callback', payload?.new?.id ?? 'no-id', payload?.new?.type);
              const row = payload.new as any;
              if (!row) return;

              // ignore rows that are not the webrtc-signal type (other types may be call-offer/accepted – keep those to ChatInterface)
              if (row.type !== 'webrtc-signal') {
                DB_LOG('Ignoring non-webrtc-signal row in VideoCall', row.type);
                return;
              }

              // ignore our own signals (we inserted them)
              if (row.sender_id === currentUserId) {
                DB_LOG('Ignoring own inserted signal row', row.id);
                return;
              }

              // row.signal may be object or stringified - normalize
              const incomingSignal = row.signal ?? null;
              if (!incomingSignal) {
                DB_LOG('Signal payload empty - ignoring', row.id);
                return;
              }

              SIGNAL_LOG('Incoming signal row', { id: row.id, sender_id: row.sender_id, signalType: typeof incomingSignal });

              // If this is an offer and this client is receiver, ensure we create peer as non-initiator before applying.
              // If it's an answer and we're the caller, peer likely exists; apply it normally.
              applySignal(incomingSignal);
            }
          )
          .subscribe((status) => {
            LOG('Supabase subscribe status', status);
          });

        channelRef.current = chan;
        LOG('Subscribed to supabase channel', { channelId: `webrtc-${chatRoomId}` });
      } catch (e) {
        ERROR_LOG('init failed', e);
        setStatus('error');
      }
    };

    init();

    return () => {
      mounted = false;
      LOG('cleanup');
      try {
        peerRef.current?.destroy();
      } catch (e) {
        ERROR_LOG('Error destroying peer', e);
      }
      try {
        if (localStream) localStream.getTracks().forEach((t) => t.stop());
      } catch {}
      try {
        if (remoteStream) remoteStream.getTracks().forEach((t) => t.stop());
      } catch {}
      try {
        if (channelRef.current) {
          LOG('Removing supabase channel');
          supabase.removeChannel(channelRef.current);
        }
      } catch (e) {
        ERROR_LOG('removeChannel failed', e);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // controls
  const toggleMute = () => {
    if (!localStream) return;
    localStream.getAudioTracks().forEach((t) => (t.enabled = !t.enabled));
    setMuted((v) => !v);
  };

  const toggleCamera = () => {
    if (!localStream) return;
    localStream.getVideoTracks().forEach((t) => (t.enabled = !t.enabled));
    setCameraOn((v) => !v);
  };

  const endCall = async () => {
    LOG('endCall - user requested');
    try {
      peerRef.current?.destroy();
    } catch (e) {
      ERROR_LOG('Error destroying peer on endCall', e);
    }
    try {
      if (localStream) localStream.getTracks().forEach((t) => t.stop());
      if (remoteStream) remoteStream.getTracks().forEach((t) => t.stop());
    } catch (e) {
      ERROR_LOG('Error stopping tracks on endCall', e);
    }

    try {
      if (channelRef.current) {
        LOG('Removing supabase channel on endCall');
        supabase.removeChannel(channelRef.current);
      }
    } catch (e) {
      ERROR_LOG('Error removing channel on endCall', e);
    }

    onClose();
  };

  const reconnect = () => {
    LOG('reconnect requested -> reload page');
    window.location.reload();
  };

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
