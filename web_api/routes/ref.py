"""Public referral link click handler."""

from enum import Enum
from urllib.parse import urlencode

from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from core.database import get_transaction
from core.referrals import get_link_by_slug, log_click, update_click_consent

router = APIRouter(tags=["referral"])

MARKETING_CONSENT_COOKIE = "marketing-consent"


def _consent_state(request: Request) -> str:
    """Derive the visitor's marketing consent state from cookies."""
    value = request.cookies.get(MARKETING_CONSENT_COOKIE)
    if value == "accepted":
        return "accepted"
    if value == "declined":
        return "declined"
    return "pending"


@router.get("/ref/{slug}")
async def referral_click(slug: str, request: Request):
    """
    Handle a referral link click.

    Logs the click (unless deduplicated by cookie), optionally sets a ref
    cookie (if marketing consent granted), and redirects to /?ref=<slug>.

    The redirect includes click_id so the frontend can retroactively update
    consent_state when the visitor makes their cookie banner choice.

    Invalid slugs still redirect to / (prevents slug enumeration).
    """
    link = None
    click_id = None
    consent = _consent_state(request)
    existing_ref_cookie = request.cookies.get("ref")

    async with get_transaction() as conn:
        link = await get_link_by_slug(conn, slug)
        if link:
            # Dedup: skip if the visitor already has a ref cookie for this exact slug
            if consent == "accepted" and existing_ref_cookie == slug:
                pass  # Same browser, same link — don't inflate click count
            else:
                click_id = await log_click(conn, link["link_id"], consent_state=consent)

    # Build redirect URL with ref and optional click_id
    params = {"ref": slug}
    if click_id is not None:
        params["click_id"] = str(click_id)
    response = RedirectResponse(url=f"/?{urlencode(params)}", status_code=302)

    # Set ref cookie if visitor has granted marketing consent
    if link and consent == "accepted":
        is_secure = request.url.scheme == "https"
        response.set_cookie(
            key="ref",
            value=slug,
            max_age=90 * 24 * 60 * 60,  # 90 days
            httponly=True,
            secure=is_secure,
            samesite="lax",
            path="/",
        )

    return response


class ConsentChoice(str, Enum):
    accepted = "accepted"
    declined = "declined"


class ConsentUpdateRequest(BaseModel):
    consent_state: ConsentChoice


@router.patch("/ref/clicks/{click_id}/consent")
async def update_consent(click_id: int, body: ConsentUpdateRequest):
    """Update consent_state on a referral click (pending -> accepted/declined).

    Called by the frontend when the visitor makes their cookie banner choice.
    Only updates clicks that are still 'pending'. Idempotent.
    """
    async with get_transaction() as conn:
        updated = await update_click_consent(conn, click_id, body.consent_state.value)
    return {"updated": updated}
