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
  type?: string; // "chat" or "assessment"
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
  baseSystemPrompt?: string;
  sections: FixtureSection[];
}

// --- Assessment types ---

export interface AssessmentItem {
  label: string;
  question: string;
  answer: string;
}

export interface AssessmentSection {
  name: string;
  instructions: string;
  items: AssessmentItem[];
}

export interface AssessmentFixture {
  name: string;
  module: string;
  type: "assessment";
  description: string;
  baseSystemPrompt: string;
  sections: AssessmentSection[];
}

export interface ScoreDimension {
  name: string;
  score: number;
  note?: string;
}

export interface ScoreResult {
  overall_score: number;
  reasoning: string;
  dimensions?: ScoreDimension[];
  key_observations?: string[];
}

export function isAssessmentFixture(
  f: Fixture | AssessmentFixture,
): f is AssessmentFixture {
  return (f as AssessmentFixture).type === "assessment";
}

export interface StreamEvent {
  type: "text" | "thinking" | "done" | "error" | "tool_use";
  content?: string;
  message?: string;
  // tool_use-only fields:
  name?: string;
  state?: "calling" | "result" | "error";
  arguments?: Record<string, unknown>;
  result?: string;
}

export interface ModelChoice {
  id: string;
  label: string;
}

export interface PromptLabConfig {
  models: ModelChoice[];
  defaultModel: string;
  defaultBasePrompt: string;
}

// --- Functions ---

const API_BASE = API_URL;

/**
 * Fetch facilitator configuration: model list + the production tutor's
 * default base prompt (for prepopulating the live-tutor editor).
 */
export async function getConfig(): Promise<PromptLabConfig> {
  const res = await fetchWithRefresh(`${API_BASE}/api/promptlab/config`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch promptlab config");
  return res.json();
}

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

export interface TutorTurnRequest {
  moduleSlug: string;
  sectionIndex?: number;
  segmentIndex?: number;
  courseSlug?: string | null;
  messages: FixtureMessage[];
  basePromptOverride?: string | null;
  enableTools?: boolean;
  enableThinking?: boolean;
  effort?: string;
  enableCourseOverview?: boolean;
  model?: string | null;
}

/**
 * Run a tutor turn via the live-tutor endpoint — mirrors the production
 * tutor pipeline (course overview, tools, stage context) without DB writes.
 */
export async function* runTutorTurn(
  req: TutorTurnRequest,
): AsyncGenerator<StreamEvent> {
  const res = await fetchWithRefresh(`${API_BASE}/api/promptlab/tutor-turn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(req),
  });

  if (!res.ok) throw new Error("Failed to run tutor turn");

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        yield JSON.parse(line.slice(6)) as StreamEvent;
      } catch {
        // Skip invalid JSON
      }
    }
  }
}

/**
 * Score a student answer using the assessment prompt.
 * Regular fetch (not SSE) — scoring uses non-streaming complete().
 */
export async function scoreAnswer(
  baseSystemPrompt: string,
  assessmentInstructions: string,
  questionText: string,
  answerText: string,
  model?: string,
): Promise<ScoreResult> {
  const body: Record<string, unknown> = {
    baseSystemPrompt,
    assessmentInstructions,
    questionText,
    answerText,
  };
  if (model) body.model = model;

  const res = await fetchWithRefresh(`${API_BASE}/api/promptlab/score`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error("Failed to score answer");
  return res.json();
}
