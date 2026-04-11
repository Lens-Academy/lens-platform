/**
 * Fetch wrapper that transparently handles 401 → refresh → retry.
 *
 * When any API call returns 401 (expired JWT), this automatically
 * calls POST /auth/refresh to rotate the refresh token and get a
 * new JWT, then retries the original request.
 *
 * Deduplication: if multiple calls 401 simultaneously, only one
 * refresh request fires. Others wait for it.
 */

import { API_URL } from "../config";

let refreshPromise: Promise<boolean> | null = null;

async function attemptRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchWithRefresh(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status !== 401) return response;

  // Deduplicate: if refresh already in flight, wait for it
  if (!refreshPromise) {
    refreshPromise = attemptRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  const refreshed = await refreshPromise;
  if (!refreshed) return response; // truly logged out

  // Retry original request with new cookie
  return fetch(input, init);
}
