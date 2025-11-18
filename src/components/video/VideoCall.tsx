import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  DailyProvider,
  useDaily,
  useDailyEvent,
  DailyIframe,
  DailyProviderProps,
} from "@daily-co/daily-react";
import { Button } from "@/components/ui/button";
import { PhoneOff, Mic, MicOff, Video as VideoIcon, VideoOff, RefreshCw, ScreenShare, StopCircle } from "lucide-react";

interface VideoCallProps {
  roomUrl: string; // e.g. https://health-test.daily.co/test
  onLeave?: () => void;
}

// Small helper component that renders local + remote videos and controls
const CallUI: React.FC<{ onLeave?: () => void }> = ({ onLeave }) => {
  const daily = useDaily();
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [participants, setParticipants] = useState<Record<string, any>>({});

  // update participants whenever Daily reports changes
  useDailyEvent("participant-joined", () => setParticipants({ ...daily?.participants() }));
  useDailyEvent("participant-updated", () => setParticipants({ ...daily?.participants() }));
  useDailyEvent("participant-left", () => setParticipants({ ...daily?.participants() }));

  useDailyEvent("left-meeting", () => {
    onLeave?.();
  });

  useEffect(() => {
    // initialize participants state on mount
    setParticipants({ ...daily?.participants() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMute = useCallback(async () => {
    const newMuted = !muted;
    await daily?.setLocalAudio(!newMuted);
    setMuted(newMuted);
  }, [daily, muted]);

  const toggleCamera = useCallback(async () => {
    const turnOff = !videoOff;
    await daily?.setLocalVideo(!turnOff);
    setVideoOff(turnOff);
  }, [daily, videoOff]);

  const startScreen = useCallback(async () => {
    try {
      await daily?.startScreenShare();
      setScreenSharing(true);
    } catch (e) {
      console.error("startScreenShare failed", e);
    }
  }, [daily]);

  const stopScreen = useCallback(async () => {
    try {
      await daily?.stopScreenShare();
      setScreenSharing(false);
    } catch (e) {
      console.error("stopScreenShare failed", e);
    }
  }, [daily]);

  const leave = useCallback(() => daily?.leave(), [daily]);

  return (
    <div className="w-full h-full grid grid-cols-12 gap-4 bg-black rounded">
      <div className="col-span-8 bg-black rounded overflow-hidden relative flex items-center justify-center">
        {/* remote videos (stacked/first remote) */}
        <div className="w-full h-full flex items-center justify-center gap-2 p-2 flex-wrap">
          {Object.values(participants)
            .filter((p: any) => !p.local)
            .map((p: any) => (
              <div key={p.session_id} className="w-1/2 h-1/2 bg-black rounded overflow-hidden">
                <div style={{ width: "100%", height: "100%" }}>
                  {/* Daily provides a data attribute for participants which the SDK mounts into */}
                  <div className="daily-remote-video" data-session-id={p.session_id} style={{ width: "100%", height: "100%" }} />
                </div>
                <div className="text-white/80 p-1 text-sm">{p.user_name ?? p.session_id}</div>
              </div>
            ))}

          {/* Fallback message */}
          {Object.values(participants).filter((p: any) => !p.local).length === 0 && (
            <div className="text-white/70 text-center p-4">Waiting for participant…</div>
          )}
        </div>
      </div>

      <div className="col-span-4 p-4 flex flex-col gap-4">
        <div className="bg-white/5 rounded p-3 flex-1 flex flex-col items-center">
          <div className="w-full h-48 bg-black rounded overflow-hidden">
            <div className="daily-local-video" data-session-id="local" style={{ width: "100%", height: "100%" }} />
          </div>
          <div className="text-white mt-2 text-sm">You</div>
        </div>

        <div className="bg-white/5 rounded p-3">
          <div className="flex justify-between text-white mb-3">
            <div>Status</div>
            <div>{daily?.meetingState ?? "idle"}</div>
          </div>

          <div className="flex justify-center gap-3">
            <Button onClick={toggleMute} className="w-10 h-10 rounded-full">{muted ? <MicOff /> : <Mic />}</Button>
            <Button onClick={toggleCamera} className="w-10 h-10 rounded-full">{videoOff ? <VideoOff /> : <VideoIcon />}</Button>
            {screenSharing ? (
              <Button onClick={stopScreen} className="w-10 h-10 rounded-full"><StopCircle /></Button>
            ) : (
              <Button onClick={startScreen} className="w-10 h-10 rounded-full"><ScreenShare /></Button>
            )}
            <Button onClick={() => window.location.reload()} className="w-10 h-10 rounded-full"><RefreshCw /></Button>
          </div>
        </div>

        <div className="mt-auto flex justify-center">
          <Button onClick={leave} variant="destructive" className="rounded-full px-4 py-2"><PhoneOff /> End Call</Button>
        </div>
      </div>
    </div>
  );
};

const VideoCall: React.FC<VideoCallProps> = ({ roomUrl, onLeave }) => {
  // DailyProvider auto-joins the room when `url` prop is provided.
  // We also provide a custom `DailyIframe` instance to ensure the SDK mounts
  const dailyConfig: Partial<DailyProviderProps> = useMemo(() => ({
    url: roomUrl,
    showLeaveButton: false,
  }), [roomUrl]);

  return (
    <DailyProvider {...dailyConfig}>
      <CallUI onLeave={onLeave} />
    </DailyProvider>
  );
};

export default VideoCall;
