"""
Integration tests for availability data flow: Frontend JSON → Database → Scheduler format.

Tests the full conversion pipeline WITHOUT running the actual scheduler.
"""

import pytest
from sqlalchemy import insert

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.tables import users
from core.availability import availability_json_to_intervals
from core.queries.users import save_user_profile
from core import update_user_profile


class TestAvailabilityIntegration:
    """Test the full availability data flow from frontend format to scheduler format."""

    @pytest.mark.asyncio
    async def test_frontend_json_to_scheduler_intervals(self, db_conn):
        """
        Frontend JSON format should convert correctly to scheduler intervals.

        Flow: Frontend sends {"Monday": ["09:00-09:30", "09:30-10:00"]}
              → Stored in DB as JSON string
              → availability_json_to_intervals() returns [(540, 600)]
        """
        # Arrange: Frontend format (what the React app sends)
        frontend_availability = '{"Monday": ["09:00-09:30", "09:30-10:00"]}'

        # Store in database (simulating PATCH /api/users/me)
        result = await db_conn.execute(
            insert(users)
            .values(
                discord_id="test_avail_user",
                discord_username="test_user",
                availability_local=frontend_availability,
                timezone="UTC",
            )
            .returning(users.c.availability_local, users.c.timezone)
        )
        row = result.mappings().first()

        # Act: Convert to scheduler format (what schedule_cohort does)
        intervals = availability_json_to_intervals(
            row["availability_local"],
            row["timezone"],
        )

        # Assert: Monday 09:00-10:00 UTC = 540-600 minutes from week start
        # Monday 00:00 = 0, so 09:00 = 540 minutes, 10:00 = 600 minutes
        assert intervals == [(540, 600)]

    @pytest.mark.asyncio
    async def test_adjacent_slots_are_merged(self, db_conn):
        """Adjacent 30-minute slots should merge into one continuous interval."""
        # Four adjacent slots: 14:00-14:30, 14:30-15:00, 15:00-15:30, 15:30-16:00
        frontend_availability = (
            '{"Tuesday": ["14:00-14:30", "14:30-15:00", "15:00-15:30", "15:30-16:00"]}'
        )

        result = await db_conn.execute(
            insert(users)
            .values(
                discord_id="test_merge_user",
                discord_username="test_user",
                availability_local=frontend_availability,
                timezone="UTC",
            )
            .returning(users.c.availability_local, users.c.timezone)
        )
        row = result.mappings().first()

        intervals = availability_json_to_intervals(
            row["availability_local"],
            row["timezone"],
        )

        # Tuesday 14:00-16:00 = (1*24*60 + 14*60) to (1*24*60 + 16*60) = 2280-2400
        assert intervals == [(2280, 2400)]

    @pytest.mark.asyncio
    async def test_multiple_days_produces_multiple_intervals(self, db_conn):
        """Availability on different days should produce separate intervals."""
        frontend_availability = """{
            "Monday": ["10:00-10:30", "10:30-11:00"],
            "Wednesday": ["15:00-15:30", "15:30-16:00"]
        }"""

        result = await db_conn.execute(
            insert(users)
            .values(
                discord_id="test_multiday_user",
                discord_username="test_user",
                availability_local=frontend_availability,
                timezone="UTC",
            )
            .returning(users.c.availability_local, users.c.timezone)
        )
        row = result.mappings().first()

        intervals = availability_json_to_intervals(
            row["availability_local"],
            row["timezone"],
        )

        # Monday 10:00-11:00 = 600-660
        # Wednesday 15:00-16:00 = (2*24*60 + 15*60) to (2*24*60 + 16*60) = 3780-3840
        assert sorted(intervals) == [(600, 660), (3780, 3840)]

    @pytest.mark.asyncio
    async def test_timezone_conversion_shifts_intervals(self, db_conn):
        """
        Times stored in local timezone should convert to UTC.

        User in America/New_York selects Monday 09:00-10:00 local.
        In January (EST = UTC-5), this becomes Monday 14:00-15:00 UTC.
        """
        frontend_availability = '{"Monday": ["09:00-09:30", "09:30-10:00"]}'

        result = await db_conn.execute(
            insert(users)
            .values(
                discord_id="test_tz_user",
                discord_username="test_user",
                availability_local=frontend_availability,
                timezone="America/New_York",
            )
            .returning(users.c.availability_local, users.c.timezone)
        )
        row = result.mappings().first()

        intervals = availability_json_to_intervals(
            row["availability_local"],
            row["timezone"],
        )

        # Monday 09:00-10:00 EST = Monday 14:00-15:00 UTC = 840-900 minutes
        assert intervals == [(840, 900)]

    @pytest.mark.asyncio
    async def test_timezone_day_boundary_crossing(self, db_conn):
        """
        Late night in positive UTC offset should shift to previous day in UTC.

        User in Asia/Tokyo (UTC+9) selects Monday 02:00-03:00 local.
        This becomes Sunday 17:00-18:00 UTC.
        """
        frontend_availability = '{"Monday": ["02:00-02:30", "02:30-03:00"]}'

        result = await db_conn.execute(
            insert(users)
            .values(
                discord_id="test_daycross_user",
                discord_username="test_user",
                availability_local=frontend_availability,
                timezone="Asia/Tokyo",
            )
            .returning(users.c.availability_local, users.c.timezone)
        )
        row = result.mappings().first()

        intervals = availability_json_to_intervals(
            row["availability_local"],
            row["timezone"],
        )

        # Monday 02:00-03:00 JST = Sunday 17:00-18:00 UTC
        # Sunday = day 6, so 6*24*60 + 17*60 = 8640 + 1020 = 9660
        # End: 6*24*60 + 18*60 = 9720
        assert intervals == [(9660, 9720)]

    @pytest.mark.asyncio
    async def test_empty_availability_returns_empty_list(self, db_conn):
        """Empty or null availability should return empty interval list."""
        result = await db_conn.execute(
            insert(users)
            .values(
                discord_id="test_empty_user",
                discord_username="test_user",
                availability_local=None,
                timezone="UTC",
            )
            .returning(users.c.availability_local, users.c.timezone)
        )
        row = result.mappings().first()

        intervals = availability_json_to_intervals(
            row["availability_local"],
            row["timezone"],
        )

        assert intervals == []

    @pytest.mark.asyncio
    async def test_empty_json_object_returns_empty_list(self, db_conn):
        """Empty JSON object should return empty interval list."""
        result = await db_conn.execute(
            insert(users)
            .values(
                discord_id="test_emptyjson_user",
                discord_username="test_user",
                availability_local="{}",
                timezone="UTC",
            )
            .returning(users.c.availability_local, users.c.timezone)
        )
        row = result.mappings().first()

        intervals = availability_json_to_intervals(
            row["availability_local"],
            row["timezone"],
        )

        assert intervals == []

    @pytest.mark.asyncio
    async def test_noncontiguous_slots_stay_separate(self, db_conn):
        """Non-adjacent slots on the same day should produce separate intervals."""
        # Gap between 10:00-10:30 and 14:00-14:30
        frontend_availability = '{"Monday": ["10:00-10:30", "14:00-14:30"]}'

        result = await db_conn.execute(
            insert(users)
            .values(
                discord_id="test_gap_user",
                discord_username="test_user",
                availability_local=frontend_availability,
                timezone="UTC",
            )
            .returning(users.c.availability_local, users.c.timezone)
        )
        row = result.mappings().first()

        intervals = availability_json_to_intervals(
            row["availability_local"],
            row["timezone"],
        )

        # Monday 10:00-10:30 = 600-630
        # Monday 14:00-14:30 = 840-870
        assert sorted(intervals) == [(600, 630), (840, 870)]


class TestAvailabilityLastUpdatedAt:
    """Tests for availability_last_updated_at timestamp tracking."""

    @pytest.mark.asyncio
    async def test_save_user_profile_sets_timestamp_on_availability_update(
        self, db_conn
    ):
        """save_user_profile should set availability_last_updated_at when availability changes."""
        # Create user first
        await db_conn.execute(
            insert(users).values(
                discord_id="test_timestamp_user1",
                discord_username="test_user",
            )
        )

        # Update availability
        result = await save_user_profile(
            db_conn,
            discord_id="test_timestamp_user1",
            availability_local='{"Monday": ["09:00-09:30"]}',
        )

        assert result["availability_last_updated_at"] is not None

    @pytest.mark.asyncio
    async def test_save_user_profile_sets_timestamp_on_if_needed_update(self, db_conn):
        """save_user_profile should set availability_last_updated_at when if_needed changes."""
        # Create user first
        await db_conn.execute(
            insert(users).values(
                discord_id="test_timestamp_user2",
                discord_username="test_user",
            )
        )

        # Update if_needed availability
        result = await save_user_profile(
            db_conn,
            discord_id="test_timestamp_user2",
            if_needed_availability_local='{"Tuesday": ["14:00-14:30"]}',
        )

        assert result["availability_last_updated_at"] is not None

    @pytest.mark.asyncio
    async def test_save_user_profile_sets_timestamp_on_timezone_update(self, db_conn):
        """save_user_profile should set availability_last_updated_at when timezone changes."""
        # Create user first
        await db_conn.execute(
            insert(users).values(
                discord_id="test_timestamp_user3",
                discord_username="test_user",
            )
        )

        # Update timezone (affects availability in absolute terms)
        result = await save_user_profile(
            db_conn,
            discord_id="test_timestamp_user3",
            timezone="America/New_York",
        )

        assert result["availability_last_updated_at"] is not None

    @pytest.mark.asyncio
    async def test_save_user_profile_no_timestamp_on_other_fields(self, db_conn):
        """save_user_profile should NOT set availability_last_updated_at for non-availability fields."""
        # Create user first
        await db_conn.execute(
            insert(users).values(
                discord_id="test_timestamp_user3b",
                discord_username="test_user",
            )
        )

        # Update only nickname (not availability or timezone)
        result = await save_user_profile(
            db_conn,
            discord_id="test_timestamp_user3b",
            nickname="New Nickname",
        )

        assert result["availability_last_updated_at"] is None

    @pytest.mark.asyncio
    async def test_update_user_profile_sets_timestamp(self, db_conn):
        """update_user_profile should set availability_last_updated_at when availability changes."""
        # Create user first
        await db_conn.execute(
            insert(users).values(
                discord_id="test_timestamp_user4",
                discord_username="test_user",
            )
        )
        await db_conn.commit()

        # Update via update_user_profile (uses its own transaction)
        result = await update_user_profile(
            discord_id="test_timestamp_user4",
            availability_local='{"Wednesday": ["10:00-10:30"]}',
        )

        assert result is not None
        assert result["availability_last_updated_at"] is not None
