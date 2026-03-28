"""Referral link business logic — slug generation and link CRUD."""

import re
import unicodedata

from sqlalchemy import and_, func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from .tables import referral_links

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
            select(referral_links.c.link_id).where(
                referral_links.c.slug == candidate
            )
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
        raise ValueError(
            f"Campaign link limit reached ({MAX_CAMPAIGN_LINKS_PER_USER})"
        )

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


async def soft_delete_link(
    conn: AsyncConnection, link_id: int, user_id: int
) -> None:
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
