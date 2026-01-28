import { useEffect, useRef, useCallback } from "react";
import { API_URL } from "../config";
import { updateTimeSpent } from "../api/progress";
import { getAnonymousToken } from "./useAnonymousToken";

interface ActivityTrackerOptions {
  // New progress API options
  contentId?: string;
  isAuthenticated?: boolean;

  inactivityTimeout?: number; // ms, default 180000 (3 min)
  heartbeatInterval?: number; // ms, default 60000 (60 sec)
  enabled?: boolean;
}

export function useActivityTracker({
  contentId,
  isAuthenticated = false,
  inactivityTimeout = 180_000,
  heartbeatInterval = 60_000, // Changed from 30s to 60s
  enabled = true,
}: ActivityTrackerOptions) {
  const isActiveRef = useRef(false);
  // Initialize to null, set on first activity to avoid impure Date.now() during render
  const lastActivityRef = useRef<number | null>(null);
  const heartbeatIntervalRef = useRef<number | null>(null);
  // Track accumulated time for progress API
  const lastHeartbeatTimeRef = useRef<number | null>(null);

  // Heartbeat for UUID-based progress API
  const sendProgressHeartbeat = useCallback(async () => {
    if (!enabled || !contentId) return;

    const now = Date.now();
    const lastTime = lastHeartbeatTimeRef.current;

    // Calculate time delta since last heartbeat
    const timeDeltaS = lastTime ? Math.floor((now - lastTime) / 1000) : 0;
    lastHeartbeatTimeRef.current = now;

    // Only send if we have actual time to report
    if (timeDeltaS <= 0) return;

    try {
      await updateTimeSpent(contentId, timeDeltaS, isAuthenticated);
    } catch (error) {
      // Fire-and-forget, ignore errors
      console.debug("Progress heartbeat failed:", error);
    }
  }, [contentId, isAuthenticated, enabled]);

  const sendHeartbeat = useCallback(async () => {
    if (!enabled || !contentId) return;
    await sendProgressHeartbeat();
  }, [enabled, contentId, sendProgressHeartbeat]);

  const handleActivity = useCallback(() => {
    lastActivityRef.current = Date.now();

    // Initialize heartbeat time on first activity
    if (lastHeartbeatTimeRef.current === null) {
      lastHeartbeatTimeRef.current = Date.now();
    }

    if (!isActiveRef.current) {
      isActiveRef.current = true;
      // Send immediate heartbeat when becoming active
      sendHeartbeat();
    }
  }, [sendHeartbeat]);

  const handleScroll = useCallback(() => {
    handleActivity();
  }, [handleActivity]);

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

    // sendBeacon on page unload for reliable time tracking
    const handleBeforeUnload = () => {
      if (!contentId || !isActiveRef.current) return;

      const now = Date.now();
      const lastTime = lastHeartbeatTimeRef.current;
      const timeDeltaS = lastTime ? Math.floor((now - lastTime) / 1000) : 0;

      if (timeDeltaS <= 0) return;

      // Use sendBeacon for reliable delivery on page unload
      const payload = JSON.stringify({
        content_id: contentId,
        time_delta_s: timeDeltaS,
      });

      // Build URL with session token for anonymous users
      const url = `${API_URL}/api/progress/time`;

      // sendBeacon sends as text/plain by default, but our endpoint handles raw JSON
      // For authenticated users, cookies are sent automatically
      // For anonymous users, we need to append the token as a query param since
      // sendBeacon doesn't support custom headers
      if (!isAuthenticated) {
        const token = getAnonymousToken();
        navigator.sendBeacon(`${url}?anonymous_token=${token}`, payload);
      } else {
        navigator.sendBeacon(url, payload);
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, handleActivity);
      });
      window.removeEventListener("scroll", handleScroll);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("beforeunload", handleBeforeUnload);

      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
    };
  }, [
    enabled,
    contentId,
    isAuthenticated,
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
