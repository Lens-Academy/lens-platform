import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@/api/questions", () => ({
  createResponse: vi.fn(),
  updateResponse: vi.fn(),
  getResponses: vi.fn(),
}));

import { createResponse, updateResponse, getResponses } from "@/api/questions";
import { useAutoSave } from "../useAutoSave";

const mockedCreateResponse = vi.mocked(createResponse);
const mockedUpdateResponse = vi.mocked(updateResponse);
const mockedGetResponses = vi.mocked(getResponses);

const defaultOpts = {
  questionId: "mod:0:0",
  moduleSlug: "test-module",
  questionText: "What is AI safety?",
  isAuthenticated: false,
  debounceMs: 1000,
};

describe("useAutoSave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();

    // Default mock implementations
    mockedGetResponses.mockResolvedValue({ responses: [] });
    mockedCreateResponse.mockResolvedValue({
      response_id: 42,
      created_at: "2025-01-01T00:00:00Z",
    });
    mockedUpdateResponse.mockResolvedValue({
      response_id: 42,
      created_at: "2025-01-01T00:00:00Z",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("1. Lazy create: first setText triggers POST after debounce", async () => {
    const { result } = renderHook(() => useAutoSave(defaultOpts));

    // Wait for loading to finish (getResponses resolves)
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    act(() => {
      result.current.setText("hello");
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Wait for async save to complete
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(mockedCreateResponse).toHaveBeenCalledOnce();
    expect(mockedCreateResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        answerText: "hello",
        questionId: "mod:0:0",
        moduleSlug: "test-module",
      }),
      false,
    );
    expect(mockedUpdateResponse).not.toHaveBeenCalled();
    expect(result.current.responseId).toBe(42);
  });

  it("2. Update after create: second setText triggers PATCH", async () => {
    const { result } = renderHook(() => useAutoSave(defaultOpts));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // First setText -> POST
    act(() => {
      result.current.setText("hello");
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // Second setText -> PATCH
    act(() => {
      result.current.setText("hello world");
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(mockedUpdateResponse).toHaveBeenCalledOnce();
    expect(mockedUpdateResponse).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ answerText: "hello world" }),
      false,
    );
    expect(mockedCreateResponse).toHaveBeenCalledTimes(1); // Only once from first save
  });

  it("3. Debounce coalescing: multiple rapid setText calls produce one API call", async () => {
    const { result } = renderHook(() => useAutoSave(defaultOpts));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    act(() => {
      result.current.setText("a");
      vi.advanceTimersByTime(500);
    });

    act(() => {
      result.current.setText("ab");
      vi.advanceTimersByTime(500);
    });

    act(() => {
      result.current.setText("abc");
      vi.advanceTimersByTime(1000);
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(mockedCreateResponse).toHaveBeenCalledOnce();
    expect(mockedCreateResponse).toHaveBeenCalledWith(
      expect.objectContaining({ answerText: "abc" }),
      false,
    );
  });

  it("4. Save status transitions: idle -> saving -> saved -> idle", async () => {
    // Use a deferred promise for createResponse
    let resolveCreate!: (value: {
      response_id: number;
      created_at: string;
    }) => void;
    mockedCreateResponse.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );

    const { result } = renderHook(() => useAutoSave(defaultOpts));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.saveStatus).toBe("idle");

    // Start save: setText then advance past debounce
    act(() => {
      result.current.setText("test");
    });

    // Advance past debounce to trigger flushSave
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    // flushSave has been called, setSaveStatus('saving') should have fired
    expect(result.current.saveStatus).toBe("saving");

    // Resolve the create promise
    await act(async () => {
      resolveCreate({ response_id: 42, created_at: "2025-01-01T00:00:00Z" });
    });

    expect(result.current.saveStatus).toBe("saved");

    // Advance past the saved->idle transition (2s)
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current.saveStatus).toBe("idle");
  });

  it("5. Load existing draft on mount: GET returns incomplete response", async () => {
    mockedGetResponses.mockResolvedValue({
      responses: [
        {
          response_id: 99,
          question_id: "mod:0:0",
          module_slug: "test-module",
          question_text: "What is AI safety?",
          question_hash: "abc123",
          answer_text: "draft text",
          answer_metadata: {},
          created_at: "2025-01-01T00:00:00Z",
          completed_at: null,
        },
      ],
    });

    const { result } = renderHook(() => useAutoSave(defaultOpts));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.text).toBe("draft text");
    expect(result.current.responseId).toBe(99);
    expect(result.current.isCompleted).toBe(false);
  });

  it("6. Load completed answer on mount: GET returns response with completed_at", async () => {
    mockedGetResponses.mockResolvedValue({
      responses: [
        {
          response_id: 99,
          question_id: "mod:0:0",
          module_slug: "test-module",
          question_text: "What is AI safety?",
          question_hash: "abc123",
          answer_text: "done",
          answer_metadata: {},
          created_at: "2025-01-01T00:00:00Z",
          completed_at: "2025-01-01T00:00:00Z",
        },
      ],
    });

    const { result } = renderHook(() => useAutoSave(defaultOpts));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.isCompleted).toBe(true);
    expect(result.current.text).toBe("done");
  });

  it("7. markComplete: flushes pending save then PATCHes completed_at", async () => {
    const { result } = renderHook(() => useAutoSave(defaultOpts));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // Create initial response
    act(() => {
      result.current.setText("answer");
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // Make a pending change (don't advance timer)
    act(() => {
      result.current.setText("answer v2");
    });

    // markComplete should flush + complete
    await act(async () => {
      await result.current.markComplete();
    });

    // updateResponse should have been called: once for flush with text, once for completion
    const updateCalls = mockedUpdateResponse.mock.calls;
    // Find calls that have answerText
    const textUpdateCalls = updateCalls.filter(
      (call) => call[1].answerText !== undefined,
    );
    const completionCalls = updateCalls.filter(
      (call) => call[1].completedAt !== undefined,
    );

    expect(textUpdateCalls.length).toBeGreaterThanOrEqual(1);
    expect(textUpdateCalls[textUpdateCalls.length - 1][1].answerText).toBe(
      "answer v2",
    );
    expect(completionCalls.length).toBeGreaterThanOrEqual(1);
    expect(result.current.isCompleted).toBe(true);
  });

  it("8. Flush on unmount: pending save fires before cleanup", async () => {
    const { result, unmount } = renderHook(() => useAutoSave(defaultOpts));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // Type text but don't advance timer (save is pending)
    act(() => {
      result.current.setText("unsaved");
    });

    // Unmount should flush
    unmount();

    expect(mockedCreateResponse).toHaveBeenCalledWith(
      expect.objectContaining({ answerText: "unsaved" }),
      false,
    );
  });

  it("9. Error recovery: API error sets saveStatus to 'error', text preserved", async () => {
    mockedCreateResponse.mockRejectedValue(new Error("network"));

    const { result } = renderHook(() => useAutoSave(defaultOpts));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    act(() => {
      result.current.setText("oops");
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.saveStatus).toBe("error");
    expect(result.current.text).toBe("oops");
  });
});
