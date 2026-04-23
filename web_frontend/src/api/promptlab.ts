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
 * Tutor-turn request: one tutor turn through the production pipeline, minus DB.
 * `scenarioSource` discriminates between a live-module source and a fixture source.
 * Both paths flow through the same backend code (`build_scenario_turn` → `send_module_message`).
 * Override fields skip their respective assembly steps on the server when set.
 */
export interface TutorTurnRequest {
  scenarioSource?: "live_module" | "fixture";

  // live_module source
  moduleSlug?: string | null;
  sectionIndex?: number;
  segmentIndex?: number;
  courseSlug?: string | null;

  // fixture source
  fixtureKey?: string | null;
  fixtureSectionIndex?: number;

  // shared
  messages: FixtureMessage[];
  basePromptOverride?: string | null;
  systemPromptOverride?: string | null;
  instructionsOverride?: string | null;
  contentContextOverride?: string | null;
  courseOverviewOverride?: string | null;
  llmMessagesOverride?: FixtureMessage[] | null;
  enableTools?: boolean;
  enableThinking?: boolean;
  effort?: string;
  enableCourseOverview?: boolean;
  model?: string | null;
}

/** Inspector payload: what the LLM would see for a given request, without invoking it. */
export interface InspectResponse {
  scenario: {
    llm_messages: FixtureMessage[];
    stage: Record<string, unknown>;
    current_content: string | null;
    course_overview: string | null;
    instructions: string;
    section_title: string | null;
    system_messages_to_persist: string[];
  };
  system_prompt: string;
  llm_messages: FixtureMessage[];
  llm_kwargs: {
    model: string;
    thinking?: Record<string, unknown> | null;
    output_config?: Record<string, unknown> | null;
    max_tokens: number;
  };
  provenance: Record<string, string>;
}

/**
 * Run a tutor turn via the tutor-turn endpoint — mirrors the production
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
 * Inspect what the tutor-turn endpoint would send to the LLM — same input
 * shape as runTutorTurn, but returns the assembled system prompt, messages,
 * and kwargs without invoking the LLM.
 */
export async function inspect(req: TutorTurnRequest): Promise<InspectResponse> {
  const res = await fetchWithRefresh(`${API_BASE}/api/promptlab/inspect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    // Try to surface the backend's HTTPException detail (e.g. "Module not
    // found") so the Inspector shows something actionable. Fall back to
    // the status code + URL if parsing fails.
    let detail: string;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body);
    } catch {
      detail = `${res.status} ${res.statusText}`;
    }
    throw new Error(detail);
  }
  return res.json();
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
