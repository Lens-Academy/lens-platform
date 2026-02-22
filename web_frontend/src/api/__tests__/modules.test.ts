// web_frontend/src/api/__tests__/modules.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createFetchMock,
  jsonResponse,
  errorResponse,
} from "@/test/fetchMock";
import {
  listModules,
  getModule,
  getChatHistory,
  getNextModule,
  transcribeAudio,
  getModuleProgress,
  getCourseProgress,
  RequestTimeoutError,
} from "../modules";

const fm = createFetchMock();

beforeEach(() => {
  fm.install();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  fm.restore();
  vi.restoreAllMocks();
});

describe("listModules", () => {
  it("returns parsed module list", async () => {
    const modules = [{ slug: "a", title: "A" }];
    fm.mock.mockResolvedValue(jsonResponse({ modules }));

    expect(await listModules()).toEqual(modules);
  });

  it("throws on non-ok response", async () => {
    fm.mock.mockResolvedValue(errorResponse(500));
    await expect(listModules()).rejects.toThrow("Failed to fetch modules");
  });
});

describe("getModule", () => {
  it("returns parsed module", async () => {
    const mod = { slug: "test", title: "Test", sections: [] };
    fm.mock.mockResolvedValue(jsonResponse(mod));

    expect(await getModule("test")).toEqual(mod);
    expect(fm.callsTo("/api/modules/test")).toHaveLength(1);
  });

  it("throws on non-ok response", async () => {
    fm.mock.mockResolvedValue(errorResponse(404));
    await expect(getModule("missing")).rejects.toThrow("Failed to fetch module");
  });
});

describe("getChatHistory", () => {
  it("returns parsed chat history", async () => {
    const history = {
      sessionId: 1,
      messages: [{ role: "user", content: "hi" }],
    };
    fm.mock.mockResolvedValue(jsonResponse(history));

    expect(await getChatHistory("mod")).toEqual(history);
  });

  it("returns empty session on 401", async () => {
    // 401 -> fetchWithRefresh tries refresh -> refresh fails -> returns 401
    fm.mock
      .mockResolvedValueOnce(errorResponse(401)) // original
      .mockResolvedValueOnce(errorResponse(403)); // refresh fails

    const result = await getChatHistory("mod");
    expect(result).toEqual({ sessionId: 0, messages: [] });
  });

  it("throws on non-401 error", async () => {
    fm.mock.mockResolvedValue(errorResponse(500));
    await expect(getChatHistory("mod")).rejects.toThrow("Failed to fetch chat history");
  });
});

describe("getNextModule", () => {
  it("returns null on 204 No Content", async () => {
    fm.mock.mockResolvedValue(new Response(null, { status: 204 }));
    expect(await getNextModule("course", "current")).toBeNull();
  });

  it("returns next_module for nextModuleSlug response", async () => {
    fm.mock.mockResolvedValue(
      jsonResponse({ nextModuleSlug: "mod-2", nextModuleTitle: "Module 2" }),
    );

    expect(await getNextModule("course", "mod-1")).toEqual({
      type: "next_module",
      slug: "mod-2",
      title: "Module 2",
    });
  });

  it("returns unit_complete for completedUnit response", async () => {
    fm.mock.mockResolvedValue(jsonResponse({ completedUnit: 3 }));

    expect(await getNextModule("course", "mod-last")).toEqual({
      type: "unit_complete",
      unitNumber: 3,
    });
  });

  it("throws on non-ok response", async () => {
    fm.mock.mockResolvedValue(errorResponse(500));
    await expect(getNextModule("course", "mod")).rejects.toThrow("Failed to fetch next module");
  });
});

describe("getModuleProgress", () => {
  it("returns parsed progress", async () => {
    const progress = {
      module: { id: "1", slug: "test", title: "Test" },
      status: "in_progress",
      progress: { completed: 1, total: 3 },
      lenses: [],
      chatSession: { sessionId: 1, hasMessages: false },
    };
    fm.mock.mockResolvedValue(jsonResponse(progress));

    expect(await getModuleProgress("test")).toEqual(progress);
  });

  it("returns null on 401", async () => {
    fm.mock
      .mockResolvedValueOnce(errorResponse(401)) // original
      .mockResolvedValueOnce(errorResponse(403)); // refresh fails

    expect(await getModuleProgress("test")).toBeNull();
  });

  it("throws on non-401 error", async () => {
    fm.mock.mockResolvedValue(errorResponse(500));
    await expect(getModuleProgress("test")).rejects.toThrow("Failed to fetch module progress");
  });
});

describe("transcribeAudio", () => {
  it("returns transcribed text on success", async () => {
    fm.mock.mockResolvedValue(jsonResponse({ text: "Hello world" }));
    expect(await transcribeAudio(new Blob(["audio"]))).toBe("Hello world");
  });

  it("throws 'Recording too large' on 413", async () => {
    fm.mock.mockResolvedValue(errorResponse(413));
    await expect(transcribeAudio(new Blob())).rejects.toThrow("Recording too large");
  });

  it("throws rate limit error on 429", async () => {
    fm.mock.mockResolvedValue(errorResponse(429));
    await expect(transcribeAudio(new Blob())).rejects.toThrow("Too many requests, try again shortly");
  });

  it("throws generic error on other failures", async () => {
    fm.mock.mockResolvedValue(errorResponse(500));
    await expect(transcribeAudio(new Blob())).rejects.toThrow("Transcription failed");
  });
});

describe("getCourseProgress", () => {
  it("returns parsed course progress", async () => {
    const progress = {
      course: { slug: "course-1", title: "Test Course" },
      units: [
        {
          meetingNumber: 1,
          modules: [
            {
              slug: "mod-1",
              title: "Module 1",
              stages: [],
              status: "completed" as const,
              optional: false,
            },
          ],
        },
      ],
    };
    fm.mock.mockResolvedValue(jsonResponse(progress));

    expect(await getCourseProgress("course-1")).toEqual(progress);
  });

  it("throws on error", async () => {
    fm.mock.mockResolvedValue(errorResponse(500));
    await expect(getCourseProgress("course-1")).rejects.toThrow("Failed to fetch course progress");
  });
});

describe("fetchWithTimeout (via getModule)", () => {
  it("RequestTimeoutError has correct properties", () => {
    const err = new RequestTimeoutError("/api/modules/test", 10000);

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(RequestTimeoutError);
    expect(err.name).toBe("RequestTimeoutError");
    expect(err.url).toBe("/api/modules/test");
    expect(err.timeoutMs).toBe(10000);
    expect(err.message).toBe("Request timed out after 10s");
  });

  it("aborts fetch after timeout elapses", async () => {
    vi.useFakeTimers();

    let capturedSignal: AbortSignal | undefined;
    fm.mock.mockImplementation(
      (_url: string | URL | Request, init?: RequestInit) => {
        capturedSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => {});
      },
    );

    const promise = getModule("test-slug");

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(false);

    vi.advanceTimersByTime(10_001);

    expect(capturedSignal!.aborted).toBe(true);

    vi.useRealTimers();
    promise.catch(() => {});
  });

  it("converts AbortError to RequestTimeoutError on timeout", async () => {
    vi.useFakeTimers();

    fm.mock.mockImplementation(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("The operation was aborted.");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );

    const result = getModule("test-slug").then(
      () => {
        throw new Error("should have rejected");
      },
      (err: unknown) => err,
    );

    await vi.advanceTimersByTimeAsync(10_001);

    const err = await result;
    expect(err).toBeInstanceOf(RequestTimeoutError);

    vi.useRealTimers();
  });
});

describe("transcribeAudio timeout", () => {
  it("uses 30s timeout, not the default 10s", async () => {
    vi.useFakeTimers();

    let capturedSignal: AbortSignal | undefined;
    fm.mock.mockImplementation(
      (_url: string | URL | Request, init?: RequestInit) => {
        capturedSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => {});
      },
    );

    const promise = transcribeAudio(new Blob(["audio"]));

    // At 10s (default timeout) — should NOT be aborted
    vi.advanceTimersByTime(10_001);
    expect(capturedSignal!.aborted).toBe(false);

    // At 30s — should be aborted
    vi.advanceTimersByTime(20_000);
    expect(capturedSignal!.aborted).toBe(true);

    vi.useRealTimers();
    promise.catch(() => {});
  });
});
