"""
Subscribe routes — public email capture and Substack subscription.

Endpoints:
- POST /api/subscribe - Register interest (email capture) and/or subscribe to Substack
- GET /api/subscribe/unsubscribe - Unsubscribe from notifications

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

router = APIRouter(prefix="/api/subscribe", tags=["subscribe"])

# CORS headers for the subscribe endpoint (allows sandboxed iframes)
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


def _extract_course_fields(body: dict) -> dict:
    """Extract learner/navigator fields from a JSON body with backward compat.

    If the old ``subscribe_courses`` field is sent (and the new split fields are
    absent), it maps to ``subscribe_courses_learners=True``.
    """
    legacy = body.get("subscribe_courses", False)
    return {
        "subscribe_courses_learners": body.get("subscribe_courses_learners", legacy),
        "subscribe_courses_navigators": body.get("subscribe_courses_navigators", False),
    }


async def _extract_fields(request: Request) -> dict:
    """Extract email and subscription flags from request body.

    Returns dict with keys: email, subscribe_courses_learners,
    subscribe_courses_navigators, subscribe_substack.
    For non-JSON content types (no-cors fallback), defaults to learners=True.
    """
    content_type = request.headers.get("content-type", "")

    if "application/json" in content_type:
        body = await request.json()
        return {
            "email": body.get("email", ""),
            **_extract_course_fields(body),
            "subscribe_substack": body.get("subscribe_substack", False),
        }
    elif "application/x-www-form-urlencoded" in content_type:
        raw = await request.body()
        parsed = parse_qs(raw.decode())
        return {
            "email": parsed.get("email", [""])[0],
            "subscribe_courses_learners": True,
            "subscribe_courses_navigators": False,
            "subscribe_substack": False,
        }
    elif "text/plain" in content_type:
        # no-cors mode with text/plain
        raw = (await request.body()).decode().strip()
        # Try JSON first, then treat as raw email
        if raw.startswith("{"):
            import json

            try:
                body = json.loads(raw)
                return {
                    "email": body.get("email", ""),
                    **_extract_course_fields(body),
                    "subscribe_substack": body.get("subscribe_substack", False),
                }
            except json.JSONDecodeError:
                pass
        return {
            "email": raw,
            "subscribe_courses_learners": True,
            "subscribe_courses_navigators": False,
            "subscribe_substack": False,
        }

    return {
        "email": "",
        "subscribe_courses_learners": False,
        "subscribe_courses_navigators": False,
        "subscribe_substack": False,
    }


@router.options("")
async def subscribe_preflight() -> Response:
    """Handle CORS preflight for subscribe endpoint."""
    return Response(status_code=204, headers=_CORS_HEADERS)


@router.post("")
async def subscribe(request: Request) -> Response:
    """Register a prospect email and/or subscribe to Substack."""
    ip = request.client.host if request.client else "unknown"
    if not _check_rate_limit(ip):
        return JSONResponse(
            {"detail": "Too many requests. Try again later."},
            status_code=429,
            headers=_CORS_HEADERS,
        )

    fields = await _extract_fields(request)
    email = fields["email"].strip()
    subscribe_courses_learners = fields["subscribe_courses_learners"]
    subscribe_courses_navigators = fields["subscribe_courses_navigators"]
    subscribe_substack = fields["subscribe_substack"]

    if (
        not subscribe_courses_learners
        and not subscribe_courses_navigators
        and not subscribe_substack
    ):
        return JSONResponse(
            {"detail": "Please select at least one option."},
            status_code=400,
            headers=_CORS_HEADERS,
        )

    if not is_valid_email(email):
        return JSONResponse(
            {"detail": "Please enter a valid email address."},
            status_code=400,
            headers=_CORS_HEADERS,
        )

    base_url = str(request.base_url).rstrip("/")
    await register_prospect(
        email,
        base_url,
        subscribe_courses_learners=subscribe_courses_learners,
        subscribe_courses_navigators=subscribe_courses_navigators,
        subscribe_substack=subscribe_substack,
    )

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
