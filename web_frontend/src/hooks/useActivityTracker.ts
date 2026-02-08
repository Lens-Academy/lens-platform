import { useEffect, useRef, useCallback } from "react";
import { API_URL } from "../config";
import { sendHeartbeatPing } from "../api/progress";
import { getAnonymousToken } from "./useAnonymousToken";

interface ActivityTrackerOptions {
  contentId?: string;
  loId?: string | null;
  moduleId?: string | null;
  isAuthenticated?: boolean;
  contentTitle?: string;
  moduleTitle?: string;
  loTitle?: string;

  inactivityTimeout?: number; // ms, default 180000 (3 min)
  heartbeatInterval?: number; // ms, default 20000 (20 sec)
  enabled?: boolean;
}

export function useActivityTracker({
  contentId,
  loId,
  moduleId,
  isAuthenticated = false,
  contentTitle,
  moduleTitle,
  loTitle,
  inactivityTimeout = 180_000,
  heartbeatInterval = 20_000,
  enabled = true,
}: ActivityTrackerOptions) {
  const isActiveRef = useRef(false);
  const lastActivityRef = useRef<number | null>(null);
  const heartbeatIntervalRef = useRef<number | null>(null);

  // Build sendBeacon payload (no time_delta_s — server computes time)
  const buildBeaconPayload = useCallback(() => {
    if (!contentId) return null;
    return JSON.stringify({
      content_id: contentId,
      ...(loId ? { lo_id: loId } : {}),
      ...(moduleId ? { module_id: moduleId } : {}),
      ...(contentTitle ? { content_title: contentTitle } : {}),
      ...(moduleTitle ? { module_title: moduleTitle } : {}),
      ...(loTitle ? { lo_title: loTitle } : {}),
    });
  }, [contentId, loId, moduleId, contentTitle, moduleTitle, loTitle]);

  // Fire a sendBeacon ping (for visibility hidden + cleanup)
  const sendBeacon = useCallback(() => {
    if (!contentId || !isActiveRef.current) return;
    const payload = buildBeaconPayload();
    if (!payload) return;

    const url = `${API_URL}/api/progress/time`;
    if (!isAuthenticated) {
      const token = getAnonymousToken();
      navigator.sendBeacon(`${url}?anonymous_token=${token}`, payload);
    } else {
      navigator.sendBeacon(url, payload);
    }
  }, [contentId, isAuthenticated, buildBeaconPayload]);

  // Heartbeat: just ping the server, no time computation
  const sendHeartbeat = useCallback(async () => {
    if (!enabled || !contentId) return;
    try {
      await sendHeartbeatPing(
        contentId,
        isAuthenticated,
        loId,
        moduleId,
        contentTitle,
        moduleTitle,
        loTitle,
      );
    } catch (error) {
      console.debug("Progress heartbeat failed:", error);
    }
  }, [
    contentId,
    loId,
    moduleId,
    isAuthenticated,
    enabled,
    contentTitle,
    moduleTitle,
    loTitle,
  ]);

  const handleActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    isActiveRef.current = true;
  }, []);

  useEffect(() => {
    if (!enabled) return;

    // Activity listeners
    const events = ["scroll", "mousemove", "keydown"];
    events.forEach((event) => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    // Visibility change — flush beacon when tab is hidden
    const handleVisibility = () => {
      if (document.hidden) {
        sendBeacon();
        isActiveRef.current = false;
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    // Heartbeat interval
    heartbeatIntervalRef.current = window.setInterval(() => {
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

    // Send initial heartbeat to establish last_heartbeat_at on the server
    sendHeartbeat();

    // sendBeacon on page unload
    const handleBeforeUnload = () => {
      sendBeacon();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      // Flush a final beacon on cleanup (e.g., section switch)
      sendBeacon();

      events.forEach((event) => {
        window.removeEventListener(event, handleActivity);
      });
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("beforeunload", handleBeforeUnload);

      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
    };
  }, [
    enabled,
    contentId,
    loId,
    moduleId,
    isAuthenticated,
    handleActivity,
    sendHeartbeat,
    sendBeacon,
    heartbeatInterval,
    inactivityTimeout,
  ]);

  // Manual activity trigger (for video play events, chat streaming)
  const triggerActivity = useCallback(() => {
    handleActivity();
  }, [handleActivity]);

  return { triggerActivity };
}
