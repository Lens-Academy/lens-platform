# OAuth Claiming Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move anonymous session claiming from post-login API call into OAuth callback itself, eliminating race conditions.

**Architecture:** Pass `anonymous_token` through OAuth state, claim in callback before redirect. Delete the now-unused `/api/progress/claim` endpoint.

**Tech Stack:** FastAPI, SQLAlchemy async, Discord OAuth2

---

## Task 1: Add `anonymous_token` to `/auth/discord` endpoint

**Files:**
- Modify: `web_api/routes/auth.py:89-136`

**Step 1: Update function signature**

Add `anonymous_token` parameter to `discord_oauth_start`:

```python
@router.get("/discord")
async def discord_oauth_start(
    request: Request,
    next: str = "/",
    origin: str | None = None,
    anonymous_token: str | None = None,  # NEW
):
```

**Step 2: Store token in OAuth state**

Update the `_oauth_states[state]` dict (around line 120-124):

```python
    _oauth_states[state] = {
        "next": next,
        "origin": validated_origin,
        "anonymous_token": anonymous_token,  # NEW
        "created_at": time.time(),
    }
```

**Verify:** No test needed - this is wiring. Will be tested by manual flow.

---

## Task 2: Add claiming to `/auth/discord/callback` endpoint

**Files:**
- Modify: `web_api/routes/auth.py:139-223`

**Step 1: Add imports at top of file**

After line 26, add:

```python
from uuid import UUID
from core.database import get_transaction
from core.modules.progress import claim_progress_records
from core.modules.chat_sessions import claim_chat_sessions
```

**Step 2: Refactor user creation to capture return value**

Change lines 212-215 from:

```python
    # Create or update user in database
    await get_or_create_user(
        discord_id, discord_username, discord_avatar, email, email_verified, nickname
    )
```

To:

```python
    # Create or update user in database
    user = await get_or_create_user(
        discord_id, discord_username, discord_avatar, email, email_verified, nickname
    )
```

**Step 3: Add claiming logic after user creation**

After the refactored `user = await get_or_create_user(...)`, before creating JWT, add:

```python
    # Claim anonymous sessions if token provided
    anonymous_token_str = state_data.get("anonymous_token")
    if anonymous_token_str:
        try:
            anonymous_uuid = UUID(anonymous_token_str)
        except ValueError:
            anonymous_uuid = None

        if anonymous_uuid:
            async with get_transaction() as conn:
                await claim_progress_records(
                    conn, anonymous_token=anonymous_uuid, user_id=user["user_id"]
                )
                await claim_chat_sessions(
                    conn, anonymous_token=anonymous_uuid, user_id=user["user_id"]
                )

    # Create JWT and set cookie
    token = create_jwt(discord_id, discord_username)
```

**Verify:** Manual test - login with anonymous session, verify it's claimed.

---

## Task 3: Add claiming to `/auth/code` endpoint (GET version)

**Files:**
- Modify: `web_api/routes/auth.py:226-262`

**Step 1: Update function signature**

```python
@router.get("/code")
async def validate_auth_code_endpoint(
    code: str,
    next: str = "/",
    origin: str | None = None,
    anonymous_token: str | None = None,  # NEW
):
```

**Step 2: Add claiming after user creation**

After line 253-254 (user creation), add:

```python
    # Claim anonymous sessions if token provided
    if anonymous_token:
        try:
            anonymous_uuid = UUID(anonymous_token)
        except ValueError:
            anonymous_uuid = None

        if anonymous_uuid:
            async with get_transaction() as conn:
                await claim_progress_records(
                    conn, anonymous_token=anonymous_uuid, user_id=user["user_id"]
                )
                await claim_chat_sessions(
                    conn, anonymous_token=anonymous_uuid, user_id=user["user_id"]
                )
```

**Verify:** Manual test if bot auth is used.

---

## Task 4: Add claiming to `/auth/code` endpoint (POST version)

**Files:**
- Modify: `web_api/routes/auth.py:265-289`

**Step 1: Update function signature**

```python
@router.post("/code")
async def validate_auth_code_api(
    response: Response,
    code: str,
    next: str = "/",
    anonymous_token: str | None = None,  # NEW
):
```

**Step 2: Add claiming after user creation**

After line 282-283 (user creation), add same claiming logic as Task 3.

**Verify:** Manual test if bot auth is used via API.

---

## Task 5: Delete `/api/progress/claim` endpoint

**Files:**
- Modify: `web_api/routes/progress.py`

**Step 1: Remove ClaimRequest and ClaimResponse models**

Delete lines 65-71:

```python
class ClaimRequest(BaseModel):
    anonymous_token: UUID


class ClaimResponse(BaseModel):
    progress_records_claimed: int
    chat_sessions_claimed: int
```

**Step 2: Remove claim_records endpoint**

Delete lines 296-336 (the entire `@router.post("/claim", ...)` function).

**Step 3: Remove unused imports**

Update the imports (lines 17-23). Remove `claim_progress_records` and `claim_chat_sessions` if no longer used in this file:

```python
from core.modules.progress import (
    mark_content_complete,
    update_time_spent,
    get_module_progress,
)
# Remove: claim_progress_records
# Remove: from core.modules.chat_sessions import claim_chat_sessions
```

**Step 4: Update module docstring**

Update the docstring at the top (lines 1-7) to remove the claim endpoint reference:

```python
"""Progress tracking API routes.

Endpoints:
- POST /api/progress/complete - Mark content as complete
- POST /api/progress/time - Update time spent (heartbeat or beacon)
"""
```

**Verify:**
```bash
ruff check web_api/routes/progress.py
```

---

## Task 6: Delete claim endpoint tests

**Files:**
- Modify: `web_api/tests/test_progress_integration.py`

**Step 1: Delete test in TestProgressAuthentication class**

Delete lines 146-152 (`test_claim_without_auth_returns_401`):

```python
    def test_claim_without_auth_returns_401(self):
        """POST /claim without authentication should return 401."""
        response = client.post(
            "/api/progress/claim",
            json={"anonymous_token": random_uuid_str()},
        )
        assert response.status_code == 401
```

**Step 2: Delete entire TestClaimRecords class**

Delete lines 380-425 (the entire `class TestClaimRecords:` block).

**Verify:**
```bash
pytest web_api/tests/test_progress_integration.py -v
```

---

## Task 7: Frontend - Add anonymous_token to login redirects

**Files:**
- Modify: `web_frontend/src/hooks/useAuth.ts:171-176`
- Modify: `web_frontend/src/components/nav/UserMenu.tsx:26-30`
- Modify: `web_frontend/src/views/Auth.tsx:93-95`

**Step 1: Update useAuth.ts login function**

Change the `login` callback (lines 171-176) from:

```typescript
  const login = useCallback(() => {
    // Redirect to Discord OAuth, with current path as the return URL
    const next = encodeURIComponent(window.location.pathname);
    const origin = encodeURIComponent(window.location.origin);
    window.location.href = `${API_URL}/auth/discord?next=${next}&origin=${origin}`;
  }, []);
```

To:

```typescript
  const login = useCallback(() => {
    // Redirect to Discord OAuth, with current path as the return URL
    const next = encodeURIComponent(window.location.pathname);
    const origin = encodeURIComponent(window.location.origin);
    const anonymousToken = getAnonymousToken();
    const tokenParam = anonymousToken ? `&anonymous_token=${encodeURIComponent(anonymousToken)}` : '';
    window.location.href = `${API_URL}/auth/discord?next=${next}&origin=${origin}${tokenParam}`;
  }, []);
```

**Step 2: Update UserMenu.tsx handleLogin**

Change line 30 from:

```typescript
      window.location.href = `${API_URL}/auth/discord?next=${next}&origin=${origin}`;
```

To:

```typescript
      const anonymousToken = localStorage.getItem('anonymous_token');
      const tokenParam = anonymousToken ? `&anonymous_token=${encodeURIComponent(anonymousToken)}` : '';
      window.location.href = `${API_URL}/auth/discord?next=${next}&origin=${origin}${tokenParam}`;
```

**Step 3: Update Auth.tsx handleDiscordLogin**

Change lines 93-95 from:

```typescript
  const handleDiscordLogin = () => {
    const origin = encodeURIComponent(window.location.origin);
    window.location.href = `${API_URL}/auth/discord?next=${encodeURIComponent(next)}&origin=${origin}`;
  };
```

To:

```typescript
  const handleDiscordLogin = () => {
    const origin = encodeURIComponent(window.location.origin);
    const anonymousToken = localStorage.getItem('anonymous_token');
    const tokenParam = anonymousToken ? `&anonymous_token=${encodeURIComponent(anonymousToken)}` : '';
    window.location.href = `${API_URL}/auth/discord?next=${encodeURIComponent(next)}&origin=${origin}${tokenParam}`;
  };
```

**Verify:**
```bash
cd web_frontend && npm run lint
```

---

## Task 8: Frontend - Remove post-login claim call from useAuth

**Files:**
- Modify: `web_frontend/src/hooks/useAuth.ts`

**Step 1: Remove claimSessionRecords import**

Delete line 9:

```typescript
import { claimSessionRecords } from "../api/progress";
```

**Step 2: Remove claim logic from checkAuth**

Delete the claim block (lines 88-105) inside the `if (data.authenticated)` block:

```typescript
        // Claim anonymous progress/chat records BEFORE setting authenticated state
        // This ensures claim happens before any authenticated sessions are created
        if (!hasClaimedRef.current) {
          hasClaimedRef.current = true;
          try {
            const anonymousToken = getAnonymousToken();
            const result = await claimSessionRecords(anonymousToken);
            if (
              result.progress_records_claimed > 0 ||
              result.chat_sessions_claimed > 0
            ) {
              console.log(
                `[Auth] Claimed ${result.progress_records_claimed} progress records and ${result.chat_sessions_claimed} chat sessions`,
              );
            }
          } catch (error) {
            // Non-critical - just log and continue
```

Also remove the `hasClaimedRef` if it's no longer used.

**Verify:**
```bash
cd web_frontend && npm run lint
```

---

## Task 9: Frontend - Remove post-login claim call from Module.tsx

**Files:**
- Modify: `web_frontend/src/views/Module.tsx`

**Step 1: Remove claimSessionRecords import**

Delete line 31:

```typescript
import { claimSessionRecords } from "@/api/progress";
```

**Step 2: Remove or update the login transition effect**

The effect around lines 217-240 calls `claimSessionRecords`. Either:
- Remove the entire effect if claiming is the only thing it does
- Or remove just the `claimSessionRecords` call if there's other logic

Look at the full effect and decide - if it only does claiming + refetching progress, the refetching should still happen (but claiming is now handled server-side).

**Verify:**
```bash
cd web_frontend && npm run lint && npm run build
```

---

## Task 10: Frontend - Delete claimSessionRecords function

**Files:**
- Modify: `web_frontend/src/api/progress.ts`

**Step 1: Delete the claimSessionRecords function**

Delete lines 80-96:

```typescript
export async function claimSessionRecords(anonymousToken: string): Promise<{
  progress_records_claimed: number;
  chat_sessions_claimed: number;
}> {
  const res = await fetch(`${API_BASE}/api/progress/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ anonymous_token: anonymousToken }),
  });

  if (!res.ok) {
    throw new Error(`Failed to claim records: ${res.status}`);
  }

  return res.json();
}
```

**Verify:**
```bash
cd web_frontend && npm run lint && npm run build
```

---

## Task 11: Run all checks

**Backend:**
```bash
ruff check .
ruff format --check .
pytest core/modules/tests/test_chat_sessions.py -v
pytest web_api/tests/ -v
```

**Frontend:**
```bash
cd web_frontend && npm run lint && npm run build
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `web_api/routes/auth.py` | Add `anonymous_token` param to 4 endpoints, add claiming logic |
| `web_api/routes/progress.py` | Delete claim endpoint, models, and imports |
| `web_api/tests/test_progress_integration.py` | Delete claim endpoint tests |
| `web_frontend/src/hooks/useAuth.ts` | Add token to login redirect, remove post-login claim |
| `web_frontend/src/components/nav/UserMenu.tsx` | Add token to login redirect |
| `web_frontend/src/views/Auth.tsx` | Add token to login redirect |
| `web_frontend/src/views/Module.tsx` | Remove post-login claim call |
| `web_frontend/src/api/progress.ts` | Delete `claimSessionRecords` function |

## Manual Testing Checklist

1. Clear your anonymous_token from localStorage
2. Browse content anonymously (creates progress + chat session)
3. Note your anonymous_token from localStorage
4. Log in via Discord
5. Verify: No errors on login
6. Verify: Check database - anonymous records now have your user_id
7. Verify: `/api/progress/claim` returns 404 (endpoint removed)
8. Verify: Frontend builds without errors
