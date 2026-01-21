import { useEffect, useRef, useCallback } from "react";
import { API_URL } from "../config";

interface ActivityTrackerOptions {
  sessionId: number;
  stageIndex: number;
  stageType: "article" | "video" | "chat";
  inactivityTimeout?: number; // ms, default 180000 (3 min)
  heartbeatInterval?: number; // ms, default 30000 (30 sec)
  enabled?: boolean;
}

export function useActivityTracker({
  sessionId,
  stageIndex,
  stageType,
  inactivityTimeout = 180_000,
  heartbeatInterval = 30_000,
  enabled = true,
}: ActivityTrackerOptions) {
  const isActiveRef = useRef(false);
  // Initialize to null, set on first activity to avoid impure Date.now() during render
  const lastActivityRef = useRef<number | null>(null);
  const heartbeatIntervalRef = useRef<number | null>(null);
  const scrollDepthRef = useRef(0);

  const sendHeartbeat = useCallback(async () => {
    if (!enabled) return;

    try {
      await fetch(`${API_URL}/api/module-sessions/${sessionId}/heartbeat`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage_index: stageIndex,
          stage_type: stageType,
          scroll_depth: stageType === "article" ? scrollDepthRef.current : null,
        }),
      });
    } catch (error) {
      // Fire-and-forget, ignore errors
      console.debug("Heartbeat failed:", error);
    }
  }, [sessionId, stageIndex, stageType, enabled]);

  const handleActivity = useCallback(() => {
    lastActivityRef.current = Date.now();

    if (!isActiveRef.current) {
      isActiveRef.current = true;
      // Send immediate heartbeat when becoming active
      sendHeartbeat();
    }
  }, [sendHeartbeat]);

  const handleScroll = useCallback(() => {
    handleActivity();

    // Track scroll depth for articles
    if (stageType === "article") {
      const scrollTop = window.scrollY;
      const docHeight =
        document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight > 0) {
        scrollDepthRef.current = Math.min(1, scrollTop / docHeight);
      }
    }
  }, [handleActivity, stageType]);

  useEffect(() => {
    if (!enabled) return;

    // Activity listeners
    const events = ["scroll", "mousemove", "keydown"];
    events.forEach((event) => {
      window.addEventListener(event, handleActivity, { passive: true });
    });
    window.addEventListener("scroll", handleScroll, { passive: true });

    // Visibility change
    const handleVisibility = () => {
      if (document.hidden) {
        isActiveRef.current = false;
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    // Heartbeat interval
    heartbeatIntervalRef.current = window.setInterval(() => {
      // If no activity recorded yet, don't mark as inactive
      if (lastActivityRef.current === null) return;

      const timeSinceActivity = Date.now() - lastActivityRef.current;

      if (timeSinceActivity > inactivityTimeout) {
        isActiveRef.current = false;
      }

      if (isActiveRef.current) {
        sendHeartbeat();
      }
    }, heartbeatInterval);

    // Initial activity
    handleActivity();

    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, handleActivity);
      });
      window.removeEventListener("scroll", handleScroll);
      document.removeEventListener("visibilitychange", handleVisibility);

      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
    };
  }, [
    enabled,
    handleActivity,
    handleScroll,
    sendHeartbeat,
    heartbeatInterval,
    inactivityTimeout,
  ]);

  // Manual activity trigger (for video play events)
  const triggerActivity = useCallback(() => {
    handleActivity();
  }, [handleActivity]);

  return { triggerActivity };
}
