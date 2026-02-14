"""
Authentication routes for Discord OAuth and code-based auth.

Endpoints:
- GET /auth/discord - Start Discord OAuth flow
- GET /auth/discord/callback - Handle OAuth callback
- POST /auth/refresh - Rotate refresh token and issue new JWT
- POST /auth/logout - Clear session and revoke refresh tokens
- GET /auth/me - Get current user info
"""

import os
import secrets
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, urlencode
from uuid import UUID

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import RedirectResponse

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core import get_or_create_user, get_user_profile
from core.database import get_connection, get_transaction
from core.modules.progress import claim_progress_records
from core.modules.chat_sessions import claim_chat_sessions
from core.queries.refresh_tokens import (
    get_refresh_token_by_hash,
    revoke_family,
    revoke_token,
    store_refresh_token,
)
from core.queries.users import (
    get_user_by_id,
    get_user_enrollment_status,
)
from core.config import (
    is_dev_mode,
    is_production,
    get_api_port,
    get_dev_host,
    get_frontend_port,
    get_allowed_origins,
)
from web_api.auth import (
    create_jwt,
    delete_refresh_cookie,
    delete_session_cookie,
    generate_refresh_token,
    get_optional_user,
    hash_token,
    set_refresh_cookie,
    set_session_cookie,
)
from web_api.rate_limit import oauth_start_limiter, refresh_limiter

router = APIRouter(prefix="/auth", tags=["auth"])

# Discord OAuth configuration
DISCORD_CLIENT_ID = os.environ.get("DISCORD_CLIENT_ID")
DISCORD_CLIENT_SECRET = os.environ.get("DISCORD_CLIENT_SECRET")

# Compute URLs based on mode - using centralized config
_api_port = get_api_port()

if is_dev_mode():
    # Dev mode: auto-detect from workspace number + DEV_HOST, allow env var override
    _dev_host = get_dev_host()
    DISCORD_REDIRECT_URI = os.environ.get(
        "DISCORD_REDIRECT_URI", f"http://{_dev_host}:{_api_port}/auth/discord/callback"
    )
    FRONTEND_URL = os.environ.get(
        "FRONTEND_URL", f"http://{_dev_host}:{get_frontend_port()}"
    ).rstrip("/")
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


def _validate_next_path(next_path: str) -> str:
    """Sanitize the 'next' redirect path to prevent open redirects.

    Ensures the path is a relative path starting with '/'.
    """
    if not next_path or not next_path.startswith("/") or next_path.startswith("//"):
        return "/"
    return next_path


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


async def _issue_refresh_token(response: Response, user_id: int) -> None:
    """Generate a refresh token, store its hash in DB, and set the cookie."""
    raw_token, token_hash = generate_refresh_token()
    family_id = str(uuid.uuid4())

    async with get_transaction() as conn:
        await store_refresh_token(conn, token_hash, user_id, family_id)

    set_refresh_cookie(response, raw_token)


@router.get("/discord")
async def discord_oauth_start(
    request: Request,
    next: str = "/",
    origin: str | None = None,
    anonymous_token: str | None = None,
):
    """
    Start Discord OAuth flow.

    Redirects user to Discord's authorization page.
    Stores the 'next' URL and origin in state for redirect after auth.

    If user is already authenticated, redirects to /course instead.

    Args:
        next: Path to redirect to after auth (default: "/")
        origin: Frontend origin URL (validated against whitelist)
        anonymous_token: Optional anonymous session token to claim on login
    """
    oauth_start_limiter.check(request)

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
        "next": _validate_next_path(next),
        "origin": validated_origin,
        "anonymous_token": anonymous_token,
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
        return RedirectResponse(url=f"{FRONTEND_URL}/enroll?error={quote(error)}")

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
    user = await get_or_create_user(
        discord_id, discord_username, discord_avatar, email, email_verified, nickname
    )

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

    response = RedirectResponse(url=f"{origin}{next_url}")
    set_session_cookie(response, token)
    await _issue_refresh_token(response, user["user_id"])

    return response


@router.post("/refresh")
async def refresh_token_endpoint(request: Request, response: Response):
    """
    Rotate refresh token and issue a new JWT.

    Reads the refresh_token cookie, validates it, revokes the old token,
    issues a new refresh token in the same family, and returns a new JWT.
    """
    refresh_limiter.check(request)

    raw_refresh = request.cookies.get("refresh_token")

    if raw_refresh:
        # Normal flow: validate and rotate the refresh token
        # Single transaction with FOR UPDATE to prevent concurrent rotation
        token_hash = hash_token(raw_refresh)
        new_raw, new_hash = generate_refresh_token()
        error = None
        user = None

        async with get_transaction() as conn:
            db_token = await get_refresh_token_by_hash(
                conn, token_hash, for_update=True
            )

            if not db_token:
                error = "Invalid refresh token"
            elif db_token["revoked_at"] is not None:
                # Reuse detected — revoke entire family
                await revoke_family(conn, db_token["family_id"])
                error = "Refresh token reuse detected"
            else:
                # Check expiry
                expires_at = db_token["expires_at"]
                if expires_at.tzinfo is None:
                    expires_at = expires_at.replace(tzinfo=timezone.utc)
                if datetime.now(timezone.utc) > expires_at:
                    await revoke_token(conn, db_token["token_id"])
                    error = "Refresh token expired"
                else:
                    # Valid — rotate: revoke old, issue new in same family
                    await revoke_token(conn, db_token["token_id"])
                    user = await get_user_by_id(conn, db_token["user_id"])
                    if user:
                        await store_refresh_token(
                            conn,
                            new_hash,
                            user["user_id"],
                            db_token["family_id"],
                        )
                    else:
                        error = "User not found"

        # Raise errors after transaction commits (so revoke_family persists)
        if error:
            delete_refresh_cookie(response)
            if error == "Refresh token reuse detected":
                delete_session_cookie(response)
            raise HTTPException(status_code=401, detail=error)

        # Issue new JWT + refresh cookie
        discord_id = user["discord_id"]
        discord_username = user.get("discord_username") or f"User_{discord_id[:8]}"
        jwt_token = create_jwt(discord_id, discord_username)
        set_session_cookie(response, jwt_token)
        set_refresh_cookie(response, new_raw)

        return {"status": "refreshed"}

    # No valid refresh token
    raise HTTPException(status_code=401, detail="Not authenticated")


@router.post("/logout")
async def logout(request: Request, response: Response):
    """Clear session and refresh cookies, revoke refresh token family."""
    # Revoke the refresh token family in DB
    raw_refresh = request.cookies.get("refresh_token")
    if raw_refresh:
        token_hash = hash_token(raw_refresh)
        async with get_transaction() as conn:
            db_token = await get_refresh_token_by_hash(conn, token_hash)
            if db_token:
                await revoke_family(conn, db_token["family_id"])

    delete_session_cookie(response)
    delete_refresh_cookie(response)
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

    Returns:
    - 401 if no valid JWT (triggers fetchWithRefresh to use refresh token)
    - 200 { authenticated: false } if valid JWT but no DB user record
    - 200 { authenticated: true, ... } if fully authenticated
    """
    user = await get_optional_user(request)

    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

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
