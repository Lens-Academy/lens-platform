"use client";

// web_frontend/src/hooks/useAnonymousSession.ts
import { useCallback } from "react";

const SESSION_KEY_PREFIX = "module_session_";

export function useAnonymousSession(moduleId: string) {
  const storageKey = `${SESSION_KEY_PREFIX}${moduleId}`;

  const getStoredSessionId = useCallback((): number | null => {
    const stored = localStorage.getItem(storageKey);
    if (!stored) return null;
    const parsed = parseInt(stored, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }, [storageKey]);

  const storeSessionId = useCallback(
    (sessionId: number) => {
      localStorage.setItem(storageKey, sessionId.toString());
    },
    [storageKey]
  );

  const clearSessionId = useCallback(() => {
    localStorage.removeItem(storageKey);
  }, [storageKey]);

  return {
    getStoredSessionId,
    storeSessionId,
    clearSessionId,
  };
}
