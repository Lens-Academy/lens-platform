/**
 * Manages anonymous token for progress tracking.
 *
 * The token is a UUID stored in localStorage, sent as X-Anonymous-Token header.
 * On login, call claimSessionRecords() to associate anonymous progress with user.
 */

import { useState, useEffect, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";

const ANONYMOUS_TOKEN_KEY = "anonymous_token";

export function useAnonymousToken() {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    // Get or create anonymous token
    let stored = localStorage.getItem(ANONYMOUS_TOKEN_KEY);
    if (!stored) {
      stored = uuidv4();
      localStorage.setItem(ANONYMOUS_TOKEN_KEY, stored);
    }
    setToken(stored);
  }, []);

  const clearToken = useCallback(() => {
    localStorage.removeItem(ANONYMOUS_TOKEN_KEY);
    setToken(null);
  }, []);

  return { token, clearToken };
}

/**
 * Get anonymous token synchronously (for use in API calls).
 */
export function getAnonymousToken(): string {
  let token = localStorage.getItem(ANONYMOUS_TOKEN_KEY);
  if (!token) {
    token = uuidv4();
    localStorage.setItem(ANONYMOUS_TOKEN_KEY, token);
  }
  return token;
}
