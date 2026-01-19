"""
JWT authentication utilities for the web API.

Security measures implemented:
- HS256 signing algorithm with 256-bit secret
- Token expiration (24 hours)
- HttpOnly cookies (set in routes)
"""

import os
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import HTTPException, Request, Response

JWT_SECRET = os.environ.get("JWT_SECRET")
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24

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
        "exp": now + timedelta(hours=JWT_EXPIRATION_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def verify_jwt(token: str) -> dict | None:
    """
    Verify and decode a JWT token.

    Args:
        token: The JWT token string

    Returns:
        Decoded payload dict if valid, None if invalid
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
        max_age=60 * 60 * 24,  # 24 hours
        domain=cookie_domain if is_production else None,
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
