/**
 * API client for Prompt Lab endpoints.
 */

import { API_URL } from "../config";
import { fetchWithRefresh } from "./fetchWithRefresh";

// --- Types ---

export interface FixtureSummary {
  name: string;
  module: string;
  description: string;
}

export interface FixtureMessage {
  role: "user" | "assistant";
  content: string;
}

export interface FixtureConversation {
  label: string;
  messages: FixtureMessage[];
}

export interface FixtureSection {
  name: string;
  instructions: string;
  context: string;
  conversations: FixtureConversation[];
}

export interface Fixture {
  name: string;
  module: string;
  description: string;
  sections: FixtureSection[];
}

export interface StreamEvent {
  type: "text" | "thinking" | "done" | "error";
  content?: string;
  message?: string;
}

// --- Functions ---

const API_BASE = API_URL;

/**
 * List all available fixtures.
 */
export async function listFixtures(): Promise<FixtureSummary[]> {
  const res = await fetchWithRefresh(`${API_BASE}/api/promptlab/fixtures`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch fixtures");
  const data = await res.json();
  return data.fixtures;
}

/**
 * Load a single fixture by name.
 */
export async function loadFixture(name: string): Promise<Fixture> {
  const res = await fetchWithRefresh(
    `${API_BASE}/api/promptlab/fixtures/${encodeURIComponent(name)}`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error("Failed to load fixture");
  return res.json();
}

/**
 * Regenerate an assistant response via SSE streaming.
 */
export async function* regenerateResponse(
  messages: FixtureMessage[],
  baseSystemPrompt: string,
  instructions: string,
  context: string,
  enableThinking: boolean,
  effort?: string,
  model?: string,
): AsyncGenerator<StreamEvent> {
  const body: Record<string, unknown> = {
    messages,
    baseSystemPrompt,
    instructions,
    context,
    enableThinking,
  };
  if (effort) body.effort = effort;
  if (model) body.model = model;

  const res = await fetchWithRefresh(`${API_BASE}/api/promptlab/regenerate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error("Failed to regenerate response");

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
 * Continue a conversation via SSE streaming.
 */
export async function* continueConversation(
  messages: FixtureMessage[],
  baseSystemPrompt: string,
  instructions: string,
  context: string,
  enableThinking: boolean,
  effort?: string,
  model?: string,
): AsyncGenerator<StreamEvent> {
  const body: Record<string, unknown> = {
    messages,
    baseSystemPrompt,
    instructions,
    context,
    enableThinking,
  };
  if (effort) body.effort = effort;
  if (model) body.model = model;

  const res = await fetchWithRefresh(`${API_BASE}/api/promptlab/continue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error("Failed to continue conversation");

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
