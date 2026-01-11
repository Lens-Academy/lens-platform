# Code Review: Architecture & Top-Level Files

**Date:** 2026-01-09
**Reviewer:** Claude Code (superpowers:code-reviewer)

## Overall Architectural Assessment

The project demonstrates a **well-designed 3-layer architecture** with proper separation of concerns. The unified backend approach (`main.py`) running FastAPI and Discord bot in a single event loop is elegant and avoids the complexity of inter-process communication. The architectural constraints documented in CLAUDE.md are largely followed.

**Positives:**
- Core layer (`core/`) has **no Discord imports** - verified via grep
- `discord_bot/` and `web_api/` **do not import from each other** - verified via grep
- Clear documentation of architecture and patterns
- Good use of environment variables with `.env.local` for local overrides
- Proper database connection management with async SQLAlchemy

---

## Issues Found

### Issue 1: Dead Code - Legacy Standalone Entry Points

**File:** `web_api/main.py`
**Severity:** Minor

**Issue:** The `web_api/main.py` file is a legacy standalone entry point that is no longer used (according to CLAUDE.md: "Legacy (standalone, for reference)"). It duplicates route registration and configuration from the root `main.py`, but only includes 2 of the 7 routers (auth and users - missing lesson, lessons, speech, cohorts, courses).

**Suggested Fix:** Either:
1. Delete the file if truly unused, or
2. Add a deprecation comment at the top and ensure it stays in sync, or
3. Convert it to import from the main app:

```python
"""
DEPRECATED: Legacy standalone entry point.
Use `python main.py` from project root instead.
"""
```

---

### Issue 2: Duplicate Argument Parsing Logic

**File:** `main.py` (lines 40-54, 307-334)
**Severity:** Minor

**Issue:** The argument parsing is done twice - once early (lines 40-54) to set `DEV_MODE` before imports, and again later (lines 307-334) for full CLI handling. This duplication could lead to inconsistencies.

**Example of duplication:**
```python
# Lines 40-54 (early parsing)
_early_parser = argparse.ArgumentParser(add_help=False)
_early_parser.add_argument("--dev", action="store_true")
_early_parser.add_argument("--port", type=int, default=int(os.getenv("API_PORT", "8000")))
_early_parser.add_argument("--vite-port", type=int, default=int(os.getenv("VITE_PORT", "5173")))

# Lines 307-334 (main parsing)
parser = argparse.ArgumentParser(description="AI Safety Course Platform Server")
parser.add_argument("--no-bot", ...)
parser.add_argument("--port", ...)
parser.add_argument("--dev", ...)
parser.add_argument("--vite-port", ...)
```

**Suggested Fix:** Consider consolidating the early parsing with a clear comment explaining why it must happen before imports, or extract the parsing to a separate function that can be called at the appropriate time.

---

### Issue 3: Security - Hardcoded Cookie `secure=False`

**File:** `web_api/auth.py` (line 76)
**Severity:** Important

**Issue:** The session cookie has `secure=False` with a TODO comment indicating it should be True in production. This could lead to session hijacking on production if HTTPS is used but the cookie is sent over unencrypted connections.

```python
response.set_cookie(
    key="session",
    value=token,
    httponly=True,
    secure=False,  # TODO: True in production with HTTPS
    samesite="lax",
    max_age=60 * 60 * 24,  # 24 hours
)
```

**Suggested Fix:** Read from an environment variable or detect production mode:

```python
_is_production = os.environ.get("RAILWAY_ENVIRONMENT") is not None

response.set_cookie(
    key="session",
    value=token,
    httponly=True,
    secure=_is_production,  # True in production with HTTPS
    samesite="lax",
    max_age=60 * 60 * 24,
)
```

---

### Issue 4: In-Memory OAuth State Storage

**File:** `web_api/routes/auth.py` (lines 79-81)
**Severity:** Important

**Issue:** OAuth CSRF states are stored in-memory (`_oauth_states: dict[str, dict] = {}`). The comment acknowledges this: "In production, use Redis or database". This will not work correctly if the service is scaled to multiple instances, and states will be lost on restart.

```python
# In-memory state storage for OAuth CSRF protection
# In production, use Redis or database
_oauth_states: dict[str, dict] = {}
```

**Suggested Fix:** Since the project already has a database, consider storing OAuth states in the `auth_codes` table or a similar mechanism, or use the existing database infrastructure.

---

### Issue 5: Test File in Project Root

**File:** `test_stampy_stream.py`
**Severity:** Minor

**Issue:** There is a standalone test file in the project root that appears to be a debugging/development script for testing the Stampy API. It should either be:
- Moved to a tests directory
- Converted to a proper pytest test
- Removed if no longer needed

---

### Issue 6: Cross-Layer Import Workaround in `core/nickname_sync.py`

**File:** `core/nickname_sync.py`
**Severity:** Important (Architectural Concern)

**Issue:** This file uses `sys.modules` runtime lookup to access `discord_bot.cogs.nickname_cog`. While it technically avoids a direct import, it creates a runtime dependency from `core/` to `discord_bot/`, which violates the documented architecture:

> "Layer 2a (Discord adapter) and 2b (FastAPI) should never communicate directly."

The comment explains this is necessary because Discord.py's extension loading creates a new module instance, but this pattern is fragile and breaks the layer separation principle.

```python
async def update_nickname_in_discord(discord_id: str, nickname: str | None) -> bool:
    # Access the module that discord.py's load_extension() created
    module = sys.modules.get("discord_bot.cogs.nickname_cog")
    if module is None:
        print("[nickname_sync] Module not loaded yet")
        return False
    return await module.update_nickname_in_discord(discord_id, nickname)
```

**Suggested Fix:** Consider implementing a proper event/callback pattern where:
1. The Discord bot registers a callback with core during startup
2. Core calls the callback when nickname updates are needed
3. This makes the dependency explicit and testable

---

### Issue 7: `sys.path` Manipulation Scattered Across Files

**Files:**
- `main.py` (lines 26-29)
- `web_api/routes/auth.py` (line 21)
- `discord_bot/utils/__init__.py` (lines 11-13)
- `alembic/env.py` (line 12)

**Severity:** Minor

**Issue:** Multiple files manipulate `sys.path` to enable imports. While this works, it's fragile and can lead to import issues (like the documented `main.py` shadowing problem).

**Suggested Fix:** Consider using proper Python packaging with a `pyproject.toml` or `setup.py` that installs the project in editable mode (`pip install -e .`). This would allow clean absolute imports like `from core.database import get_connection` without path manipulation.

---

### Issue 8: Missing Version Pinning in requirements.txt

**File:** `requirements.txt`
**Severity:** Minor

**Issue:** Dependencies use minimum version constraints (`>=`) rather than exact pinning. While this is fine for development, it can lead to unexpected breakage in production when dependencies update.

```
discord.py>=2.3.0
pytz>=2023.3
fastapi>=0.109.0
# etc.
```

**Suggested Fix:** Consider using a lockfile (e.g., `pip-tools` with `requirements.txt` + `requirements.lock`, or `poetry.lock`, or `uv.lock`) to ensure reproducible builds.

---

### Issue 9: Repeated DEV_MODE Check Pattern

**Files:** `main.py` (lines 120, 250, 286), `web_api/routes/auth.py` (line 36)
**Severity:** Minor

**Issue:** The pattern `os.getenv("DEV_MODE", "").lower() in ("true", "1", "yes")` is repeated multiple times across the codebase.

**Suggested Fix:** Create a utility function in `core/` or a config module:

```python
# core/config.py
import os

def is_dev_mode() -> bool:
    return os.getenv("DEV_MODE", "").lower() in ("true", "1", "yes")

def is_production() -> bool:
    return bool(os.environ.get("RAILWAY_ENVIRONMENT"))
```

---

### Issue 10: Incomplete CORS Configuration

**File:** `main.py` (lines 209-230)
**Severity:** Minor

**Issue:** CORS origins are hardcoded with specific localhost ports. While `FRONTEND_URL` is included dynamically, the hardcoded list may not cover all development scenarios and duplicates the similar list in `web_api/routes/auth.py` (ALLOWED_ORIGINS).

**Suggested Fix:** Centralize allowed origins in a configuration module to avoid duplication:

```python
# core/config.py
ALLOWED_ORIGINS = [
    os.environ.get("FRONTEND_URL", "http://localhost:5173"),
    "http://localhost:5173",
    "http://localhost:8000",
    # ... etc
]
```

---

## Summary

| Category | Critical | Important | Minor |
|----------|----------|-----------|-------|
| Security | 0 | 2 | 0 |
| Architecture | 0 | 1 | 2 |
| Code Quality | 0 | 0 | 5 |
| **Total** | **0** | **3** | **7** |

**Key Recommendations (Priority Order):**

1. **Important:** Fix the session cookie `secure` flag to be environment-aware
2. **Important:** Migrate OAuth state storage from in-memory to database
3. **Important:** Refactor `nickname_sync.py` to use a proper callback/event pattern instead of `sys.modules` lookup
4. **Minor:** Clean up dead/legacy code (`web_api/main.py`, `test_stampy_stream.py`)
5. **Minor:** Centralize configuration (DEV_MODE checks, CORS origins)

The architecture is fundamentally sound and follows the documented 3-layer pattern well. The issues found are mostly minor improvements and one notable architectural workaround (`nickname_sync.py`) that should be addressed to maintain clean layer separation.
