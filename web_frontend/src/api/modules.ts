/**
 * API client for module endpoints.
 */

import type { Module } from "../types/module";
import type { CourseProgress } from "../types/course";
import { Sentry } from "../errorTracking";
import { getAnonymousToken } from "../hooks/useAnonymousToken";
import { fetchWithRefresh } from "./fetchWithRefresh";

import { API_URL } from "../config";

export interface LensProgress {
  id: string | null;
  title: string;
  type: string;
  optional: boolean;
  completed: boolean;
  completedAt: string | null;
  timeSpentS: number;
}

export interface ModuleProgressResponse {
  module: { id: string | null; slug: string; title: string };
  status: "not_started" | "in_progress" | "completed";
  progress: { completed: number; total: number };
  lenses: LensProgress[];
  chatSession: { sessionId: number; hasMessages: boolean };
}

const API_BASE = API_URL;

// If a request is still pending after this long, warn the user (but keep waiting).
const DEFAULT_SLOW_WARNING_MS = 10000;

/**
 * Fetch with slow-request warning.
 * Does NOT abort: slow networks should still load eventually. Instead, after
 * `slowWarningMs`, reports to Sentry and dispatches `api:slow-request` /
 * `api:request-settled` window events for UI to surface a banner.
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  slowWarningMs: number = DEFAULT_SLOW_WARNING_MS,
): Promise<Response> {
  const startTime = Date.now();
  let warned = false;

  const warningId = setTimeout(() => {
    warned = true;
    console.warn(`[API] Slow request after ${slowWarningMs}ms:`, url);

    const slowError = new Error(
      `Request still pending after ${slowWarningMs / 1000}s`,
    );
    slowError.name = "SlowRequestWarning";
    Sentry.captureException(slowError, {
      tags: {
        error_type: "slow_request",
        endpoint: new URL(url, window.location.origin).pathname,
      },
      extra: { url, slowWarningMs },
    });

    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("api:slow-request", { detail: { url } }),
      );
    }
  }, slowWarningMs);

  try {
    return await fetchWithRefresh(url, options);
  } finally {
    clearTimeout(warningId);
    if (warned && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("api:request-settled", {
          detail: { url, elapsed: Date.now() - startTime },
        }),
      );
    }
  }
}

export async function listModules(): Promise<
  { slug: string; title: string }[]
> {
  const res = await fetchWithTimeout(`${API_BASE}/api/modules`);
  if (!res.ok) throw new Error("Failed to fetch modules");
  const data = await res.json();
  return data.modules;
}

export async function getModule(moduleSlug: string): Promise<Module> {
  const res = await fetchWithTimeout(`${API_BASE}/api/modules/${moduleSlug}`);
  if (!res.ok) throw new Error("Failed to fetch module");
  return res.json();
}

/**
 * Send a chat message and stream the response.
 *
 * Uses the /api/chat/module endpoint with position-based context.
 * Backend owns chat history; we just send position and message.
 */
export async function* sendMessage(
  slug: string,
  sectionIndex: number,
  segmentIndex: number,
  message: string,
  courseSlug?: string,
): AsyncGenerator<{ type: string; content?: string; name?: string }> {
  const res = await fetchWithRefresh(`${API_BASE}/api/chat/module`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Anonymous-Token": getAnonymousToken(),
    },
    credentials: "include",
    body: JSON.stringify({
      slug,
      sectionIndex,
      segmentIndex,
      message,
      ...(courseSlug && { courseSlug }),
    }),
  });

  if (!res.ok) throw new Error("Failed to send message");

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data: ")) continue;
      try {
        yield JSON.parse(line.slice(6));
      } catch {
        // Skip invalid JSON
      }
    }
  }
}

/**
 * Fetch chat history for a module.
 */
export async function getChatHistory(slug: string): Promise<{
  sessionId: number;
  messages: Array<{ role: string; content: string; sectionIndex?: number }>;
}> {
  const res = await fetchWithTimeout(
    `${API_BASE}/api/chat/module/${slug}/history`,
    {
      credentials: "include",
      headers: { "X-Anonymous-Token": getAnonymousToken() },
    },
  );
  if (!res.ok) {
    if (res.status === 401) {
      return { sessionId: 0, messages: [] };
    }
    throw new Error("Failed to fetch chat history");
  }
  return res.json();
}

interface NextModuleResponse {
  nextModuleSlug: string;
  nextModuleTitle: string;
}

interface CompletedUnitResponse {
  completedUnit: number;
}

export type ModuleCompletionResult =
  | { type: "next_module"; slug: string; title: string }
  | { type: "unit_complete"; unitNumber: number }
  | null;

export async function getNextModule(
  courseSlug: string,
  currentModuleSlug: string,
): Promise<ModuleCompletionResult> {
  const res = await fetchWithTimeout(
    `${API_BASE}/api/courses/${courseSlug}/next-module?current=${currentModuleSlug}`,
  );
  if (!res.ok) throw new Error("Failed to fetch next module");
  // 204 No Content means end of course
  if (res.status === 204) return null;

  const data: NextModuleResponse | CompletedUnitResponse = await res.json();

  if ("completedUnit" in data) {
    return { type: "unit_complete", unitNumber: data.completedUnit };
  }

  return {
    type: "next_module",
    slug: data.nextModuleSlug,
    title: data.nextModuleTitle,
  };
}

export async function transcribeAudio(audioBlob: Blob): Promise<string> {
  const formData = new FormData();
  formData.append("audio", audioBlob, "recording.webm");

  // Transcription can take a while, use longer timeout
  const res = await fetchWithTimeout(
    `${API_BASE}/api/transcribe`,
    {
      method: "POST",
      body: formData,
    },
    30000, // 30 seconds for audio transcription
  );

  if (!res.ok) {
    if (res.status === 413) throw new Error("Recording too large");
    if (res.status === 429)
      throw new Error("Too many requests, try again shortly");
    throw new Error("Transcription failed");
  }

  const data = await res.json();
  return data.text;
}

export async function getCourseProgress(
  courseSlug: string,
): Promise<CourseProgress> {
  const res = await fetchWithTimeout(
    `${API_BASE}/api/courses/${courseSlug}/progress`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error("Failed to fetch course progress");
  return res.json();
}

export async function getModuleProgress(
  moduleSlug: string,
): Promise<ModuleProgressResponse | null> {
  const res = await fetchWithTimeout(
    `${API_BASE}/api/modules/${moduleSlug}/progress`,
    {
      credentials: "include",
      headers: { "X-Anonymous-Token": getAnonymousToken() },
    },
  );
  if (!res.ok) {
    if (res.status === 401) {
      return null;
    }
    throw new Error("Failed to fetch module progress");
  }
  return res.json();
}
