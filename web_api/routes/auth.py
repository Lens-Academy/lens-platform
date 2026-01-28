"""
Authentication routes for Discord OAuth and code-based auth.

Endpoints:
- GET /auth/discord - Start Discord OAuth flow
- GET /auth/discord/callback - Handle OAuth callback
- GET /auth/code - Validate temp code from Discord bot
- POST /auth/logout - Clear session
- GET /auth/me - Get current user info
"""

import os
import secrets
import sys
import time
from pathlib import Path
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import RedirectResponse

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core import get_or_create_user, get_user_profile, validate_and_use_auth_code
from core.database import get_connection
from core.queries.users import get_user_enrollment_status
from core.config import (
    is_dev_mode,
    is_production,
    get_api_port,
    get_frontend_port,
    get_allowed_origins,
)
from web_api.auth import create_jwt, get_optional_user, set_session_cookie

router = APIRouter(prefix="/auth", tags=["auth"])

# Discord OAuth configuration
DISCORD_CLIENT_ID = os.environ.get("DISCORD_CLIENT_ID")
DISCORD_CLIENT_SECRET = os.environ.get("DISCORD_CLIENT_SECRET")

# Compute URLs based on mode - using centralized config
_api_port = get_api_port()

if is_dev_mode():
    # Dev mode: Next.js runs on separate port (auto-assigned by workspace)
    DISCORD_REDIRECT_URI = f"http://localhost:{_api_port}/auth/discord/callback"
    FRONTEND_URL = f"http://localhost:{get_frontend_port()}"
elif is_production():
    # Production: use explicit env vars
    DISCORD_REDIRECT_URI = os.environ.get(
        "DISCORD_REDIRECT_URI", f"http://localhost:{_api_port}/auth/discord/callback"
    )
    FRONTEND_URL = os.environ.get(
        "FRONTEND_URL", f"http://localhost:{_api_port}"
    ).rstrip("/")
else:
    # Local production mode (single-service): calculate from API_PORT
    DISCORD_REDIRECT_URI = f"http://localhost:{_api_port}/auth/discord/callback"
    FRONTEND_URL = f"http://localhost:{_api_port}"

# Use centralized allowed origins
ALLOWED_ORIGINS = get_allowed_origins()


def _validate_origin(origin: str | None) -> str:
    """Validate and return origin, or fallback to FRONTEND_URL."""
    if origin and origin in ALLOWED_ORIGINS:
        return origin.rstrip("/")
    return FRONTEND_URL


# In-memory state storage for OAuth CSRF protection
# In production, use Redis or database
_oauth_states: dict[str, dict] = {}
STATE_TTL_SECONDS = 600  # 10 minutes - states expire after this


def _cleanup_expired_oauth_states():
    """Remove OAuth states older than TTL. Called before adding new states."""
    cutoff = time.time() - STATE_TTL_SECONDS
    # Build list of keys to remove (can't modify dict during iteration)
    expired = [k for k, v in _oauth_states.items() if v.get("created_at", 0) < cutoff]
    for key in expired:
        del _oauth_states[key]


@router.get("/discord")
async def discord_oauth_start(
    request: Request, next: str = "/", origin: str | None = None
):
    """
    Start Discord OAuth flow.

    Redirects user to Discord's authorization page.
    Stores the 'next' URL and origin in state for redirect after auth.

    If user is already authenticated, redirects to /course instead.

    Args:
        next: Path to redirect to after auth (default: "/")
        origin: Frontend origin URL (validated against whitelist)
    """
    # Validate origin against whitelist
    validated_origin = _validate_origin(origin)

    # Check if user is already authenticated
    existing_user = await get_optional_user(request)
    if existing_user:
        # Already signed in - redirect to course page
        return RedirectResponse(url=f"{validated_origin}/course")

    if not DISCORD_CLIENT_ID:
        raise HTTPException(500, "Discord OAuth not configured")

    # Generate state for CSRF protection
    _cleanup_expired_oauth_states()  # Prevent memory leak
    state = secrets.token_urlsafe(32)
    _oauth_states[state] = {
        "next": next,
        "origin": validated_origin,
        "created_at": time.time(),
    }

    # Build Discord OAuth URL
    params = {
        "client_id": DISCORD_CLIENT_ID,
        "redirect_uri": DISCORD_REDIRECT_URI,
        "response_type": "code",
        "scope": "identify email",
        "state": state,
    }
    oauth_url = f"https://discord.com/oauth2/authorize?{urlencode(params)}"

    return RedirectResponse(url=oauth_url)


@router.get("/discord/callback")
async def discord_oauth_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
):
    """
    Handle Discord OAuth callback.

    Exchanges the authorization code for an access token,
    fetches user info, creates/updates user in database,
    and sets session cookie.
    """
    # Handle OAuth errors
    if error:
        return RedirectResponse(url=f"{FRONTEND_URL}/enroll?error={error}")

    if not code or not state:
        return RedirectResponse(url=f"{FRONTEND_URL}/enroll?error=missing_params")

    # Validate state (CSRF protection)
    state_data = _oauth_states.pop(state, None)
    if state_data is None:
        return RedirectResponse(url=f"{FRONTEND_URL}/enroll?error=invalid_state")

    # Extract origin and next path from state
    next_url = state_data.get("next", "/")
    origin = state_data.get("origin", FRONTEND_URL)

    if not DISCORD_CLIENT_ID or not DISCORD_CLIENT_SECRET:
        raise HTTPException(500, "Discord OAuth not configured")

    # Exchange code for access token
    async with httpx.AsyncClient() as client:
        token_response = await client.post(
            "https://discord.com/api/oauth2/token",
            data={
                "client_id": DISCORD_CLIENT_ID,
                "client_secret": DISCORD_CLIENT_SECRET,
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": DISCORD_REDIRECT_URI,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

        if token_response.status_code != 200:
            return RedirectResponse(url=f"{FRONTEND_URL}/enroll?error=token_exchange")

        token_data = token_response.json()
        access_token = token_data["access_token"]

        # Fetch user info from Discord
        user_response = await client.get(
            "https://discord.com/api/users/@me",
            headers={"Authorization": f"Bearer {access_token}"},
        )

        if user_response.status_code != 200:
            return RedirectResponse(url=f"{FRONTEND_URL}/enroll?error=user_fetch")

        discord_user = user_response.json()

    # Extract user info
    discord_id = discord_user["id"]
    # Use actual Discord username (no spaces allowed), not global_name (display name)
    discord_username = discord_user["username"]
    discord_avatar = discord_user.get("avatar")  # Avatar hash from Discord
    email = discord_user.get("email")
    email_verified = discord_user.get("verified", False)
    # Use global_name (display name) to pre-fill nickname if user doesn't have one
    nickname = discord_user.get("global_name")

    # Create or update user in database
    await get_or_create_user(
        discord_id, discord_username, discord_avatar, email, email_verified, nickname
    )

    # Create JWT and set cookie
    token = create_jwt(discord_id, discord_username)

    response = RedirectResponse(url=f"{origin}{next_url}")
    set_session_cookie(response, token)

    return response


@router.get("/code")
async def validate_auth_code_endpoint(
    code: str, next: str = "/", origin: str | None = None
):
    """
    Validate a temporary auth code from the Discord bot.

    The Discord bot creates codes and stores them in the auth_codes table.
    This endpoint validates the code, marks it as used, and creates a session.

    Args:
        code: The auth code to validate
        next: Path to redirect to after auth (default: "/")
        origin: Frontend origin URL (validated against whitelist)
    """
    # Validate origin against whitelist
    redirect_base = _validate_origin(origin)

    if not code:
        return RedirectResponse(url=f"{redirect_base}/enroll?error=missing_code")

    auth_code, error = await validate_and_use_auth_code(code)
    if error:
        return RedirectResponse(url=f"{redirect_base}/enroll?error={error}")

    # Get or create user
    discord_id = auth_code["discord_id"]
    user = await get_or_create_user(discord_id)
    discord_username = user.get("discord_username") or f"User_{discord_id[:8]}"

    # Create JWT and set cookie
    token = create_jwt(discord_id, discord_username)

    response = RedirectResponse(url=f"{redirect_base}{next}")
    set_session_cookie(response, token)

    return response


@router.post("/code")
async def validate_auth_code_api(response: Response, code: str, next: str = "/"):
    """
    Validate a temporary auth code from the Discord bot (API version).

    Returns JSON response instead of redirect, for frontend fetch calls.
    Sets the session cookie on the response.
    """
    if not code:
        raise HTTPException(status_code=400, detail="missing_code")

    auth_code, error = await validate_and_use_auth_code(code)
    if error:
        raise HTTPException(status_code=400, detail=error)

    # Get or create user
    discord_id = auth_code["discord_id"]
    user = await get_or_create_user(discord_id)
    discord_username = user.get("discord_username") or f"User_{discord_id[:8]}"

    # Create JWT and set cookie
    token = create_jwt(discord_id, discord_username)
    set_session_cookie(response, token)

    return {"status": "ok", "next": next}


@router.post("/logout")
async def logout(response: Response):
    """Clear the session cookie."""
    response.delete_cookie(key="session")
    return {"status": "logged_out"}


def _get_discord_avatar_url(discord_id: str, avatar_hash: str | None) -> str:
    """Construct Discord avatar URL from user ID and avatar hash."""
    if avatar_hash:
        # User has a custom avatar
        ext = "gif" if avatar_hash.startswith("a_") else "png"
        return f"https://cdn.discordapp.com/avatars/{discord_id}/{avatar_hash}.{ext}"
    else:
        # Default avatar based on user ID (modern Discord calculation)
        index = (int(discord_id) >> 22) % 6
        return f"https://cdn.discordapp.com/embed/avatars/{index}.png"


@router.get("/me")
async def get_me(request: Request):
    """
    Get current authenticated user info.

    Returns 200 always:
    - If authenticated: { authenticated: true, discord_id, discord_username, discord_avatar_url, user, is_in_signups_table, is_in_active_group }
    - If not authenticated: { authenticated: false }
    """
    user = await get_optional_user(request)

    if not user:
        return {"authenticated": False}

    db_user = await get_user_profile(user["sub"])

    if not db_user:
        # User has valid token but no DB record - treat as unauthenticated
        return {"authenticated": False}

    avatar_url = _get_discord_avatar_url(user["sub"], db_user.get("discord_avatar"))

    # Get enrollment status
    async with get_connection() as conn:
        enrollment_status = await get_user_enrollment_status(conn, db_user["user_id"])

    return {
        "authenticated": True,
        "discord_id": user["sub"],
        "discord_username": user["username"],
        "discord_avatar_url": avatar_url,
        "user": db_user,
        "is_in_signups_table": enrollment_status["is_in_signups_table"],
        "is_in_active_group": enrollment_status["is_in_active_group"],
    }
