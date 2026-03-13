"""
Prospect routes — public email capture for course notifications.

Endpoints:
- POST /api/prospects - Register interest (email capture)
- GET /api/prospects/unsubscribe - Unsubscribe from notifications

The POST endpoint supports cross-origin requests (Access-Control-Allow-Origin: *)
to allow embedding in sandboxed iframes (e.g., LessWrong custom widgets).
"""

import time
from collections import defaultdict
from urllib.parse import parse_qs

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from starlette.responses import Response

from core.prospects import (
    is_valid_email,
    register_prospect,
    unsubscribe_prospect,
    verify_unsubscribe_token,
)

router = APIRouter(prefix="/api/prospects", tags=["prospects"])

# CORS headers for the prospect endpoint (allows sandboxed iframes)
_CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

# Simple in-memory rate limiting: IP -> list of timestamps
_rate_limit: dict[str, list[float]] = defaultdict(list)
RATE_LIMIT_MAX = 5
RATE_LIMIT_WINDOW = 3600  # 1 hour


def _check_rate_limit(ip: str) -> bool:
    """Returns True if request is allowed."""
    now = time.time()
    timestamps = _rate_limit[ip]
    # Remove expired entries
    _rate_limit[ip] = [t for t in timestamps if now - t < RATE_LIMIT_WINDOW]
    if len(_rate_limit[ip]) >= RATE_LIMIT_MAX:
        return False
    _rate_limit[ip].append(now)
    return True


async def _extract_email(request: Request) -> str:
    """Extract email from JSON or form-urlencoded body."""
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        body = await request.json()
        return body.get("email", "")
    elif "application/x-www-form-urlencoded" in content_type:
        raw = await request.body()
        parsed = parse_qs(raw.decode())
        return parsed.get("email", [""])[0]
    elif "text/plain" in content_type:
        # no-cors mode with text/plain
        raw = (await request.body()).decode().strip()
        # Try JSON first, then treat as raw email
        if raw.startswith("{"):
            import json

            try:
                return json.loads(raw).get("email", "")
            except json.JSONDecodeError:
                pass
        return raw
    return ""


@router.options("")
async def prospects_preflight() -> Response:
    """Handle CORS preflight for prospect registration."""
    return Response(status_code=204, headers=_CORS_HEADERS)


@router.post("")
async def register_interest(request: Request) -> Response:
    """Register a prospect email. Always returns ok (doesn't leak existence)."""
    ip = request.client.host if request.client else "unknown"
    if not _check_rate_limit(ip):
        return JSONResponse(
            {"detail": "Too many requests. Try again later."},
            status_code=429,
            headers=_CORS_HEADERS,
        )

    email = (await _extract_email(request)).strip()
    if not is_valid_email(email):
        return JSONResponse(
            {"detail": "Please enter a valid email address."},
            status_code=400,
            headers=_CORS_HEADERS,
        )

    base_url = str(request.base_url).rstrip("/")
    await register_prospect(email, base_url)

    return JSONResponse({"ok": True}, headers=_CORS_HEADERS)


@router.get("/unsubscribe", response_class=HTMLResponse)
async def unsubscribe(email: str, token: str) -> str:
    """Unsubscribe a prospect from notifications."""
    if not verify_unsubscribe_token(email, token):
        raise HTTPException(status_code=400, detail="Invalid unsubscribe link.")

    await unsubscribe_prospect(email)

    return """<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Unsubscribed</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 60px auto; padding: 20px; text-align: center;">
<h1 style="font-size: 24px;">You've been unsubscribed</h1>
<p style="color: #666;">You won't receive any more course notification emails from Lens Academy.</p>
</body>
</html>"""
