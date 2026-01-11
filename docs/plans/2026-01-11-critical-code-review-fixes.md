# Critical Code Review Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the 3 critical bugs identified in the code review: OAuth memory leak, Response null crash, and closure capture fragility.

**Architecture:** Direct fixes to existing files. No new modules needed. TTL-based cleanup for OAuth states, proper FastAPI Response injection, and factory function pattern for event handlers.

**Tech Stack:** Python, FastAPI, discord.py

---

## Task 1: Fix OAuth State Memory Leak

**Files:**
- Modify: `web_api/routes/auth.py:79-106`

**Problem:** The `_oauth_states` dictionary stores OAuth states but never cleans them up. Users who start OAuth but don't complete it leave entries forever, causing memory exhaustion.

**Step 1: Add time import and constants**

At top of file (around line 10), add `time` import:

```python
import time
```

Add constant after line 81 (after `_oauth_states` declaration):

```python
_oauth_states: dict[str, dict] = {}
STATE_TTL_SECONDS = 600  # 10 minutes - states expire after this
```

**Step 2: Add cleanup function**

After the `_oauth_states` and `STATE_TTL_SECONDS` declarations, add:

```python
def _cleanup_expired_oauth_states():
    """Remove OAuth states older than TTL. Called before adding new states."""
    cutoff = time.time() - STATE_TTL_SECONDS
    # Build list of keys to remove (can't modify dict during iteration)
    expired = [k for k, v in _oauth_states.items() if v.get("created_at", 0) < cutoff]
    for key in expired:
        del _oauth_states[key]
```

**Step 3: Store created_at and call cleanup**

In `discord_oauth_start` function (around line 105-106), change:

```python
    # Generate state for CSRF protection
    state = secrets.token_urlsafe(32)
    _oauth_states[state] = {"next": next, "origin": validated_origin}
```

To:

```python
    # Generate state for CSRF protection
    _cleanup_expired_oauth_states()  # Prevent memory leak
    state = secrets.token_urlsafe(32)
    _oauth_states[state] = {"next": next, "origin": validated_origin, "created_at": time.time()}
```

**Step 4: Run tests to verify no regressions**

Run: `pytest web_api/tests/ -v`
Expected: All existing tests pass

**Step 5: Commit**

```bash
jj describe -m "fix: add TTL cleanup to OAuth state storage to prevent memory leak"
```

---

## Task 2: Fix Response = None Crash in POST /auth/code

**Files:**
- Modify: `web_api/routes/auth.py:242-243`

**Problem:** The `validate_auth_code_api` function has `response: Response = None` as a default parameter. When `set_session_cookie(response, token)` is called on line 264, it will crash because `response.set_cookie()` can't be called on `None`.

**Step 1: Fix the function signature**

Change line 242-243 from:

```python
@router.post("/code")
async def validate_auth_code_api(code: str, next: str = "/", response: Response = None):
```

To:

```python
@router.post("/code")
async def validate_auth_code_api(response: Response, code: str, next: str = "/"):
```

Note: `response: Response` without a default makes FastAPI inject the Response object. Moving it before `code` ensures proper positional ordering.

**Step 2: Run tests**

Run: `pytest web_api/tests/ -v`
Expected: All existing tests pass

**Step 3: Commit**

```bash
jj describe -m "fix: properly inject Response in POST /auth/code to prevent null crash"
```

---

## Task 3: Fix Closure Capture Fragility in Test Bot Manager

**Files:**
- Modify: `discord_bot/test_bot_manager.py:37-40`

**Problem:** The event handler uses default argument pattern `async def on_ready(c=client, idx=i, evt=ready_event)`. While this works, it's fragile and non-obvious. A factory function is cleaner.

**Step 1: Replace inline event handler with factory function**

Change lines 37-40 from:

```python
            @client.event
            async def on_ready(c=client, idx=i, evt=ready_event):
                print(f"    Test bot {idx + 1} connected: {c.user}")
                evt.set()
```

To:

```python
            def make_on_ready(c: discord.Client, idx: int, evt: asyncio.Event):
                """Factory to create on_ready with proper closure capture."""
                @c.event
                async def on_ready():
                    print(f"    Test bot {idx + 1} connected: {c.user}")
                    evt.set()
                return on_ready

            make_on_ready(client, i, ready_event)
```

**Step 2: Verify the bot still works**

This is a test utility file - verify manually if test bots are available, or verify the code compiles:

Run: `python -c "import discord_bot.test_bot_manager; print('Import OK')"`
Expected: `Import OK`

**Step 3: Commit**

```bash
jj describe -m "fix: use factory function for test bot event handlers to fix closure capture"
```

---

## Task 4: Final Verification

**Step 1: Run all tests**

Run: `pytest discord_bot/tests/ web_api/tests/ -v`
Expected: All tests pass

**Step 2: Squash all commits and finalize**

Run: `jj st`

Verify all 3 files are modified:
- `web_api/routes/auth.py`
- `discord_bot/test_bot_manager.py`

**Step 3: Final commit message**

```bash
jj describe -m "fix: resolve 3 critical code review issues

- Add TTL cleanup to OAuth state storage (prevents memory leak)
- Fix Response injection in POST /auth/code (prevents null crash)
- Use factory function for test bot handlers (fixes closure capture)"
```

---

## Summary

| Issue | Severity | Fix |
|-------|----------|-----|
| OAuth state memory leak | Critical | TTL-based cleanup, expire after 10 min |
| POST /auth/code Response=None | Critical | Remove default, let FastAPI inject |
| Test bot closure capture | Critical | Factory function pattern |

Estimated implementation: ~15 minutes
