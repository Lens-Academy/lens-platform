/**
 * API client for lesson endpoints.
 */

import type { Lesson, SessionState } from "../types/unified-lesson";

const API_BASE = "";

export async function listLessons(): Promise<{ id: string; title: string }[]> {
  const res = await fetch(`${API_BASE}/api/lessons`);
  if (!res.ok) throw new Error("Failed to fetch lessons");
  const data = await res.json();
  return data.lessons;
}

export async function getLesson(lessonId: string): Promise<Lesson> {
  const res = await fetch(`${API_BASE}/api/lessons/${lessonId}`);
  if (!res.ok) throw new Error("Failed to fetch lesson");
  return res.json();
}

export async function createSession(lessonId: string): Promise<number> {
  const res = await fetch(`${API_BASE}/api/lesson-sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ lesson_id: lessonId }),
  });
  if (!res.ok) throw new Error("Failed to create session");
  const data = await res.json();
  return data.session_id;
}

export async function getSession(
  sessionId: number,
  viewStage?: number
): Promise<SessionState> {
  const url =
    viewStage !== undefined
      ? `${API_BASE}/api/lesson-sessions/${sessionId}?view_stage=${viewStage}`
      : `${API_BASE}/api/lesson-sessions/${sessionId}`;

  const res = await fetch(url, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch session");
  return res.json();
}

export async function advanceStage(
  sessionId: number
): Promise<{ completed: boolean; new_stage_index?: number }> {
  const res = await fetch(
    `${API_BASE}/api/lesson-sessions/${sessionId}/advance`,
    {
      method: "POST",
      credentials: "include",
    }
  );
  if (!res.ok) throw new Error("Failed to advance stage");
  return res.json();
}

export async function* sendMessage(
  sessionId: number,
  content: string
): AsyncGenerator<{ type: string; content?: string; name?: string }> {
  const res = await fetch(
    `${API_BASE}/api/lesson-sessions/${sessionId}/message`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ content }),
    }
  );

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

export async function getNextLesson(
  courseId: string,
  currentLessonId: string
): Promise<{ nextLessonId: string; nextLessonTitle: string } | null> {
  const res = await fetch(
    `${API_BASE}/api/courses/${courseId}/next-lesson?current=${currentLessonId}`
  );
  if (!res.ok) throw new Error("Failed to fetch next lesson");
  return res.json();
}

export async function claimSession(sessionId: number): Promise<{ claimed: boolean }> {
  const res = await fetch(`${API_BASE}/api/lesson-sessions/${sessionId}/claim`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    if (res.status === 403) throw new Error("Session already claimed");
    if (res.status === 404) throw new Error("Session not found");
    throw new Error("Failed to claim session");
  }
  return res.json();
}

export async function transcribeAudio(audioBlob: Blob): Promise<string> {
  const formData = new FormData();
  formData.append("audio", audioBlob, "recording.webm");

  const res = await fetch(`${API_BASE}/api/transcribe`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    if (res.status === 413) throw new Error("Recording too large");
    if (res.status === 429) throw new Error("Too many requests, try again shortly");
    throw new Error("Transcription failed");
  }

  const data = await res.json();
  return data.text;
}
