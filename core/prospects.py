"""Prospect email capture for course notifications."""

import hashlib
import hmac
import os
import re

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert

from .database import get_connection
from .notifications.channels.email import send_email
from .tables import prospects

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# For HMAC-signed unsubscribe tokens
_HMAC_SECRET: bytes | None = None


def _get_hmac_secret() -> bytes:
    global _HMAC_SECRET
    if _HMAC_SECRET is None:
        secret = os.environ.get("JWT_SECRET", "dev-secret-change-me")
        _HMAC_SECRET = secret.encode()
    return _HMAC_SECRET


def make_unsubscribe_token(email: str) -> str:
    """Create HMAC-signed token for unsubscribe link."""
    return hmac.new(
        _get_hmac_secret(), email.lower().encode(), hashlib.sha256
    ).hexdigest()


def verify_unsubscribe_token(email: str, token: str) -> bool:
    """Verify an unsubscribe token matches the email."""
    expected = make_unsubscribe_token(email)
    return hmac.compare_digest(expected, token)


def is_valid_email(email: str) -> bool:
    return bool(EMAIL_RE.match(email)) and len(email) <= 254


async def register_prospect(
    email: str,
    base_url: str,
    subscribe_courses_learners: bool = False,
    subscribe_courses_navigators: bool = False,
    subscribe_substack: bool = False,
) -> bool:
    """
    Register a prospect email. Idempotent — duplicate emails are ignored.

    Sends a confirmation email for new course signups.
    Returns True if a new prospect was inserted.
    """
    email = email.strip().lower()

    async with get_connection() as conn:
        # Insert new row (ignore if email already exists)
        result = await conn.execute(
            insert(prospects)
            .values(email=email)
            .on_conflict_do_nothing(constraint="uq_prospects_email")
        )
        is_new = result.rowcount > 0

        # Update subscription flags (works for both new and existing rows)
        updates = {}
        if subscribe_courses_learners:
            updates["subscribe_courses_learners"] = True
        if subscribe_courses_navigators:
            updates["subscribe_courses_navigators"] = True
        if subscribe_substack:
            updates["subscribe_substack"] = True
        if updates:
            await conn.execute(
                update(prospects).where(prospects.c.email == email).values(**updates)
            )

        await conn.commit()

    if is_new and (subscribe_courses_learners or subscribe_courses_navigators):
        _send_confirmation_email(email, base_url)

    return is_new


def _send_confirmation_email(email: str, base_url: str) -> None:
    """Send a welcome email to a new prospect."""
    token = make_unsubscribe_token(email)
    unsubscribe_url = (
        f"{base_url}/api/subscribe/unsubscribe?email={email}&token={token}"
    )
    course_url = f"{base_url}/course/default"

    body = (
        "Hi there,\n\n"
        "Thanks for signing up to hear about new courses at Lens Academy.\n\n"
        "We'll send you an email when our next cohort opens for enrollment.\n\n"
        f"In the meantime, you can explore our free course materials at [{course_url}]({course_url}).\n\n"
        "— The Lens Academy Team\n\n"
        f"To unsubscribe: [{unsubscribe_url}]({unsubscribe_url})"
    )

    send_email(email, "Thanks for your interest in Lens Academy", body)


async def unsubscribe_prospect(email: str) -> bool:
    """Unsubscribe a prospect from course notifications. Returns True if found."""
    async with get_connection() as conn:
        from sqlalchemy import or_

        result = await conn.execute(
            update(prospects)
            .where(prospects.c.email == email.lower())
            .where(
                or_(
                    prospects.c.subscribe_courses_learners.is_(True),
                    prospects.c.subscribe_courses_navigators.is_(True),
                )
            )
            .values(
                subscribe_courses_learners=False,
                subscribe_courses_navigators=False,
            )
        )
        await conn.commit()
        return result.rowcount > 0


async def get_pending_substack_emails() -> list[str]:
    """Get emails that opted into Substack but haven't been synced yet."""
    async with get_connection() as conn:
        result = await conn.execute(
            select(prospects.c.email).where(
                prospects.c.subscribe_substack.is_(True),
                prospects.c.substack_synced_at.is_(None),
            )
        )
        return [row.email for row in result.fetchall()]


async def mark_substack_synced(email: str) -> None:
    """Mark an email as synced to Substack."""
    async with get_connection() as conn:
        await conn.execute(
            update(prospects)
            .where(prospects.c.email == email.lower())
            .values(substack_synced_at=func.now())
        )
        await conn.commit()


async def has_available_cohorts() -> bool:
    """Check if any cohorts are available for enrollment (public, no auth)."""
    from datetime import date, timedelta

    from .tables import cohorts

    today = date.today()
    cutoff = today - timedelta(days=7)

    async with get_connection() as conn:
        result = await conn.execute(
            select(cohorts.c.cohort_id)
            .where(cohorts.c.status == "active")
            .where(cohorts.c.cohort_start_date >= cutoff)
            .where(cohorts.c.accepts_availability_signups.is_(True))
            .limit(1)
        )
        return result.first() is not None


async def get_course_availability() -> list[dict]:
    """Get available cohorts for enrollment (public, no auth).

    Returns individual cohorts with course info so the enrollment page
    can show each start-date option.
    """
    from datetime import date, timedelta

    from .tables import cohorts

    today = date.today()
    cutoff = today - timedelta(days=7)

    async with get_connection() as conn:
        result = await conn.execute(
            select(
                cohorts.c.cohort_id,
                cohorts.c.cohort_name,
                cohorts.c.course_slug,
                cohorts.c.cohort_start_date,
                cohorts.c.duration_days,
            )
            .where(cohorts.c.status == "active")
            .where(cohorts.c.cohort_start_date >= cutoff)
            .order_by(cohorts.c.cohort_start_date)
        )

    from .content import get_cache

    cache = get_cache()
    cohort_list = []
    for row in result.mappings():
        cohort = dict(row)
        try:
            course = cache.courses[cohort["course_slug"]]
            cohort["course_name"] = course.title
        except (KeyError, AttributeError):
            cohort["course_name"] = cohort["course_slug"]
        cohort["cohort_start_date"] = cohort["cohort_start_date"].isoformat()
        cohort_list.append(cohort)
    return cohort_list
