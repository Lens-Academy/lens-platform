// web_frontend/src/hooks/__tests__/useActivityTracker.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createFetchMock, jsonResponse } from "@/test/fetchMock";
import { useActivityTracker } from "../useActivityTracker";

const fm = createFetchMock();

const defaultOptions = {
  contentId: "content-1",
  loId: "lo-1",
  moduleId: "module-1",
  isAuthenticated: true,
  contentTitle: "Test Content",
  moduleTitle: "Test Module",
  loTitle: "Test LO",
  heartbeatInterval: 20_000,
  inactivityTimeout: 180_000,
  enabled: true,
};

let sendBeaconMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fm.install();
  fm.mock.mockResolvedValue(jsonResponse({ ok: true }));

  sendBeaconMock = vi.fn().mockReturnValue(true);
  Object.defineProperty(navigator, "sendBeacon", {
    value: sendBeaconMock,
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
  fm.restore();
  vi.restoreAllMocks();
});

describe("useActivityTracker", () => {
  it("sends initial heartbeat on mount", async () => {
    renderHook(() => useActivityTracker(defaultOptions));
    await vi.advanceTimersByTimeAsync(0); // flush async sendHeartbeat

    expect(fm.callsTo("/api/progress/time")).toHaveLength(1);
  });

  it("sends periodic heartbeats while active", async () => {
    renderHook(() => useActivityTracker(defaultOptions));
    await vi.advanceTimersByTimeAsync(0);
    const initial = fm.callsTo("/api/progress/time").length;

    await vi.advanceTimersByTimeAsync(20_000);

    expect(fm.callsTo("/api/progress/time").length).toBeGreaterThan(initial);
  });

  it("stops heartbeats after inactivity timeout", async () => {
    renderHook(() => useActivityTracker(defaultOptions));
    await vi.advanceTimersByTimeAsync(0);

    // Advance past inactivity timeout
    await vi.advanceTimersByTimeAsync(180_001);
    const callsAfterTimeout = fm.callsTo("/api/progress/time").length;

    // Another heartbeat interval — should NOT send
    await vi.advanceTimersByTimeAsync(20_000);

    expect(fm.callsTo("/api/progress/time").length).toBe(callsAfterTimeout);
  });

  it("remains active at exactly the inactivity timeout boundary", async () => {
    renderHook(() => useActivityTracker(defaultOptions));
    await vi.advanceTimersByTimeAsync(0);

    // Advance to 160,000ms (8 intervals fired, all active)
    await vi.advanceTimersByTimeAsync(160_000);
    const callsBefore = fm.callsTo("/api/progress/time").length;

    // Advance to exactly 180,000ms — the interval fires with
    // timeSinceActivity = 180,000 = inactivityTimeout
    // With >: 180,000 > 180,000 is false → still active → heartbeat fires
    // With >=: 180,000 >= 180,000 is true → inactive → NO heartbeat
    await vi.advanceTimersByTimeAsync(20_000);

    expect(fm.callsTo("/api/progress/time").length).toBeGreaterThan(callsBefore);
  });

  it("activity events reset the inactivity timer", async () => {
    renderHook(() => useActivityTracker(defaultOptions));
    await vi.advanceTimersByTimeAsync(0);

    // Advance close to inactivity timeout
    await vi.advanceTimersByTimeAsync(170_000);

    // Activity resets timer
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });

    // Advance past original timeout point but within new timeout window
    await vi.advanceTimersByTimeAsync(20_000);
    const callsAtOriginalTimeout = fm.callsTo("/api/progress/time").length;

    // One more interval — should still be active because scroll reset the timer
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fm.callsTo("/api/progress/time").length).toBeGreaterThan(
      callsAtOriginalTimeout,
    );
  });

  it("sends beacon on visibility change to hidden", async () => {
    renderHook(() => useActivityTracker(defaultOptions));
    await vi.advanceTimersByTimeAsync(0);

    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(sendBeaconMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/progress/time"),
      expect.any(String),
    );
  });

  it("does not send beacon when user is inactive", async () => {
    renderHook(() => useActivityTracker(defaultOptions));
    await vi.advanceTimersByTimeAsync(0);

    // Go inactive: advance past timeout + one full interval so the interval
    // callback sets isActiveRef.current = false
    // At t=200,000ms: timeSinceActivity = 200,000 > 180,000 → inactive
    await vi.advanceTimersByTimeAsync(200_001);

    sendBeaconMock.mockClear();

    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    // sendBeacon() should return early because isActiveRef.current is false
    expect(sendBeaconMock).not.toHaveBeenCalled();
  });

  it("sends beacon on unmount", async () => {
    const { unmount } = renderHook(() =>
      useActivityTracker(defaultOptions),
    );
    await vi.advanceTimersByTimeAsync(0);

    unmount();

    expect(sendBeaconMock).toHaveBeenCalled();
  });

  it("clears heartbeat interval on unmount", async () => {
    const { unmount } = renderHook(() =>
      useActivityTracker(defaultOptions),
    );
    await vi.advanceTimersByTimeAsync(0);

    const callsBeforeUnmount = fm.callsTo("/api/progress/time").length;

    unmount();

    // Advance by several heartbeat intervals — no new heartbeats should fire
    await vi.advanceTimersByTimeAsync(60_000);

    expect(fm.callsTo("/api/progress/time").length).toBe(callsBeforeUnmount);
  });

  it("does nothing when enabled: false", async () => {
    renderHook(() =>
      useActivityTracker({ ...defaultOptions, enabled: false }),
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(fm.callsTo("/api/progress/time")).toHaveLength(0);
    expect(sendBeaconMock).not.toHaveBeenCalled();
  });

  it("sends beacon on beforeunload", async () => {
    renderHook(() => useActivityTracker(defaultOptions));
    await vi.advanceTimersByTimeAsync(0);

    window.dispatchEvent(new Event("beforeunload"));

    expect(sendBeaconMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/progress/time"),
      expect.any(String),
    );
  });

  it("stops heartbeats after visibility hidden", async () => {
    renderHook(() => useActivityTracker(defaultOptions));
    await vi.advanceTimersByTimeAsync(0);

    // Trigger visibility hidden — should set isActiveRef.current = false
    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    const callsAfterHidden = fm.callsTo("/api/progress/time").length;

    // Next heartbeat interval — should NOT fire because isActiveRef.current is false
    await vi.advanceTimersByTimeAsync(20_000);

    expect(fm.callsTo("/api/progress/time").length).toBe(callsAfterHidden);
  });

  it("appends anonymous_token to beacon URL when not authenticated", async () => {
    renderHook(() =>
      useActivityTracker({ ...defaultOptions, isAuthenticated: false }),
    );
    await vi.advanceTimersByTimeAsync(0);

    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(sendBeaconMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/progress\/time\?anonymous_token=.+/),
      expect.any(String),
    );
  });

  it("triggerActivity() resets activity state after timeout", async () => {
    const { result } = renderHook(() =>
      useActivityTracker(defaultOptions),
    );
    await vi.advanceTimersByTimeAsync(0);

    // Go inactive
    await vi.advanceTimersByTimeAsync(180_001);
    const callsWhenInactive = fm.callsTo("/api/progress/time").length;

    // Trigger activity manually
    act(() => {
      result.current.triggerActivity();
    });

    // Next heartbeat should fire
    await vi.advanceTimersByTimeAsync(20_000);

    expect(fm.callsTo("/api/progress/time").length).toBeGreaterThan(
      callsWhenInactive,
    );
  });
});
