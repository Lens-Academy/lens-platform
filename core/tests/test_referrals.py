"""Tests for core/referrals.py — slug generation and referral link CRUD."""

import pytest
import pytest_asyncio
from sqlalchemy import insert

from core.referrals import (
    MAX_CAMPAIGN_LINKS_PER_USER,
    SLUG_PATTERN,
    create_campaign_link,
    create_default_link,
    get_user_links,
    slugify_name,
    soft_delete_link,
    update_link,
    validate_slug,
)
from core.tables import referral_links, users


# ── Fixtures ──────────────────────────────────────────────────


@pytest_asyncio.fixture
async def test_user(db_conn):
    result = await db_conn.execute(
        insert(users)
        .values(discord_id="test-discord-123", discord_username="testuser")
        .returning(users.c.user_id)
    )
    return result.first()[0]


# ── Slug generation tests (sync, no DB) ──────────────────────


class TestSlugifyName:
    def test_slugify_simple_name(self):
        assert slugify_name("Kate") == "kate"

    def test_slugify_name_with_spaces(self):
        assert slugify_name("Alex Rivera") == "alex-rivera"

    def test_slugify_strips_special_chars(self):
        # Unicode accents stripped via NFKD normalization
        result = slugify_name("José María")
        # NFKD decomposes accented chars: é→e+combining, í→i+combining
        # Stripping combining marks leaves the base letters
        assert result == "jose-maria"

    def test_slugify_collapses_hyphens(self):
        assert slugify_name("test--name") == "test-name"

    def test_slugify_strips_leading_trailing_hyphens(self):
        assert slugify_name("-test-") == "test"

    def test_slugify_short_name_padded(self):
        result = slugify_name("ab")
        assert len(result) >= 3

    def test_slugify_long_name_truncated(self):
        result = slugify_name("a" * 100)
        assert len(result) <= 50


class TestValidateSlug:
    def test_valid_slug(self):
        assert validate_slug("kate") is True
        assert validate_slug("alex-rivera") is True

    def test_invalid_slug_starts_with_digit(self):
        assert validate_slug("1kate") is False

    def test_invalid_slug_too_short(self):
        assert validate_slug("ab") is False

    def test_invalid_slug_uppercase(self):
        assert validate_slug("Kate") is False


# ── CRUD tests (async, use db_conn fixture) ──────────────────


class TestCreateDefaultLink:
    @pytest.mark.asyncio
    async def test_create_default_link(self, db_conn, test_user):
        link = await create_default_link(db_conn, test_user, "Kate Smith")
        assert link["is_default"] is True
        assert link["slug"] == "kate-smith"
        assert link["name"] == "Kate Smith"
        assert link["user_id"] == test_user

    @pytest.mark.asyncio
    async def test_create_default_link_slug_collision(self, db_conn, test_user):
        # Pre-insert a colliding slug from a different user
        other = await db_conn.execute(
            insert(users)
            .values(discord_id="other-discord", discord_username="other")
            .returning(users.c.user_id)
        )
        other_id = other.first()[0]
        await db_conn.execute(
            insert(referral_links).values(
                user_id=other_id,
                name="Kate Smith",
                slug="kate-smith",
                is_default=True,
            )
        )

        link = await create_default_link(db_conn, test_user, "Kate Smith")
        assert link["slug"].startswith("kate-smith-")
        assert link["is_default"] is True


class TestCreateCampaignLink:
    @pytest.mark.asyncio
    async def test_create_campaign_link(self, db_conn, test_user):
        # Need a default link first
        await create_default_link(db_conn, test_user, "Kate Smith")
        link = await create_campaign_link(db_conn, test_user, "Summer 2025")
        assert link["is_default"] is False
        assert link["name"] == "Summer 2025"
        assert "summer-2025" in link["slug"]

    @pytest.mark.asyncio
    async def test_campaign_link_cap(self, db_conn, test_user):
        await create_default_link(db_conn, test_user, "Kate Smith")
        for i in range(MAX_CAMPAIGN_LINKS_PER_USER):
            await create_campaign_link(db_conn, test_user, f"Campaign {i}")
        with pytest.raises(ValueError, match="limit"):
            await create_campaign_link(db_conn, test_user, "One Too Many")


class TestGetUserLinks:
    @pytest.mark.asyncio
    async def test_get_user_links(self, db_conn, test_user):
        await create_default_link(db_conn, test_user, "Kate Smith")
        await create_campaign_link(db_conn, test_user, "Summer 2025")
        links = await get_user_links(db_conn, test_user)
        assert len(links) == 2
        assert links[0]["is_default"] is True


class TestSoftDeleteLink:
    @pytest.mark.asyncio
    async def test_soft_delete_link(self, db_conn, test_user):
        await create_default_link(db_conn, test_user, "Kate Smith")
        campaign = await create_campaign_link(db_conn, test_user, "Summer 2025")
        await soft_delete_link(db_conn, campaign["link_id"], test_user)
        links = await get_user_links(db_conn, test_user)
        assert len(links) == 1

    @pytest.mark.asyncio
    async def test_cannot_delete_default_link(self, db_conn, test_user):
        default = await create_default_link(db_conn, test_user, "Kate Smith")
        with pytest.raises(ValueError, match="default"):
            await soft_delete_link(db_conn, default["link_id"], test_user)


class TestUpdateLink:
    @pytest.mark.asyncio
    async def test_update_link_name(self, db_conn, test_user):
        await create_default_link(db_conn, test_user, "Kate Smith")
        campaign = await create_campaign_link(db_conn, test_user, "Summer 2025")
        updated = await update_link(
            db_conn, campaign["link_id"], test_user, name="Winter 2025"
        )
        assert updated["name"] == "Winter 2025"
        assert updated["slug"] == campaign["slug"]

    @pytest.mark.asyncio
    async def test_update_link_slug(self, db_conn, test_user):
        await create_default_link(db_conn, test_user, "Kate Smith")
        campaign = await create_campaign_link(db_conn, test_user, "Summer 2025")
        updated = await update_link(
            db_conn, campaign["link_id"], test_user, slug="new-slug"
        )
        assert updated["slug"] == "new-slug"

    @pytest.mark.asyncio
    async def test_update_link_slug_uniqueness(self, db_conn, test_user):
        default = await create_default_link(db_conn, test_user, "Kate Smith")
        campaign = await create_campaign_link(db_conn, test_user, "Summer 2025")
        with pytest.raises(ValueError, match="slug"):
            await update_link(
                db_conn, campaign["link_id"], test_user, slug=default["slug"]
            )
