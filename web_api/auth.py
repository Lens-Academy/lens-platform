"""
JWT authentication utilities for the web API.

Security measures implemented:
- HS256 signing algorithm with 256-bit secret
- Token expiration (15 minutes)
- HttpOnly cookies (set in routes)
"""

import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

import jwt
from fastapi import Header, HTTPException, Request, Response

from core.queries.refresh_tokens import REFRESH_TOKEN_EXPIRES_DAYS

JWT_SECRET = os.environ.get("JWT_SECRET")
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_MINUTES = 15

# Validate JWT_SECRET at startup in production
if not JWT_SECRET and os.environ.get("RAILWAY_ENVIRONMENT"):
    raise RuntimeError(
        "JWT_SECRET must be set in production (RAILWAY_ENVIRONMENT detected)"
    )


def create_jwt(discord_user_id: str, discord_username: str) -> str:
    """
    Create a signed JWT token for an authenticated user.

    Args:
        discord_user_id: The user's Discord ID
        discord_username: The user's Discord username

    Returns:
        Signed JWT token string
    """
    if not JWT_SECRET:
        raise ValueError("JWT_SECRET environment variable not set")

    now = datetime.now(timezone.utc)
    payload = {
        "sub": discord_user_id,
        "username": discord_username,
        "iat": now,
        "exp": now + timedelta(minutes=JWT_EXPIRATION_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def verify_jwt(token: str) -> dict | None:
    """
    Verify and decode a JWT token.

    Args:
        token: The JWT token string

    Returns:
        Decoded payload dict if valid, None if invalid/no secret configured
    """
    if not JWT_SECRET:
        raise ValueError("JWT_SECRET environment variable not set")

    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.InvalidTokenError:
        return None


def set_session_cookie(response: Response, token: str) -> None:
    """
    Set the session cookie with the JWT token.

    Args:
        response: The FastAPI response object
        token: The JWT token to store
    """
    is_production = bool(os.environ.get("RAILWAY_ENVIRONMENT"))
    cookie_domain = os.environ.get("COOKIE_DOMAIN")  # e.g., ".lensacademy.org"
    # Use "none" for cross-origin staging (requires user to allow third-party cookies)
    # Use "lax" for same-origin or production with shared domain
    samesite = os.environ.get("COOKIE_SAMESITE", "lax")

    response.set_cookie(
        key="session",
        value=token,
        httponly=True,
        secure=is_production or samesite == "none",  # Secure required for SameSite=None
        samesite=samesite,
        max_age=60 * JWT_EXPIRATION_MINUTES,
        path="/",
        domain=cookie_domain if is_production else None,
    )


def hash_token(raw: str) -> str:
    """Hash a raw token with SHA-256 for storage."""
    return hashlib.sha256(raw.encode()).hexdigest()


def generate_refresh_token() -> tuple[str, str]:
    """Generate a refresh token. Returns (raw_token, token_hash)."""
    raw = secrets.token_urlsafe(32)
    return raw, hash_token(raw)


def set_refresh_cookie(response: Response, raw_token: str) -> None:
    """Set the refresh token cookie (HttpOnly, scoped to /auth/)."""
    is_production = bool(os.environ.get("RAILWAY_ENVIRONMENT"))
    cookie_domain = os.environ.get("COOKIE_DOMAIN")
    samesite = os.environ.get("COOKIE_SAMESITE", "lax")

    response.set_cookie(
        key="refresh_token",
        value=raw_token,
        httponly=True,
        secure=is_production or samesite == "none",
        samesite=samesite,
        max_age=60 * 60 * 24 * REFRESH_TOKEN_EXPIRES_DAYS,
        path="/auth/",
        domain=cookie_domain if is_production else None,
    )


def delete_refresh_cookie(response: Response) -> None:
    """Clear the refresh token cookie."""
    is_production = bool(os.environ.get("RAILWAY_ENVIRONMENT"))
    cookie_domain = os.environ.get("COOKIE_DOMAIN")
    samesite = os.environ.get("COOKIE_SAMESITE", "lax")

    response.delete_cookie(
        key="refresh_token",
        path="/auth/",
        domain=cookie_domain if is_production else None,
        secure=is_production or samesite == "none",
        samesite=samesite,
    )


def delete_session_cookie(response: Response) -> None:
    """Clear the session cookie with matching attributes."""
    is_production = bool(os.environ.get("RAILWAY_ENVIRONMENT"))
    cookie_domain = os.environ.get("COOKIE_DOMAIN")
    samesite = os.environ.get("COOKIE_SAMESITE", "lax")

    response.delete_cookie(
        key="session",
        path="/",
        domain=cookie_domain if is_production else None,
        secure=is_production or samesite == "none",
        samesite=samesite,
    )


async def get_current_user(request: Request) -> dict:
    """
    FastAPI dependency to get the current authenticated user.

    Extracts the session cookie and validates the JWT.

    Args:
        request: The FastAPI request object

    Returns:
        The decoded JWT payload with user info

    Raises:
        HTTPException: 401 if not authenticated or invalid token
    """
    token = request.cookies.get("session")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    payload = verify_jwt(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    return payload


async def get_optional_user(request: Request) -> dict | None:
    """
    FastAPI dependency to optionally get the current user.

    Returns None if not authenticated instead of raising an exception.
    Useful for endpoints that work for both authenticated and anonymous users.

    Args:
        request: The FastAPI request object

    Returns:
        The decoded JWT payload if authenticated, None otherwise
    """
    token = request.cookies.get("session")
    if not token:
        return None

    return verify_jwt(token)


async def get_user_or_anonymous(
    request: Request,
    x_anonymous_token: str | None = Header(None),
) -> tuple[int | None, UUID | None]:
    """
    FastAPI dependency to get user_id or anonymous_token.

    Supports both authenticated users (via JWT cookie) and anonymous users
    (via X-Anonymous-Token header). Raises 401 if neither is provided.

    Args:
        request: The FastAPI request object
        x_anonymous_token: Optional anonymous token from header

    Returns:
        Tuple of (user_id, anonymous_token) - one will be set, other will be None

    Raises:
        HTTPException: 401 if neither JWT nor anonymous token provided
    """
    from core.database import get_connection
    from core.queries.users import get_user_by_discord_id

    user = await get_optional_user(request)
    user_id = None
    anonymous_token = None

    if user:
        # Look up database user_id from Discord ID
        async with get_connection() as conn:
            db_user = await get_user_by_discord_id(conn, user["sub"])
            if db_user:
                user_id = db_user["user_id"]

    if not user_id and x_anonymous_token:
        try:
            anonymous_token = UUID(x_anonymous_token)
        except ValueError:
            pass

    if not user_id and not anonymous_token:
        raise HTTPException(status_code=401, detail="Authentication required")

    return user_id, anonymous_token


async def require_admin(request: Request) -> dict:
    """
    FastAPI dependency requiring admin privileges.

    Returns the database user dict (with user_id) if admin.

    Raises:
        HTTPException: 401 if not authenticated, 403 if not admin
    """
    from core.database import get_connection
    from core.queries.users import get_user_by_discord_id
    from core.queries.facilitator import is_admin

    # First check authentication
    token = request.cookies.get("session")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    payload = verify_jwt(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    discord_id = payload["sub"]

    # Check admin status
    async with get_connection() as conn:
        db_user = await get_user_by_discord_id(conn, discord_id)
        if not db_user:
            raise HTTPException(status_code=403, detail="User not found")

        if not await is_admin(conn, db_user["user_id"]):
            raise HTTPException(status_code=403, detail="Admin access required")

    return db_user
