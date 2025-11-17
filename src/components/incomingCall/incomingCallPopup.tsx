import React, { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export type IncomingCallProps = {
  callerName: string;
  onAccept: () => void;
  onReject: () => void;
  autoHangupMs?: number;
};

export const IncomingCallPopup: React.FC<IncomingCallProps> = ({
  callerName,
  onAccept,
  onReject,
  autoHangupMs = 20000,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [hasHandled, setHasHandled] = useState(false);

  useEffect(() => {
    const audio = new Audio("/ringtones/default_ring.mp3");
    audio.loop = true;

    // Bypass autoplay restrictions
    audio.muted = true;
    audio.play().then(() => {
      audio.muted = false;
    }).catch(() => {});

    audioRef.current = audio;

    const timeout = setTimeout(() => {
      if (!hasHandled) {
        setHasHandled(true);
        onReject();
      }
    }, autoHangupMs);

    return () => {
      clearTimeout(timeout);
      audio.pause();
    };
  }, [autoHangupMs, hasHandled, onReject]);

  const handleAccept = () => {
    if (hasHandled) return;
    setHasHandled(true);
    audioRef.current?.pause();
    onAccept();
  };

  const handleReject = () => {
    if (hasHandled) return;
    setHasHandled(true);
    audioRef.current?.pause();
    onReject();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="p-6 space-y-4 text-center max-w-sm w-full animate-in fade-in zoom-in">
        <h2 className="text-xl font-semibold">{callerName} is calling…</h2>

        <div className="flex justify-center gap-4 mt-4">
          <Button className="rounded-full px-6" onClick={handleAccept}>
            Accept
          </Button>

          <Button
            variant="destructive"
            className="rounded-full px-6"
            onClick={handleReject}
          >
            Reject
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default IncomingCallPopup;
