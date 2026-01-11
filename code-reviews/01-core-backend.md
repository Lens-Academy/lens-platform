# Code Review: `core/` Directory

**Date:** 2026-01-09
**Reviewer:** Claude Code (superpowers:code-reviewer)

## Summary

The `core/` directory implements platform-agnostic business logic for an AI Safety education platform. Overall, the code is well-organized with clean separation of concerns. However, I identified several issues ranging from potential bugs to code quality improvements.

---

## File: `core/timezone.py`

### Issue 1: Bare `except` Clause (Lines 25-26, 54-55)

**Severity: Important**

Bare `except:` clauses silently catch all exceptions including `KeyboardInterrupt`, `SystemExit`, etc. This makes debugging difficult and can mask real problems.

```python
# Current code (line 25-26)
try:
    tz = pytz.timezone(user_tz_str)
except:
    tz = pytz.UTC
```

**Suggested fix:**
```python
try:
    tz = pytz.timezone(user_tz_str)
except pytz.UnknownTimeZoneError:
    tz = pytz.UTC
```

Same fix applies to lines 54-55.

---

## File: `core/cohorts.py`

### Issue 2: Bare `except` Clause (Lines 128-129, 148-149)

**Severity: Important**

Same issue as above - bare `except:` clauses hide real errors.

```python
# Current code (lines 124-129)
try:
    tz = pytz.timezone(tz_name)
    now = datetime.now(pytz.UTC)
    abbrev = now.astimezone(tz).strftime('%Z')
except:
    abbrev = tz_name
```

**Suggested fix:**
```python
try:
    tz = pytz.timezone(tz_name)
    now = datetime.now(pytz.UTC)
    abbrev = now.astimezone(tz).strftime('%Z')
except pytz.UnknownTimeZoneError:
    abbrev = tz_name
```

Same fix applies to `get_timezone_abbrev()` at lines 144-149.

---

## File: `core/data.py`

### Issue 3: Missing File I/O Error Handling (Lines 18-23, 26-30)

**Severity: Important**

`load_data()` and `save_data()` don't handle file I/O errors (permission issues, disk full, corrupted JSON, etc.). A read failure could crash the application.

```python
# Current code
def load_data() -> dict:
    """Load all user data from the JSON file."""
    if DATA_FILE.exists():
        with open(DATA_FILE, "r") as f:
            return json.load(f)  # No error handling for JSONDecodeError
    return {}
```

**Suggested fix:**
```python
def load_data() -> dict:
    """Load all user data from the JSON file."""
    if not DATA_FILE.exists():
        return {}
    try:
        with open(DATA_FILE, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError) as e:
        # Log the error - caller can decide how to handle
        print(f"Warning: Failed to load data from {DATA_FILE}: {e}")
        return {}
```

---

## File: `core/__init__.py`

### Issue 4: Duplicate Comment (Lines 6-7)

**Severity: Minor**

Redundant comment lines.

```python
# Current code
# Database (SQLAlchemy) - user data migrated to database, courses removed

# Database (SQLAlchemy)
```

**Suggested fix:** Remove line 7 (the duplicate comment).

### Issue 5: Inconsistent Import Style (Lines 59-60)

**Severity: Minor**

Using `from core import` instead of relative imports within the core package is inconsistent with the rest of the file.

```python
# Current code
from core import stampy
from core import lesson_chat
```

**Suggested fix:**
```python
from . import stampy
from . import lesson_chat
```

---

## File: `core/queries/groups.py`

### Issue 6: Unused Import (Line 10)

**Severity: Minor**

`GroupUserRole` is imported but never used in the file.

```python
from ..enums import GroupUserRole
```

**Suggested fix:** Remove the unused import.

---

## File: `core/availability.py`

### Issue 7: Accessing Private pytz Attribute (Lines 40, 47)

**Severity: Important**

`_utc_transition_times` is a private attribute of pytz timezone objects that may change or be removed in future versions.

```python
# Current code
if not hasattr(tz, '_utc_transition_times') or not tz._utc_transition_times:
    return []  # No DST for this timezone
```

**Suggested fix:** Consider using the `dateutil` library's `rrule` functionality or pytz's public API, or add a comment acknowledging the risk:

```python
# Note: Using pytz private attribute _utc_transition_times.
# This is a known limitation - consider migrating to dateutil if this causes issues.
if not hasattr(tz, '_utc_transition_times') or not tz._utc_transition_times:
    return []
```

---

## File: `core/users.py`

### Issue 8: Mutable Default Argument Pattern Risk (Lines 30-35)

**Severity: Minor**

While `None` is used correctly here, the docstring could be clearer that these are optional parameters:

```python
async def save_user_profile(
    discord_id: str,
    nickname: str = None,  # Should be Optional[str] = None
    timezone_str: str = None,
    ...
```

**Suggested fix:** Update type hints for clarity:

```python
async def save_user_profile(
    discord_id: str,
    nickname: str | None = None,
    timezone_str: str | None = None,
    availability_local: str | None = None,
    if_needed_availability_local: str | None = None,
) -> dict[str, Any]:
```

---

## File: `core/lessons/sessions.py`

### Issue 9: Extra Database Round-Trip (Lines 103-116, 129-142, 155-165)

**Severity: Minor**

Functions `add_message()`, `advance_stage()`, and `complete_session()` call `get_session()` after updating, resulting in an extra database round-trip. The update already happens in a transaction, and you could use RETURNING to avoid the extra fetch.

```python
# Current pattern in add_message:
async with get_transaction() as conn:
    await conn.execute(...)  # Update

return await get_session(session_id)  # Extra fetch
```

**Suggested fix:** Use RETURNING in the update statement:

```python
async with get_transaction() as conn:
    result = await conn.execute(
        update(lesson_sessions)
        .where(lesson_sessions.c.session_id == session_id)
        .values(
            messages=messages,
            last_active_at=datetime.now(timezone.utc),
        )
        .returning(lesson_sessions)
    )
    row = result.mappings().one()
    return dict(row)
```

---

## File: `core/nickname.py`

### Issue 10: Return Value Not Used in Context Manager Exit (Lines 47-53)

**Severity: Minor**

The transaction commits even if no rows were updated (user doesn't exist). This is not a bug, but the logic could be clearer by fetching the user first or using a single atomic operation.

---

## File: `core/transcripts/tools.py`

### Issue 11: Import Inside Function (Lines 100, 117, 223)

**Severity: Minor**

`json` and `re` are imported inside functions rather than at module level:

```python
def get_text_at_time(...) -> str:
    import json  # Import inside function
```

**Suggested fix:** Move imports to the top of the file for consistency and slight performance improvement (avoids repeated import lookups):

```python
# At top of file:
import json
import re
from pathlib import Path
```

---

## File: `core/queries/cohorts.py`

### Issue 12: Unused Import (Lines 4, 6)

**Severity: Minor**

`datetime` and `timezone` are imported but only used in `save_cohort_category_id()`. The import of `datetime` from the `datetime` module shadows the module name.

```python
from datetime import datetime, timezone
```

This is fine but worth noting for consistency checks.

---

## File: `core/lesson_chat.py`

### Issue 13: Duplicate Module with `core/lessons/chat.py`

**Severity: Important**

Both `core/lesson_chat.py` and `core/lessons/chat.py` exist and have overlapping functionality:

- `core/lesson_chat.py`: Generic lesson chat with Claude
- `core/lessons/chat.py`: Stage-aware lesson chat with Claude

The `core/lesson_chat.py` file (87 lines) appears to be an older or simpler version. The `core/lessons/chat.py` is more feature-complete with stage awareness.

**Suggested fix:** Review whether `core/lesson_chat.py` is still needed. If not, remove it and update `core/__init__.py` to remove the export. If both are needed, rename for clarity (e.g., `simple_chat.py` vs `stage_aware_chat.py`).

---

## File: `core/stampy.py`

### Issue 14: No Error Handling for HTTP Failures (Lines 23-51)

**Severity: Important**

The `ask()` function doesn't handle HTTP errors or timeouts meaningfully - they will raise and bubble up. Consider handling common errors gracefully.

```python
# Current code has no try/except around the HTTP operations
async with httpx.AsyncClient(timeout=60.0) as client:
    async with client.stream(...) as response:
        # No check for response.status_code
```

**Suggested fix:**
```python
async with httpx.AsyncClient(timeout=60.0) as client:
    try:
        async with client.stream(...) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                ...
    except httpx.HTTPStatusError as e:
        yield ("error", f"API error: {e.response.status_code}")
        return
    except httpx.TimeoutException:
        yield ("error", "Request timed out")
        return
```

---

## File: `core/google_docs.py`

### Issue 15: Potential aiohttp Session Leak on Exception (Lines 51-59)

**Severity: Minor**

While using `async with` properly handles cleanup, if `jwt.encode()` fails before entering the context manager, no cleanup is needed. However, this could be slightly cleaner:

```python
# Current code is fine, but error handling could be more explicit
async with aiohttp.ClientSession() as session:
    async with session.post(...) as resp:
        data = await resp.json()
```

This is actually fine as-is - just noting for completeness.

---

## File: `core/lessons/content.py`

### Issue 16: Duplicate Frontmatter Parsing Functions (Lines 45-80 and 178-213)

**Severity: Minor**

`parse_frontmatter()` and `parse_video_frontmatter()` have nearly identical logic with different metadata classes. This could be DRYed up.

**Suggested fix:** Create a generic parser:

```python
def _parse_frontmatter_generic(text: str, field_mapping: dict) -> tuple[dict, str]:
    """Generic frontmatter parser.

    Args:
        text: Full markdown text
        field_mapping: Dict of yaml_key -> attr_name

    Returns:
        Tuple of (metadata_dict, content)
    """
    pattern = r'^---\s*\n(.*?)\n---\s*\n'
    match = re.match(pattern, text, re.DOTALL)

    if not match:
        return {}, text

    frontmatter_text = match.group(1)
    content = text[match.end():]

    metadata = {}
    for line in frontmatter_text.split('\n'):
        line = line.strip()
        if ':' in line:
            key, value = line.split(':', 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key in field_mapping:
                metadata[field_mapping[key]] = value

    return metadata, content
```

---

## Positive Observations

1. **Clean Architecture**: The 3-layer architecture (core, adapters, frontend) is well-maintained with proper separation
2. **Type Hints**: Good use of modern Python type hints throughout
3. **Async Consistency**: Database operations properly use async/await
4. **Transaction Management**: Good use of context managers for database transactions
5. **Dataclasses**: Clean use of dataclasses for domain objects
6. **Documentation**: Most functions have docstrings explaining purpose and parameters

---

## Priority Summary

| Severity | Count | Key Issues |
|----------|-------|------------|
| Critical | 0 | - |
| Important | 6 | Bare except clauses, duplicate modules, missing error handling, private attribute access |
| Minor | 10 | Unused imports, redundant code, style inconsistencies |
