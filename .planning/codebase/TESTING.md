# Testing Patterns

**Analysis Date:** 2026-02-14

## Test Framework

**Backend (Python):**
- pytest 9.0.2
- Config: `/home/penguin/code/lens-platform/ws3/pytest.ini`
- Plugins: pytest-asyncio 1.3.0, pytest-anyio 4.12.1

**Frontend (TypeScript):**
- Vitest 4.0.18
- Config: `/home/penguin/code/lens-platform/ws3/web_frontend/vitest.config.ts`
- Testing Library: @testing-library/react 16.3.2, @testing-library/jest-dom 6.9.1

**Run Commands:**
```bash
# Python - All tests
pytest

# Python - Specific module
pytest core/tests/
pytest discord_bot/tests/
pytest web_api/tests/

# Python - Watch mode (not configured)

# Python - Coverage (not configured via pytest)

# TypeScript - Frontend tests
cd web_frontend
npm run test              # Run all tests (vitest)

# TypeScript - Content processor tests
cd content_processor
npm run test
```

## Test File Organization

**Python Location:**
- Co-located in `tests/` subdirectories within each module
- Pattern: `{module}/tests/test_{feature}.py`
- Examples:
  - `discord_bot/tests/test_nickname_cog.py`
  - `web_api/tests/test_courses_api.py`
  - `core/notifications/tests/test_dispatcher.py`
  - `core/calendar/tests/test_events.py`

**TypeScript Location:**
- Co-located with source files
- Pattern: `{filename}.test.ts` or `{filename}.test.tsx`
- Some tests in `__tests__/` subdirectories
- Examples:
  - `web_frontend/src/utils/branchLayout.test.ts`
  - `web_frontend/src/utils/__tests__/branchLayout.test.ts`
  - `web_frontend/src/test/CourseOverview.contract.test.tsx`
  - `content_processor/src/parser/article.test.ts`

**Naming:**
- Python: `test_*.py` (pytest discovery)
- TypeScript: `*.test.ts` or `*.test.tsx` (Vitest discovery)

**Structure:**
```
discord_bot/
  tests/
    conftest.py          # Shared fixtures
    helpers.py           # Test utilities
    test_nickname_cog.py
    test_scheduler.py
    fake_interaction.py  # Mock Discord objects
```

## Test Structure

**Python Suite Organization:**
```python
"""Tests for notification dispatcher."""

import pytest
from unittest.mock import AsyncMock, patch


class TestTimezoneFormatting:
    @pytest.mark.asyncio
    async def test_formats_meeting_time_in_user_timezone(self):
        """meeting_time should be formatted in user's timezone when sending."""
        # Arrange
        mock_user = {...}
        captured_body = None

        def capture_email(to_email, subject, body):
            nonlocal captured_body
            captured_body = body
            return True

        # Act
        with patch("core.notifications.dispatcher.get_user_by_id",
                   AsyncMock(return_value=mock_user)):
            with patch("core.notifications.dispatcher.send_email",
                      side_effect=capture_email):
                await send_notification(...)

        # Assert
        assert captured_body is not None
        assert "Wednesday at 10:00 PM (UTC+7)" in captured_body
```

**TypeScript Suite Organization:**
```typescript
import { describe, it, expect } from "vitest";
import { buildBranchLayout } from "../branchLayout";

describe("buildBranchLayout", () => {
  it("returns all trunk items when no optional sections", () => {
    // Arrange
    const stages = [stage("A"), stage("B"), stage("C")];

    // Act
    const layout = buildBranchLayout(stages);

    // Assert
    expect(layout).toEqual([
      { kind: "trunk", index: 0, stage: stages[0] },
      { kind: "trunk", index: 1, stage: stages[1] },
      { kind: "trunk", index: 2, stage: stages[2] },
    ]);
  });
});
```

**Patterns:**
- Class-based grouping in Python (e.g., `class TestTimezoneFormatting`)
- `describe`/`it` nesting in TypeScript (Vitest/Jest style)
- Arrange-Act-Assert pattern
- Descriptive test names as sentences

## Mocking

**Python Framework:**
- `unittest.mock` (`AsyncMock`, `MagicMock`, `patch`)
- No dedicated mocking library beyond standard library

**Python Patterns:**
```python
from unittest.mock import AsyncMock, MagicMock, patch

# Mock async function
with patch("core.notifications.dispatcher.get_user_by_id",
           AsyncMock(return_value=mock_user)):
    result = await send_notification(...)

# Mock sync function
with patch("core.notifications.dispatcher.send_email",
           return_value=True) as mock_email:
    await send_notification(...)
    mock_email.assert_called_once()

# Capture function arguments
captured_body = None
def capture_email(to_email, subject, body):
    nonlocal captured_body
    captured_body = body
    return True

with patch("...", side_effect=capture_email):
    ...
```

**TypeScript Framework:**
- Vitest's `vi` API for mocking
- No separate mocking library (Vitest built-in)

**TypeScript Patterns:**
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock module before importing component
vi.mock("vike/client/router", () => ({
  navigate: vi.fn(),
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation((url: string) => {
    if (url.includes("/api/users/me")) {
      return Promise.resolve({ ok: false });
    }
    return Promise.resolve({ ok: true, json: async () => data });
  });
});
```

**What to Mock:**
- External APIs (Discord, SendGrid, Google Calendar)
- Database connections in unit tests (integration tests use real DB with transactions)
- HTTP requests (`fetch`, `httpx`)
- Time-dependent functions
- File system operations

**What NOT to Mock:**
- Business logic in `core/` when testing adapters (use real implementations)
- Type definitions and interfaces
- Pure functions (test directly)

## Fixtures and Factories

**Python Test Data:**
```python
# discord_bot/tests/helpers.py
async def create_test_cohort(
    conn: AsyncConnection,
    course_slug: str = "default",
    name: str = "Test Cohort",
    num_meetings: int = 8,
) -> dict:
    """Create a cohort for testing."""
    result = await conn.execute(
        insert(cohorts).values(...).returning(cohorts)
    )
    return dict(result.mappings().first())

async def create_test_user(
    conn: AsyncConnection,
    cohort_id: int,
    discord_id: str,
    availability: str = '{"Monday": ["09:00-09:30"]}',
    role: str = "participant",
) -> dict:
    """Create a user with a signup for a cohort."""
    # ... insert user, signup, facilitator records
```

**TypeScript Test Data:**
```typescript
// Helper factory functions
function stage(title: string, optional = false): StageInfo {
  return { type: "article", title, duration: null, optional };
}

// Shared fixtures (JSON files)
import courseProgressFixture from "../../../fixtures/course_progress_response.json";
```

**Location:**
- Python: `tests/helpers.py` for factory functions
- TypeScript: Inline helper functions or imported JSON fixtures
- JSON fixtures: `web_frontend/fixtures/` (shared between frontend and backend contract tests)

## Coverage

**Requirements:** No enforced coverage targets

**Python View Coverage:**
```bash
# Not configured via pytest
# Manual coverage run would need pytest-cov installed
```

**TypeScript View Coverage:**
```bash
cd web_frontend
npm run test -- --coverage  # Vitest coverage
```

**Current State:**
- No coverage reporting in CI
- No coverage badges
- Tests focus on critical paths (scheduling, API contracts, notifications)

## Test Types

**Unit Tests:**
- Scope: Individual functions and classes
- Isolation: Mock external dependencies
- Examples:
  - `core/notifications/tests/test_dispatcher.py` - notification routing logic
  - `web_frontend/src/utils/branchLayout.test.ts` - layout calculation
  - `content_processor/src/parser/article.test.ts` - parsing logic

**Integration Tests:**
- Scope: Multiple components working together
- Database: Uses transactional fixtures (rollback after test)
- Examples:
  - `discord_bot/tests/test_availability_integration.py`
  - `web_api/tests/test_progress_integration.py`
  - `core/notifications/tests/test_email_integration.py`

**Contract Tests:**
- Scope: API response format validation
- Fixtures: Shared JSON fixtures between frontend and backend
- Examples:
  - `web_frontend/src/test/CourseOverview.contract.test.tsx`
  - `web_api/tests/test_course_progress_contract.py`

**E2E Tests:**
- Scope: Full user flows
- Examples:
  - `discord_bot/tests/test_discord_e2e.py`
  - `web_api/tests/test_progress_e2e.py`

**No dedicated E2E framework** (Playwright, Cypress) for frontend - E2E tests are Python-based using TestClient

## Common Patterns

**Async Testing (Python):**
```python
import pytest

@pytest.mark.asyncio
async def test_creates_event_with_correct_params(self):
    """Test async function."""
    result = await create_meeting_event(...)
    assert result is not None
```

**Async Testing (TypeScript):**
```typescript
it("renders module titles from the fixture", async () => {
  render(<CourseOverview courseId="default" />);

  await waitFor(() => {
    const elements = screen.getAllByText(firstModule.title);
    expect(elements.length).toBeGreaterThan(0);
  });
});
```

**Error Testing (Python):**
```python
def test_reports_error_for_missing_title(self):
    """Should report error for invalid data."""
    result = parseArticle(content, 'articles/test.md')

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].severity).toBe('error');
```

**Error Testing (TypeScript):**
```typescript
it("reports error for missing title", () => {
  const result = parseArticle(content, 'articles/test.md');

  expect(result.errors.length).toBeGreaterThan(0);
  expect(result.errors.some(e =>
    e.message.toLowerCase().includes('title')
  )).toBe(true);
});
```

## Database Testing

**Fixture Pattern:**
```python
# discord_bot/tests/conftest.py
@pytest_asyncio.fixture
async def db_conn():
    """
    Provide a DB connection that rolls back after each test.

    All changes made during the test are visible within the test,
    but rolled back afterward so DB stays clean.
    """
    load_dotenv(".env.local")

    from core.database import set_engine

    engine = create_async_engine(database_url, ...)
    set_engine(engine)  # Inject into singleton

    async with engine.connect() as conn:
        txn = await conn.begin()
        try:
            yield conn
        finally:
            await txn.rollback()

    set_engine(None)
    await engine.dispose()
```

**Usage:**
```python
async def test_creates_groups(db_conn):
    """Test uses db_conn fixture."""
    cohort = await create_test_cohort(db_conn)
    user = await create_test_user(db_conn, cohort["cohort_id"], "123")
    # ... test logic
    # Automatic rollback after test
```

## Content Cache Testing

**Auto-fixture for course data:**
```python
# conftest.py
@pytest.fixture(autouse=True)
def init_content_cache():
    """Initialize a minimal content cache for tests that need course data."""
    from core.content.cache import set_cache, clear_cache, ContentCache

    test_cache = ContentCache(
        courses={
            "default": ParsedCourse(slug="default", title="AI Safety Course", ...)
        },
        ...
    )
    set_cache(test_cache)

    yield

    clear_cache()
```

## React Component Testing

**Setup File:**
```typescript
// web_frontend/src/test/setup.ts
import "@testing-library/jest-dom";

// Mock localStorage
const localStorageMock = ...
Object.defineProperty(window, "localStorage", { value: localStorageMock });

// Mock window.matchMedia, IntersectionObserver, ResizeObserver
```

**Component Test Pattern:**
```typescript
import { render, screen, waitFor } from "@testing-library/react";

it("renders the course title from the fixture", async () => {
  render(<CourseOverview courseId="default" />);

  await waitFor(() => {
    const elements = screen.getAllByText(courseProgressFixture.course.title);
    expect(elements.length).toBeGreaterThan(0);
  });
});
```

## Dynamic Test Discovery

**Pattern for content-agnostic tests:**
```python
# web_api/tests/test_courses_api.py
def get_first_module_before_meeting(course_slug: str) -> str | None:
    """Find first module that's followed by a meeting."""
    course = load_course(course_slug)
    for i, item in enumerate(course.progression[:-1]):
        if isinstance(item, ModuleRef) and isinstance(
            course.progression[i + 1], MeetingMarker
        ):
            return item.slug
    return None

def test_get_next_module_returns_unit_complete():
    """Should return completedUnit when next item is a meeting."""
    module_slug = get_first_module_before_meeting("default")
    if module_slug is None:
        pytest.skip("No module→meeting pattern in default course")

    response = client.get(f"/api/courses/default/next-module?current={module_slug}")
    assert response.status_code == 200
```

## Test Configuration

**Python (`pytest.ini`):**
```ini
[pytest]
pythonpath = .
addopts = --import-mode=importlib
asyncio_mode = auto
asyncio_default_fixture_loop_scope = function
```

**TypeScript (`vitest.config.ts`):**
```typescript
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
```

---

*Testing analysis: 2026-02-14*
