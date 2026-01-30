# Auto-Claim Anonymous Sessions on OAuth Callback

**Date:** 2026-01-30
**Status:** Ready for implementation

## Problem

When a user logs in via Discord OAuth, multiple frontend API calls fire simultaneously after redirect. The `/api/chat/module/.../history` endpoint can create a new user session before the anonymous session claiming completes, causing a unique constraint violation on `idx_chat_sessions_unique_user_active`.

**Race condition sequence:**
1. OAuth callback completes → sets JWT cookie → redirects to frontend
2. Frontend loads → fires parallel API calls
3. `/api/chat/module/X/history` wins race → creates user session for content X
4. `/api/progress/claim` runs → tries to claim anonymous session for content X → fails (user already has session)

## Solution

Move session claiming into the OAuth callback itself. By the time the frontend loads, all anonymous data is already migrated.

This matches the canonical pattern used by auth libraries like `better-auth`, which provide `onLinkAccount` hooks during authentication for exactly this purpose.

## Implementation

### 1. Backend: Modify `/auth/discord` endpoint

**File:** `web_api/routes/auth.py`

Accept optional `anonymous_token` query parameter and store it in OAuth state:

```python
@router.get("/discord")
async def discord_oauth_start(
    request: Request,
    next: str = "/",
    origin: str | None = None,
    anonymous_token: str | None = None,  # NEW
):
    # ... existing validation ...

    _oauth_states[state] = {
        "next": next,
        "origin": validated_origin,
        "anonymous_token": anonymous_token,  # NEW
        "created_at": time.time(),
    }
```

### 2. Backend: Modify `/auth/discord/callback` endpoint

**File:** `web_api/routes/auth.py`

After creating/fetching the user, claim any anonymous sessions:

```python
@router.get("/discord/callback")
async def discord_oauth_callback(...):
    # ... existing OAuth flow ...

    # Create or update user in database
    user = await get_or_create_user(...)

    # NEW: Claim anonymous sessions if token provided
    anonymous_token = state_data.get("anonymous_token")
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

    # Create JWT and redirect as normal
    token = create_jwt(discord_id, discord_username)
    response = RedirectResponse(url=f"{origin}{next_url}")
    set_session_cookie(response, token)
    return response
```

### 2b. Backend: Modify `/auth/code` endpoint

**File:** `web_api/routes/auth.py`

The `/auth/code` endpoint (used for Discord bot auth codes) also needs claiming logic. Accept `anonymous_token` as a query parameter and claim after user creation:

```python
@router.get("/code")
async def auth_code(
    request: Request,
    code: str,
    anonymous_token: str | None = None,  # NEW
):
    # ... existing code validation and user creation ...

    # NEW: Claim anonymous sessions if token provided
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

    # ... rest of endpoint ...
```

### 3. Backend: Fix `claim_chat_sessions` for conflict handling

**File:** `core/modules/chat_sessions.py`

The current implementation will fail with a unique constraint violation if the user already has an active session for a content_id. Update to match the pattern in `claim_progress_records`:

```python
async def claim_chat_sessions(
    conn: AsyncConnection,
    *,
    anonymous_token: UUID,
    user_id: int,
) -> int:
    """Claim anonymous chat sessions for a user.

    Skips sessions where the user already has an active session for the same content_id.
    Returns count of sessions claimed.
    """
    # Find content_ids where user already has an active session
    existing_content_ids = (
        select(chat_sessions.c.content_id)
        .where(
            and_(
                chat_sessions.c.user_id == user_id,
                chat_sessions.c.archived_at.is_(None),
            )
        )
        .scalar_subquery()
    )

    # Only claim sessions for content the user doesn't already have
    result = await conn.execute(
        update(chat_sessions)
        .where(
            and_(
                chat_sessions.c.anonymous_token == anonymous_token,
                ~chat_sessions.c.content_id.in_(existing_content_ids),
            )
        )
        .values(user_id=user_id, anonymous_token=None)
    )
    # NOTE: No explicit commit - let the caller's transaction handle it
    return result.rowcount
```

**Key changes:**
- Add subquery to find existing user sessions
- Filter out anonymous sessions that conflict
- Remove explicit `await conn.commit()` (was breaking transaction atomicity)

### 5. Backend: Delete `/api/progress/claim` endpoint

**File:** `web_api/routes/progress.py`

Remove:
- `ClaimRequest` model
- `ClaimResponse` model
- `claim_records` endpoint function
- Imports for `claim_progress_records`, `claim_chat_sessions` (move to auth.py)

### 6. Frontend: Pass anonymous_token on login redirect

**File:** Wherever the login redirect is initiated (likely in auth context or login button)

When redirecting to `/auth/discord`, include the anonymous token:

```typescript
const loginUrl = new URL('/auth/discord', apiBaseUrl);
loginUrl.searchParams.set('next', currentPath);
loginUrl.searchParams.set('origin', window.location.origin);

const anonymousToken = localStorage.getItem('anonymous_token');
if (anonymousToken) {
  loginUrl.searchParams.set('anonymous_token', anonymousToken);
}

window.location.href = loginUrl.toString();
```

### 7. Frontend: Remove post-login claim call

**File:** Wherever the post-login claim was being called

Remove the code that calls `/api/progress/claim` after login completes.

## Testing

### Manual test flow:
1. Clear database of test user's sessions
2. Browse content anonymously (creates anonymous session)
3. Log in via Discord
4. Verify: No 500 error on login
5. Verify: Anonymous session is now owned by user
6. Verify: Chat history preserved

### Automated test (TDD):
Add test for conflict case in `core/modules/tests/test_chat_sessions.py`:

```python
@pytest.mark.asyncio
async def test_claim_chat_sessions_skips_conflicting_content(
    test_user_id, anonymous_token, content_id
):
    """claim should skip sessions where user already has active session for same content."""
    # Create user session first
    async with get_transaction() as conn:
        await get_or_create_chat_session(
            conn, user_id=test_user_id, anonymous_token=None,
            content_id=content_id, content_type="module"
        )

    # Create anonymous session for same content
    async with get_transaction() as conn:
        await get_or_create_chat_session(
            conn, user_id=None, anonymous_token=anonymous_token,
            content_id=content_id, content_type="module"
        )

    # Claim should not raise, should skip the conflicting session
    async with get_transaction() as conn:
        count = await claim_chat_sessions(
            conn, anonymous_token=anonymous_token, user_id=test_user_id
        )

    assert count == 0  # Skipped due to conflict
```

## Migration Notes

- No database migration needed
- Frontend and backend changes should be deployed together
- The `/api/progress/claim` endpoint removal is a breaking change, but frontend is updated simultaneously

## Files Changed

| File | Change |
|------|--------|
| `web_api/routes/auth.py` | Add anonymous_token to `/auth/discord` and `/auth/code`, add claiming in callbacks |
| `core/modules/chat_sessions.py` | Add conflict-skip logic, remove explicit commit |
| `web_api/routes/progress.py` | Delete claim endpoint |
| Frontend auth redirect | Pass anonymous_token |
| Frontend post-login | Remove claim call |
