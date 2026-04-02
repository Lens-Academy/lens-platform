"""Tests for core/referrals.py — slug generation and referral link CRUD."""

from datetime import date

import pytest
import pytest_asyncio
from sqlalchemy import insert, select

from core.referrals import (
    MAX_CAMPAIGN_LINKS_PER_USER,
    create_campaign_link,
    create_default_link,
    get_all_referrer_stats,
    get_link_by_slug,
    get_link_stats,
    get_user_links,
    log_click,
    resolve_attribution,
    slugify_name,
    soft_delete_link,
    update_click_consent,
    update_link,
    validate_slug,
)
from core.tables import (
    cohorts,
    groups,
    groups_users,
    referral_clicks,
    referral_links,
    signups,
    users,
)


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


# ── Click tracking & attribution tests ───────────────────────


class TestLogClick:
    @pytest.mark.asyncio
    async def test_log_click(self, db_conn, test_user):
        link = await create_default_link(db_conn, test_user, "Test User")
        await log_click(db_conn, link["link_id"])
        await log_click(db_conn, link["link_id"])
        stats = await get_link_stats(db_conn, link["link_id"])
        assert stats["clicks"] == 2


class TestLogClickConsentState:
    @pytest.mark.asyncio
    async def test_log_click_records_consent_accepted(self, db_conn, test_user):
        link = await create_default_link(db_conn, test_user, "Consent Test")
        await log_click(db_conn, link["link_id"], consent_state="accepted")
        row = await db_conn.execute(
            select(referral_clicks.c.consent_state).where(
                referral_clicks.c.link_id == link["link_id"]
            )
        )
        assert row.scalar() == "accepted"

    @pytest.mark.asyncio
    async def test_log_click_records_consent_declined(self, db_conn, test_user):
        link = await create_default_link(db_conn, test_user, "Consent Test")
        await log_click(db_conn, link["link_id"], consent_state="declined")
        row = await db_conn.execute(
            select(referral_clicks.c.consent_state).where(
                referral_clicks.c.link_id == link["link_id"]
            )
        )
        assert row.scalar() == "declined"

    @pytest.mark.asyncio
    async def test_log_click_records_consent_pending(self, db_conn, test_user):
        link = await create_default_link(db_conn, test_user, "Consent Test")
        await log_click(db_conn, link["link_id"], consent_state="pending")
        row = await db_conn.execute(
            select(referral_clicks.c.consent_state).where(
                referral_clicks.c.link_id == link["link_id"]
            )
        )
        assert row.scalar() == "pending"

    @pytest.mark.asyncio
    async def test_log_click_defaults_to_pending(self, db_conn, test_user):
        link = await create_default_link(db_conn, test_user, "Consent Test")
        await log_click(db_conn, link["link_id"])
        row = await db_conn.execute(
            select(referral_clicks.c.consent_state).where(
                referral_clicks.c.link_id == link["link_id"]
            )
        )
        assert row.scalar() == "pending"


class TestLogClickReturnsClickId:
    @pytest.mark.asyncio
    async def test_log_click_returns_click_id(self, db_conn, test_user):
        link = await create_default_link(db_conn, test_user, "Return Test")
        click_id = await log_click(db_conn, link["link_id"])
        assert isinstance(click_id, int)

    @pytest.mark.asyncio
    async def test_log_click_returns_unique_ids(self, db_conn, test_user):
        link = await create_default_link(db_conn, test_user, "Return Test")
        id1 = await log_click(db_conn, link["link_id"])
        id2 = await log_click(db_conn, link["link_id"])
        assert id1 != id2


class TestGetLinkBySlug:
    @pytest.mark.asyncio
    async def test_get_link_by_slug(self, db_conn, test_user):
        created = await create_default_link(db_conn, test_user, "Test User")
        link = await get_link_by_slug(db_conn, created["slug"])
        assert link is not None
        assert link["user_id"] == test_user

    @pytest.mark.asyncio
    async def test_get_link_by_slug_deleted(self, db_conn, test_user):
        await create_default_link(db_conn, test_user, "Test User")
        campaign = await create_campaign_link(db_conn, test_user, "Temp")
        await soft_delete_link(db_conn, campaign["link_id"], test_user)
        result = await get_link_by_slug(db_conn, campaign["slug"])
        assert result is None


class TestResolveAttribution:
    @pytest.mark.asyncio
    async def test_resolve_attribution(self, db_conn, test_user):
        link = await create_default_link(db_conn, test_user, "Referrer")
        click_id = await log_click(db_conn, link["link_id"])
        referred_row = await db_conn.execute(
            insert(users)
            .values(discord_id="referred-456", discord_username="referred")
            .returning(users.c.user_id)
        )
        referred_id = referred_row.first()[0]
        await resolve_attribution(db_conn, referred_id, click_id)
        row = await db_conn.execute(
            select(users.c.referred_by_click_id).where(users.c.user_id == referred_id)
        )
        assert row.scalar() == click_id

    @pytest.mark.asyncio
    async def test_resolve_attribution_invalid_click_id(self, db_conn):
        referred_row = await db_conn.execute(
            insert(users)
            .values(discord_id="referred-789", discord_username="referred2")
            .returning(users.c.user_id)
        )
        referred_id = referred_row.first()[0]
        await resolve_attribution(db_conn, referred_id, 999999)
        row = await db_conn.execute(
            select(users.c.referred_by_click_id).where(users.c.user_id == referred_id)
        )
        assert row.scalar() is None


class TestGetLinkStats:
    @pytest.mark.asyncio
    async def test_get_link_stats_full_funnel(self, db_conn, test_user):
        link = await create_default_link(db_conn, test_user, "Referrer")
        await log_click(db_conn, link["link_id"])
        await log_click(db_conn, link["link_id"])
        await log_click(db_conn, link["link_id"])
        await db_conn.execute(
            insert(users)
            .values(
                discord_id="ref-user-1",
                discord_username="refuser1",
                referred_by_link_id=link["link_id"],
            )
            .returning(users.c.user_id)
        )
        stats = await get_link_stats(db_conn, link["link_id"])
        assert stats["clicks"] == 3
        assert stats["signups"] == 1


# ── Additional attribution tests ─────────────────────────────


class TestResolveAttributionIdempotent:
    @pytest.mark.asyncio
    async def test_second_attribution_does_not_overwrite(self, db_conn, test_user):
        """Once a user has attribution, a second call with a different click does NOT overwrite."""
        referrer1 = test_user
        link1 = await create_default_link(db_conn, referrer1, "Referrer One")
        click1 = await log_click(db_conn, link1["link_id"])

        referrer2_row = await db_conn.execute(
            insert(users)
            .values(discord_id="referrer2-discord", discord_username="referrer2")
            .returning(users.c.user_id)
        )
        referrer2 = referrer2_row.first()[0]
        link2 = await create_default_link(db_conn, referrer2, "Referrer Two")
        click2 = await log_click(db_conn, link2["link_id"])

        referred_row = await db_conn.execute(
            insert(users)
            .values(discord_id="referred-idempotent", discord_username="referred")
            .returning(users.c.user_id)
        )
        referred_id = referred_row.first()[0]

        await resolve_attribution(db_conn, referred_id, click1)
        row = await db_conn.execute(
            select(users.c.referred_by_click_id).where(users.c.user_id == referred_id)
        )
        assert row.scalar() == click1

        await resolve_attribution(db_conn, referred_id, click2)
        row = await db_conn.execute(
            select(users.c.referred_by_click_id).where(users.c.user_id == referred_id)
        )
        assert row.scalar() == click1  # unchanged


class TestResolveAttributionSelfReferral:
    @pytest.mark.asyncio
    async def test_user_cannot_be_attributed_to_own_link(self, db_conn, test_user):
        """A user cannot be attributed to their own referral link."""
        link = await create_default_link(db_conn, test_user, "Self Referrer")
        click_id = await log_click(db_conn, link["link_id"])
        await resolve_attribution(db_conn, test_user, click_id)
        row = await db_conn.execute(
            select(users.c.referred_by_click_id).where(users.c.user_id == test_user)
        )
        assert row.scalar() is None


# ── Full funnel stats tests ──────────────────────────────────


@pytest_asyncio.fixture
async def full_funnel_setup(db_conn, test_user):
    """Set up a full funnel: referrer -> link -> referred users -> cohort -> group."""
    link = await create_default_link(db_conn, test_user, "Funnel Referrer")

    # Create a cohort
    cohort_row = await db_conn.execute(
        insert(cohorts)
        .values(
            cohort_name="Test Cohort",
            course_slug="default",
            cohort_start_date=date(2025, 1, 1),
            duration_days=30,
            number_of_group_meetings=4,
        )
        .returning(cohorts.c.cohort_id)
    )
    cohort_id = cohort_row.first()[0]

    # Create a group in that cohort
    group_row = await db_conn.execute(
        insert(groups)
        .values(group_name="Test Group", cohort_id=cohort_id)
        .returning(groups.c.group_id)
    )
    group_id = group_row.first()[0]

    # Create referred users
    referred_ids = []
    for i in range(3):
        row = await db_conn.execute(
            insert(users)
            .values(
                discord_id=f"funnel-ref-{i}",
                discord_username=f"funnelref{i}",
                referred_by_link_id=link["link_id"],
            )
            .returning(users.c.user_id)
        )
        referred_ids.append(row.first()[0])

    return {
        "link": link,
        "cohort_id": cohort_id,
        "group_id": group_id,
        "referred_ids": referred_ids,
    }


class TestGetLinkStatsFullFunnel:
    @pytest.mark.asyncio
    async def test_enrolled_and_completed_counts(
        self, db_conn, test_user, full_funnel_setup
    ):
        setup = full_funnel_setup
        link = setup["link"]

        # Log some clicks
        for _ in range(5):
            await log_click(db_conn, link["link_id"])

        # Enroll 2 of 3 referred users (insert into signups)
        for uid in setup["referred_ids"][:2]:
            await db_conn.execute(
                insert(signups).values(
                    user_id=uid,
                    cohort_id=setup["cohort_id"],
                    role="participant",
                )
            )

        # Complete 1 of 2 enrolled users (insert into groups_users with status=completed)
        await db_conn.execute(
            insert(groups_users).values(
                user_id=setup["referred_ids"][0],
                group_id=setup["group_id"],
                role="participant",
                status="completed",
            )
        )

        stats = await get_link_stats(db_conn, link["link_id"])
        assert stats["clicks"] == 5
        assert stats["signups"] == 3  # 3 referred users
        assert stats["enrolled"] == 2  # 2 with signups
        assert stats["completed"] == 1  # 1 with completed group status


# ── All referrer stats tests ─────────────────────────────────


class TestGetAllReferrerStats:
    @pytest.mark.asyncio
    async def test_basic_aggregation(self, db_conn, test_user):
        """One referrer with clicks and signups."""
        link = await create_default_link(db_conn, test_user, "Stats Referrer")
        await log_click(db_conn, link["link_id"])
        await log_click(db_conn, link["link_id"])

        # Create a referred user
        await db_conn.execute(
            insert(users).values(
                discord_id="stats-ref-1",
                discord_username="statsref1",
                referred_by_link_id=link["link_id"],
            )
        )

        stats = await get_all_referrer_stats(db_conn)
        # Find our referrer in results
        referrer = next(s for s in stats if s["user_id"] == test_user)
        assert referrer["clicks"] == 2
        assert referrer["signups"] == 1
        assert referrer["links"] == 1

    @pytest.mark.asyncio
    async def test_multiple_referrers_sorted_by_clicks(self, db_conn):
        """Multiple referrers sorted by clicks descending."""
        # Create two referrers
        row1 = await db_conn.execute(
            insert(users)
            .values(discord_id="multi-ref-1", discord_username="multiref1")
            .returning(users.c.user_id)
        )
        user1 = row1.first()[0]
        link1 = await create_default_link(db_conn, user1, "Multi Ref One")

        row2 = await db_conn.execute(
            insert(users)
            .values(discord_id="multi-ref-2", discord_username="multiref2")
            .returning(users.c.user_id)
        )
        user2 = row2.first()[0]
        link2 = await create_default_link(db_conn, user2, "Multi Ref Two")

        # User2 gets more clicks
        await log_click(db_conn, link1["link_id"])
        await log_click(db_conn, link2["link_id"])
        await log_click(db_conn, link2["link_id"])
        await log_click(db_conn, link2["link_id"])

        stats = await get_all_referrer_stats(db_conn)
        # Filter to just our test users
        our_stats = [s for s in stats if s["user_id"] in (user1, user2)]
        assert len(our_stats) == 2
        # user2 should be first (more clicks)
        assert our_stats[0]["user_id"] == user2
        assert our_stats[0]["clicks"] == 3
        assert our_stats[1]["user_id"] == user1
        assert our_stats[1]["clicks"] == 1

    @pytest.mark.asyncio
    async def test_deleted_links_clicks_excluded(self, db_conn):
        """Deleted links' clicks should be excluded from stats."""
        row = await db_conn.execute(
            insert(users)
            .values(discord_id="del-ref-1", discord_username="delref1")
            .returning(users.c.user_id)
        )
        uid = row.first()[0]
        default_link = await create_default_link(db_conn, uid, "Del Ref")
        campaign = await create_campaign_link(db_conn, uid, "Temp Campaign")

        # Log clicks on both links
        await log_click(db_conn, default_link["link_id"])
        await log_click(db_conn, campaign["link_id"])
        await log_click(db_conn, campaign["link_id"])

        # Delete the campaign link
        await soft_delete_link(db_conn, campaign["link_id"], uid)

        stats = await get_all_referrer_stats(db_conn)
        referrer = next(s for s in stats if s["user_id"] == uid)
        # Only the default link's click should count (1 link remaining, 1 click)
        assert referrer["links"] == 1
        assert referrer["clicks"] == 1


# ── Soft delete authorization tests ──────────────────────────


class TestSoftDeleteLinkAuthorization:
    @pytest.mark.asyncio
    async def test_delete_link_owned_by_different_user(self, db_conn, test_user):
        """Deleting a link owned by a different user raises ValueError."""
        # Create a campaign link owned by test_user
        await create_default_link(db_conn, test_user, "Owner")
        campaign = await create_campaign_link(db_conn, test_user, "Their Link")

        # Create a different user
        other_row = await db_conn.execute(
            insert(users)
            .values(discord_id="other-user-delete", discord_username="otheruser")
            .returning(users.c.user_id)
        )
        other_id = other_row.first()[0]

        # Other user tries to delete test_user's link
        with pytest.raises(ValueError, match="not found"):
            await soft_delete_link(db_conn, campaign["link_id"], other_id)


# ── Campaign link with explicit slug tests ───────────────────


class TestCreateCampaignLinkWithExplicitSlug:
    @pytest.mark.asyncio
    async def test_explicit_slug_is_used(self, db_conn, test_user):
        await create_default_link(db_conn, test_user, "Kate Smith")
        link = await create_campaign_link(
            db_conn, test_user, "My Campaign", slug="my-custom-slug"
        )
        assert link["slug"] == "my-custom-slug"

    @pytest.mark.asyncio
    async def test_explicit_slug_collision_gets_suffix(self, db_conn, test_user):
        await create_default_link(db_conn, test_user, "Kate Smith")
        # Create first with explicit slug
        link1 = await create_campaign_link(
            db_conn, test_user, "Campaign A", slug="shared-slug"
        )
        assert link1["slug"] == "shared-slug"

        # Create second with same explicit slug - should get suffix
        link2 = await create_campaign_link(
            db_conn, test_user, "Campaign B", slug="shared-slug"
        )
        assert link2["slug"].startswith("shared-slug-")
        assert link2["slug"] != "shared-slug"


# ── Slugify edge cases ───────────────────────────────────────


class TestUpdateClickConsent:
    @pytest.mark.asyncio
    async def test_updates_pending_to_pending_then_accepted(self, db_conn, test_user):
        link = await create_default_link(db_conn, test_user, "Update Test")
        click_id = await log_click(db_conn, link["link_id"], consent_state="pending")
        updated = await update_click_consent(db_conn, click_id, "accepted")
        assert updated is True
        row = await db_conn.execute(
            select(referral_clicks.c.consent_state).where(
                referral_clicks.c.click_id == click_id
            )
        )
        assert row.scalar() == "pending_then_accepted"

    @pytest.mark.asyncio
    async def test_updates_pending_to_declined(self, db_conn, test_user):
        link = await create_default_link(db_conn, test_user, "Update Test")
        click_id = await log_click(db_conn, link["link_id"], consent_state="pending")
        updated = await update_click_consent(db_conn, click_id, "declined")
        assert updated is True
        row = await db_conn.execute(
            select(referral_clicks.c.consent_state).where(
                referral_clicks.c.click_id == click_id
            )
        )
        assert row.scalar() == "declined"

    @pytest.mark.asyncio
    async def test_does_not_update_already_resolved(self, db_conn, test_user):
        link = await create_default_link(db_conn, test_user, "Update Test")
        click_id = await log_click(db_conn, link["link_id"], consent_state="accepted")
        updated = await update_click_consent(db_conn, click_id, "declined")
        assert updated is False
        row = await db_conn.execute(
            select(referral_clicks.c.consent_state).where(
                referral_clicks.c.click_id == click_id
            )
        )
        assert row.scalar() == "accepted"  # unchanged

    @pytest.mark.asyncio
    async def test_nonexistent_click_id(self, db_conn):
        updated = await update_click_consent(db_conn, 999999, "accepted")
        assert updated is False


class TestSlugifyEdgeCases:
    def test_empty_string_input(self):
        result = slugify_name("")
        assert len(result) >= 3
        assert result == "ref"

    def test_only_special_chars_input(self):
        result = slugify_name("!!!@@@###")
        assert len(result) >= 3
        assert result == "ref"
