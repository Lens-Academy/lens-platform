/**
 * useAutoSave - Debounced auto-save hook with lazy create/update pattern.
 *
 * On first keystroke: POST to create a response record.
 * On subsequent changes: debounced PATCH to update.
 * On unmount: flush any pending save.
 * On mount: load existing answer from API.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  createResponse,
  updateResponse,
  getResponses,
} from "@/api/assessments";

export interface UseAutoSaveOptions {
  questionId: string;
  moduleSlug: string;
  learningOutcomeId?: string | null;
  contentId?: string | null;
  isAuthenticated: boolean;
  debounceMs?: number;
}

export interface UseAutoSaveReturn {
  text: string;
  setText: (text: string) => void;
  setMetadata: (metadata: Record<string, unknown>) => void;
  saveStatus: "idle" | "saving" | "saved" | "error";
  isCompleted: boolean;
  markComplete: () => Promise<void>;
  reopenAnswer: () => Promise<void>;
  responseId: number | null;
  isLoading: boolean;
}

export function useAutoSave(options: UseAutoSaveOptions): UseAutoSaveReturn {
  const {
    questionId,
    moduleSlug,
    learningOutcomeId,
    contentId,
    isAuthenticated,
    debounceMs = 2500,
  } = options;

  const [text, setTextState] = useState("");
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [isCompleted, setIsCompleted] = useState(false);
  const [responseId, setResponseId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Refs for managing async save logic
  const latestTextRef = useRef("");
  const responseIdRef = useRef<number | null>(null);
  const metadataRef = useRef<Record<string, unknown>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  const mountedRef = useRef(true);

  // Keep responseIdRef in sync with state
  useEffect(() => {
    responseIdRef.current = responseId;
  }, [responseId]);

  // Core save function
  const flushSave = useCallback(async (): Promise<void> => {
    // Clear any pending debounce timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!dirtyRef.current) return;

    // Prevent concurrent saves
    if (savingRef.current) return;
    savingRef.current = true;
    dirtyRef.current = false;

    const textToSave = latestTextRef.current;
    const metadata =
      Object.keys(metadataRef.current).length > 0
        ? { ...metadataRef.current }
        : undefined;

    if (mountedRef.current) {
      setSaveStatus("saving");
    }

    try {
      if (responseIdRef.current === null) {
        // First save: create
        const result = await createResponse(
          {
            questionId,
            moduleSlug,
            learningOutcomeId: learningOutcomeId ?? null,
            contentId: contentId ?? null,
            answerText: textToSave,
            answerMetadata: metadata,
          },
          isAuthenticated,
        );
        responseIdRef.current = result.response_id;
        if (mountedRef.current) {
          setResponseId(result.response_id);
        }
      } else {
        // Subsequent: update
        await updateResponse(
          responseIdRef.current,
          {
            answerText: textToSave,
            ...(metadata ? { answerMetadata: metadata } : {}),
          },
          isAuthenticated,
        );
      }

      if (mountedRef.current) {
        setSaveStatus("saved");
        // Transition saved -> idle after 2s
        if (savedTimerRef.current) {
          clearTimeout(savedTimerRef.current);
        }
        savedTimerRef.current = setTimeout(() => {
          if (mountedRef.current) {
            setSaveStatus("idle");
          }
        }, 2000);
      }
    } catch {
      if (mountedRef.current) {
        setSaveStatus("error");
        // Re-mark as dirty so next debounce retries
        dirtyRef.current = true;
      }
    } finally {
      savingRef.current = false;
    }
  }, [
    questionId,
    moduleSlug,
    learningOutcomeId,
    contentId,
    isAuthenticated,
  ]);

  // setText: update text and schedule debounced save
  const setText = useCallback(
    (newText: string) => {
      latestTextRef.current = newText;
      setTextState(newText);
      dirtyRef.current = true;

      // Clear existing debounce timer
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      // Schedule new save
      timerRef.current = setTimeout(() => {
        flushSave();
      }, debounceMs);
    },
    [debounceMs, flushSave],
  );

  // setMetadata: merge keys into metadata ref
  const setMetadata = useCallback((metadata: Record<string, unknown>) => {
    metadataRef.current = { ...metadataRef.current, ...metadata };
  }, []);

  // markComplete: flush pending save, then PATCH completed_at
  const markComplete = useCallback(async () => {
    // Flush any pending text first
    await flushSave();

    if (responseIdRef.current === null) return;

    try {
      await updateResponse(
        responseIdRef.current,
        { completedAt: new Date().toISOString() },
        isAuthenticated,
      );
      if (mountedRef.current) {
        setIsCompleted(true);
      }
    } catch {
      if (mountedRef.current) {
        setSaveStatus("error");
      }
    }
  }, [flushSave, isAuthenticated]);

  // reopenAnswer: create a new response (new attempt) and archive stale feedback
  const reopenAnswer = useCallback(async () => {
    try {
      const result = await createResponse(
        {
          questionId,
          moduleSlug,
          learningOutcomeId: learningOutcomeId ?? null,
          contentId: contentId ?? null,
          answerText: latestTextRef.current,
        },
        isAuthenticated,
      );
      responseIdRef.current = result.response_id;
      if (mountedRef.current) {
        setResponseId(result.response_id);
        setIsCompleted(false);
      }
    } catch {
      if (mountedRef.current) {
        setSaveStatus("error");
      }
    }
  }, [questionId, moduleSlug, learningOutcomeId, contentId, isAuthenticated]);

  // Load existing answer on mount
  useEffect(() => {
    let cancelled = false;

    async function loadExisting() {
      try {
        const result = await getResponses(
          { moduleSlug, questionId },
          isAuthenticated,
        );

        if (cancelled) return;

        if (result.responses.length > 0) {
          // Find the most recent response
          const latest = result.responses[0]; // Already sorted by created_at DESC

          // If it has no completed_at, resume editing it
          if (!latest.completed_at) {
            latestTextRef.current = latest.answer_text;
            setTextState(latest.answer_text);
            responseIdRef.current = latest.response_id;
            setResponseId(latest.response_id);
            setIsCompleted(false);
          } else {
            // All completed — show completed state with latest text
            latestTextRef.current = latest.answer_text;
            setTextState(latest.answer_text);
            responseIdRef.current = latest.response_id;
            setResponseId(latest.response_id);
            setIsCompleted(true);
          }
        }
      } catch {
        // Silently fail — user can still type and create new answer
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadExisting();

    return () => {
      cancelled = true;
    };
  }, [moduleSlug, questionId, isAuthenticated]);

  // Flush on unmount
  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      // Clear timers
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      if (savedTimerRef.current) {
        clearTimeout(savedTimerRef.current);
      }

      // Fire-and-forget flush of pending save
      if (dirtyRef.current) {
        const textToSave = latestTextRef.current;
        const currentResponseId = responseIdRef.current;
        const metadata =
          Object.keys(metadataRef.current).length > 0
            ? { ...metadataRef.current }
            : undefined;

        if (currentResponseId === null) {
          createResponse(
            {
              questionId,
              moduleSlug,
              learningOutcomeId: learningOutcomeId ?? null,
              contentId: contentId ?? null,
              answerText: textToSave,
              answerMetadata: metadata,
            },
            isAuthenticated,
          );
        } else {
          updateResponse(
            currentResponseId,
            {
              answerText: textToSave,
              ...(metadata ? { answerMetadata: metadata } : {}),
            },
            isAuthenticated,
          );
        }
      }
    };
  }, [questionId, moduleSlug, learningOutcomeId, contentId, isAuthenticated]);

  return {
    text,
    setText,
    setMetadata,
    saveStatus,
    isCompleted,
    markComplete,
    reopenAnswer,
    responseId,
    isLoading,
  };
}
