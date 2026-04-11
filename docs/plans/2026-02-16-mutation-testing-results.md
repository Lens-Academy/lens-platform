# Mutation Testing Results

**Date:** 2026-02-16
**Purpose:** Validate that our 8 new test files actually catch real bugs by systematically mutating production code and checking if tests fail.

## Methodology

For each function with tests, we apply 2-3 realistic mutations to the production source code (off-by-one errors, logic inversions, removed guards, changed strings, etc.), run the tests, and verify they catch the mutation. Mutations that survive (tests pass when they shouldn't) are flagged for review.

## Summary

| Test File | Mutations | Caught | Survived | Kill Rate |
|-----------|-----------|--------|----------|-----------|
| extractHeadings.test.ts | 8 | 5 | 3 | 62.5% |
| completionButtonText.test.ts | 6 | 5 | 1 | 83.3% |
| stageProgress.test.ts | 6 | 5 | 1 | 83.0% |
| formatDuration.test.ts | 7 | 4 | 3 | 57.0% |
| fetchWithRefresh.test.ts | 3 | 3 | 0 | 100% |
| modules.test.ts | 10 | 8 | 2 | 80.0% |
| useAuth.test.ts | 7 | 7 | 0 | 100% |
| useActivityTracker.test.ts | 11 | 5 | 6 | 45.5% |
| **Total** | **58** | **42** | **16** | **72.4%** |

## Survived Mutations — Triage

### Equivalent Mutations (no test change needed)

These mutations survived because they're functionally equivalent — the code path produces the same result either way.

1. **completionButtonText.ts:34** — Removed `!isTextOrPage` early return guard. Redundant: `getSectionTextLength()` returns `Infinity` for non-text types, so the subsequent `!isShort` check catches them anyway. Defensive code, not a testable behavior difference.

2. **formatDuration.ts:19** — Changed `seconds < 0` to `seconds < -1`. Test uses `-5` which satisfies both. However, the guard exists for *any* negative, so this is borderline (see real gaps below for the fix).

3. **formatDuration.ts:43** — Changed `>= 300` to `> 300`. For exactly 300s, both paths produce `"5 min"`. The rounding path gives `Math.round(300/60) = 5`, the non-rounding path gives `minutes=5, secs=0`.

4. **extractHeadings.ts:75** — Changed `||` to `&&` in `if (!text || !level) continue`. In practice, `text` and `level` are always both null or both non-null (the regex captures them together), so `||` vs `&&` makes no difference.

5. **useActivityTracker.ts:116** — Removed `lastActivityRef.current === null` guard. Dead code in practice: the initial `handleActivity()` call on mount always sets the ref before the first interval fires.

6. **useActivityTracker.ts:97** — Removed `if (!enabled) return;` guard in useEffect. Redundant: `sendHeartbeat()` has its own `if (!enabled || !contentId) return;` guard. (Still registers unnecessary event listeners, but tests can't observe that.)

### Real Gaps (tests should be strengthened)

These survived mutations represent real behavior differences that our tests don't catch.

#### Low Priority

7. **extractHeadings.ts:62** — Removed `.trim()` from markdown heading text extraction. No test input has trailing whitespace like `"## Hello World  "`. *Fix: add test with whitespace-padded heading.*

8. **extractHeadings.ts:70** — Removed `.trim()` from HTML heading text extraction. No test input has `<h2> Overview </h2>`. *Fix: add test with whitespace in HTML tags.*

#### Medium Priority

9. **formatDuration.ts:44** — Changed `Math.round` to `Math.floor` for >= 5 min rounding. Test input `423s` (7.05 min) rounds and floors to the same value (7). *Fix: add `formatDuration(330)` expecting `"6 min"` (5.5 min rounds up).*

10. **stageProgress.ts:42-52** — Swapped `isCompleted`/`isViewing` branch order in non-optional section. No test has both `isCompleted=true` AND `isViewing=true`. *Fix: add test with `{ isCompleted: true, isViewing: true, isOptional: false }` to verify completed takes priority.*

11. **modules.ts:249** — Changed `transcribeAudio` timeout from `30000` to `10000`. No test verifies the 30s timeout value. *Fix: add test that verifies abort signal timing or the passed timeout parameter.*

#### High Priority

12. **modules.ts:79** — Flipped `=== "AbortError"` to `!== "AbortError"` in `fetchWithTimeout`. The timeout test only checks that `AbortSignal` is set, but never exercises the catch branch that converts `AbortError` to `RequestTimeoutError`. *Fix: mock fetch to reject with AbortError when signal fires, assert RequestTimeoutError is thrown.*

13. **useActivityTracker.ts:120** — Changed `>` to `>=` in inactivity comparison. Test advances 180,001ms which exceeds both thresholds. *Fix: add boundary test at exactly `inactivityTimeout` (180,000ms).*

14. **useActivityTracker.ts:51** — Removed `isActiveRef.current` guard from `sendBeacon`. No test verifies beacons are suppressed when user is inactive. *Fix: go inactive first, then trigger visibility hidden, assert beacon NOT sent.*

15. **useActivityTracker.ts:151-153** — Removed `clearInterval` in cleanup. No test verifies interval is cleared on unmount. *Fix: unmount, advance timers, assert no new heartbeats.*

16. **useActivityTracker.ts:109** — Removed `isActiveRef.current = false` in visibility handler. No test verifies that after visibility hidden, heartbeats stop. *Fix: trigger visibility hidden, advance timer, assert no heartbeat sent.*

---

## Detailed Results

### extractHeadings.test.ts

**Source:** `src/utils/extractHeadings.ts`
**Tests:** 16 tests

#### Function: `generateHeadingId` (line 13)

| # | Mutation | Line | Caught? | Catching tests |
|---|----------|------|---------|----------------|
| 1 | Removed `.toLowerCase()` call | 15 | Yes | 8 tests across all describe blocks |
| 2 | Changed `slice(0, 50)` to `slice(0, 40)` | 19 | Yes | "truncates to 50 characters" |

#### Function: `extractHeadings` (line 30)

| # | Mutation | Line | Caught? | Catching tests |
|---|----------|------|---------|----------------|
| 3 | Removed `.trim()` from markdown text extraction | 62 | **NO** | - |
| 4 | Changed `count > 0` to `count >= 0` in dedup | 79 | Yes | 5 tests |
| 5 | Flipped `!text` to `text` in guard clause | 75 | Yes | 7 tests |
| 6 | Changed `\|\|` to `&&` in guard clause | 75 | **NO** | - |
| 7 | Changed `count + 1` to `count + 2` in seenIds | 80 | Yes | 3 deduplication tests |
| 8 | Removed `.trim()` from HTML text extraction | 70 | **NO** | - |

---

### completionButtonText.test.ts

**Source:** `src/utils/completionButtonText.ts`
**Tests:** 11 tests

#### Function: `getSectionTextLength` (line 8)

| # | Mutation | Line | Caught? | Catching tests |
|---|----------|------|---------|----------------|
| 1 | Changed `Infinity` to `0` (fallback return) | 22 | Yes | "returns Infinity for video/article sections" |
| 2 | Changed reduce initial value `0` to `1` | 18 | Yes | "returns sum of text segment lengths", "returns 0 for page with no text segments" |

#### Function: `getCompletionButtonText` (line 29)

| # | Mutation | Line | Caught? | Catching tests |
|---|----------|------|---------|----------------|
| 3 | Changed `< 1750` to `<= 1750` (off-by-one) | 36 | Yes | "returns 'Mark section complete' for long text", "threshold is exclusive" |
| 4 | Changed `sectionIndex === 0` to `!== 0` | 39 | Yes | "returns 'Get started'...", "returns 'Continue'...", "threshold is exclusive" |
| 5 | Removed `!isTextOrPage` early return guard | 34 | **NO** | - (equivalent: Infinity handles it) |
| 6 | Changed `\|\|` to `&&` in isTextOrPage check | 33 | Yes | 3 tests |

---

### stageProgress.test.ts

**Source:** `src/utils/stageProgress.ts`
**Tests:** 15 tests

#### Function: `getCircleFillClasses` (line 19)

| # | Mutation | Line | Caught? | Catching tests |
|---|----------|------|---------|----------------|
| 1 | Changed `"bg-blue-500"` to `"bg-red-500"` | 43-45 | Yes | "completed, no hover", "completed, with hover" |
| 2 | Swapped isCompleted/isViewing branches | 42-52 | **NO** | - (no test with both true) |
| 3 | Changed optional viewing `border-gray-400` to `border-gray-300` | 34-35 | Yes | "optional viewing, no hover", "optional viewing, with hover" |
| 4 | Flipped `isOptional` guard | 26 | Yes | All 12 tests |

#### Function: `getRingClasses` (line 63)

| # | Mutation | Line | Caught? | Catching tests |
|---|----------|------|---------|----------------|
| 5 | Removed `!` from `!isViewing` guard | 67 | Yes | All 3 ring tests |
| 6 | Changed completed ring `ring-blue-500` to `ring-gray-500` | 69 | Yes | "returns blue ring when viewing and completed" |

---

### formatDuration.test.ts

**Source:** `src/utils/formatDuration.ts`
**Tests:** 14 tests

#### Function: `formatDuration` (line 17)

| # | Mutation | Line | Caught? | Catching tests |
|---|----------|------|---------|----------------|
| 1 | Changed `< 60` to `<= 60` (off-by-one) | 26 | Yes | "formats exactly 1 minute" |
| 2 | Changed `>= 300` to `> 300` | 43 | **NO** | - (equivalent at boundary) |
| 3 | Changed `seconds < 0` to `seconds < -1` | 19 | **NO** | - (test uses -5) |
| 4 | Changed `Math.floor` to `Math.ceil` | 23 | Yes | "floors fractional seconds" |
| 5 | Changed `hours > 0` to `hours >= 0` | 35 | Yes | 5 tests |
| 6 | Changed `Math.round` to `Math.floor` | 44 | **NO** | - (test input doesn't distinguish) |
| 7 | Swapped `secs > 0` to `secs === 0` | 49 | Yes | 3 tests |

---

### fetchWithRefresh.test.ts

**Source:** `src/api/fetchWithRefresh.ts`
**Tests:** 7 tests

#### Function: `fetchWithRefresh` (line 28)

| # | Mutation | Line | Caught? | Catching tests |
|---|----------|------|---------|----------------|
| 1 | Changed 401 check to 403 | 33 | Yes | 4 tests |
| 2 | Removed retry after refresh | 45 | Yes | 3 tests |
| 3 | Flipped refresh guard `!refreshed` to `refreshed` | 42 | Yes | 5 tests |

---

### modules.test.ts

**Source:** `src/api/modules.ts`
**Tests:** 22 tests

#### Function: `listModules` (line 109)

| # | Mutation | Line | Caught? | Catching tests |
|---|----------|------|---------|----------------|
| 1 | Changed response parsing `data.modules` to `data` | 115 | Yes | "returns parsed module list" |

#### Function: `getChatHistory` (line 180)

| # | Mutation | Line | Caught? | Catching tests |
|---|----------|------|---------|----------------|
| 2 | Changed 401 check to 403 | 192 | Yes | "returns empty session on 401" |

#### Function: `getNextModule` (line 214)

| # | Mutation | Line | Caught? | Catching tests |
|---|----------|------|---------|----------------|
| 3 | Changed 204 check to 200 | 223 | Yes | 3 tests |
| 4 | Swapped completedUnit/nextModuleSlug branching | 227-235 | Yes | 2 tests |

#### Function: `transcribeAudio` (line 238)

| # | Mutation | Line | Caught? | Catching tests |
|---|----------|------|---------|----------------|
| 5 | Changed 413 check to 414 | 253 | Yes | "throws 'Recording too large' on 413" |
| 6 | Changed timeout 30000 to 10000 | 249 | **NO** | - |

#### Function: `getModuleProgress` (line 274)

| # | Mutation | Line | Caught? | Catching tests |
|---|----------|------|---------|----------------|
| 7 | Changed 401 check to 403 | 285 | Yes | "returns null on 401" |

#### Function: `RequestTimeoutError` (line 40)

| # | Mutation | Line | Caught? | Catching tests |
|---|----------|------|---------|----------------|
| 8 | Changed error message format | 45 | Yes | "RequestTimeoutError has correct properties" |

#### Function: `fetchWithTimeout` (line 58)

| # | Mutation | Line | Caught? | Catching tests |
|---|----------|------|---------|----------------|
| 9 | Flipped AbortError check `===` to `!==` | 79 | **NO** | - |

#### Function: `getCourseProgress` (line 263)

| # | Mutation | Line | Caught? | Catching tests |
|---|----------|------|---------|----------------|
| 10 | Changed error message string | 270 | Yes | "throws on error" |

---

### useAuth.test.ts

**Source:** `src/hooks/useAuth.ts`
**Tests:** 10 tests

#### Behavior: Authentication state mapping

| # | Mutation | Line | Caught? | Catching tests |
|---|----------|------|---------|----------------|
| 1 | `isAuthenticated: true` to `false` | 86 | Yes | 3 tests |
| 2 | Hardcoded `tosAccepted: false` | 94 | Yes | "derives tosAccepted from tos_accepted_at" |
| 3 | Hardcoded `isInSignupsTable: false` | 92 | Yes | "resolves to authenticated state with all fields" |

#### Behavior: Response/state guards

| # | Mutation | Line | Caught? | Catching tests |
|---|----------|------|---------|----------------|
| 4 | Flipped `!response.ok` to `response.ok` | 66 | Yes | 4 tests |
| 5 | Changed initial `isLoading: true` to `false` | 50 | Yes | 3 tests |

#### Behavior: Login/Logout

| # | Mutation | Line | Caught? | Catching tests |
|---|----------|------|---------|----------------|
| 6 | Changed `/auth/discord` to `/auth/google` | 155 | Yes | "login() redirects to Discord OAuth URL" |
| 7 | Changed `method: "POST"` to `"GET"` | 161 | Yes | "logout() POSTs to /auth/logout" |

---

### useActivityTracker.test.ts

**Source:** `src/hooks/useActivityTracker.ts`
**Tests:** 10 tests

#### Behavior: Timer and activity logic

| # | Mutation | Line | Caught? | Catching tests |
|---|----------|------|---------|----------------|
| 1 | Changed `>` to `>=` in inactivity check | 120 | **NO** | - |
| 2 | Removed `isActiveRef.current` guard from sendBeacon | 51 | **NO** | - |
| 3 | Flipped `!isAuthenticated` to `isAuthenticated` | 56 | Yes | "appends anonymous_token..." |
| 4 | Removed heartbeat active guard | 124 | Yes | "stops heartbeats after inactivity timeout" |
| 5 | Removed `sendBeacon()` from cleanup | 143 | Yes | "sends beacon on unmount" |
| 6 | Removed initial `sendHeartbeat()` | 133 | Yes | "sends initial heartbeat on mount" |
| 7 | Removed initial `handleActivity()` | 130 | Yes | 5 tests |

#### Behavior: Guards and cleanup

| # | Mutation | Line | Caught? | Catching tests |
|---|----------|------|---------|----------------|
| 8 | Removed `if (!enabled) return;` guard | 97 | **NO** | - (redundant guard) |
| 9 | Removed `lastActivityRef === null` guard | 116 | **NO** | - (dead code path) |
| 10 | Removed `clearInterval` in cleanup | 151-153 | **NO** | - |
| 11 | Removed `isActiveRef.current = false` in visibility handler | 109 | **NO** | - |
