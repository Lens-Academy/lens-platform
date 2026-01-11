# Auth/Me Return 200 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Change `/auth/me` to return 200 with `{ authenticated: false }` instead of 401 when not logged in, eliminating noisy console errors.

**Architecture:** The backend `/auth/me` endpoint will use `get_optional_user` instead of `get_current_user`, returning a consistent 200 response with an `authenticated` boolean. The frontend `useAuth` hook will check this field instead of HTTP status code.

**Tech Stack:** FastAPI (backend), React/TypeScript (frontend)

---

### Task 1: Backend - Update /auth/me endpoint

**Files:**
- Modify: `web_api/routes/auth.py:288-312`

**Step 1: Update the /auth/me endpoint to use get_optional_user**

Change the import and endpoint implementation:

```python
# In web_api/routes/auth.py

# Update import at line 24 to include get_optional_user:
from web_api.auth import create_jwt, get_optional_user, set_session_cookie

# Replace the get_me function (lines 288-312) with:
@router.get("/me")
async def get_me(request: Request):
    """
    Get current authenticated user info.

    Returns 200 always:
    - If authenticated: { authenticated: true, discord_id, discord_username, discord_avatar_url, user }
    - If not authenticated: { authenticated: false }
    """
    user = await get_optional_user(request)

    if not user:
        return {"authenticated": False}

    db_user = await get_user_profile(user["sub"])

    if not db_user:
        # User has valid token but no DB record - treat as unauthenticated
        return {"authenticated": False}

    avatar_url = _get_discord_avatar_url(
        user["sub"],
        db_user.get("discord_avatar")
    )

    return {
        "authenticated": True,
        "discord_id": user["sub"],
        "discord_username": user["username"],
        "discord_avatar_url": avatar_url,
        "user": db_user,
    }
```

**Step 2: Verify the change manually**

Run the dev server and test:
```bash
# In terminal 1: Start the server
python main.py --dev --no-bot

# In terminal 2: Test unauthenticated request
curl http://localhost:8000/auth/me
# Expected: {"authenticated":false}
```

**Step 3: Commit backend change**

```bash
git add web_api/routes/auth.py
git commit -m "fix(auth): return 200 from /auth/me when not authenticated

Instead of returning 401 which shows as error in browser console,
return 200 with { authenticated: false } for cleaner UX."
```

---

### Task 2: Frontend - Update useAuth hook

**Files:**
- Modify: `web_frontend/src/hooks/useAuth.ts:48-84`

**Step 1: Update the fetchUser function to check authenticated field**

```typescript
// In web_frontend/src/hooks/useAuth.ts

// Replace the fetchUser useCallback (lines 48-85) with:
const fetchUser = useCallback(async () => {
  try {
    const response = await fetch(`${API_URL}/auth/me`, {
      credentials: "include", // Include cookies
    });

    if (!response.ok) {
      // Server error - treat as not authenticated
      setState({
        isAuthenticated: false,
        isLoading: false,
        user: null,
        discordId: null,
        discordUsername: null,
        discordAvatarUrl: null,
      });
      return;
    }

    const data = await response.json();

    if (data.authenticated) {
      setState({
        isAuthenticated: true,
        isLoading: false,
        user: data.user,
        discordId: data.discord_id,
        discordUsername: data.discord_username,
        discordAvatarUrl: data.discord_avatar_url,
      });
    } else {
      setState({
        isAuthenticated: false,
        isLoading: false,
        user: null,
        discordId: null,
        discordUsername: null,
        discordAvatarUrl: null,
      });
    }
  } catch (error) {
    console.error("Failed to fetch user:", error);
    setState({
      isAuthenticated: false,
      isLoading: false,
      user: null,
      discordId: null,
      discordUsername: null,
      discordAvatarUrl: null,
    });
  }
}, []);
```

**Step 2: Verify in browser**

1. Open browser devtools Network tab
2. Navigate to the app while not logged in
3. Verify `/auth/me` returns 200 (not 401)
4. Verify no red error in Console tab

**Step 3: Commit frontend change**

```bash
git add web_frontend/src/hooks/useAuth.ts
git commit -m "fix(auth): handle new /auth/me response format

Check data.authenticated instead of response.ok to determine
auth status, now that backend returns 200 for unauthenticated."
```

---

### Task 3: Update frontend tests

**Files:**
- Modify: `web_frontend/src/__tests__/anonymous-session-flow.test.tsx`

**Step 1: Update the useAuth mock to match new response format**

The tests mock `useAuth` directly, so they should still work. Run tests to verify:

```bash
cd web_frontend && npm test
```

Expected: All tests pass (mocks bypass the actual fetch logic).

**Step 2: Commit if any test fixes needed**

```bash
git add -A
git commit -m "test: update tests for new auth response format"
```

---

## Verification Checklist

- [ ] `curl http://localhost:8000/auth/me` returns `{"authenticated":false}` (not 401)
- [ ] Browser console shows no red 401 error on page load when not logged in
- [ ] `npm test` passes in web_frontend
- [ ] Login flow still works correctly
- [ ] Authenticated requests to `/auth/me` return user data with `authenticated: true`
