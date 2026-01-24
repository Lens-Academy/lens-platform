# Testing Patterns

**Analysis Date:** 2026-01-21

## Test Framework

**Python Runner:**
- pytest with pytest-asyncio
- Config: `pytest.ini` at project root
- Version: pytest-asyncio with auto mode

**Configuration (`pytest.ini`):**
```ini
[pytest]
pythonpath = .
addopts = --import-mode=importlib
asyncio_mode = auto
asyncio_default_fixture_loop_scope = function
```

**Run Commands:**
```bash
pytest                        # Run all tests
pytest core/tests/            # Core module tests only
pytest discord_bot/tests/     # Discord bot tests only
pytest web_api/tests/         # Web API tests only
pytest -v                     # Verbose output
pytest -k "test_name"         # Run specific test by name
pytest --tb=short             # Shorter traceback
```

## Test File Organization

**Location:** Co-located in `tests/` subdirectories within each module

**Structure:**
```
core/
├── modules/
│   └── tests/
│       ├── conftest.py           # Fixtures for module tests
│       ├── fixtures/             # Test data files
│       │   ├── lessons/
│       │   └── courses/
│       ├── test_sessions.py
│       ├── test_courses.py
│       └── test_loader.py
├── notifications/
│   └── tests/
│       ├── conftest.py
│       ├── test_dispatcher.py
│       └── test_email.py
└── tests/
    └── test_meetings.py

discord_bot/
└── tests/
    ├── conftest.py
    ├── test_scheduler.py
    └── test_scheduling_e2e.py

web_api/
└── tests/
    ├── conftest.py
    ├── test_modules_api.py
    └── test_courses_api.py
```

**Naming:**
- Test files: `test_*.py` prefix
- Test functions: `test_*` prefix
- Test classes: `Test*` prefix (e.g., `TestSendNotification`)

## Test Structure

**Function-based Tests (Preferred for simple cases):**
```python
@pytest.mark.asyncio
async def test_create_session(test_user_id):
    """Should create a new module session."""
    session = await create_session(
        user_id=test_user_id, module_slug="intro-to-ai-safety"
    )
    assert session["module_slug"] == "intro-to-ai-safety"
    assert session["current_stage_index"] == 0
    assert session["messages"] == []
```

**Class-based Tests (For grouping related tests):**
```python
class TestSendNotification:
    @pytest.mark.asyncio
    async def test_sends_email_when_enabled(self):
        from core.notifications.dispatcher import send_notification
        # ... test implementation

    @pytest.mark.asyncio
    async def test_sends_discord_when_enabled(self):
        # ... test implementation
```

**Docstrings:**
- Every test has a docstring describing expected behavior
- Format: "Should [do something]" or descriptive statement
- Examples:
  - `"""Should create a new module session."""`
  - `"""Empty string should return empty list."""`
  - `"""Cannot claim a session that's already claimed."""`

## Async Testing

**Pattern:**
```python
@pytest.mark.asyncio
async def test_async_operation(test_user_id):
    """Test an async function."""
    result = await async_function(test_user_id)
    assert result is not None
```

**Note:** With `asyncio_mode = auto` in pytest.ini, the `@pytest.mark.asyncio` decorator is technically optional but explicitly used throughout for clarity.

## Fixtures

**Root-level Fixture (`conftest.py`):**
```python
@pytest.fixture(scope="session")
def event_loop_policy():
    """Use default event loop policy for all async tests."""
    import asyncio
    return asyncio.DefaultEventLoopPolicy()
```

**Database Connection Fixture (Transaction rollback pattern):**
```python
@pytest_asyncio.fixture
async def db_conn():
    """
    Provide a DB connection that rolls back after each test.

    All changes made during the test are visible within the test,
    but rolled back afterward so DB stays clean.
    """
    load_dotenv(".env.local")

    import os
    database_url = os.environ.get("DATABASE_URL", "")
    if database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+asyncpg://", 1)

    engine = create_async_engine(
        database_url,
        connect_args={"statement_cache_size": 0},
    )

    async with engine.connect() as conn:
        txn = await conn.begin()
        try:
            yield conn
        finally:
            await txn.rollback()

    await engine.dispose()
```

**Test User Fixtures:**
```python
@pytest_asyncio.fixture
async def test_user_id():
    """Create a test user and return their user_id. Cleans up after test."""
    from core.database import get_transaction

    unique_id = str(uuid.uuid4())[:8]
    discord_id = f"test_{unique_id}"

    async with get_transaction() as conn:
        result = await conn.execute(
            text("""
                INSERT INTO users (discord_id, discord_username)
                VALUES (:discord_id, :username)
                RETURNING user_id
            """),
            {"discord_id": discord_id, "username": f"test_user_{unique_id}"},
        )
        user_id = result.fetchone()[0]

    yield user_id

    # Cleanup
    async with get_transaction() as conn:
        await conn.execute(
            text("DELETE FROM users WHERE user_id = :user_id"),
            {"user_id": user_id}
        )
```

**Content Cache Fixtures:**
```python
@pytest.fixture(autouse=True)
def init_content_cache():
    """Initialize a minimal content cache for tests that need course data."""
    from core.content.cache import set_cache, clear_cache, ContentCache
    from core.modules.markdown_parser import ParsedCourse

    test_cache = ContentCache(
        courses={
            "default": ParsedCourse(
                slug="default",
                title="AI Safety Course",
                progression=[],
            )
        },
        modules={},
        articles={},
        video_transcripts={},
        last_refreshed=datetime.now(timezone.utc),
        last_commit_sha=None,
    )
    set_cache(test_cache)

    yield

    clear_cache()
```

**Engine Cleanup Fixture:**
```python
@pytest_asyncio.fixture(autouse=True)
async def cleanup_engine():
    """Clean up the database engine after each test to avoid connection pool issues."""
    yield
    from core.database import close_engine
    await close_engine()
```

## Mocking

**Framework:** `unittest.mock` (standard library)

**Patterns:**

**Patching module-level functions:**
```python
from unittest.mock import patch, AsyncMock

with patch("core.notifications.dispatcher.get_user_by_id", AsyncMock(return_value=mock_user)):
    result = await send_notification(user_id=1, ...)
```

**Nested patches (common pattern):**
```python
with patch("module.path.func1") as mock1:
    with patch("module.path.func2") as mock2:
        with patch("module.path.func3") as mock3:
            result = await function_under_test()

mock1.assert_called_once()
mock2.assert_called_with(expected_args)
```

**FastAPI TestClient mocking:**
```python
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_endpoint():
    with patch("web_api.routes.modules.get_current_user") as mock_auth:
        mock_auth.return_value = {"sub": "test_discord_123", "username": "testuser"}

        with patch("web_api.routes.modules.claim_session") as mock_claim:
            mock_claim.return_value = {"session_id": 1, "user_id": 42}

            response = client.post("/api/module-sessions/1/claim")
            assert response.status_code == 200
```

**Exception mocking:**
```python
with patch("module.function") as mock_fn:
    mock_fn.side_effect = Exception("API error")
    result = function_that_catches_exceptions()
    assert result is False
```

**MagicMock for complex objects:**
```python
from unittest.mock import MagicMock

mock_stage = MagicMock()
mock_stage.type = "chat"
mock_stage.instructions = "Test instructions"
mock_stage.show_user_previous_content = True
```

**What to Mock:**
- External API calls (Discord, SendGrid, GitHub)
- Database operations (when not testing DB integration)
- Authentication/authorization functions
- Time-dependent operations

**What NOT to Mock:**
- Core business logic being tested
- Pure functions with no side effects
- Data transformation functions

## Fixtures and Factories

**Test Data Location:**
- `core/modules/tests/fixtures/` - Course and lesson YAML files
- Inline fixture functions in conftest.py

**Fixture Path Pattern:**
```python
from pathlib import Path

FIXTURES_DIR = Path(__file__).parent / "fixtures"

@pytest.fixture
def fixtures_lessons_dir():
    """Return path to test fixtures lessons directory."""
    return FIXTURES_DIR / "lessons"
```

**Test Data Factories (Inline):**
```python
def test_with_many_people():
    people = [
        Person(id=str(i), name=f"P{i}", intervals=[(540, 720)])
        for i in range(10)
    ]
    result = schedule(people, ...)
```

## Coverage

**Requirements:** Not enforced, no minimum coverage target

**View Coverage (if pytest-cov installed):**
```bash
pytest --cov=core --cov-report=html
```

## Test Types

**Unit Tests:**
- Isolated function/method testing
- Mock external dependencies
- Location: `*/tests/test_*.py`
- Example: `core/notifications/tests/test_email.py`

**Integration Tests:**
- Test multiple components together
- Use real database with rollback
- Location: Same as unit tests, differentiated by fixtures used
- Example: `discord_bot/tests/test_scheduling_e2e.py`

**API Tests (FastAPI):**
- Use `TestClient` from fastapi.testclient
- Mock authentication and database
- Test HTTP response codes and JSON structure
- Example: `web_api/tests/test_modules_api.py`

**E2E Tests:**
- Limited coverage currently
- Focus on critical user flows
- Example: `discord_bot/tests/test_scheduling_e2e.py`

## Common Patterns

**Async Testing:**
```python
@pytest.mark.asyncio
async def test_async_function():
    result = await async_operation()
    assert result == expected
```

**Error Testing:**
```python
@pytest.mark.asyncio
async def test_raises_on_not_found(test_user_id):
    """Cannot claim a session that doesn't exist."""
    with pytest.raises(SessionNotFoundError):
        await claim_session(99999, test_user_id)
```

**Parametrized Tests (when applicable):**
```python
def test_all_day_codes(self):
    """Test all day codes parse correctly."""
    intervals = [
        ("M08:00 M09:00", 0),  # Monday
        ("T08:00 T09:00", 1),  # Tuesday
        ("W08:00 W09:00", 2),  # Wednesday
        # ...
    ]
    for interval_str, expected_day in intervals:
        result = parse_interval_string(interval_str)
        expected_start = expected_day * 1440 + 8 * 60
        assert result[0][0] == expected_start
```

**API Response Testing:**
```python
def test_claim_session_success():
    """Authenticated user can claim an anonymous session."""
    with patch(...):
        response = client.post("/api/module-sessions/1/claim")

        assert response.status_code == 200
        assert response.json()["claimed"] is True
        mock_claim.assert_called_once_with(1, 42)
```

**Cleanup Patterns:**
```python
@pytest_asyncio.fixture
async def test_resource():
    # Setup
    resource = await create_resource()

    yield resource

    # Cleanup (always runs)
    await delete_resource(resource.id)
```

## Test Data Isolation

**Database Tests:**
- Each test gets a transaction that rolls back
- Use unique identifiers (UUID) for test data
- Clean up created resources in fixture teardown

**Cache Tests:**
- Use `autouse=True` fixtures to set up test cache
- Clear cache in fixture teardown
- Avoid relying on production cache state

---

*Testing analysis: 2026-01-21*
