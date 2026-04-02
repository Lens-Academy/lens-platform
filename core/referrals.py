"""Referral link business logic — slug generation, link CRUD, click tracking, attribution."""

import re
import unicodedata

from sqlalchemy import and_, func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from .tables import referral_clicks, referral_links, users

# ── Constants ─────────────────────────────────────────────────

SLUG_PATTERN = re.compile(r"^[a-z][a-z0-9-]{2,49}$")
MAX_CAMPAIGN_LINKS_PER_USER = 50


# ── Slug utilities ────────────────────────────────────────────


def slugify_name(name: str) -> str:
    """Convert a display name to a URL-safe slug.

    - NFKD normalize and strip accents
    - Lowercase, replace non-alphanumeric with hyphens
    - Collapse consecutive hyphens, strip leading/trailing hyphens
    - Pad short slugs (< 3 chars) with 'ref', truncate to 50
    """
    # Normalize unicode and strip combining marks (accents)
    nfkd = unicodedata.normalize("NFKD", name)
    ascii_only = "".join(c for c in nfkd if not unicodedata.combining(c))

    # Lowercase, replace non-alphanumeric with hyphens
    slug = re.sub(r"[^a-z0-9]", "-", ascii_only.lower())

    # Collapse consecutive hyphens
    slug = re.sub(r"-{2,}", "-", slug)

    # Strip leading/trailing hyphens
    slug = slug.strip("-")

    # Pad short slugs
    if len(slug) < 3:
        slug = f"ref-{slug}" if slug else "ref"

    # Truncate to 50 chars (avoid cutting mid-hyphen)
    if len(slug) > 50:
        slug = slug[:50].rstrip("-")

    return slug


def validate_slug(slug: str) -> bool:
    """Check whether a slug matches the allowed pattern."""
    return bool(SLUG_PATTERN.match(slug))


# ── Internal helpers ──────────────────────────────────────────


async def _ensure_unique_slug(conn: AsyncConnection, slug: str) -> str:
    """Return *slug* if available, otherwise append -1, -2, ... until unique."""
    candidate = slug
    counter = 0
    while True:
        row = await conn.execute(
            select(referral_links.c.link_id).where(referral_links.c.slug == candidate)
        )
        if row.first() is None:
            return candidate
        counter += 1
        candidate = f"{slug}-{counter}"


async def _get_default_link(conn: AsyncConnection, user_id: int) -> dict | None:
    """Return the user's default referral link, or None."""
    row = await conn.execute(
        select(referral_links).where(
            and_(
                referral_links.c.user_id == user_id,
                referral_links.c.is_default.is_(True),
                referral_links.c.deleted_at.is_(None),
            )
        )
    )
    result = row.first()
    return dict(result._mapping) if result else None


def _row_to_dict(row) -> dict:
    return dict(row._mapping)


# ── CRUD functions ────────────────────────────────────────────


async def create_default_link(
    conn: AsyncConnection, user_id: int, display_name: str
) -> dict:
    """Create the user's default referral link."""
    slug = slugify_name(display_name)
    slug = await _ensure_unique_slug(conn, slug)

    result = await conn.execute(
        insert(referral_links)
        .values(
            user_id=user_id,
            name=display_name,
            slug=slug,
            is_default=True,
        )
        .returning(referral_links)
    )
    return _row_to_dict(result.first())


async def create_campaign_link(
    conn: AsyncConnection,
    user_id: int,
    name: str,
    slug: str | None = None,
) -> dict:
    """Create a campaign (non-default) referral link.

    Enforces a per-user cap of MAX_CAMPAIGN_LINKS_PER_USER campaign links.
    If *slug* is not provided, auto-generates from the default link's slug + name.
    """
    # Check cap (count non-default, non-deleted links)
    count_row = await conn.execute(
        select(func.count()).where(
            and_(
                referral_links.c.user_id == user_id,
                referral_links.c.is_default.is_(False),
                referral_links.c.deleted_at.is_(None),
            )
        )
    )
    count = count_row.scalar()
    if count >= MAX_CAMPAIGN_LINKS_PER_USER:
        raise ValueError(f"Campaign link limit reached ({MAX_CAMPAIGN_LINKS_PER_USER})")

    if slug is None:
        default = await _get_default_link(conn, user_id)
        prefix = default["slug"] if default else "ref"
        slug = f"{prefix}-{slugify_name(name)}"

    slug = await _ensure_unique_slug(conn, slug)

    result = await conn.execute(
        insert(referral_links)
        .values(
            user_id=user_id,
            name=name,
            slug=slug,
            is_default=False,
        )
        .returning(referral_links)
    )
    return _row_to_dict(result.first())


async def get_user_links(conn: AsyncConnection, user_id: int) -> list[dict]:
    """Get all non-deleted links for a user, default first."""
    rows = await conn.execute(
        select(referral_links)
        .where(
            and_(
                referral_links.c.user_id == user_id,
                referral_links.c.deleted_at.is_(None),
            )
        )
        .order_by(referral_links.c.is_default.desc(), referral_links.c.created_at)
    )
    return [_row_to_dict(r) for r in rows.fetchall()]


async def soft_delete_link(conn: AsyncConnection, link_id: int, user_id: int) -> None:
    """Soft-delete a referral link. Refuses to delete the default link."""
    row = await conn.execute(
        select(referral_links).where(
            and_(
                referral_links.c.link_id == link_id,
                referral_links.c.user_id == user_id,
            )
        )
    )
    link = row.first()
    if link is None:
        raise ValueError("Link not found")
    if link._mapping["is_default"]:
        raise ValueError("Cannot delete default referral link")

    await conn.execute(
        update(referral_links)
        .where(referral_links.c.link_id == link_id)
        .values(deleted_at=func.now())
    )


async def update_link(
    conn: AsyncConnection,
    link_id: int,
    user_id: int,
    name: str | None = None,
    slug: str | None = None,
) -> dict:
    """Update a referral link's name and/or slug."""
    values: dict = {}

    if name is not None:
        values["name"] = name

    if slug is not None:
        # Check slug uniqueness (excluding this link)
        existing = await conn.execute(
            select(referral_links.c.link_id).where(
                and_(
                    referral_links.c.slug == slug,
                    referral_links.c.link_id != link_id,
                )
            )
        )
        if existing.first() is not None:
            raise ValueError(f"slug '{slug}' is already taken")
        values["slug"] = slug

    if values:
        await conn.execute(
            update(referral_links)
            .where(
                and_(
                    referral_links.c.link_id == link_id,
                    referral_links.c.user_id == user_id,
                )
            )
            .values(**values)
        )

    # Return updated row
    row = await conn.execute(
        select(referral_links).where(referral_links.c.link_id == link_id)
    )
    return _row_to_dict(row.first())


# ── Click tracking & attribution ─────────────────────────────


async def log_click(
    conn: AsyncConnection, link_id: int, *, consent_state: str = "pending"
) -> int:
    """Record a click on a referral link.

    consent_state: 'accepted' (cookies on, dedup active), 'declined' (user
    rejected cookies), or 'pending' (new visitor, no choice yet).

    Returns the click_id of the new row.
    """
    result = await conn.execute(
        insert(referral_clicks)
        .values(link_id=link_id, consent_state=consent_state)
        .returning(referral_clicks.c.click_id)
    )
    return result.scalar()


async def update_click_consent(
    conn: AsyncConnection, click_id: int, consent_state: str
) -> bool:
    """Update consent_state on a click, but only if it's still 'pending'.

    When the frontend reports 'accepted', we store 'pending_then_accepted'
    to distinguish "had cookies at click time" (accepted) from "accepted
    during this session" (pending_then_accepted). The latter may include
    privacy-browser users whose cookies don't persist.

    'declined' is stored as-is (no need to distinguish pending_then_declined).

    Returns True if the row was updated, False if it was already resolved
    or the click_id doesn't exist.
    """
    stored_state = (
        "pending_then_accepted" if consent_state == "accepted" else consent_state
    )
    result = await conn.execute(
        update(referral_clicks)
        .where(
            and_(
                referral_clicks.c.click_id == click_id,
                referral_clicks.c.consent_state == "pending",
            )
        )
        .values(consent_state=stored_state)
    )
    return result.rowcount > 0


async def get_link_by_slug(conn: AsyncConnection, slug: str) -> dict | None:
    """Look up an active (non-deleted) referral link by slug."""
    row = await conn.execute(
        select(referral_links).where(
            and_(
                referral_links.c.slug == slug,
                referral_links.c.deleted_at.is_(None),
            )
        )
    )
    result = row.first()
    return _row_to_dict(result) if result else None


async def resolve_attribution(
    conn: AsyncConnection, user_id: int, ref_slug: str
) -> None:
    """Set referred_by_link_id on a user.

    Silently does nothing if the slug is invalid or the user already has
    attribution set.
    """
    link = await get_link_by_slug(conn, ref_slug)
    if link is None:
        return

    # Don't self-attribute
    if link["user_id"] == user_id:
        return

    # Only set if not already attributed
    row = await conn.execute(
        select(users.c.referred_by_link_id).where(users.c.user_id == user_id)
    )
    current = row.scalar()
    if current is not None:
        return

    await conn.execute(
        update(users)
        .where(users.c.user_id == user_id)
        .values(referred_by_link_id=link["link_id"])
    )


# ── Funnel stats ─────────────────────────────────────────────


async def get_link_stats(conn: AsyncConnection, link_id: int) -> dict:
    """Return click, signup, enrolled, and completed counts for a single link."""
    from .tables import groups_users, signups

    clicks = await conn.scalar(
        select(func.count())
        .select_from(referral_clicks)
        .where(referral_clicks.c.link_id == link_id)
    )
    signup_count = await conn.scalar(
        select(func.count())
        .select_from(users)
        .where(users.c.referred_by_link_id == link_id)
    )
    enrolled_count = await conn.scalar(
        select(func.count(func.distinct(signups.c.user_id)))
        .select_from(signups.join(users, signups.c.user_id == users.c.user_id))
        .where(users.c.referred_by_link_id == link_id)
    )
    completed_count = await conn.scalar(
        select(func.count(func.distinct(groups_users.c.user_id)))
        .select_from(
            groups_users.join(users, groups_users.c.user_id == users.c.user_id)
        )
        .where(
            and_(
                users.c.referred_by_link_id == link_id,
                groups_users.c.status == "completed",
            )
        )
    )
    return {
        "clicks": clicks or 0,
        "signups": signup_count or 0,
        "enrolled": enrolled_count or 0,
        "completed": completed_count or 0,
    }


async def get_all_referrer_stats(conn: AsyncConnection) -> list[dict]:
    """Aggregated stats per referrer for admin view.

    Returns list of dicts with user_id, nickname, discord_username, links,
    clicks, signups, enrolled, completed. Sorted by clicks descending.
    """
    from .tables import groups_users, signups

    # Get all users who have at least one referral link
    link_owners = (
        select(
            referral_links.c.user_id,
            func.count(func.distinct(referral_links.c.link_id)).label("links"),
        )
        .where(referral_links.c.deleted_at.is_(None))
        .group_by(referral_links.c.user_id)
        .subquery("link_owners")
    )

    # Click counts per user (via their links)
    click_counts = (
        select(
            referral_links.c.user_id,
            func.count(referral_clicks.c.click_id).label("clicks"),
        )
        .select_from(
            referral_links.outerjoin(
                referral_clicks,
                referral_links.c.link_id == referral_clicks.c.link_id,
            )
        )
        .where(referral_links.c.deleted_at.is_(None))
        .group_by(referral_links.c.user_id)
        .subquery("click_counts")
    )

    # Signup counts per referrer
    signup_counts = (
        select(
            referral_links.c.user_id,
            func.count(users.c.user_id).label("signups"),
        )
        .select_from(
            referral_links.join(
                users,
                referral_links.c.link_id == users.c.referred_by_link_id,
            )
        )
        .where(referral_links.c.deleted_at.is_(None))
        .group_by(referral_links.c.user_id)
        .subquery("signup_counts")
    )

    # Enrolled counts per referrer (referred users who have signups)
    referred_users = users.alias("referred")
    enrolled_counts = (
        select(
            referral_links.c.user_id,
            func.count(func.distinct(signups.c.user_id)).label("enrolled"),
        )
        .select_from(
            referral_links.join(
                referred_users,
                referral_links.c.link_id == referred_users.c.referred_by_link_id,
            ).join(signups, signups.c.user_id == referred_users.c.user_id)
        )
        .where(referral_links.c.deleted_at.is_(None))
        .group_by(referral_links.c.user_id)
        .subquery("enrolled_counts")
    )

    # Completed counts per referrer
    referred_users2 = users.alias("referred2")
    completed_counts = (
        select(
            referral_links.c.user_id,
            func.count(func.distinct(groups_users.c.user_id)).label("completed"),
        )
        .select_from(
            referral_links.join(
                referred_users2,
                referral_links.c.link_id == referred_users2.c.referred_by_link_id,
            ).join(
                groups_users,
                groups_users.c.user_id == referred_users2.c.user_id,
            )
        )
        .where(
            and_(
                referral_links.c.deleted_at.is_(None),
                groups_users.c.status == "completed",
            )
        )
        .group_by(referral_links.c.user_id)
        .subquery("completed_counts")
    )

    # Main query: join everything together
    query = (
        select(
            users.c.user_id,
            users.c.nickname,
            users.c.discord_username,
            link_owners.c.links,
            func.coalesce(click_counts.c.clicks, 0).label("clicks"),
            func.coalesce(signup_counts.c.signups, 0).label("signups"),
            func.coalesce(enrolled_counts.c.enrolled, 0).label("enrolled"),
            func.coalesce(completed_counts.c.completed, 0).label("completed"),
        )
        .select_from(
            users.join(link_owners, users.c.user_id == link_owners.c.user_id)
            .outerjoin(click_counts, users.c.user_id == click_counts.c.user_id)
            .outerjoin(signup_counts, users.c.user_id == signup_counts.c.user_id)
            .outerjoin(
                enrolled_counts,
                users.c.user_id == enrolled_counts.c.user_id,
            )
            .outerjoin(
                completed_counts,
                users.c.user_id == completed_counts.c.user_id,
            )
        )
        .order_by(func.coalesce(click_counts.c.clicks, 0).desc())
    )

    rows = await conn.execute(query)
    return [dict(r._mapping) for r in rows.fetchall()]
