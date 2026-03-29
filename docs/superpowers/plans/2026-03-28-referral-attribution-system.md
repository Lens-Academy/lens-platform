# Referral & Attribution System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a referral tracking system where users get personalized links, can create campaign links, and see full-funnel stats (click → signup → enroll → complete).

**Architecture:** Two new DB tables (`referral_links`, `referral_clicks`) + one new column on `users`. Server-side `/ref/<slug>` route handles click tracking and redirects. Hybrid attribution via OAuth state parameter (primary, cookie-free) + first-party marketing cookie (for consenting users with long attribution windows). Frontend `/referrals` page for link management + admin view for global stats.

**Tech Stack:** SQLAlchemy Core (tables), Alembic (migrations), FastAPI (routes), React + Tailwind (frontend), pytest (tests)

**Spec:** `docs/superpowers/specs/2026-03-28-referral-attribution-system-design.md`

---

## File Structure

**New files:**
- `core/referrals.py` — business logic: slug generation, link CRUD, click logging, attribution, funnel stats
- `core/tests/test_referrals.py` — unit tests for core referral logic
- `web_api/routes/referrals.py` — API endpoints (user-facing, admin, public click handler)
- `web_api/tests/test_referrals.py` — API route tests
- `web_frontend/src/pages/referrals/+Page.tsx` — referrals page route
- `web_frontend/src/components/referrals/ReferralsPage.tsx` — referrals page component
- `web_frontend/src/api/referrals.ts` — API client for referral endpoints
- `alembic/versions/<auto>_add_referral_tables.py` — migration

**Modified files:**
- `core/tables.py` — add `referral_links` and `referral_clicks` tables, add `referred_by_link_id` to `users`
- `core/auth.py:7-43` — return `is_new` flag from `get_or_create_user()`
- `core/queries/users.py:75-124` — create default referral link inside user creation transaction
- `web_api/routes/auth.py:141-147` — add `ref` query param to OAuth start
- `web_api/routes/auth.py:178-183` — store `ref` in OAuth state
- `web_api/routes/auth.py:272-303` — resolve attribution on signup
- `web_api/routes/modules.py:118` — unpack tuple from `get_or_create_user()`
- `web_api/routes/courses.py:117` — unpack tuple from `get_or_create_user()`
- `web_api/routes/progress.py:40,109` — unpack tuple from `get_or_create_user()`
- `web_frontend/src/hooks/useAuth.ts:169-178` — pass ref param through to OAuth
- `web_frontend/src/components/enroll/EnrollWizard.tsx` — read `ref` from URL, pass to login()
- `web_frontend/src/components/CookieBanner.tsx` — add marketing cookie toggle
- `web_frontend/src/analytics.ts` — add marketing consent key and helpers
- `web_frontend/src/components/LandingNav.tsx:8-11` — add /referrals link
- `main.py:394+` — register referrals router

---

## Task 1: Database Schema — Tables & Migration

**Files:**
- Modify: `core/tables.py`
- Create: `alembic/versions/<auto>_add_referral_tables.py`

- [ ] **Step 1: Add `referral_links` table to `core/tables.py`**

Add after the `prospects` table definition (around line 555), before the `metadata` export:

```python
# =====================================================
# Referral tracking
# =====================================================

referral_links = Table(
    "referral_links",
    metadata,
    Column("link_id", Integer, primary_key=True, autoincrement=True),
    Column(
        "user_id",
        Integer,
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("name", Text, nullable=False),
    Column("slug", Text, nullable=False, unique=True),  # unique=True creates the index
    Column("is_default", Boolean, nullable=False, server_default="false"),
    Column("created_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Column("deleted_at", TIMESTAMP(timezone=True)),
    Index("idx_referral_links_user_id", "user_id"),
)

referral_clicks = Table(
    "referral_clicks",
    metadata,
    Column("click_id", Integer, primary_key=True, autoincrement=True),
    Column(
        "link_id",
        Integer,
        ForeignKey("referral_links.link_id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("clicked_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Index("idx_referral_clicks_link_id", "link_id"),
)
```

- [ ] **Step 2: Add `referred_by_link_id` column and marketing consent columns to `users` table**

Add to the `users` table definition (after `cookies_analytics_consent_at`):

```python
    Column("cookies_marketing_consent", Text),  # 'accepted' | 'declined' | NULL
    Column("cookies_marketing_consent_at", TIMESTAMP(timezone=True)),
    Column(
        "referred_by_link_id",
        Integer,
        ForeignKey("referral_links.link_id", ondelete="SET NULL"),
    ),
```

- [ ] **Step 3: Add partial unique index for is_default**

Add inside the `referral_links` Table definition, or as a standalone after:

```python
# Enforce one default link per user at DB level
Index(
    "idx_referral_links_one_default_per_user",
    referral_links.c.user_id,
    unique=True,
    postgresql_where=referral_links.c.is_default.is_(True),
)
```

Note: SQLAlchemy Core partial indexes with `postgresql_where` need to be created outside the `Table()` call. Place it right after the `referral_links` table definition.

- [ ] **Step 4: Auto-generate the Alembic migration**

Run:
```bash
.venv/bin/alembic revision --autogenerate -m "add referral tables and marketing consent"
```

- [ ] **Step 5: Review the generated migration**

Open the generated file in `alembic/versions/`. Verify it includes:
- `create_table("referral_links", ...)`
- `create_table("referral_clicks", ...)`
- `add_column("users", Column("cookies_marketing_consent", ...))`
- `add_column("users", Column("cookies_marketing_consent_at", ...))`
- `add_column("users", Column("referred_by_link_id", ...))`
- The partial unique index
- Correct `downgrade()` (drop in reverse order)

Fix any issues in the generated migration manually.

- [ ] **Step 6: Run the migration**

```bash
.venv/bin/alembic upgrade head
```

- [ ] **Step 7: Commit**

```
feat: add referral_links, referral_clicks tables and marketing consent columns
```

---

## Task 2: Core Business Logic — Slug Generation & Link CRUD

**Files:**
- Create: `core/referrals.py`
- Create: `core/tests/test_referrals.py`

- [ ] **Step 1: Write failing tests for slug generation**

```python
# core/tests/test_referrals.py
import pytest
from core.referrals import slugify_name, generate_slug


def test_slugify_simple_name():
    assert slugify_name("Kate") == "kate"


def test_slugify_name_with_spaces():
    assert slugify_name("Alex Rivera") == "alex-rivera"


def test_slugify_strips_special_chars():
    assert slugify_name("José María") == "jos-mara"


def test_slugify_collapses_hyphens():
    assert slugify_name("test--name") == "test-name"


def test_slugify_strips_leading_trailing_hyphens():
    assert slugify_name("-test-") == "test"


def test_slugify_short_name_padded():
    # Minimum 3 chars per slug validation
    assert len(slugify_name("Al")) >= 3


def test_slugify_long_name_truncated():
    long_name = "a" * 100
    result = slugify_name(long_name)
    assert len(result) <= 50
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
.venv/bin/pytest core/tests/test_referrals.py -v
```
Expected: ImportError — `core.referrals` doesn't exist yet.

- [ ] **Step 3: Implement slug generation**

```python
# core/referrals.py
"""Referral link management and attribution tracking."""

import re
import unicodedata

from sqlalchemy import select, func, insert, update, and_
from sqlalchemy.ext.asyncio import AsyncConnection

from .tables import referral_links, referral_clicks, users

# Slug validation: lowercase alphanumeric + hyphens, 3-50 chars, starts with letter
SLUG_PATTERN = re.compile(r"^[a-z][a-z0-9-]{2,49}$")
MAX_CAMPAIGN_LINKS_PER_USER = 50


def slugify_name(name: str) -> str:
    """Convert a display name to a URL-safe slug."""
    # Normalize unicode, strip accents
    normalized = unicodedata.normalize("NFKD", name)
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    # Lowercase, replace non-alphanumeric with hyphens
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_only.lower()).strip("-")
    # Collapse multiple hyphens
    slug = re.sub(r"-{2,}", "-", slug)
    # Enforce length bounds
    slug = slug[:50]
    # Ensure minimum length
    if len(slug) < 3:
        slug = slug + "ref" if slug else "ref"
        slug = slug[:50]
    return slug


def validate_slug(slug: str) -> bool:
    """Check if a slug matches the required pattern."""
    return bool(SLUG_PATTERN.match(slug))
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
.venv/bin/pytest core/tests/test_referrals.py -v
```
Expected: All PASS.

- [ ] **Step 5: Write failing tests for link CRUD**

```python
# core/tests/test_referrals.py (append)
import pytest_asyncio
from core.referrals import (
    create_default_link,
    create_campaign_link,
    get_user_links,
    soft_delete_link,
)


@pytest_asyncio.fixture
async def test_user(db_conn):
    """Insert a test user and return their user_id."""
    from core.tables import users

    result = await db_conn.execute(
        insert(users).values(
            discord_id="test-discord-123",
            discord_username="testuser",
        ).returning(users.c.user_id)
    )
    row = result.first()
    return row[0]


@pytest.mark.asyncio
async def test_create_default_link(db_conn, test_user):
    link = await create_default_link(db_conn, test_user, "Test User")
    assert link["is_default"] is True
    assert link["slug"] == "test-user"
    assert link["name"] == "Default"
    assert link["user_id"] == test_user


@pytest.mark.asyncio
async def test_create_default_link_slug_collision(db_conn, test_user):
    """When slug already taken, appends a numeric suffix."""
    # Create a link that will collide
    await db_conn.execute(
        insert(referral_links).values(
            user_id=test_user, name="Existing", slug="test-user", is_default=False,
        )
    )
    link = await create_default_link(db_conn, test_user, "Test User")
    assert link["slug"].startswith("test-user-")
    assert link["is_default"] is True


@pytest.mark.asyncio
async def test_create_campaign_link(db_conn, test_user):
    await create_default_link(db_conn, test_user, "Test User")
    link = await create_campaign_link(db_conn, test_user, "Twitter Bio")
    assert link["is_default"] is False
    assert link["name"] == "Twitter Bio"
    assert "twitter-bio" in link["slug"]


@pytest.mark.asyncio
async def test_campaign_link_cap(db_conn, test_user):
    """Cannot create more than MAX_CAMPAIGN_LINKS_PER_USER links."""
    await create_default_link(db_conn, test_user, "Test User")
    for i in range(MAX_CAMPAIGN_LINKS_PER_USER):
        await create_campaign_link(db_conn, test_user, f"Link {i}", slug=f"test-link-{i:03d}")
    with pytest.raises(ValueError, match="maximum"):
        await create_campaign_link(db_conn, test_user, "One Too Many")


@pytest.mark.asyncio
async def test_get_user_links(db_conn, test_user):
    await create_default_link(db_conn, test_user, "Test User")
    await create_campaign_link(db_conn, test_user, "Twitter Bio")
    links = await get_user_links(db_conn, test_user)
    assert len(links) == 2
    assert links[0]["is_default"] is True  # default first


@pytest.mark.asyncio
async def test_soft_delete_link(db_conn, test_user):
    await create_default_link(db_conn, test_user, "Test User")
    link = await create_campaign_link(db_conn, test_user, "Temp Link")
    await soft_delete_link(db_conn, link["link_id"], test_user)
    links = await get_user_links(db_conn, test_user)
    assert len(links) == 1  # only default remains


@pytest.mark.asyncio
async def test_cannot_delete_default_link(db_conn, test_user):
    default = await create_default_link(db_conn, test_user, "Test User")
    with pytest.raises(ValueError, match="default"):
        await soft_delete_link(db_conn, default["link_id"], test_user)


@pytest.mark.asyncio
async def test_update_link_name(db_conn, test_user):
    from core.referrals import update_link
    await create_default_link(db_conn, test_user, "Test User")
    link = await create_campaign_link(db_conn, test_user, "Old Name")
    updated = await update_link(db_conn, link["link_id"], test_user, name="New Name")
    assert updated["name"] == "New Name"
    assert updated["slug"] == link["slug"]  # slug unchanged


@pytest.mark.asyncio
async def test_update_link_slug(db_conn, test_user):
    from core.referrals import update_link
    await create_default_link(db_conn, test_user, "Test User")
    link = await create_campaign_link(db_conn, test_user, "My Link")
    updated = await update_link(db_conn, link["link_id"], test_user, slug="new-custom-slug")
    assert updated["slug"] == "new-custom-slug"


@pytest.mark.asyncio
async def test_update_link_slug_uniqueness(db_conn, test_user):
    from core.referrals import update_link
    await create_default_link(db_conn, test_user, "Test User")
    link1 = await create_campaign_link(db_conn, test_user, "Link 1", slug="link-one-slug")
    link2 = await create_campaign_link(db_conn, test_user, "Link 2", slug="link-two-slug")
    with pytest.raises(ValueError, match="taken"):
        await update_link(db_conn, link2["link_id"], test_user, slug="link-one-slug")
```

- [ ] **Step 6: Run tests to verify they fail**

```bash
.venv/bin/pytest core/tests/test_referrals.py -v -k "not slugify"
```
Expected: ImportError for the new functions.

- [ ] **Step 7: Implement link CRUD functions**

Add to `core/referrals.py`:

```python
async def create_default_link(
    conn: AsyncConnection,
    user_id: int,
    display_name: str,
) -> dict:
    """Create the default referral link for a user. Called at account creation."""
    slug = slugify_name(display_name)
    slug = await _ensure_unique_slug(conn, slug)
    result = await conn.execute(
        insert(referral_links)
        .values(user_id=user_id, name="Default", slug=slug, is_default=True)
        .returning(referral_links)
    )
    return dict(result.mappings().first())


async def create_campaign_link(
    conn: AsyncConnection,
    user_id: int,
    name: str,
    slug: str | None = None,
) -> dict:
    """Create a named campaign link for a user."""
    # Check cap
    count = await conn.scalar(
        select(func.count())
        .select_from(referral_links)
        .where(
            and_(
                referral_links.c.user_id == user_id,
                referral_links.c.deleted_at.is_(None),
            )
        )
    )
    if count >= MAX_CAMPAIGN_LINKS_PER_USER:
        raise ValueError(f"Maximum of {MAX_CAMPAIGN_LINKS_PER_USER} links reached")

    # Generate slug from name if not provided, prefixed with user's default slug
    if slug is None:
        default_link = await _get_default_link(conn, user_id)
        prefix = default_link["slug"] if default_link else "ref"
        slug = f"{prefix}-{slugify_name(name)}"

    if not validate_slug(slug):
        raise ValueError(f"Invalid slug: {slug}")

    slug = await _ensure_unique_slug(conn, slug)
    result = await conn.execute(
        insert(referral_links)
        .values(user_id=user_id, name=name, slug=slug, is_default=False)
        .returning(referral_links)
    )
    return dict(result.mappings().first())


async def get_user_links(
    conn: AsyncConnection,
    user_id: int,
) -> list[dict]:
    """Get all active (non-deleted) links for a user, default first."""
    result = await conn.execute(
        select(referral_links)
        .where(
            and_(
                referral_links.c.user_id == user_id,
                referral_links.c.deleted_at.is_(None),
            )
        )
        .order_by(referral_links.c.is_default.desc(), referral_links.c.created_at)
    )
    return [dict(row) for row in result.mappings()]


async def soft_delete_link(
    conn: AsyncConnection,
    link_id: int,
    user_id: int,
) -> None:
    """Soft-delete a campaign link. Cannot delete the default link."""
    # Fetch the link
    result = await conn.execute(
        select(referral_links).where(
            and_(
                referral_links.c.link_id == link_id,
                referral_links.c.user_id == user_id,
                referral_links.c.deleted_at.is_(None),
            )
        )
    )
    link = result.mappings().first()
    if link is None:
        raise ValueError("Link not found")
    if link["is_default"]:
        raise ValueError("Cannot delete the default referral link")
    await conn.execute(
        update(referral_links)
        .where(referral_links.c.link_id == link_id)
        .values(deleted_at=func.now())
    )


async def _get_default_link(conn: AsyncConnection, user_id: int) -> dict | None:
    """Get the default link for a user."""
    result = await conn.execute(
        select(referral_links).where(
            and_(
                referral_links.c.user_id == user_id,
                referral_links.c.is_default.is_(True),
            )
        )
    )
    row = result.mappings().first()
    return dict(row) if row else None


async def _ensure_unique_slug(conn: AsyncConnection, slug: str) -> str:
    """If slug is taken, append incrementing numeric suffix."""
    # Check if slug exists
    exists = await conn.scalar(
        select(func.count())
        .select_from(referral_links)
        .where(referral_links.c.slug == slug)
    )
    if not exists:
        return slug
    # Try suffixes
    for i in range(1, 1000):
        candidate = f"{slug}-{i}"
        if len(candidate) > 50:
            candidate = f"{slug[:50 - len(str(i)) - 1]}-{i}"
        exists = await conn.scalar(
            select(func.count())
            .select_from(referral_links)
            .where(referral_links.c.slug == candidate)
        )
        if not exists:
            return candidate
    raise ValueError("Could not generate unique slug")
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
.venv/bin/pytest core/tests/test_referrals.py -v
```
Expected: All PASS.

- [ ] **Step 9: Commit**

```
feat: add core referral logic — slug generation, link CRUD, soft delete
```

---

## Task 3: Core Business Logic — Click Tracking, Attribution & Funnel Stats

**Files:**
- Modify: `core/referrals.py`
- Modify: `core/tests/test_referrals.py`

- [ ] **Step 1: Write failing tests for click tracking and attribution**

```python
# core/tests/test_referrals.py (append)
from core.referrals import (
    log_click,
    resolve_attribution,
    get_link_by_slug,
    get_link_stats,
    get_all_referrer_stats,
)


@pytest.mark.asyncio
async def test_log_click(db_conn, test_user):
    link = await create_default_link(db_conn, test_user, "Test User")
    await log_click(db_conn, link["link_id"])
    await log_click(db_conn, link["link_id"])
    stats = await get_link_stats(db_conn, link["link_id"])
    assert stats["clicks"] == 2


@pytest.mark.asyncio
async def test_get_link_by_slug(db_conn, test_user):
    await create_default_link(db_conn, test_user, "Test User")
    link = await get_link_by_slug(db_conn, "test-user")
    assert link is not None
    assert link["user_id"] == test_user


@pytest.mark.asyncio
async def test_get_link_by_slug_deleted(db_conn, test_user):
    """Deleted links are not found by slug."""
    await create_default_link(db_conn, test_user, "Test User")
    campaign = await create_campaign_link(db_conn, test_user, "Temp")
    await soft_delete_link(db_conn, campaign["link_id"], test_user)
    result = await get_link_by_slug(db_conn, campaign["slug"])
    assert result is None


@pytest.mark.asyncio
async def test_resolve_attribution(db_conn, test_user):
    """Attribution sets referred_by_link_id on the referred user."""
    link = await create_default_link(db_conn, test_user, "Referrer")
    # Create a second user (the referred user)
    result = await db_conn.execute(
        insert(users).values(
            discord_id="referred-456", discord_username="referred",
        ).returning(users.c.user_id)
    )
    referred_id = result.first()[0]
    await resolve_attribution(db_conn, referred_id, link["slug"])
    # Check the user record
    row = await db_conn.execute(
        select(users.c.referred_by_link_id).where(users.c.user_id == referred_id)
    )
    assert row.scalar() == link["link_id"]


@pytest.mark.asyncio
async def test_resolve_attribution_invalid_slug(db_conn, test_user):
    """Invalid slug is silently ignored (no error, no attribution)."""
    result = await db_conn.execute(
        insert(users).values(
            discord_id="referred-789", discord_username="referred2",
        ).returning(users.c.user_id)
    )
    referred_id = result.first()[0]
    await resolve_attribution(db_conn, referred_id, "nonexistent-slug")
    row = await db_conn.execute(
        select(users.c.referred_by_link_id).where(users.c.user_id == referred_id)
    )
    assert row.scalar() is None


@pytest.mark.asyncio
async def test_get_link_stats_full_funnel(db_conn, test_user):
    """Stats include clicks, signups from referred users."""
    link = await create_default_link(db_conn, test_user, "Referrer")
    # Log some clicks
    await log_click(db_conn, link["link_id"])
    await log_click(db_conn, link["link_id"])
    await log_click(db_conn, link["link_id"])
    # Create a referred user
    result = await db_conn.execute(
        insert(users).values(
            discord_id="ref-user-1", discord_username="refuser1",
            referred_by_link_id=link["link_id"],
        ).returning(users.c.user_id)
    )
    stats = await get_link_stats(db_conn, link["link_id"])
    assert stats["clicks"] == 3
    assert stats["signups"] == 1
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
.venv/bin/pytest core/tests/test_referrals.py -v -k "click or attribution or stats or slug"
```
Expected: ImportError for the new functions.

- [ ] **Step 3: Implement click tracking, attribution, and stats**

Add to `core/referrals.py`:

```python
from datetime import datetime, timezone


async def log_click(conn: AsyncConnection, link_id: int) -> None:
    """Log a referral link click."""
    await conn.execute(
        insert(referral_clicks).values(link_id=link_id)
    )


async def get_link_by_slug(conn: AsyncConnection, slug: str) -> dict | None:
    """Look up an active (non-deleted) referral link by slug."""
    result = await conn.execute(
        select(referral_links).where(
            and_(
                referral_links.c.slug == slug,
                referral_links.c.deleted_at.is_(None),
            )
        )
    )
    row = result.mappings().first()
    return dict(row) if row else None


async def resolve_attribution(
    conn: AsyncConnection,
    user_id: int,
    ref_slug: str,
) -> None:
    """
    Set referred_by_link_id on a user record.

    Silently does nothing if the slug is invalid or the user already has attribution.
    """
    link = await get_link_by_slug(conn, ref_slug)
    if link is None:
        return
    # Don't overwrite existing attribution
    row = await conn.execute(
        select(users.c.referred_by_link_id).where(users.c.user_id == user_id)
    )
    if row.scalar() is not None:
        return
    await conn.execute(
        update(users)
        .where(users.c.user_id == user_id)
        .values(referred_by_link_id=link["link_id"])
    )


async def get_link_stats(conn: AsyncConnection, link_id: int) -> dict:
    """Get funnel stats for a single link."""
    from .tables import signups, groups_users

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
    """Get aggregated referral stats per user (for admin view)."""
    # Get all users who have at least one referral link
    result = await conn.execute(
        select(
            referral_links.c.user_id,
            func.count(referral_links.c.link_id).label("link_count"),
        )
        .where(referral_links.c.deleted_at.is_(None))
        .group_by(referral_links.c.user_id)
    )
    referrers = [dict(row) for row in result.mappings()]

    stats = []
    for referrer in referrers:
        user_id = referrer["user_id"]
        # Get all link IDs for this user
        link_ids_result = await conn.execute(
            select(referral_links.c.link_id).where(
                and_(
                    referral_links.c.user_id == user_id,
                    referral_links.c.deleted_at.is_(None),
                )
            )
        )
        link_ids = [row[0] for row in link_ids_result]

        total_clicks = await conn.scalar(
            select(func.count())
            .select_from(referral_clicks)
            .where(referral_clicks.c.link_id.in_(link_ids))
        ) if link_ids else 0

        total_signups = await conn.scalar(
            select(func.count())
            .select_from(users)
            .where(users.c.referred_by_link_id.in_(link_ids))
        ) if link_ids else 0

        from .tables import signups as signups_table, groups_users

        total_enrolled = await conn.scalar(
            select(func.count(func.distinct(signups_table.c.user_id)))
            .select_from(
                signups_table.join(users, signups_table.c.user_id == users.c.user_id)
            )
            .where(users.c.referred_by_link_id.in_(link_ids))
        ) if link_ids else 0

        total_completed = await conn.scalar(
            select(func.count(func.distinct(groups_users.c.user_id)))
            .select_from(
                groups_users.join(users, groups_users.c.user_id == users.c.user_id)
            )
            .where(
                and_(
                    users.c.referred_by_link_id.in_(link_ids),
                    groups_users.c.status == "completed",
                )
            )
        ) if link_ids else 0

        # Get user info
        user_row = await conn.execute(
            select(users.c.user_id, users.c.nickname, users.c.discord_username)
            .where(users.c.user_id == user_id)
        )
        user_info = user_row.mappings().first()

        stats.append({
            "user_id": user_id,
            "nickname": user_info["nickname"] if user_info else None,
            "discord_username": user_info["discord_username"] if user_info else None,
            "links": referrer["link_count"],
            "clicks": total_clicks or 0,
            "signups": total_signups or 0,
            "enrolled": total_enrolled or 0,
            "completed": total_completed or 0,
        })

    return sorted(stats, key=lambda s: s["clicks"], reverse=True)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
.venv/bin/pytest core/tests/test_referrals.py -v
```
Expected: All PASS.

- [ ] **Step 5: Commit**

```
feat: add click tracking, attribution resolution, and funnel stats queries
```

---

## Task 4: Modify Auth Flow — Default Link Creation & Attribution

**Files:**
- Modify: `core/auth.py`
- Modify: `core/queries/users.py`
- Modify: `web_api/routes/auth.py`
- Modify: `web_api/routes/modules.py`
- Modify: `web_api/routes/courses.py`
- Modify: `web_api/routes/progress.py`

- [ ] **Step 1: Modify `core/queries/users.py` to create default link in same transaction**

In `core/queries/users.py`, import `create_default_link` from `core.referrals` and call it inside the existing `get_or_create_user` function when a new user is created (after line 123):

```python
from core.referrals import create_default_link

# Inside get_or_create_user, after the `if nickname:` block for new users:
    new_user = await create_user(
        conn, discord_id, discord_username, discord_avatar, email, email_verified
    )
    if nickname:
        new_user = await update_user(conn, discord_id, nickname=nickname)
    # Create default referral link in the same transaction
    display_name = nickname or discord_username or discord_id
    await create_default_link(conn, new_user["user_id"], display_name)
    return new_user, True
```

This ensures the default link is created in the **same transaction** as user creation (spec requirement).

- [ ] **Step 2: Modify `core/auth.py` to return `is_new` flag**

The function already has `_is_new` but discards it. Simply change line 33 and the return:

```python
async def get_or_create_user(
    discord_id: str,
    discord_username: str | None = None,
    discord_avatar: str | None = None,
    email: str | None = None,
    email_verified: bool = False,
    nickname: str | None = None,
) -> tuple[dict, bool]:
    """
    Get or create a user by Discord ID.

    Returns:
        Tuple of (user_dict, is_new_user)
    """
    async with get_transaction() as conn:
        user, is_new = await _get_or_create_user(
            conn,
            discord_id,
            discord_username,
            discord_avatar,
            email,
            email_verified,
            nickname,
        )

    return user, is_new
```

- [ ] **Step 3: Update ALL callers of `get_or_create_user` to unpack the tuple**

There are 4 callers beyond `auth.py` that will break:

**`web_api/routes/auth.py:272`:**
```python
user, is_new = await get_or_create_user(
    discord_id, discord_username, discord_avatar, email, email_verified, nickname
)
```

**`web_api/routes/modules.py:118`:**
```python
user, _ = await get_or_create_user(discord_id)
```

**`web_api/routes/courses.py:117`:**
```python
user, _ = await get_or_create_user(discord_id)
```

**`web_api/routes/progress.py:40` and `progress.py:109`:**
```python
user, _ = await get_or_create_user(discord_id)
```

- [ ] **Step 4: Add `ref` parameter to OAuth start endpoint**

In `web_api/routes/auth.py`, modify `discord_oauth_start` (line 142):

```python
@router.get("/discord")
async def discord_oauth_start(
    request: Request,
    next: str = "/",
    origin: str | None = None,
    anonymous_token: str | None = None,
    ref: str | None = None,  # NEW: referral slug
):
```

And add `ref` to the state dict (line 178):

```python
_oauth_states[state] = {
    "next": _validate_next_path(next),
    "origin": validated_origin,
    "anonymous_token": anonymous_token,
    "ref": ref,  # NEW
    "created_at": time.time(),
}
```

- [ ] **Step 5: Add attribution resolution to OAuth callback**

In `web_api/routes/auth.py`, after `user, is_new = await get_or_create_user(...)` (line 272), add attribution resolution. Note: default link creation is already handled inside `get_or_create_user` (Step 1).

```python
    # Resolve referral attribution
    ref_slug = state_data.get("ref")
    if not ref_slug:
        # Fall back to cookie
        ref_slug = request.cookies.get("ref")
    if ref_slug:
        async with get_transaction() as conn:
            await resolve_attribution(conn, user["user_id"], ref_slug)
```

After `response` is created (line 299), clear the cookie:

```python
    # Clear the ref cookie if present
    if ref_slug and request.cookies.get("ref"):
        response.delete_cookie("ref", path="/")
```

Add the import at the top of `web_api/routes/auth.py`:

```python
from core.referrals import resolve_attribution
```

- [ ] **Step 6: Run existing auth tests to verify nothing is broken**

```bash
.venv/bin/pytest web_api/tests/test_auth_me.py -v
.venv/bin/pytest core/tests/ -v
```
Expected: All existing tests PASS.

- [ ] **Step 7: Commit**

```
feat: integrate referral attribution into Discord OAuth flow
```

---

## Task 5: Public Click Handler Route — `/ref/<slug>`

**Files:**
- Create: `web_api/routes/ref.py`
- Modify: `main.py`

- [ ] **Step 1: Create the `/ref/<slug>` server-side route**

```python
# web_api/routes/ref.py
"""Public referral link click handler."""

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
    and redirects to /enroll?ref=<slug>.

    Invalid slugs still redirect to /enroll (prevents slug enumeration).
    """
    async with get_transaction() as conn:
        link = await get_link_by_slug(conn, slug)
        if link:
            await log_click(conn, link["link_id"])

    response = RedirectResponse(url=f"/enroll?ref={slug}", status_code=302)

    # Set ref cookie if visitor has granted marketing consent
    if link and request.cookies.get(MARKETING_CONSENT_COOKIE) == "accepted":
        response.set_cookie(
            key="ref",
            value=slug,
            max_age=90 * 24 * 60 * 60,  # 90 days
            httponly=True,
            secure=True,
            samesite="lax",
            path="/",
        )

    return response
```

- [ ] **Step 2: Register the router in `main.py`**

Add import near the other route imports:

```python
from web_api.routes.ref import router as ref_router
```

Add registration near the other `app.include_router()` calls:

```python
app.include_router(ref_router)
```

- [ ] **Step 3: Verify the route works manually**

Start the dev server and test:
```bash
curl -v http://localhost:8200/ref/nonexistent-slug 2>&1 | grep -E "< HTTP|< location"
```
Expected: 302 redirect to `/enroll?ref=nonexistent-slug`.

- [ ] **Step 4: Commit**

```
feat: add /ref/<slug> public click handler route
```

---

## Task 6: User-Facing API Endpoints

**Files:**
- Create: `web_api/routes/referrals.py`
- Create: `web_api/tests/test_referrals.py`
- Modify: `main.py`

- [ ] **Step 1: Create the referrals API router**

```python
# web_api/routes/referrals.py
"""User-facing and admin referral API endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from web_api.auth import get_current_user, require_admin
from core.database import get_connection, get_transaction
from core.referrals import (
    create_campaign_link,
    get_user_links,
    get_link_stats,
    soft_delete_link,
    validate_slug,
    get_all_referrer_stats,
)

router = APIRouter(prefix="/api/referrals", tags=["referrals"])


class CreateLinkRequest(BaseModel):
    name: str
    slug: str | None = None


class UpdateLinkRequest(BaseModel):
    name: str | None = None
    slug: str | None = None


@router.get("/links")
async def list_my_links(user=Depends(get_current_user)):
    """List the current user's referral links with per-link funnel stats."""
    async with get_connection() as conn:
        links = await get_user_links(conn, user["user_id"])
        result = []
        for link in links:
            stats = await get_link_stats(conn, link["link_id"])
            result.append({**link, **stats})
    return {"links": result}


@router.post("/links")
async def create_link(body: CreateLinkRequest, user=Depends(get_current_user)):
    """Create a new campaign link."""
    if body.slug and not validate_slug(body.slug):
        raise HTTPException(400, "Invalid slug. Use 3-50 lowercase letters, numbers, and hyphens.")
    try:
        async with get_transaction() as conn:
            link = await create_campaign_link(
                conn, user["user_id"], body.name, slug=body.slug,
            )
        return link
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.patch("/links/{link_id}")
async def update_link(
    link_id: int, body: UpdateLinkRequest, user=Depends(get_current_user),
):
    """Update a link's name or slug."""
    from core.referrals import update_link as _update_link

    if body.slug and not validate_slug(body.slug):
        raise HTTPException(400, "Invalid slug.")
    try:
        async with get_transaction() as conn:
            link = await _update_link(conn, link_id, user["user_id"], body.name, body.slug)
        return link
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.delete("/links/{link_id}")
async def delete_link(link_id: int, user=Depends(get_current_user)):
    """Soft-delete a campaign link."""
    try:
        async with get_transaction() as conn:
            await soft_delete_link(conn, link_id, user["user_id"])
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(400, str(e))
```

- [ ] **Step 2: Add admin endpoints to the same router**

Append to `web_api/routes/referrals.py`:

```python
# --- Admin endpoints ---

admin_router = APIRouter(prefix="/api/admin/referrals", tags=["admin-referrals"])


@admin_router.get("/overview")
async def admin_overview(admin=Depends(require_admin)):
    """Global referral funnel stats."""
    async with get_connection() as conn:
        stats = await get_all_referrer_stats(conn)
    total = {
        "clicks": sum(s["clicks"] for s in stats),
        "signups": sum(s["signups"] for s in stats),
        "enrolled": sum(s["enrolled"] for s in stats),
        "completed": sum(s["completed"] for s in stats),
        "referrers": len(stats),
    }
    return {"total": total, "referrers": stats}


@admin_router.get("/referrers/{user_id}")
async def admin_referrer_detail(user_id: int, admin=Depends(require_admin)):
    """Per-link breakdown for a specific referrer."""
    async with get_connection() as conn:
        links = await get_user_links(conn, user_id)
        result = []
        for link in links:
            stats = await get_link_stats(conn, link["link_id"])
            result.append({**link, **stats})
    return {"links": result}
```

- [ ] **Step 3: Add `update_link` function to `core/referrals.py`**

```python
async def update_link(
    conn: AsyncConnection,
    link_id: int,
    user_id: int,
    name: str | None = None,
    slug: str | None = None,
) -> dict:
    """Update a link's name and/or slug."""
    # Fetch the link
    result = await conn.execute(
        select(referral_links).where(
            and_(
                referral_links.c.link_id == link_id,
                referral_links.c.user_id == user_id,
                referral_links.c.deleted_at.is_(None),
            )
        )
    )
    link = result.mappings().first()
    if link is None:
        raise ValueError("Link not found")

    updates = {}
    if name is not None:
        updates["name"] = name
    if slug is not None:
        if not validate_slug(slug):
            raise ValueError(f"Invalid slug: {slug}")
        # Check uniqueness
        existing = await conn.scalar(
            select(func.count())
            .select_from(referral_links)
            .where(
                and_(
                    referral_links.c.slug == slug,
                    referral_links.c.link_id != link_id,
                )
            )
        )
        if existing:
            raise ValueError(f"Slug '{slug}' is already taken")
        updates["slug"] = slug

    if not updates:
        return dict(link)

    await conn.execute(
        update(referral_links)
        .where(referral_links.c.link_id == link_id)
        .values(**updates)
    )
    # Return updated link
    result = await conn.execute(
        select(referral_links).where(referral_links.c.link_id == link_id)
    )
    return dict(result.mappings().first())
```

- [ ] **Step 4: Register both routers in `main.py`**

```python
from web_api.routes.referrals import router as referrals_router, admin_router as referrals_admin_router

app.include_router(referrals_router)
app.include_router(referrals_admin_router)
```

- [ ] **Step 5: Run all tests**

```bash
.venv/bin/pytest core/tests/test_referrals.py -v
```
Expected: All PASS.

- [ ] **Step 6: Commit**

```
feat: add user-facing and admin referral API endpoints
```

---

## Task 7: Frontend — Cookie Banner Update (Marketing Consent)

**Files:**
- Modify: `web_frontend/src/analytics.ts`
- Modify: `web_frontend/src/components/CookieBanner.tsx`

- [ ] **Step 1: Add marketing consent helpers to `analytics.ts`**

Add after the existing `CONSENT_KEY` constant:

```typescript
const MARKETING_CONSENT_KEY = "marketing-consent";

export function hasMarketingConsent(): boolean {
  return localStorage.getItem(MARKETING_CONSENT_KEY) === "accepted";
}

export function optInMarketing(): void {
  localStorage.setItem(MARKETING_CONSENT_KEY, "accepted");
  // Set a cookie that the server can read for the /ref route
  document.cookie = `marketing-consent=accepted; path=/; max-age=${90 * 24 * 60 * 60}; SameSite=Lax`;
}

export function optOutMarketing(): void {
  localStorage.setItem(MARKETING_CONSENT_KEY, "declined");
  document.cookie = "marketing-consent=declined; path=/; max-age=0";
  // Also clear any ref cookie
  document.cookie = "ref=; path=/; max-age=0";
}

export function hasMarketingConsentChoice(): boolean {
  const consent = localStorage.getItem(MARKETING_CONSENT_KEY);
  return consent === "accepted" || consent === "declined";
}
```

- [ ] **Step 2: Update `CookieBanner.tsx` with marketing toggle**

Replace the current banner with a two-category version:

```tsx
import { useState, useEffect } from "react";
import { detectUserCountry, requiresCookieConsent } from "../geolocation";
import {
  optIn,
  optOut,
  hasConsentChoice,
  optInMarketing,
  optOutMarketing,
  hasMarketingConsentChoice,
} from "../analytics";
import { initSentry } from "../errorTracking";

export default function CookieBanner() {
  const [showBanner, setShowBanner] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function checkConsent() {
      if (hasConsentChoice() && hasMarketingConsentChoice()) {
        setIsLoading(false);
        return;
      }
      const country = await detectUserCountry();
      const needsConsent = requiresCookieConsent(country);
      if (needsConsent) {
        setShowBanner(true);
      } else {
        optIn();
        optInMarketing();
        initSentry();
      }
      setIsLoading(false);
    }
    checkConsent();
  }, []);

  const handleAcceptAll = () => {
    optIn();
    optInMarketing();
    initSentry();
    setShowBanner(false);
  };

  const handleDeclineAll = () => {
    optOut();
    optOutMarketing();
    setShowBanner(false);
  };

  if (isLoading || !showBanner) return null;

  return (
    <div className="fixed top-0 left-0 right-0 bg-slate-900 border-b border-slate-700 p-4 z-50 shadow-lg">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex-1">
          <p className="text-sm text-slate-300">
            We use cookies to understand how you use this platform (analytics)
            and how you found us (marketing).{" "}
            <a
              href="/privacy"
              className="text-blue-400 hover:text-blue-300 underline"
            >
              Learn more
            </a>
          </p>
        </div>
        <div className="flex gap-3 flex-shrink-0">
          <button
            onClick={handleDeclineAll}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors"
          >
            Decline All
          </button>
          <button
            onClick={handleAcceptAll}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors"
          >
            Accept All
          </button>
        </div>
      </div>
    </div>
  );
}
```

Note: This simplifies to Accept All / Decline All. Per-category toggles can be added later but aren't needed for v1 — GDPR requires equal prominence for accept/decline, which this provides.

- [ ] **Step 3: Test manually in browser**

Start frontend dev server, navigate to the site. Verify:
- Banner shows for GDPR regions
- Accept All sets both `analytics-consent` and `marketing-consent` in localStorage
- Decline All sets both to `declined`

- [ ] **Step 4: Commit**

```
feat: add marketing cookie consent to cookie banner
```

---

## Task 8: Frontend — OAuth Flow Integration (Pass `ref` Through)

**Files:**
- Modify: `web_frontend/src/hooks/useAuth.ts`
- Modify: `web_frontend/src/components/enroll/EnrollWizard.tsx`

- [ ] **Step 1: Modify `useAuth.ts` login function to accept ref param**

In `web_frontend/src/hooks/useAuth.ts`, change the `login` callback (line 169):

```typescript
const login = useCallback((refSlug?: string) => {
    const next = encodeURIComponent(window.location.pathname);
    const origin = encodeURIComponent(window.location.origin);
    const anonymousToken = getAnonymousToken();
    const tokenParam = anonymousToken
      ? `&anonymous_token=${encodeURIComponent(anonymousToken)}`
      : "";
    const refParam = refSlug
      ? `&ref=${encodeURIComponent(refSlug)}`
      : "";
    window.location.href = `${API_URL}/auth/discord?next=${next}&origin=${origin}${tokenParam}${refParam}`;
  }, []);
```

- [ ] **Step 2: Update the `login` type in the AuthContext**

Find where the context type is defined (likely in the same file or a types file) and update the `login` signature to accept an optional string.

- [ ] **Step 3: Capture `ref` from URL in EnrollWizard and pass to login**

In `EnrollWizard.tsx`, read the `ref` query param and pass it through:

```typescript
// Near the top of the component
const refSlug = useMemo(() => {
  if (typeof window === "undefined") return undefined;
  return new URLSearchParams(window.location.search).get("ref") || undefined;
}, []);

// In handleDiscordConnect (or wherever login() is called)
const handleDiscordConnect = () => {
  login(refSlug);
};
```

- [ ] **Step 4: Verify the full flow manually**

1. Navigate to `/enroll?ref=test-slug`
2. Click "Connect with Discord"
3. Verify the OAuth URL includes `&ref=test-slug`

- [ ] **Step 5: Commit**

```
feat: pass referral slug through OAuth flow from enroll page
```

---

## Task 9: Frontend — `/referrals` Page

**Files:**
- Create: `web_frontend/src/pages/referrals/+Page.tsx`
- Create: `web_frontend/src/components/referrals/ReferralsPage.tsx`
- Create: `web_frontend/src/api/referrals.ts`
- Modify: `web_frontend/src/components/LandingNav.tsx`

- [ ] **Step 1: Create the API client**

```typescript
// web_frontend/src/api/referrals.ts
import { API_URL } from "../config";

export interface ReferralLink {
  link_id: number;
  name: string;
  slug: string;
  is_default: boolean;
  clicks: number;
  signups: number;
  enrolled: number;
  completed: number;
}

export async function getMyLinks(): Promise<{ links: ReferralLink[] }> {
  const res = await fetch(`${API_URL}/api/referrals/links`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch referral links");
  return res.json();
}

export async function createLink(
  name: string,
  slug?: string,
): Promise<ReferralLink> {
  const res = await fetch(`${API_URL}/api/referrals/links`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, slug: slug || undefined }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to create link");
  }
  return res.json();
}

export async function updateLink(
  linkId: number,
  data: { name?: string; slug?: string },
): Promise<ReferralLink> {
  const res = await fetch(`${API_URL}/api/referrals/links/${linkId}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to update link");
  }
  return res.json();
}

export async function deleteLink(linkId: number): Promise<void> {
  const res = await fetch(`${API_URL}/api/referrals/links/${linkId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to delete link");
  }
}
```

- [ ] **Step 2: Create the page route**

```tsx
// web_frontend/src/pages/referrals/+Page.tsx
export { default } from "../../components/referrals/ReferralsPage";
```

- [ ] **Step 3: Create the ReferralsPage component**

```tsx
// web_frontend/src/components/referrals/ReferralsPage.tsx
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../hooks/useAuth";
import { getMyLinks, createLink, deleteLink, updateLink, ReferralLink } from "../../api/referrals";
import Layout from "../Layout";

const BASE_URL = typeof window !== "undefined" ? window.location.origin : "";

export default function ReferralsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [links, setLinks] = useState<ReferralLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newLinkName, setNewLinkName] = useState("");
  const [newLinkSlug, setNewLinkSlug] = useState("");
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const [editingSlug, setEditingSlug] = useState<number | null>(null);
  const [editSlugValue, setEditSlugValue] = useState("");

  const fetchLinks = useCallback(async () => {
    try {
      const data = await getMyLinks();
      setLinks(data.links);
    } catch {
      setError("Failed to load referral links");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) fetchLinks();
  }, [user, fetchLinks]);

  const handleCopy = (slug: string, linkId: number) => {
    navigator.clipboard.writeText(`${BASE_URL}/ref/${slug}`);
    setCopied(linkId);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleCreate = async () => {
    if (!newLinkName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await createLink(newLinkName.trim(), newLinkSlug.trim() || undefined);
      setNewLinkName("");
      setNewLinkSlug("");
      await fetchLinks();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create link");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (linkId: number) => {
    try {
      await deleteLink(linkId);
      await fetchLinks();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete link");
    }
  };

  const handleEditSlug = (link: ReferralLink) => {
    setEditingSlug(link.link_id);
    setEditSlugValue(link.slug);
  };

  const handleSaveSlug = async (linkId: number) => {
    try {
      await updateLink(linkId, { slug: editSlugValue });
      setEditingSlug(null);
      await fetchLinks();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update slug");
    }
  };

  if (authLoading || loading) {
    return (
      <Layout>
        <div className="max-w-4xl mx-auto p-6">
          <p className="text-slate-400">Loading...</p>
        </div>
      </Layout>
    );
  }

  if (!user) {
    return (
      <Layout>
        <div className="max-w-4xl mx-auto p-6">
          <p className="text-slate-400">Sign in to manage your referral links.</p>
        </div>
      </Layout>
    );
  }

  const defaultLink = links.find((l) => l.is_default);
  const campaignLinks = links.filter((l) => !l.is_default);
  const totals = links.reduce(
    (acc, l) => ({
      clicks: acc.clicks + l.clicks,
      signups: acc.signups + l.signups,
      enrolled: acc.enrolled + l.enrolled,
      completed: acc.completed + l.completed,
    }),
    { clicks: 0, signups: 0, enrolled: 0, completed: 0 },
  );

  return (
    <Layout>
      <div className="max-w-4xl mx-auto p-6 space-y-8">
        <h1 className="text-2xl font-bold text-white">Your Referral Links</h1>

        {error && (
          <p className="text-red-400 text-sm">{error}</p>
        )}

        {/* Default link */}
        {defaultLink && (
          <div className="bg-slate-800 rounded-lg p-6 space-y-3">
            <h2 className="text-lg font-semibold text-white">Your Referral Link</h2>
            <div className="flex items-center gap-3">
              <code className="flex-1 bg-slate-900 px-4 py-2 rounded text-blue-400 text-sm">
                {BASE_URL}/ref/{defaultLink.slug}
              </code>
              <button
                onClick={() => handleCopy(defaultLink.slug, defaultLink.link_id)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm transition-colors"
              >
                {copied === defaultLink.link_id ? "Copied!" : "Copy"}
              </button>
            </div>
            <p className="text-sm text-slate-400">
              Share this message: "I've been taking this AI safety course and thought you'd enjoy it. Here's my link: {BASE_URL}/ref/{defaultLink.slug}"
            </p>
          </div>
        )}

        {/* Stats table */}
        <div className="bg-slate-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-left text-slate-400">
                <th className="p-4">Link</th>
                <th className="p-4 text-right">Clicks</th>
                <th className="p-4 text-right">Signups</th>
                <th className="p-4 text-right">Enrolled</th>
                <th className="p-4 text-right">Completed</th>
                <th className="p-4"></th>
              </tr>
            </thead>
            <tbody>
              {links.map((link) => (
                <tr key={link.link_id} className="border-b border-slate-700/50">
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <span className="text-white">{link.name}</span>
                      <button
                        onClick={() => handleCopy(link.slug, link.link_id)}
                        className="text-blue-400 hover:text-blue-300 text-xs"
                      >
                        {copied === link.link_id ? "Copied!" : "Copy"}
                      </button>
                    </div>
                    {editingSlug === link.link_id ? (
                      <div className="flex items-center gap-1 mt-1">
                        <span className="text-xs text-slate-500">/ref/</span>
                        <input
                          type="text"
                          value={editSlugValue}
                          onChange={(e) => setEditSlugValue(e.target.value)}
                          className="bg-slate-900 border border-slate-600 rounded px-1 py-0.5 text-xs text-white w-32"
                        />
                        <button onClick={() => handleSaveSlug(link.link_id)} className="text-green-400 text-xs">Save</button>
                        <button onClick={() => setEditingSlug(null)} className="text-slate-400 text-xs">Cancel</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <code className="text-xs text-slate-500">/ref/{link.slug}</code>
                        <button onClick={() => handleEditSlug(link)} className="text-slate-400 hover:text-slate-300 text-xs">Edit</button>
                      </div>
                    )}
                  </td>
                  <td className="p-4 text-right text-white">{link.clicks}</td>
                  <td className="p-4 text-right text-white">{link.signups}</td>
                  <td className="p-4 text-right text-white">{link.enrolled}</td>
                  <td className="p-4 text-right text-white">{link.completed}</td>
                  <td className="p-4 text-right">
                    {!link.is_default && (
                      <button
                        onClick={() => handleDelete(link.link_id)}
                        className="text-red-400 hover:text-red-300 text-xs"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              <tr className="bg-slate-900/50 font-semibold">
                <td className="p-4 text-white">Total</td>
                <td className="p-4 text-right text-white">{totals.clicks}</td>
                <td className="p-4 text-right text-white">{totals.signups}</td>
                <td className="p-4 text-right text-white">{totals.enrolled}</td>
                <td className="p-4 text-right text-white">{totals.completed}</td>
                <td className="p-4"></td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Create campaign link */}
        <div className="bg-slate-800 rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-semibold text-white">Create Campaign Link</h2>
          <p className="text-sm text-slate-400">
            Track different campaigns separately. Give each link a name like "Twitter bio" or "Blog post".
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder="Link name (e.g. Twitter bio)"
              value={newLinkName}
              onChange={(e) => setNewLinkName(e.target.value)}
              className="flex-1 bg-slate-900 border border-slate-700 rounded px-4 py-2 text-white text-sm placeholder-slate-500"
            />
            <input
              type="text"
              placeholder="Custom slug (optional)"
              value={newLinkSlug}
              onChange={(e) => setNewLinkSlug(e.target.value)}
              className="flex-1 bg-slate-900 border border-slate-700 rounded px-4 py-2 text-white text-sm placeholder-slate-500"
            />
            <button
              onClick={handleCreate}
              disabled={creating || !newLinkName.trim()}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded text-sm transition-colors"
            >
              {creating ? "Creating..." : "Create"}
            </button>
          </div>
        </div>
      </div>
    </Layout>
  );
}
```

- [ ] **Step 4: Add /referrals to navigation**

In `web_frontend/src/components/LandingNav.tsx`, add to `NAV_LINKS` (around line 8-11). This needs to be conditional on the user being logged in — check how the nav currently handles auth-gated links and follow that pattern. If the nav doesn't have auth-gated links, add `/referrals` as a regular link (unauthenticated users will see the "Sign in" message on the page).

- [ ] **Step 5: Verify in browser**

Start frontend and backend dev servers. Navigate to `/referrals`. Verify:
- Default link shows with copy button
- Campaign link creation works
- Stats table renders
- Delete works for non-default links

- [ ] **Step 6: Commit**

```
feat: add /referrals page with link management and stats
```

---

## Task 10: Marketing Consent DB Sync

**Files:**
- Modify: `web_frontend/src/hooks/useAuth.ts`
- Modify: `web_api/routes/users.py` (if marketing consent needs to be in the PATCH /api/users/me handler)

- [ ] **Step 1: Check how analytics consent is synced to DB**

Read `web_frontend/src/hooks/useAuth.ts` around lines 126-135 to see how `cookies_analytics_consent` is synced. Follow the same pattern for `cookies_marketing_consent`.

- [ ] **Step 2: Add marketing consent to the sync logic**

In the same `useEffect` or function that syncs analytics consent, add marketing consent:

```typescript
const marketingChoice = localStorage.getItem("marketing-consent");
if (marketingChoice) {
  // Include in the same PATCH /api/users/me call
  updates.cookies_marketing_consent = marketingChoice;
}
```

- [ ] **Step 3: Ensure the backend accepts the new field**

Check `web_api/routes/users.py` PATCH `/api/users/me` handler. If it uses a whitelist of allowed fields, add `cookies_marketing_consent` to it.

- [ ] **Step 4: Test by accepting cookies, logging in, and checking DB**

- [ ] **Step 5: Commit**

```
feat: sync marketing cookie consent to database
```

---

## Task 11: Backfill Default Links for Existing Users

**Files:**
- Create: `scripts/backfill_referral_links.py`

- [ ] **Step 1: Write a one-time backfill script**

```python
#!/usr/bin/env python3
"""Backfill default referral links for existing users who don't have one."""

import asyncio
from dotenv import load_dotenv

load_dotenv(".env.local")

from core.database import get_transaction, get_connection
from core.tables import users, referral_links
from core.referrals import create_default_link
from sqlalchemy import select, and_


async def backfill():
    async with get_connection() as conn:
        # Find users without a default referral link
        result = await conn.execute(
            select(users.c.user_id, users.c.nickname, users.c.discord_username, users.c.discord_id)
            .where(
                ~users.c.user_id.in_(
                    select(referral_links.c.user_id).where(referral_links.c.is_default.is_(True))
                )
            )
        )
        users_without_links = list(result.mappings())

    print(f"Found {len(users_without_links)} users without default referral links")

    for u in users_without_links:
        display_name = u["nickname"] or u["discord_username"] or u["discord_id"]
        async with get_transaction() as conn:
            link = await create_default_link(conn, u["user_id"], display_name)
        print(f"  Created /ref/{link['slug']} for user {u['user_id']} ({display_name})")

    print("Done!")


if __name__ == "__main__":
    asyncio.run(backfill())
```

- [ ] **Step 2: Run the backfill**

```bash
.venv/bin/python scripts/backfill_referral_links.py
```

- [ ] **Step 3: Commit**

```
feat: add backfill script for existing users' default referral links
```

---

## Task 12: End-to-End Verification

- [ ] **Step 1: Run the full test suite**

```bash
.venv/bin/pytest core/tests/test_referrals.py -v
.venv/bin/pytest -x  # full suite to check nothing is broken
```

- [ ] **Step 2: Run linting**

```bash
cd web_frontend && npm run lint && npm run build && cd ..
ruff check .
ruff format --check .
```

- [ ] **Step 3: Manual E2E test**

1. Open `/referrals` — verify default link shows
2. Create a campaign link — verify it appears in the table
3. Copy a link URL and open it in an incognito window
4. Verify redirect to `/enroll?ref=<slug>`
5. Click "Connect with Discord" — verify `&ref=<slug>` in the OAuth URL
6. Complete signup — verify `referred_by_link_id` is set in the DB
7. Go back to the referrer's `/referrals` page — verify click and signup counts updated

- [ ] **Step 4: Final commit if any fixes were needed**
