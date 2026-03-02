/**
 * API client for roleplay REST endpoints.
 *
 * Follows the same patterns as modules.ts -- uses fetchWithRefresh,
 * getAnonymousToken, API_URL, credentials: "include".
 *
 * Note: Roleplay chat streaming now uses the unified WebSocket at
 * /ws/chat/roleplay (see useUnifiedRoleplay hook). This file only
 * contains REST endpoints for history, complete, and retry.
 */

import { fetchWithRefresh } from "./fetchWithRefresh";
import { getAnonymousToken } from "../hooks/useAnonymousToken";
import { API_URL } from "../config";

const API_BASE = API_URL;

/**
 * Fetch existing roleplay session history.
 *
 * Returns the session ID, message history, and completion state.
 */
export async function getRoleplayHistory(
  moduleSlug: string,
  roleplayId: string,
): Promise<{
  sessionId: number;
  messages: Array<{ role: string; content: string }>;
  completedAt: string | null;
}> {
  const res = await fetchWithRefresh(
    `${API_BASE}/api/chat/roleplay/${roleplayId}/history?module_slug=${encodeURIComponent(moduleSlug)}`,
    {
      credentials: "include",
      headers: { "X-Anonymous-Token": getAnonymousToken() },
    },
  );

  if (!res.ok) {
    if (res.status === 401) {
      return { sessionId: 0, messages: [], completedAt: null };
    }
    throw new Error("Failed to fetch roleplay history");
  }

  return res.json();
}

/**
 * Mark a roleplay session as complete.
 */
export async function completeRoleplay(sessionId: number): Promise<void> {
  const res = await fetchWithRefresh(
    `${API_BASE}/api/chat/roleplay/${sessionId}/complete`,
    {
      method: "POST",
      credentials: "include",
      headers: { "X-Anonymous-Token": getAnonymousToken() },
    },
  );

  if (!res.ok) throw new Error("Failed to complete roleplay session");
}

/**
 * Archive the current session and create a fresh one.
 *
 * Returns the new session ID.
 */
/**
 * Fetch the assessment result for a completed roleplay session.
 *
 * Returns null if no assessment exists yet (404).
 */
export async function getRoleplayAssessment(
  sessionId: number,
): Promise<{
  score_data: {
    overall_score: number;
    reasoning: string;
    dimensions?: Array<{ name: string; score: number; note?: string }>;
    key_observations?: string[];
  };
  model_id: string | null;
  created_at: string;
} | null> {
  const res = await fetchWithRefresh(
    `${API_BASE}/api/chat/roleplay/${sessionId}/assessment`,
    {
      credentials: "include",
      headers: { "X-Anonymous-Token": getAnonymousToken() },
    },
  );

  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Failed to fetch assessment");
  return res.json();
}

/**
 * Archive the current session and create a fresh one.
 *
 * Returns the new session ID.
 */
export async function retryRoleplay(
  sessionId: number,
  openingMessage?: string,
): Promise<{ sessionId: number }> {
  const res = await fetchWithRefresh(
    `${API_BASE}/api/chat/roleplay/${sessionId}/retry`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Anonymous-Token": getAnonymousToken(),
      },
      credentials: "include",
      body: JSON.stringify({
        opening_message: openingMessage,
      }),
    },
  );

  if (!res.ok) throw new Error("Failed to retry roleplay session");

  return res.json();
}
