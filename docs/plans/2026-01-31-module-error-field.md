# Module Error Field Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Surface module flattening errors to the frontend instead of silently showing empty content.

**Architecture:** Add an optional `error` field to `FlattenedModule` that captures flattening errors. When present, the API returns it and the frontend displays an error message instead of empty content.

**Tech Stack:** Python (dataclass), FastAPI, TypeScript, React

---

## Task 1: Add error field to FlattenedModule dataclass

**Files:**
- Modify: `core/modules/flattened_types.py:22-29`
- Test: `core/modules/tests/test_flattened_types.py`

**Step 1: Write the failing test**

Add to `core/modules/tests/test_flattened_types.py`:

```python
def test_flattened_module_with_error():
    """FlattenedModule can store an error message."""
    module = FlattenedModule(
        slug="broken",
        title="Broken Module",
        content_id=None,
        sections=[],
        error="'from' anchor not found: Cascades are when...",
    )
    assert module.error == "'from' anchor not found: Cascades are when..."


def test_flattened_module_error_defaults_to_none():
    """FlattenedModule error field defaults to None."""
    module = FlattenedModule(
        slug="working",
        title="Working Module",
        content_id=None,
        sections=[{"type": "page", "segments": []}],
    )
    assert module.error is None
```

**Step 2: Run test to verify it fails**

Run: `pytest core/modules/tests/test_flattened_types.py::test_flattened_module_with_error -v`

Expected: FAIL with `TypeError: FlattenedModule.__init__() got an unexpected keyword argument 'error'`

**Step 3: Add error field to FlattenedModule**

Modify `core/modules/flattened_types.py` - replace lines 22-29 with:

```python
@dataclass
class FlattenedModule:
    """A module with all sections flattened and resolved."""

    slug: str
    title: str
    content_id: UUID | None
    sections: list[dict] = field(default_factory=list)
    error: str | None = None
```

**Step 4: Run tests to verify they pass**

Run: `pytest core/modules/tests/test_flattened_types.py -v`

Expected: All tests PASS

**Step 5: Commit**

```bash
git add core/modules/flattened_types.py core/modules/tests/test_flattened_types.py
git commit -m "$(cat <<'EOF'
feat(core): add error field to FlattenedModule

Allows storing flattening errors so they can be surfaced to users
instead of silently showing empty content.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Store error when flattening fails

**Files:**
- Modify: `core/content/github_fetcher.py:496-504`

**Step 1: Modify the exception handler to store the error**

In `core/content/github_fetcher.py`, find the flattening loop (around line 491-504) and modify the exception handler.

Note: Truncate long error messages to 1000 characters to avoid poor UX with very long parsing errors.

```python
        # Flatten all modules (now bundling functions can use get_cache())
        for slug, module in raw_modules.items():
            try:
                flattened = flatten_module(module, lookup)
                cache.flattened_modules[slug] = flattened
            except Exception as e:
                logger.warning(f"Failed to flatten module {slug}: {e}")
                # Truncate long error messages for better UX
                error_msg = str(e)
                if len(error_msg) > 1000:
                    error_msg = error_msg[:1000] + "..."
                # Create a minimal flattened module with the error message
                cache.flattened_modules[slug] = FlattenedModule(
                    slug=module.slug,
                    title=module.title,
                    content_id=module.content_id,
                    sections=[],
                    error=error_msg,
                )
```

**Step 2: Verify manually**

Run: `python -c "
import asyncio
from core.content import refresh_cache, get_cache

async def main():
    await refresh_cache()
    cache = get_cache()
    for slug, module in cache.flattened_modules.items():
        if module.error:
            print(f'{slug}: {module.error}')
        else:
            print(f'{slug}: OK ({len(module.sections)} sections)')

asyncio.run(main())
"`

Expected: Any modules with flattening errors show their error message.

**Step 3: Commit**

```bash
git add core/content/github_fetcher.py
git commit -m "$(cat <<'EOF'
feat(content): store flattening errors in FlattenedModule

When a module fails to flatten (e.g., missing anchor, invalid reference),
the error message is now stored in the module's error field instead of
being silently discarded.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Include error field in API serialization

**Files:**
- Modify: `web_api/routes/modules.py:66-75`
- Test: `web_api/tests/test_modules_api.py`

**Step 1: Write the failing test**

Add to `web_api/tests/test_modules_api.py`:

```python
import pytest
from unittest.mock import patch
from uuid import UUID

from fastapi.testclient import TestClient
from main import app
from core.modules.flattened_types import FlattenedModule


@pytest.fixture
def client():
    return TestClient(app)


def test_get_module_returns_error_field_when_present(client):
    """GET /api/modules/{slug} should include error field when module has error."""
    mock_module = FlattenedModule(
        slug="broken-module",
        title="Broken Module",
        content_id=UUID("00000000-0000-0000-0000-000000000001"),
        sections=[],
        error="'from' anchor not found: some text...",
    )

    with patch("web_api.routes.modules.load_flattened_module", return_value=mock_module):
        response = client.get("/api/modules/broken-module")

    assert response.status_code == 200
    data = response.json()
    assert data["slug"] == "broken-module"
    assert data["title"] == "Broken Module"
    assert data["sections"] == []
    assert data["error"] == "'from' anchor not found: some text..."


def test_get_module_omits_error_field_when_none(client):
    """GET /api/modules/{slug} should not include error field when module is OK."""
    mock_module = FlattenedModule(
        slug="working-module",
        title="Working Module",
        content_id=UUID("00000000-0000-0000-0000-000000000002"),
        sections=[{"type": "page", "segments": []}],
        error=None,
    )

    with patch("web_api.routes.modules.load_flattened_module", return_value=mock_module):
        response = client.get("/api/modules/working-module")

    assert response.status_code == 200
    data = response.json()
    assert data["slug"] == "working-module"
    assert "error" not in data


def test_list_modules_includes_errored_modules(client):
    """GET /api/modules should include modules with errors in the list."""
    mock_working = FlattenedModule(
        slug="working",
        title="Working Module",
        content_id=UUID("00000000-0000-0000-0000-000000000001"),
        sections=[{"type": "page", "segments": []}],
        error=None,
    )
    mock_broken = FlattenedModule(
        slug="broken",
        title="Broken Module",
        content_id=UUID("00000000-0000-0000-0000-000000000002"),
        sections=[],
        error="Some error",
    )

    def mock_load(slug):
        if slug == "working":
            return mock_working
        elif slug == "broken":
            return mock_broken
        raise Exception("Not found")

    with patch("web_api.routes.modules.get_available_modules", return_value=["working", "broken"]):
        with patch("web_api.routes.modules.load_flattened_module", side_effect=mock_load):
            response = client.get("/api/modules")

    assert response.status_code == 200
    data = response.json()
    slugs = [m["slug"] for m in data["modules"]]
    assert "working" in slugs
    assert "broken" in slugs  # Errored modules still appear in list
```

**Step 2: Run test to verify it fails**

Run: `pytest web_api/tests/test_modules_api.py::test_get_module_returns_error_field_when_present -v`

Expected: FAIL with `KeyError: 'error'` or `AssertionError` because the current serializer doesn't include the error field.

Note: The second test (`test_get_module_omits_error_field_when_none`) will pass initially since the current serializer already doesn't include error.

**Step 3: Update serialize_flattened_module**

Modify `web_api/routes/modules.py` - replace the `serialize_flattened_module` function (lines 66-75):

```python
def serialize_flattened_module(module: FlattenedModule) -> dict:
    """Serialize a flattened module to JSON for the API response.

    Sections are already dicts (page, video, article) so we pass them through.
    Error field is only included when present (not None).
    """
    result = {
        "slug": module.slug,
        "title": module.title,
        "sections": module.sections,
    }
    if module.error is not None:
        result["error"] = module.error
    return result
```

**Step 4: Run tests to verify they pass**

Run: `pytest web_api/tests/test_modules_api.py -v`

Expected: All tests PASS

**Step 5: Commit**

```bash
git add web_api/routes/modules.py web_api/tests/test_modules_api.py
git commit -m "$(cat <<'EOF'
feat(api): include error field in module API response

The /api/modules/{slug} endpoint now includes an 'error' field when
a module failed to flatten. This allows the frontend to display
meaningful error messages instead of empty content.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3b: Include error field in progress endpoint

**Files:**
- Modify: `web_api/routes/modules.py` (get_module_progress_endpoint function)
- Test: `web_api/tests/test_modules_api.py`

**Context:** When a module has an error, the progress endpoint returns 0/0 progress with no explanation. Users need to see the error message here too.

**Step 1: Write the failing test**

Add to `web_api/tests/test_modules_api.py`:

```python
def test_get_module_progress_includes_error_when_present(client):
    """GET /api/modules/{slug}/progress should include error field when module has error."""
    mock_module = FlattenedModule(
        slug="broken-module",
        title="Broken Module",
        content_id=UUID("00000000-0000-0000-0000-000000000001"),
        sections=[],
        error="'from' anchor not found: some text...",
    )

    with patch("web_api.routes.modules.load_flattened_module", return_value=mock_module):
        response = client.get("/api/modules/broken-module/progress")

    assert response.status_code == 200
    data = response.json()
    assert data["error"] == "'from' anchor not found: some text..."
    assert data["progress"]["total"] == 0
```

**Step 2: Run test to verify it fails**

Run: `pytest web_api/tests/test_modules_api.py::test_get_module_progress_includes_error_when_present -v`

Expected: FAIL with `KeyError: 'error'` because progress endpoint doesn't include error field.

**Step 3: Update get_module_progress_endpoint**

In `web_api/routes/modules.py`, find the `get_module_progress_endpoint` function (around line 105) and add the error field to the response.

Find the return statement (around line 200-213) and modify it to include error:

```python
    # Build response
    response = {
        "module": {
            "id": str(module.content_id) if module.content_id else None,
            "slug": module.slug,
            "title": module.title,
        },
        "status": status,
        "progress": {"completed": completed_count, "total": total_count},
        "lenses": lenses_progress,
        "chatSession": {
            "sessionId": chat_session.id if chat_session else None,
            "hasMessages": has_messages,
        },
    }

    # Include error if module has one
    if module.error:
        response["error"] = module.error

    return response
```

**Step 4: Run tests to verify they pass**

Run: `pytest web_api/tests/test_modules_api.py -v`

Expected: All tests PASS

**Step 5: Commit**

```bash
git add web_api/routes/modules.py web_api/tests/test_modules_api.py
git commit -m "$(cat <<'EOF'
feat(api): include error field in module progress endpoint

When a module has a flattening error, the progress endpoint now
includes the error message so users understand why the module
shows 0/0 progress.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add error field to frontend Module type

**Files:**
- Modify: `web_frontend/src/types/module.ts:144-148`

**Step 1: Update the Module type**

In `web_frontend/src/types/module.ts`, find the Module type (around line 144) and add the error field:

```typescript
export type Module = {
  slug: string;
  title: string;
  sections: ModuleSection[];
  error?: string;
};
```

**Step 2: Verify TypeScript compiles**

Run: `cd web_frontend && npm run build`

Expected: Build succeeds (no type errors)

**Step 3: Commit**

```bash
git add web_frontend/src/types/module.ts
git commit -m "$(cat <<'EOF'
feat(frontend): add optional error field to Module type

Allows TypeScript to recognize the error field from the API response.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Display error in Module view

**Files:**
- Modify: `web_frontend/src/views/Module.tsx:916-928`

**Step 1: Update the error display section**

In `web_frontend/src/views/Module.tsx`, find the error state section (around line 916-928) and update it to also check for `module.error`:

```tsx
  // Error states
  if (loadError || !module) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-stone-50">
        <div className="text-center">
          <p className="text-red-600 mb-4">{loadError ?? "Module not found"}</p>
          <a href="/" className="text-emerald-600 hover:underline">
            Go home
          </a>
        </div>
      </div>
    );
  }

  // Module loaded but has flattening error
  if (module.error) {
    return (
      <div className="min-h-dvh bg-stone-50">
        <div className="sticky top-0 z-50 bg-white border-b border-stone-200">
          <div className="max-w-3xl mx-auto px-4 py-4">
            <h1 className="text-xl font-semibold text-stone-900">{module.title}</h1>
          </div>
        </div>
        <div className="max-w-3xl mx-auto px-4 py-12">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-red-800 mb-2">
              Module Error
            </h2>
            <p className="text-red-700 mb-4">
              This module failed to load due to a content error:
            </p>
            <pre className="bg-red-100 p-4 rounded text-sm text-red-900 overflow-x-auto whitespace-pre-wrap">
              {module.error}
            </pre>
            <p className="text-red-600 text-sm mt-4">
              Please contact the course administrators to resolve this issue.
            </p>
          </div>
        </div>
      </div>
    );
  }
```

**Step 2: Verify it compiles**

Run: `cd web_frontend && npm run build`

Expected: Build succeeds

**Step 3: Manual test (optional)**

If you have a module with an error in staging, navigate to it and verify the error message displays.

**Step 4: Commit**

```bash
git add web_frontend/src/views/Module.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): display module flattening errors to users

When a module has an error (failed to flatten), the frontend now shows
a clear error message with the specific error details instead of
showing empty content.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Run full test suite and verify

**Step 1: Run backend tests**

Run: `pytest core/modules/tests/test_flattened_types.py web_api/tests/test_modules_api.py -v`

Expected: All 6 new tests PASS:
- `test_flattened_module_with_error`
- `test_flattened_module_error_defaults_to_none`
- `test_get_module_returns_error_field_when_present`
- `test_get_module_omits_error_field_when_none`
- `test_list_modules_includes_errored_modules`
- `test_get_module_progress_includes_error_when_present`

**Step 2: Run linters**

Run: `ruff check . && ruff format --check .`

Expected: No errors

**Step 3: Run frontend build**

Run: `cd web_frontend && npm run lint && npm run build`

Expected: No errors

**Step 4: Final commit (if any formatting fixes needed)**

If ruff or eslint made changes, commit them:

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: fix linting issues

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Summary

After completing all tasks:

1. `FlattenedModule` has an optional `error: str | None` field
2. `github_fetcher.py` stores error messages when flattening fails (truncated to 1000 chars)
3. `serialize_flattened_module()` includes error in API response when present
4. Progress endpoint also includes error field when module has error
5. Frontend `Module` type has optional `error` field
6. `Module.tsx` displays a user-friendly error message when `module.error` is set

**API Response Examples:**

GET /api/modules/{slug} - Success:
```json
{"slug": "demo", "title": "Introduction", "sections": [...]}
```

GET /api/modules/{slug} - Error:
```json
{"slug": "demo", "title": "Introduction", "sections": [], "error": "'from' anchor not found: Cascades are when..."}
```

GET /api/modules/{slug}/progress - Error:
```json
{
  "module": {"id": null, "slug": "demo", "title": "Introduction"},
  "status": "not_started",
  "progress": {"completed": 0, "total": 0},
  "lenses": [],
  "chatSession": {"sessionId": null, "hasMessages": false},
  "error": "'from' anchor not found: Cascades are when..."
}
```

---

## Notes from Code Review

**Addressed in this plan:**
- Error messages are truncated to 1000 characters to avoid poor UX with long parsing errors
- Progress endpoint includes error field so users understand 0/0 progress
- List endpoint test confirms errored modules still appear in module list

**Intentional behavior (not bugs):**
- Errored modules appear in module list (they exist, just with error)
- When a module is fixed in source content, next `refresh_cache()` clears the error automatically
