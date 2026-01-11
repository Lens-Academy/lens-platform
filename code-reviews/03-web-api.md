# Code Review: `web_api/` Directory

**Date:** 2026-01-09
**Reviewer:** Claude Code (superpowers:code-reviewer)

## Summary

The web_api layer is generally well-structured with clear separation of concerns. However, there are several issues ranging from dead code to potential security gaps and code quality improvements.

---

## File: `web_api/main.py`

### Issue 1: Dead Code - Legacy Standalone Entry Point
**Severity: Minor**
**Lines: 1-49**

This file is documented as "Legacy standalone entry" in CLAUDE.md but is not used in the unified architecture. It only registers 2 routers while the main `main.py` registers 7 routers, creating inconsistency.

```python
# Only includes these routers:
from routes.auth import router as auth_router
from routes.users import router as users_router
```

**Recommendation:** Either remove this file entirely (since it's unused) or add a deprecation warning at the top explaining it's only for standalone development. If kept, update it to include all routers for consistency.

---

## File: `web_api/auth.py`

### Issue 2: Missing Environment Variable Validation at Startup
**Severity: Important**
**Lines: 16-18**

```python
JWT_SECRET = os.environ.get("JWT_SECRET")
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24
```

`JWT_SECRET` is only validated when `create_jwt()` or `verify_jwt()` is called. This delays error detection until runtime during user authentication.

**Suggested Fix:** Add startup validation or use a configuration module:
```python
JWT_SECRET = os.environ.get("JWT_SECRET")
if not JWT_SECRET and os.environ.get("RAILWAY_ENVIRONMENT"):
    raise RuntimeError("JWT_SECRET must be set in production")
```

### Issue 3: Hardcoded `secure=False` in Cookie
**Severity: Important**
**Lines: 72-79**

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

The TODO has not been addressed. In production (Railway), cookies should be secure.

**Suggested Fix:**
```python
is_production = bool(os.environ.get("RAILWAY_ENVIRONMENT"))
response.set_cookie(
    key="session",
    value=token,
    httponly=True,
    secure=is_production,
    samesite="lax",
    max_age=60 * 60 * 24,
)
```

### Issue 4: Unused Import
**Severity: Minor**
**Line: 14**

```python
from fastapi import HTTPException, Request, Response
```

`Request` is imported but never used in this module.

---

## File: `web_api/routes/auth.py`

### Issue 5: In-Memory OAuth State Storage - Memory Leak
**Severity: Critical**
**Lines: 79-81**

```python
# In-memory state storage for OAuth CSRF protection
# In production, use Redis or database
_oauth_states: dict[str, dict] = {}
```

This dictionary grows unbounded. If users start OAuth but never complete it, state entries are never cleaned up. In production, this will eventually cause memory exhaustion.

**Suggested Fix:** Add TTL-based cleanup:
```python
import time
from collections import OrderedDict

_oauth_states: OrderedDict[str, dict] = OrderedDict()
STATE_TTL_SECONDS = 600  # 10 minutes

def _cleanup_expired_states():
    """Remove states older than TTL."""
    cutoff = time.time() - STATE_TTL_SECONDS
    while _oauth_states:
        key, value = next(iter(_oauth_states.items()))
        if value.get("created_at", 0) < cutoff:
            _oauth_states.pop(key)
        else:
            break

# In discord_oauth_start:
_cleanup_expired_states()
_oauth_states[state] = {"next": next, "origin": validated_origin, "created_at": time.time()}
```

### Issue 6: Potential NullPointerException in POST /auth/code
**Severity: Critical**
**Lines: 242-266**

```python
@router.post("/code")
async def validate_auth_code_api(code: str, next: str = "/", response: Response = None):
    ...
    set_session_cookie(response, token)  # response could be None!
```

The `response` parameter has a default of `None`, but `set_session_cookie` calls `response.set_cookie()` which would raise `AttributeError` if response is None.

**Suggested Fix:** Use `Depends()` to inject the response properly:
```python
from fastapi import Response, Depends

@router.post("/code")
async def validate_auth_code_api(
    code: str,
    next: str = "/",
    response: Response = Depends()
):
```

Or use FastAPI's standard pattern:
```python
@router.post("/code")
async def validate_auth_code_api(code: str, response: Response, next: str = "/"):
```

### Issue 7: Inconsistent Error Handling - POST vs GET /auth/code
**Severity: Minor**
**Lines: 203-266**

The GET endpoint returns redirects on error:
```python
return RedirectResponse(url=f"{redirect_base}/signup?error=missing_code")
```

The POST endpoint returns JSON:
```python
return {"status": "error", "error": "missing_code"}
```

But the POST endpoint doesn't use proper HTTP status codes for errors - it returns 200 with error in body.

**Suggested Fix:** For the POST endpoint, raise proper HTTPException:
```python
if not code:
    raise HTTPException(status_code=400, detail="missing_code")

auth_code, error = await validate_and_use_auth_code(code)
if error:
    raise HTTPException(status_code=400, detail=error)
```

### Issue 8: Inconsistent sys.path.insert Depth
**Severity: Minor**
**Line: 21**

```python
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
```

This goes up 3 levels (auth.py -> routes -> web_api -> project_root), which is correct. However, compare to `users.py`:

```python
sys.path.insert(0, str(Path(__file__).parent.parent))
```

This only goes up 2 levels (users.py -> routes -> web_api), which is incorrect for importing from `core/`.

**Wait - actually `users.py` still works because the root `main.py` already added project_root to sys.path. This is fragile and should be consistent.**

---

## File: `web_api/routes/users.py`

### Issue 9: Incorrect sys.path.insert
**Severity: Important**
**Line: 17**

```python
sys.path.insert(0, str(Path(__file__).parent.parent))
```

This adds `web_api/` to sys.path, not the project root. The imports `from core import ...` only work because the root `main.py` already added project_root. If this module were ever run standalone, it would fail.

**Suggested Fix:**
```python
sys.path.insert(0, str(Path(__file__).parent.parent.parent))  # Project root
```

### Issue 10: Unused Import
**Severity: Minor**
**Line: 12**

```python
from typing import Any
```

Only `Any` is imported but used in return type hints. This is fine, but could use the built-in `dict` type annotation in Python 3.9+:

```python
async def update_my_profile(...) -> dict[str, Any]:
# Could be simplified if you prefer
async def update_my_profile(...) -> dict:
```

---

## File: `web_api/routes/cohorts.py`

### Issue 11: Same sys.path Issue as users.py
**Severity: Important**
**Line: 14**

```python
sys.path.insert(0, str(Path(__file__).parent.parent))
```

Same problem - adds `web_api/` instead of project root.

### Issue 12: Unused Import
**Severity: Minor**
**Line: 10**

```python
from typing import Any
```

`Any` is used in the return type `dict[str, Any]`, which is fine.

---

## File: `web_api/routes/lessons.py`

### Issue 13: Dev Fallback Creates Real Users in Database
**Severity: Important**
**Lines: 92-104**

```python
async def get_user_id_for_lesson(request: Request) -> int:
    """Get user_id, with dev fallback for unauthenticated requests."""
    user_jwt = await get_optional_user(request)

    if user_jwt:
        discord_id = user_jwt["sub"]
    else:
        # Dev fallback: use a test discord_id
        discord_id = "dev_test_user_123"

    user = await get_or_create_user(discord_id)
    return user["user_id"]
```

This creates a real `dev_test_user_123` user in the production database whenever an unauthenticated request comes in. This pollutes the database and could be a security issue.

**Suggested Fix:** Either:
1. Remove this fallback entirely and let anonymous sessions work without a user_id
2. Only enable this in dev mode:
```python
if user_jwt:
    discord_id = user_jwt["sub"]
elif os.environ.get("DEV_MODE"):
    discord_id = "dev_test_user_123"
else:
    return None  # Anonymous user
```

### Issue 14: Code Duplication - Session Authorization Check
**Severity: Minor**
**Lines: 232-234, 374-376, 449-451**

The same authorization check is repeated 3 times:
```python
if session["user_id"] is not None and session["user_id"] != user_id:
    raise HTTPException(status_code=403, detail="Not your session")
```

**Suggested Fix:** Extract to a helper function:
```python
def check_session_access(session: dict, user_id: int | None):
    """Raise 403 if user doesn't own the session."""
    if session["user_id"] is not None and session["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Not your session")
```

### Issue 15: Stage Serialization Code Duplication
**Severity: Minor**
**Lines: 147-173, 297-350**

The stage serialization logic in `get_lesson()` and `get_session_state()` is very similar but not identical. This makes it hard to maintain.

**Suggested Fix:** Create a shared `serialize_stage()` function that handles all stage types consistently.

### Issue 16: Large Function - get_session_state
**Severity: Minor**
**Lines: 216-351**

The `get_session_state` function is 135 lines long and does multiple things:
- Validates access
- Loads lesson
- Gets stage content
- Serializes response

**Suggested Fix:** Extract helper functions for each responsibility.

---

## File: `web_api/routes/lesson.py`

### Issue 17: No Authentication Required for Chat Endpoint
**Severity: Important**
**Lines: 47-67**

```python
@router.post("/lesson")
async def chat_lesson(request: LessonChatRequest) -> StreamingResponse:
```

This endpoint has no authentication. Anyone can send arbitrary messages to Claude, potentially incurring API costs.

**Question:** Is this intentional for anonymous lesson access? If so, add a comment. If not, add authentication.

### Issue 18: Different API Prefix from lessons.py
**Severity: Minor**
**Line: 20**

```python
router = APIRouter(prefix="/api/chat", tags=["lesson"])
```

This uses `/api/chat` prefix while `lessons.py` uses `/api` prefix. Having two different files handle lesson-related endpoints with different prefixes is confusing.

**Question:** Should this be consolidated into `lessons.py`?

---

## File: `web_api/routes/speech.py`

### Issue 19: No Authentication Required
**Severity: Important**
**Lines: 12-35**

```python
@router.post("/transcribe")
async def transcribe(audio: UploadFile):
```

Whisper API calls cost money. This endpoint has no authentication, allowing anyone to use your API key for transcription.

**Suggested Fix:**
```python
from web_api.auth import get_current_user

@router.post("/transcribe")
async def transcribe(audio: UploadFile, user: dict = Depends(get_current_user)):
```

---

## File: `web_api/routes/courses.py`

### Issue 20: Returns None Instead of 204 No Content
**Severity: Minor**
**Lines: 25-31**

```python
if result is None:
    return None

return {
    "nextLessonId": result.lesson_id,
    "nextLessonTitle": result.lesson_title,
}
```

Returning `None` becomes `null` in JSON with 200 status. It would be cleaner to return 204 No Content or an explicit response.

**Suggested Fix:**
```python
from fastapi.responses import Response

if result is None:
    return Response(status_code=204)
```

Or return an explicit structure:
```python
if result is None:
    return {"nextLessonId": None, "nextLessonTitle": None}
```

---

## Cross-File Issues

### Issue 21: Inconsistent sys.path Management
**Severity: Important**
**Files: All route files**

Different files use different approaches:
- `auth.py`, `lessons.py`, `lesson.py`: 3 levels up (correct)
- `users.py`, `cohorts.py`: 2 levels up (incorrect, only works due to root main.py)
- `courses.py`, `speech.py`: No sys.path modification (relies on root main.py)

**Suggested Fix:** Either:
1. Standardize all files to use 3 levels up
2. Remove all sys.path modifications since root `main.py` already handles it
3. Use proper package structure with `__init__.py` and relative imports

### Issue 22: Missing Input Validation on User-Provided Strings
**Severity: Minor**
**Various files**

Several endpoints accept user-provided strings without length/format validation:
- `lesson_id` in various endpoints
- `code` in auth endpoints
- `nickname`, `email` in user updates

While some validation may happen in core/, defense in depth suggests validating at the API layer too.

**Suggested Fix:** Add Pydantic validators:
```python
class CreateSessionRequest(BaseModel):
    lesson_id: str = Field(..., min_length=1, max_length=100, pattern=r'^[a-z0-9-]+$')
```

---

## Summary of Findings

| Severity | Count | Key Issues |
|----------|-------|------------|
| Critical | 2 | Memory leak in OAuth state storage, null response bug |
| Important | 6 | Cookie security, incorrect sys.path, dev fallback polluting DB, unauthenticated paid API endpoints |
| Minor | 8 | Dead code, unused imports, code duplication, inconsistent API design |

**Recommended Priority:**
1. Fix the memory leak in OAuth state storage (Critical)
2. Fix the null response bug in POST /auth/code (Critical - will crash in prod)
3. Add authentication to /transcribe endpoint (Important - cost exposure)
4. Fix secure cookie setting for production (Important - security)
5. Address sys.path inconsistencies (Important - maintainability)
