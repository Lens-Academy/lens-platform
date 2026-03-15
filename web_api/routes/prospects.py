"""
Prospect routes — public email capture for course notifications.

Endpoints:
- POST /api/prospects - Register interest (email capture)
- GET /api/prospects/unsubscribe - Unsubscribe from notifications
"""

import time
from collections import defaultdict

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from core.prospects import (
    is_valid_email,
    register_prospect,
    unsubscribe_prospect,
    verify_unsubscribe_token,
)

router = APIRouter(prefix="/api/prospects", tags=["prospects"])

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


class ProspectRequest(BaseModel):
    email: str


@router.post("")
async def register_interest(body: ProspectRequest, request: Request) -> dict:
    """Register a prospect email. Always returns ok (doesn't leak existence)."""
    ip = request.client.host if request.client else "unknown"
    if not _check_rate_limit(ip):
        raise HTTPException(
            status_code=429, detail="Too many requests. Try again later."
        )

    email = body.email.strip()
    if not is_valid_email(email):
        raise HTTPException(
            status_code=400, detail="Please enter a valid email address."
        )

    base_url = str(request.base_url).rstrip("/")
    await register_prospect(email, base_url)

    return {"ok": True}


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
