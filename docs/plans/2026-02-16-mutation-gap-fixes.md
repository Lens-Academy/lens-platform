# Mutation Testing Gap Fixes — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the 10 real test gaps identified by mutation testing, raising kill rate from 72.4% to ~95%+.

**Architecture:** Add 10 new test cases across 5 existing test files. No production code changes — this is purely strengthening tests. Each task adds 1-2 tests to a single file, runs the suite, and commits.

**Tech Stack:** Vitest, React Testing Library, existing `createFetchMock` utility, `vi.useFakeTimers()`.

**Run all tests:** `cd /home/penguin/code/lens-platform/ws2/web_frontend && npx vitest run`

---

## Task 1: extractHeadings — trim whitespace tests

**Mutation gaps:** #7 (markdown `.trim()` line 62), #8 (HTML `.trim()` line 70)

**File:** `web_frontend/src/utils/__tests__/extractHeadings.test.ts`

**Step 1: Add two tests**

Inside the `describe("extractHeadings", ...)` block, after the "shares seenIds counter across calls" test (line 92), add:

```typescript
  it("trims whitespace from markdown heading text", () => {
    const result = extractHeadings("## Hello World  ");
    expect(result).toEqual([
      { id: "hello-world", text: "Hello World", level: 2 },
    ]);
  });

  it("trims whitespace from HTML heading text", () => {
    const result = extractHeadings("<h2> Overview </h2>");
    expect(result).toEqual([
      { id: "overview", text: "Overview", level: 2 },
    ]);
  });
```

**Why these catch the mutations:**
- If `.trim()` is removed from line 62, the markdown test gets `text: "Hello World  "` (trailing spaces) — fails.
- If `.trim()` is removed from line 70, the HTML test gets `text: " Overview "` (leading/trailing spaces) — fails.

**Step 2: Run tests**

```bash
cd /home/penguin/code/lens-platform/ws2/web_frontend && npx vitest run src/utils/__tests__/extractHeadings.test.ts
```

Expected: all 18 tests pass (16 existing + 2 new).

**Step 3: Commit**

```
test(extractHeadings): add trim whitespace coverage for markdown and HTML headings
```

---

## Task 2: formatDuration — Math.round vs Math.floor distinction

**Mutation gap:** #9 (line 44, `Math.round` changed to `Math.floor`)

**File:** `web_frontend/src/utils/__tests__/formatDuration.test.ts`

**Step 1: Add one test**

After the "rounds to nearest minute above 5 min" test (line 36), add:

```typescript
  it("rounds up at half-minute boundary (330s = 5.5 min → 6 min)", () => {
    expect(formatDuration(330)).toBe("6 min");
  });
```

**Why this catches the mutation:**
- `330 / 60 = 5.5`. `Math.round(5.5) = 6`. `Math.floor(5.5) = 5`.
- With `Math.round`: returns `"6 min"` — passes.
- With `Math.floor`: returns `"5 min"` — fails.

**Step 2: Run tests**

```bash
cd /home/penguin/code/lens-platform/ws2/web_frontend && npx vitest run src/utils/__tests__/formatDuration.test.ts
```

Expected: all 15 tests pass (14 existing + 1 new).

**Step 3: Commit**

```
test(formatDuration): add half-minute rounding boundary test (330s)
```

---

## Task 3: stageProgress — completed takes priority over viewing

**Mutation gap:** #10 (lines 42-52, swapped `isCompleted`/`isViewing` branch order)

**File:** `web_frontend/src/utils/__tests__/stageProgress.test.ts`

**Step 1: Add two tests**

After the "completed, with hover" test (line 19), add:

```typescript
  it("completed takes priority over viewing, no hover", () => {
    expect(
      getCircleFillClasses({ isCompleted: true, isViewing: true, isOptional: false }),
    ).toBe("bg-blue-500 text-white");
  });

  it("completed takes priority over viewing, with hover", () => {
    expect(
      getCircleFillClasses(
        { isCompleted: true, isViewing: true, isOptional: false },
        { includeHover: true },
      ),
    ).toBe("bg-blue-500 text-white hover:bg-blue-600");
  });
```

**Why these catch the mutation:**
- Production code checks `isCompleted` first (line 42), then `isViewing` (line 48).
- If branches are swapped, `isViewing` is checked first → returns gray classes instead of blue.
- Tests assert blue (completed) classes, so swapped branches fail.

**Step 2: Run tests**

```bash
cd /home/penguin/code/lens-platform/ws2/web_frontend && npx vitest run src/utils/__tests__/stageProgress.test.ts
```

Expected: all 17 tests pass (15 existing + 2 new).

**Step 3: Commit**

```
test(stageProgress): verify completed takes priority when both completed and viewing
```

---

## Task 4: modules — AbortError→RequestTimeoutError conversion + transcribeAudio 30s timeout

**Mutation gaps:** #12 (line 79, flipped `=== "AbortError"` to `!==`), #11 (line 249, changed timeout 30000 to 10000)

**File:** `web_frontend/src/api/__tests__/modules.test.ts`

**Step 1: Add AbortError conversion test**

Inside the `describe("fetchWithTimeout (via getModule)", ...)` block, after the "aborts fetch after timeout elapses" test (line 233), add:

```typescript
  it("converts AbortError to RequestTimeoutError on timeout", async () => {
    vi.useFakeTimers();

    fm.mock.mockImplementation(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    );

    const promise = getModule("test-slug");
    await vi.advanceTimersByTimeAsync(10_001);

    await expect(promise).rejects.toBeInstanceOf(RequestTimeoutError);

    vi.useRealTimers();
  });
```

**Why this catches the mutation:**
- Production code: `error.name === "AbortError"` → wraps in `RequestTimeoutError` and throws.
- Mutation: `error.name !== "AbortError"` → re-throws the raw `DOMException` (AbortError) instead.
- Test asserts `.rejects.toBeInstanceOf(RequestTimeoutError)` — fails with the raw DOMException.

**Step 2: Add transcribeAudio 30s timeout test**

Add a new describe block after the `getCourseProgress` describe:

```typescript
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
```

**Why this catches the mutation:**
- Production: `transcribeAudio` passes `30000` to `fetchWithTimeout`.
- Mutation: changed to `10000`.
- Test checks signal is NOT aborted at 10s but IS aborted at 30s. With the mutation, signal is already aborted at 10s — first assertion fails.

**Step 3: Run tests**

```bash
cd /home/penguin/code/lens-platform/ws2/web_frontend && npx vitest run src/api/__tests__/modules.test.ts
```

Expected: all 24 tests pass (22 existing + 2 new).

**Step 4: Commit**

```
test(modules): add AbortError→RequestTimeoutError conversion and transcribeAudio 30s timeout tests
```

---

## Task 5: useActivityTracker — four high-priority gap fixes

**Mutation gaps:** #13 (line 120, `>` to `>=` boundary), #14 (line 51, beacon suppression when inactive), #15 (lines 151-153, clearInterval on cleanup), #16 (line 109, `isActiveRef.current = false` in visibility handler)

**File:** `web_frontend/src/hooks/__tests__/useActivityTracker.test.ts`

**Step 1: Add boundary test (gap #13)**

After the "stops heartbeats after inactivity timeout" test (line 73), add:

```typescript
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
```

**Why this catches the mutation:**
- At exactly 180,000ms since last activity, the `>` comparison evaluates to `false` (user stays active). The `>=` mutation evaluates to `true` (user goes inactive, no heartbeat).

**Step 2: Add beacon suppression test (gap #14)**

After the "sends beacon on visibility change to hidden" test (line 112), add:

```typescript
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
```

**Why this catches the mutation:**
- `sendBeacon` at line 51 checks `!isActiveRef.current` — returns early if inactive.
- Mutation: removes this guard → beacon fires even when inactive.
- Test goes inactive first, then triggers visibility hidden. Without the guard, `navigator.sendBeacon` is called. With the guard, it returns early.

**Step 3: Add cleanup interval test (gap #15)**

After the "sends beacon on unmount" test (line 123), add:

```typescript
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
```

**Why this catches the mutation:**
- Cleanup calls `clearInterval(heartbeatIntervalRef.current)` at line 152.
- Mutation: removes `clearInterval` → interval keeps firing after unmount → heartbeats continue.
- Test unmounts, advances 60s (3 would-be intervals), and asserts no new heartbeats.

**Step 4: Add visibility-stops-heartbeats test (gap #16)**

After the "sends beacon on beforeunload" test (line 145), add:

```typescript
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
```

**Why this catches the mutation:**
- Visibility handler sets `isActiveRef.current = false` at line 109.
- Mutation: removes this line → `isActiveRef.current` stays `true` → heartbeat fires at next interval.
- Test triggers visibility hidden, advances one interval, asserts no new heartbeat.

**Step 5: Run tests**

```bash
cd /home/penguin/code/lens-platform/ws2/web_frontend && npx vitest run src/hooks/__tests__/useActivityTracker.test.ts
```

Expected: all 14 tests pass (10 existing + 4 new).

**Step 6: Commit**

```
test(useActivityTracker): add boundary, beacon suppression, cleanup, and visibility-heartbeat tests
```

---

## Task 6: Run full test suite

Run the full test suite to verify no regressions across all 15 test files.

```bash
cd /home/penguin/code/lens-platform/ws2/web_frontend && npx vitest run
```

Expected: all ~115 tests pass across 15 test files.

---

## Summary

| Task | File | Tests Added | Gaps Closed |
|------|------|-------------|-------------|
| 1 | extractHeadings.test.ts | +2 | #7, #8 (low) |
| 2 | formatDuration.test.ts | +1 | #9 (medium) |
| 3 | stageProgress.test.ts | +2 | #10 (medium) |
| 4 | modules.test.ts | +2 | #11 (medium), #12 (high) |
| 5 | useActivityTracker.test.ts | +4 | #13, #14, #15, #16 (high) |
| **Total** | 5 files | **+11 tests** | **10 gaps** |

After these fixes, the only survived mutations should be the 6 equivalent mutations (no action needed), raising the effective kill rate from 72.4% to ~97%.
