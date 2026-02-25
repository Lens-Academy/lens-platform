/**
 * API client for roleplay chat endpoints.
 *
 * Follows the same patterns as modules.ts -- uses fetchWithRefresh,
 * getAnonymousToken, API_URL, credentials: "include".
 */

import { fetchWithRefresh } from "./fetchWithRefresh";
import { getAnonymousToken } from "../hooks/useAnonymousToken";
import { API_URL } from "../config";

const API_BASE = API_URL;

/**
 * Send a roleplay chat message and stream the response via SSE.
 *
 * Uses the /api/chat/roleplay endpoint. The SSE stream yields events
 * with type "text" (content chunks), "done" (stream complete), or
 * "error" (something went wrong).
 */
export async function* sendRoleplayMessage(params: {
  moduleSlug: string;
  roleplayId: string;
  message: string;
  aiInstructions: string;
  scenarioContent?: string;
  openingMessage?: string;
}): AsyncGenerator<{ type: string; content?: string; message?: string }> {
  const res = await fetchWithRefresh(`${API_BASE}/api/chat/roleplay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Anonymous-Token": getAnonymousToken(),
    },
    credentials: "include",
    body: JSON.stringify({
      module_slug: params.moduleSlug,
      roleplay_id: params.roleplayId,
      message: params.message,
      ai_instructions: params.aiInstructions,
      scenario_content: params.scenarioContent,
      opening_message: params.openingMessage,
    }),
  });

  if (!res.ok) throw new Error("Failed to send roleplay message");

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split("\n");

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const data = JSON.parse(line.slice(6));
        yield data;
      } catch {
        // Skip invalid JSON
      }
    }
  }
}

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
