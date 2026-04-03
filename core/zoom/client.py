"""Zoom API client with Server-to-Server OAuth authentication."""

import base64
import logging
import os
import time

import httpx
import sentry_sdk

logger = logging.getLogger(__name__)

ZOOM_ACCOUNT_ID = os.environ.get("ZOOM_ACCOUNT_ID", "")
ZOOM_CLIENT_ID = os.environ.get("ZOOM_CLIENT_ID", "")
ZOOM_CLIENT_SECRET = os.environ.get("ZOOM_CLIENT_SECRET", "")

BASE_URL = "https://api.zoom.us/v2"
TOKEN_URL = "https://zoom.us/oauth/token"

# Cached token and expiry
_access_token: str | None = None
_token_expires_at: float = 0


def is_zoom_configured() -> bool:
    """Check if Zoom API credentials are configured."""
    return bool(ZOOM_ACCOUNT_ID and ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET)


async def _get_access_token() -> str:
    """
    Get a valid Zoom access token, refreshing if expired.

    S2S OAuth tokens last 1 hour. We refresh 5 minutes early to avoid
    mid-request expiration.
    """
    global _access_token, _token_expires_at

    if _access_token and time.time() < _token_expires_at - 300:
        return _access_token

    credentials = base64.b64encode(
        f"{ZOOM_CLIENT_ID}:{ZOOM_CLIENT_SECRET}".encode()
    ).decode()

    async with httpx.AsyncClient() as client:
        response = await client.post(
            TOKEN_URL,
            headers={
                "Authorization": f"Basic {credentials}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data={
                "grant_type": "account_credentials",
                "account_id": ZOOM_ACCOUNT_ID,
            },
        )
        response.raise_for_status()
        data = response.json()

    _access_token = data["access_token"]
    _token_expires_at = time.time() + data["expires_in"]
    return _access_token


def _log_zoom_error(
    exception: Exception,
    operation: str,
    context: dict | None = None,
) -> None:
    """Log Zoom API errors with appropriate severity."""
    context = context or {}
    status = None
    if isinstance(exception, httpx.HTTPStatusError):
        status = exception.response.status_code

    if status == 429:
        logger.warning(
            f"Zoom API rate limit hit during {operation}",
            extra={"operation": operation, **context},
        )
        sentry_sdk.capture_message(
            f"Zoom API rate limit: {operation}",
            level="warning",
            extras={"operation": operation, **context},
        )
    else:
        logger.error(
            f"Zoom API error during {operation}: {exception}",
            extra={"operation": operation, **context},
        )
        sentry_sdk.capture_exception(exception)


async def zoom_request(
    method: str,
    path: str,
    json: dict | None = None,
    params: dict | None = None,
) -> dict | None:
    """
    Make an authenticated request to the Zoom API.

    Returns the JSON response, or None if Zoom is not configured.
    Raises httpx.HTTPStatusError on API errors.
    """
    if not is_zoom_configured():
        return None

    token = await _get_access_token()
    async with httpx.AsyncClient() as client:
        response = await client.request(
            method,
            f"{BASE_URL}{path}",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json=json,
            params=params,
            timeout=30,
        )
        response.raise_for_status()
        if response.status_code == 204:
            return {}
        return response.json()
