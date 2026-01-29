/**
 * API client for module endpoints.
 */

import type { Module } from "../types/module";
import type { CourseProgress } from "../types/course";
import { Sentry } from "../errorTracking";
import { getAnonymousToken } from "../hooks/useAnonymousToken";

import { API_URL } from "../config";

const API_BASE = API_URL;

// Default timeout for API requests (in milliseconds)
const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Custom error class for request timeouts.
 * Distinguishes timeouts from other network errors.
 */
export class RequestTimeoutError extends Error {
  public readonly url: string;
  public readonly timeoutMs: number;

  constructor(url: string, timeoutMs: number) {
    super(`Request timed out after ${timeoutMs / 1000}s`);
    this.name = "RequestTimeoutError";
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Fetch with timeout and error tracking.
 * - Aborts request after timeout
 * - Logs timeout to console
 * - Captures timeout in Sentry with context
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const startTime = Date.now();

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    const elapsed = Date.now() - startTime;

    if (error instanceof Error && error.name === "AbortError") {
      // Request was aborted due to timeout
      const timeoutError = new RequestTimeoutError(url, timeoutMs);

      console.error(`[API] Request timeout after ${elapsed}ms:`, url, {
        timeoutMs,
        elapsed,
      });

      // Capture in Sentry with context
      Sentry.captureException(timeoutError, {
        tags: {
          error_type: "request_timeout",
          endpoint: new URL(url, window.location.origin).pathname,
        },
        extra: {
          url,
          timeoutMs,
          elapsed,
        },
      });

      throw timeoutError;
    }

    // Re-throw other errors (network failures, etc.)
    throw error;
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
): AsyncGenerator<{ type: string; content?: string; name?: string }> {
  const res = await fetch(`${API_BASE}/api/chat/module`, {
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
    }),
  });

  if (!res.ok) throw new Error("Failed to send message");

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
 * Fetch chat history for a module.
 */
export async function getChatHistory(slug: string): Promise<{
  sessionId: number;
  messages: Array<{ role: string; content: string }>;
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
