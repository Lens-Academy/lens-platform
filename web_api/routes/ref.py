"""Public referral link click handler."""

from urllib.parse import quote

from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse

from core.database import get_transaction
from core.referrals import get_link_by_slug, log_click

router = APIRouter(tags=["referral"])

MARKETING_CONSENT_COOKIE = "marketing-consent"


@router.get("/ref/{slug}")
async def referral_click(slug: str, request: Request):
    """
    Handle a referral link click.

    Logs the click, optionally sets a ref cookie (if marketing consent granted),
    and redirects to /?ref=<slug>.

    Invalid slugs still redirect to / (prevents slug enumeration).
    """
    link = None
    async with get_transaction() as conn:
        link = await get_link_by_slug(conn, slug)
        if link:
            await log_click(conn, link["link_id"])

    response = RedirectResponse(url=f"/?ref={quote(slug, safe='')}", status_code=302)

    # Set ref cookie if visitor has granted marketing consent
    if link and request.cookies.get(MARKETING_CONSENT_COOKIE) == "accepted":
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
