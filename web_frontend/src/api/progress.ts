/**
 * API client for progress tracking endpoints.
 */

import { API_URL } from "../config";
import { getAnonymousToken } from "../hooks/useAnonymousToken";
import type { LensProgress } from "./modules";

const API_BASE = API_URL;

interface AuthHeaders {
  Authorization?: string;
  "X-Anonymous-Token"?: string;
}

function getAuthHeaders(isAuthenticated: boolean): AuthHeaders {
  if (isAuthenticated) {
    // JWT is sent via credentials: include
    return {};
  }
  return { "X-Anonymous-Token": getAnonymousToken() };
}

export interface MarkCompleteRequest {
  content_id: string;
  content_type: "module" | "lo" | "lens" | "test";
  content_title: string;
  time_spent_s?: number;
  module_slug?: string; // If provided, response includes full module state
}

export interface MarkCompleteResponse {
  completed_at: string;
  module_status?: "not_started" | "in_progress" | "completed";
  module_progress?: { completed: number; total: number };
  lenses?: LensProgress[]; // Full lens array if module_slug was provided
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
