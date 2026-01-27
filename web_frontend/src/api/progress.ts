/**
 * API client for progress tracking endpoints.
 */

import { API_URL } from "../config";
import { getSessionToken } from "../hooks/useSessionToken";

const API_BASE = API_URL;

interface AuthHeaders {
  Authorization?: string;
  "X-Session-Token"?: string;
}

function getAuthHeaders(isAuthenticated: boolean): AuthHeaders {
  if (isAuthenticated) {
    // JWT is sent via credentials: include
    return {};
  }
  return { "X-Session-Token": getSessionToken() };
}

export interface MarkCompleteRequest {
  content_id: string;
  content_type: "module" | "lo" | "lens" | "test";
  content_title: string;
  time_spent_s?: number;
}

export interface MarkCompleteResponse {
  completed_at: string;
  module_status?: string;
  module_progress?: { completed: number; total: number };
}

export async function markComplete(
  request: MarkCompleteRequest,
  isAuthenticated: boolean,
): Promise<MarkCompleteResponse> {
  const res = await fetch(`${API_BASE}/api/progress/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(isAuthenticated),
    },
    credentials: "include",
    body: JSON.stringify(request),
  });

  if (!res.ok) {
    throw new Error("Failed to mark complete");
  }

  return res.json();
}

export async function updateTimeSpent(
  contentId: string,
  timeDeltaS: number,
  isAuthenticated: boolean,
): Promise<void> {
  await fetch(`${API_BASE}/api/progress/time`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(isAuthenticated),
    },
    credentials: "include",
    body: JSON.stringify({
      content_id: contentId,
      time_delta_s: timeDeltaS,
    }),
  });
  // Fire and forget - don't throw on error
}

export async function claimSessionRecords(
  sessionToken: string,
): Promise<{ progress_records_claimed: number; chat_sessions_claimed: number }> {
  const res = await fetch(`${API_BASE}/api/progress/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ session_token: sessionToken }),
  });

  if (!res.ok) {
    throw new Error("Failed to claim records");
  }

  return res.json();
}
