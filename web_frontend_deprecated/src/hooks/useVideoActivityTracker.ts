import { useEffect, useRef, useCallback } from "react";
import { API_URL } from "../config";

interface VideoActivityTrackerOptions {
  sessionId: number;
  stageIndex: number;
  heartbeatInterval?: number; // ms, default 30000
  enabled?: boolean;
}

export function useVideoActivityTracker({
  sessionId,
  stageIndex,
  heartbeatInterval = 30_000,
  enabled = true,
}: VideoActivityTrackerOptions) {
  const isPlayingRef = useRef(false);
  const videoTimeRef = useRef(0);
  const heartbeatIntervalRef = useRef<number | null>(null);

  const sendHeartbeat = useCallback(async () => {
    if (!enabled || !isPlayingRef.current) return;

    try {
      await fetch(`${API_URL}/api/lesson-sessions/${sessionId}/heartbeat`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage_index: stageIndex,
          stage_type: "video",
          video_time: Math.floor(videoTimeRef.current),
        }),
      });
    } catch (error) {
      console.debug("Video heartbeat failed:", error);
    }
  }, [sessionId, stageIndex, enabled]);

  useEffect(() => {
    if (!enabled) return;

    heartbeatIntervalRef.current = window.setInterval(() => {
      if (isPlayingRef.current) {
        sendHeartbeat();
      }
    }, heartbeatInterval);

    return () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
    };
  }, [enabled, sendHeartbeat, heartbeatInterval]);

  const onPlay = useCallback(() => {
    isPlayingRef.current = true;
    sendHeartbeat(); // Immediate heartbeat on play
  }, [sendHeartbeat]);

  const onPause = useCallback(() => {
    isPlayingRef.current = false;
  }, []);

  const onTimeUpdate = useCallback((currentTime: number) => {
    videoTimeRef.current = currentTime;
  }, []);

  return { onPlay, onPause, onTimeUpdate };
}
