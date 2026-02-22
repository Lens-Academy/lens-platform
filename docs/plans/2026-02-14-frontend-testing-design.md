# Frontend Testing Strategy

## Problem

133 frontend source files, 7 test files (~106 test cases). Coverage is concentrated in utility math (branchColors, branchLayout) and one component integration test (Module progress). The API layer, custom hooks, and most utilities are untested. This is fine for a solo developer but blocks confident collaboration, refactoring, and feature work.

## Goal

Add 8 test files covering critical paths: all utilities with meaningful logic, the API layer, and the two most important hooks. Establish a consistent mocking strategy and shared test infrastructure that makes future tests easy to write.

## Mocking Strategy: Unit+1

**Mock `fetch` and timers. Mock nothing else.**

The frontend's dependency chain is: Components → Hooks → API functions → `fetchWithRefresh` → `fetch`. The only external boundary is `fetch` (network) and browser timer/event APIs. Everything between components and `fetch` is our code and should run for real in tests.

This means:
- When testing `useAuth`, the real `fetchWithRefresh` runs, which calls the mocked `fetch`. If the refresh deduplication logic breaks, `useAuth` tests catch it.
- When testing `modules.ts` API functions, the real `fetchWithTimeout` runs with its real `AbortController` timeout logic, calling through real `fetchWithRefresh`, hitting mocked `fetch`.
- When testing `useActivityTracker`, `vi.useFakeTimers()` controls the heartbeat intervals. The real `sendHeartbeatPing` runs, calling real `fetchWithRefresh`, hitting mocked `fetch`.

**What this means for existing tests:** The existing `Module.progress.test.tsx` mocks at the module level (`vi.mock("@/api/modules")`). That's appropriate for a 44K-LOC view component — you need to isolate the component from its entire dependency tree to test its state machine. The new tests are for smaller units where running real dependencies is practical and more valuable.

### Shared Fetch Mock Utility

A `createFetchMock()` helper in `src/test/fetchMock.ts`, used by all test files that need network mocking. It should:
- Replace `global.fetch` with a `vi.fn()` in `beforeEach`, restore in `afterEach`
- Provide helpers: `mockJsonResponse(url, data, status?)`, `mockErrorResponse(url, status)`, `mockSequence(url, [response1, response2, ...])` for testing refresh retry flows
- Expose `fetchMock.calls()` for asserting which URLs were called with what options

This prevents each test file from reinventing fetch mocking with slightly different patterns.

## Scope: 8 New Test Files

### Group 1: Pure Utilities (no mocks)

These have zero dependencies on network or browser APIs. Input → output.

**`src/utils/__tests__/extractHeadings.test.ts`**
- Markdown `##`/`###` extraction
- HTML `<h2>`/`<h3>` extraction
- ID generation: lowercasing, special char removal, truncation to 50 chars
- Duplicate ID deduplication across single and multiple documents
- Edge cases: empty input, no headings, special-char-only headings

**`src/utils/__tests__/completionButtonText.test.ts`**
- Section type determines base behavior (text/page vs video/article)
- Character length threshold (1750) determines short vs long
- Section index determines "Get started" (0) vs "Continue" (>0)
- `getSectionTextLength`: text sections, page sections with text segments, video/article → Infinity

**`src/utils/__tests__/stageProgress.test.ts`**
- `getCircleFillClasses`: all combinations of `{completed, viewing, optional} × {hover, no-hover}`
- `getRingClasses`: viewing vs not-viewing, completed vs not

**`src/utils/__tests__/formatDuration.test.ts`**
- Seconds only (<60s), minutes+seconds (1-5min), rounded minutes (5min+), hours+minutes
- Boundary values: 0, 59, 60, 299, 300, 3600
- Invalid input: negative, NaN, Infinity

### Group 2: API Layer (mock `fetch` only)

**`src/api/__tests__/fetchWithRefresh.test.ts`**
- Pass-through on non-401 responses
- 401 → refresh → retry cycle
- Failed refresh → return original 401
- Concurrent 401 deduplication (multiple calls 401 simultaneously, only one refresh fires)
- Non-401 errors pass through

Note: `fetchWithRefresh` uses a module-level `refreshPromise` singleton for deduplication. Tests need to reset this between cases — either by re-importing the module or by ensuring each test completes the full refresh cycle.

**`src/api/__tests__/modules.test.ts`** (uses real `fetchWithRefresh`)
- `fetchWithTimeout`: response within timeout, timeout fires `RequestTimeoutError` with correct url/timeoutMs
- `getModule`, `listModules`: successful parsing, error on non-ok response
- `getModuleProgress`: 401 → null (special case), success → parsed response
- `getChatHistory`: 401 → empty session, success → parsed messages
- `getNextModule`: 204 → null, `completedUnit` response, `nextModuleSlug` response (union type branching)
- `transcribeAudio`: status-specific error messages (413, 429), 30s timeout override

### Group 3: Hooks (mock `fetch` + fake timers)

**`src/hooks/__tests__/useAuth.test.ts`** (uses real `fetchWithRefresh`)
- Starts with `isLoading: true`, resolves to authenticated or unauthenticated
- Authenticated response: all fields mapped correctly, `tosAccepted` derived from `tos_accepted_at`
- `response.ok = false` → unauthenticated state
- Network error → unauthenticated state (no throw)
- `login()` → constructs OAuth URL with `next`, `origin`, `anonymous_token` params
- `logout()` → POSTs to `/auth/logout`, resets all state
- `refreshUser()` → re-fetches from `/auth/me`

**`src/hooks/__tests__/useActivityTracker.test.ts`** (mock `fetch` + `vi.useFakeTimers()`)
- Initial heartbeat on mount
- Periodic heartbeats while active
- Inactivity timeout stops heartbeats
- Activity events (scroll, mousemove, keydown) reset the inactivity timer
- `sendBeacon` on visibility change to hidden
- `sendBeacon` on cleanup/unmount
- `enabled: false` → no listeners, no heartbeats
- `triggerActivity()` resets activity state

## Out of Scope

- **Component render tests** for the 44 components — the Module.progress test covers the most critical component flow. Expanding component coverage is a separate effort.
- **Admin/Facilitator views** — internal tools, low ROI.
- **Analytics/error tracking wrappers** — testing that `posthog.capture()` was called is testing mock behavior.
- **Static pages** (Privacy, Terms) — no logic.
- **Snapshot tests** — test what the DOM looks like, not what the user experiences.
- **`progress.ts`** — two thin functions (`markComplete`, `sendHeartbeatPing`) that are straightforward wrappers around `fetchWithRefresh`. Already indirectly tested through `useActivityTracker` (heartbeat) and `Module.progress.test.tsx` (markComplete). Not worth a dedicated test file.
- **`admin.ts`** — admin API client, low blast radius.

## File Organization

Follow existing conventions:
- Utils: `src/utils/__tests__/*.test.ts` (matches existing `branchColors.test.ts`, `branchLayout.test.ts`)
- API: `src/api/__tests__/*.test.ts` (new directory)
- Hooks: `src/hooks/__tests__/*.test.ts` (new directory)
- Shared test utils: `src/test/fetchMock.ts` (alongside existing `src/test/setup.ts`)

## Implementation Order

Bottom-up, so each layer's dependencies are tested before the layer itself:

1. Pure utilities (4 files, no dependencies between them — can parallelize)
2. Shared fetch mock utility
3. `fetchWithRefresh` tests (foundation for all API/hook tests)
4. `modules.ts` tests (uses real `fetchWithRefresh`)
5. `useAuth` tests (uses real `fetchWithRefresh`)
6. `useActivityTracker` tests (uses real `sendHeartbeatPing` → real `fetchWithRefresh`)

## Success Criteria

- All 8 new test files pass alongside existing 7 test files
- `npm test` runs the full suite (15 test files)
- No test-only methods added to production code
- Shared fetch mock utility used consistently (no per-file fetch mocking patterns)
- Tests verify behavior, not mock existence (per testing anti-patterns skill)
