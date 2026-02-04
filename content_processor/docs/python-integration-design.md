# Python-TypeScript Content Processor Integration

## Overview

The TypeScript content processor will **entirely replace** the Python markdown parser and flattener. Python code in `core/modules/markdown_parser.py`, `flattener.py`, and related files will be deleted.

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. GitHub Fetch                                                              │
│    github_fetcher.py fetches raw .md files from Lens-Academy/lens-edu-relay │
│    Stores in memory as dict: {path: content}                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. Content Processing (NEW)                                                  │
│    Python serializes files to JSON → pipes to TypeScript subprocess          │
│    TypeScript processes → returns JSON result                                │
│    Python parses result into cache.flattened_modules                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. Cache Storage                                                             │
│    ContentCache.flattened_modules holds processed modules                    │
│    Same structure as current - API layer unchanged                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 4. API Endpoints                                                             │
│    GET /api/modules/{slug} returns from cache.flattened_modules              │
│    No changes needed - cache shape unchanged                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 5. Frontend                                                                  │
│    Fetches /api/modules/{slug}, renders sections                             │
│    No changes needed - API response shape unchanged                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Key Architecture Decision: Subprocess via stdin/stdout

**Decision:** Python calls TypeScript CLI via subprocess, piping content through stdin.

**Why subprocess (vs HTTP service, vs native bindings):**
- Simple - CLI already exists
- Infrequent calls (startup + webhooks) - ~500ms overhead acceptable
- No infrastructure to manage
- Not CPU-blocking (async subprocess, Python event loop stays free)

**Interface:**
```bash
echo '{"modules/foo.md": "content...", ...}' | npx tsx src/cli.ts --stdin
```

**Why stdin (vs temp files):**
- Hundreds of markdown files - avoids I/O overhead
- Single source of truth - no cache/tempdir drift
- Content flows directly from memory to memory

## Interfaces and Testing Strategy

### Interface 1: TypeScript CLI stdin

**Boundary:** CLI reads JSON from stdin instead of filesystem

**Change needed:** Add `--stdin` flag to `src/cli.ts`

**Test (TypeScript):**
- One test verifying `--stdin` produces same output as file-based input
- Uses existing fixture, just tests the stdin code path

---

### Interface 2: Python → TypeScript subprocess

**Boundary:** Python serializes cache, calls subprocess, parses result

**Change needed:** New `core/content/processor.py` module

**Test (Python):**
- One integration test using `golden/actual-content` fixture
- Reads fixture .md files → serializes to JSON → real subprocess → compare to expected.json
- Tests the full round-trip through real TypeScript

---

### Interface 3: GitHub → Python

**Boundary:** Fetch files from GitHub API

**Change needed:** None (already exists), but integration point changes

**Test (Python):**
- One shallow integration test hitting real GitHub
- Fetches single test fixture file: `_test-fixture.md`
- Verifies content matches expected (hardcoded in test)
- Tests: credentials work, can reach repo, basic fetch works

**Requires:** Create `_test-fixture.md` in GitHub repo (stable, never changes)

---

### Interface 4: Processed content → Cache

**Boundary:** Subprocess result stored in `cache.flattened_modules`

**Change needed:** Modify `github_fetcher.py` to use subprocess instead of Python flattener

**Test (Python):**
- Part of interface 2 test - verify result has correct shape
- Existing API tests should continue passing (cache shape unchanged)

---

### Interface 5: API → Frontend (Contract Testing)

**Boundary:** FastAPI serves JSON that frontend TypeScript types can parse

**Approach:** Shared JSON fixtures used by both backend and frontend tests

**Location:** `tests/contracts/`

**Fixture files:**
- `module-mixed.json` - Comprehensive module with all section types (page, lens-video, lens-article)

**Test (Python):**
```python
def test_api_response_matches_contract():
    # Load contract fixture, populate cache, call API, assert match
    expected = json.load(open("tests/contracts/module-mixed.json"))
    response = client.get(f"/api/modules/{expected['slug']}")
    assert response.json() == expected
```

**Test (TypeScript/Frontend):**
```typescript
import type { Module } from '../types/module';
import fixture from '../../../tests/contracts/module-mixed.json';

test('frontend types match API contract', () => {
  // Compile-time check: if types don't match fixture shape, TS errors
  const module: Module = fixture;
  expect(module.sections.length).toBeGreaterThan(0);
});
```

**Why this works:**
- Single source of truth for API shape
- If backend changes output → Python test fails
- If frontend types drift → TypeScript test fails (or compile error)
- Contract file is human-readable documentation of the API

---

## Test Summary

| # | Interface | Test Type | What it Tests |
|---|-----------|-----------|---------------|
| 1 | TS CLI stdin | Unit (TS) | `--stdin` flag reads JSON correctly |
| 2 | Python→TS subprocess | Integration (Py) | Full round-trip with golden fixture |
| 3 | GitHub→Python | Unit+1 (Py) | Real GitHub fetch of test fixture |
| 4 | Result→Cache | Covered by #2 | Cache shape correct |
| 5 | API→Frontend | Contract (Py+TS) | Shared fixture validates both sides |

**Total: 4 new tests** (two TS, two Python)

## Decisions Made

### 1. Error Handling
**Decision:** Fail-safe - keep serving stale content rather than crash.
- Subprocess fails → log error, keep old cache, don't crash server
- GitHub webhook fails → log error, don't update cache, don't crash
- Surface errors to operators via logging

### 2. Incremental Updates
**Decision:** Incremental GitHub fetch, full TypeScript processing.
- Python tracks which files changed (from webhook payload)
- Fetch only changed files from GitHub (webhooks can fire every 10 seconds)
- Update in-memory file map with changed files
- Pass entire file map to TypeScript for full processing
- TypeScript always processes the whole vault

### 3. Cache Shape Compatibility
**Decision:** No conversion needed - camelCase flows through.
- TypeScript outputs camelCase (`contentId`, `learningOutcomeId`)
- Python `FlattenedModule.sections` is `list[dict]` - passes through as-is
- API's `serialize_flattened_module()` passes sections through unchanged
- Frontend expects camelCase - matches TypeScript output

### 4. Deployment
**Decision:** Add Node.js to Python container.
- Simple - just add Node.js to Dockerfile
- Minimal overhead (~few MB)
- No infrastructure changes needed

### 5. Startup Sequence
**Decision:** Blocking on startup, crash on failure.
- Server starts → fetch from GitHub → process → cache ready
- Blocking - server shouldn't serve requests with empty cache
- If processing fails on startup → crash and let Railway restart

### 6. Logging and Observability
**Decision:** Capture stderr, log timing.
- Capture TypeScript stderr → Python logging (as warnings)
- Log subprocess duration for metrics
- Any processing errors surfaced in logs

### 7. Python Code Deletion
**Decision:** Delete flattening code, keep fetch/cache infrastructure.
- Delete: `markdown_parser.py`, `flattener.py`, `content.py` (bundling logic)
- Keep: `github_fetcher.py` (still fetches), `cache.py` (still stores), `flattened_types.py` (API uses it)
