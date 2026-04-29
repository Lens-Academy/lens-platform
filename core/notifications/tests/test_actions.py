"""Tests for high-level notification actions."""

import pytest
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch, MagicMock
from zoneinfo import ZoneInfo


class TestNotifyGroupAssigned:
    @pytest.mark.asyncio
    async def test_sends_notification(self):
        """Test that notify_group_assigned sends email and Discord notifications."""
        from core.notifications.actions import notify_group_assigned

        mock_send = AsyncMock(return_value={"email": True, "discord": True})

        with patch("core.notifications.actions.send_notification", mock_send):
            result = await notify_group_assigned(
                user_id=1,
                group_name="Curious Capybaras",
                recurring_meeting_time_utc="Wednesday 15:00",
                member_names=["Alice", "Bob"],
                discord_channel_id="123456",
            )

        mock_send.assert_called_once()
        call_kwargs = mock_send.call_args[1]
        assert call_kwargs["message_type"] == "group_assigned"
        assert call_kwargs["context"]["group_name"] == "Curious Capybaras"
        assert result == {"email": True, "discord": True}

    @pytest.mark.asyncio
    async def test_uses_iso_timestamp_when_next_meeting_provided(self):
        """Reviewer #1 (DST): when a real datetime is available, prefer it.

        Goes through dispatcher's meeting_time_utc ISO branch which uses the
        actual date for offset computation, eliminating DST drift.
        """
        from core.notifications.actions import notify_group_assigned

        mock_send = AsyncMock(return_value={"email": True, "discord": True})
        next_meeting = datetime(2026, 7, 15, 15, 0, tzinfo=ZoneInfo("UTC"))

        with patch("core.notifications.actions.send_notification", mock_send):
            await notify_group_assigned(
                user_id=1,
                group_name="Curious Capybaras",
                recurring_meeting_time_utc="Wednesday 15:00",
                member_names=["Alice", "Bob"],
                discord_channel_id="123456",
                next_meeting_at=next_meeting,
            )

        ctx = mock_send.call_args[1]["context"]
        # ISO timestamp set so dispatcher converts in user's tz
        assert ctx["meeting_time_utc"] == "2026-07-15T15:00:00+00:00"
        # No-timezone fallback uses the same singular UTC format reminders use
        assert ctx["meeting_time"] == "Wednesday at 15:00 UTC"
        # No recurring key when we have a real datetime
        assert "meeting_time_recurring_utc" not in ctx

    @pytest.mark.asyncio
    async def test_falls_back_to_recurring_string_without_next_meeting(self):
        """Without next_meeting_at, pass the recurring string for dispatcher to parse."""
        from core.notifications.actions import notify_group_assigned

        mock_send = AsyncMock(return_value={"email": True, "discord": True})

        with patch("core.notifications.actions.send_notification", mock_send):
            await notify_group_assigned(
                user_id=1,
                group_name="Curious Capybaras",
                recurring_meeting_time_utc="Wednesday 15:00",
                member_names=["Alice", "Bob"],
                discord_channel_id="123456",
            )

        ctx = mock_send.call_args[1]["context"]
        assert ctx["meeting_time_recurring_utc"] == "Wednesday 15:00"
        assert ctx["meeting_time"] == "Wednesday at 15:00 UTC"
        assert "meeting_time_utc" not in ctx

    @pytest.mark.asyncio
    async def test_unparseable_string_appends_utc_marker_and_logs(self, caplog):
        """Reviewer #3/#7: unparseable strings must not silently regress.

        When the recurring string can't be parsed but looks time-shaped
        (contains a digit), append " UTC" so the user sees a marker. Log a
        warning so admins can find bad data in production.
        """
        import logging
        from core.notifications.actions import notify_group_assigned

        mock_send = AsyncMock(return_value={"email": True, "discord": True})

        with caplog.at_level(logging.WARNING, logger="core.notifications.actions"):
            with patch("core.notifications.actions.send_notification", mock_send):
                await notify_group_assigned(
                    user_id=1,
                    group_name="Curious Capybaras",
                    recurring_meeting_time_utc="Wednesday 3pm",
                    member_names=["Alice"],
                    discord_channel_id="123456",
                )

        ctx = mock_send.call_args[1]["context"]
        assert ctx["meeting_time"] == "Wednesday 3pm UTC"
        assert "meeting_time_recurring_utc" not in ctx
        assert any("Wednesday 3pm" in r.message for r in caplog.records), (
            "Expected warning about unparseable meeting time"
        )

    @pytest.mark.asyncio
    async def test_tbd_passes_through_without_utc_suffix(self):
        """'TBD' is not time-shaped, no UTC marker, no warning."""
        from core.notifications.actions import notify_group_assigned

        mock_send = AsyncMock(return_value={"email": True, "discord": True})

        with patch("core.notifications.actions.send_notification", mock_send):
            await notify_group_assigned(
                user_id=1,
                group_name="Curious Capybaras",
                recurring_meeting_time_utc="TBD",
                member_names=["Alice"],
                discord_channel_id="123456",
            )

        ctx = mock_send.call_args[1]["context"]
        assert ctx["meeting_time"] == "TBD"

    @pytest.mark.asyncio
    async def test_lenient_parser_handles_admin_typed_strings(self):
        """Reviewer #7: case/abbrev variations should still go through the
        dispatcher localization path, not the unparseable fallback."""
        from core.notifications.actions import notify_group_assigned

        mock_send = AsyncMock(return_value={"email": True, "discord": True})

        for s in ["wed 15:00", "Wednesday at 15:00", "WEDNESDAY 15:00 UTC"]:
            with patch("core.notifications.actions.send_notification", mock_send):
                await notify_group_assigned(
                    user_id=1,
                    group_name="X",
                    recurring_meeting_time_utc=s,
                    member_names=["A"],
                    discord_channel_id="1",
                )
            ctx = mock_send.call_args[1]["context"]
            assert ctx["meeting_time_recurring_utc"] == s, (
                f"Expected {s!r} to be parseable and routed through dispatcher"
            )
            assert ctx["meeting_time"] == "Wednesday at 15:00 UTC"


class TestNotifyMemberJoined:
    @pytest.mark.asyncio
    async def test_uses_iso_timestamp_when_next_meeting_provided(self):
        from core.notifications.actions import notify_member_joined

        mock_send = AsyncMock(return_value={"email": True, "discord": True})
        next_meeting = datetime(2026, 7, 15, 15, 0, tzinfo=ZoneInfo("UTC"))

        with patch("core.notifications.actions.send_notification", mock_send):
            await notify_member_joined(
                user_id=1,
                group_name="Curious Capybaras",
                recurring_meeting_time_utc="Wednesday 15:00",
                member_names=["Alice", "Bob"],
                discord_channel_id="123456",
                discord_user_id="987654",
                next_meeting_at=next_meeting,
            )

        ctx = mock_send.call_args[1]["context"]
        assert ctx["meeting_time_utc"] == "2026-07-15T15:00:00+00:00"
        assert ctx["meeting_time"] == "Wednesday at 15:00 UTC"


class TestNotifyGroupAssignedEndToEnd:
    """Reviewer #6: actually run the rendered email body, not just the context dict."""

    @pytest.mark.asyncio
    async def test_user_with_timezone_sees_offset_in_email_body(self):
        """notify_group_assigned -> dispatcher -> rendered email body."""
        from core.notifications.actions import notify_group_assigned

        mock_user = {
            "user_id": 1,
            "email": "alice@example.com",
            "discord_id": "123456",
            "nickname": "Alice",
            "timezone": "Asia/Bangkok",  # UTC+7
            "email_notifications_enabled": True,
            "dm_notifications_enabled": False,
        }

        captured_body = None

        def capture_email(to_email, subject, body):
            nonlocal captured_body
            captured_body = body
            return True

        next_meeting = datetime(2026, 7, 15, 15, 0, tzinfo=ZoneInfo("UTC"))

        with patch(
            "core.notifications.dispatcher.get_user_by_id",
            AsyncMock(return_value=mock_user),
        ):
            with patch(
                "core.notifications.dispatcher.send_email",
                side_effect=capture_email,
            ):
                # Patch the dedup check; not relevant to format assertions
                with patch(
                    "core.notifications.dispatcher.log_notification",
                    AsyncMock(),
                ):
                    await notify_group_assigned(
                        user_id=1,
                        group_name="Curious Capybaras",
                        recurring_meeting_time_utc="Wednesday 15:00",
                        member_names=["Alice", "Bob"],
                        discord_channel_id="123456",
                        next_meeting_at=next_meeting,
                    )

        assert captured_body is not None
        # July reference -> Bangkok is UTC+7 year-round, but the assertion is
        # really that the user-tz format reaches the rendered body.
        assert "Wednesday at 10:00 PM (UTC+7)" in captured_body, (
            f"Body did not contain expected localized meeting time: {captured_body!r}"
        )

    @pytest.mark.asyncio
    async def test_user_without_timezone_sees_utc_marker_in_email_body(self):
        from core.notifications.actions import notify_group_assigned

        mock_user = {
            "user_id": 1,
            "email": "alice@example.com",
            "discord_id": "123456",
            "nickname": "Alice",
            "timezone": None,
            "email_notifications_enabled": True,
            "dm_notifications_enabled": False,
        }

        captured_body = None

        def capture_email(to_email, subject, body):
            nonlocal captured_body
            captured_body = body
            return True

        with patch(
            "core.notifications.dispatcher.get_user_by_id",
            AsyncMock(return_value=mock_user),
        ):
            with patch(
                "core.notifications.dispatcher.send_email",
                side_effect=capture_email,
            ):
                with patch(
                    "core.notifications.dispatcher.log_notification",
                    AsyncMock(),
                ):
                    await notify_group_assigned(
                        user_id=1,
                        group_name="Curious Capybaras",
                        recurring_meeting_time_utc="Wednesday 15:00",
                        member_names=["Alice", "Bob"],
                        discord_channel_id="123456",
                    )

        assert captured_body is not None
        assert "Wednesday at 15:00 UTC" in captured_body


class TestScheduleMeetingReminders:
    """Test schedule_meeting_reminders() with lightweight signature."""

    def test_schedules_all_reminders(self):
        """Should schedule 3 lightweight reminder jobs."""
        from core.notifications.actions import schedule_meeting_reminders

        mock_schedule = MagicMock()
        meeting_time = datetime.now(ZoneInfo("UTC")) + timedelta(days=7)

        with patch("core.notifications.actions.schedule_reminder", mock_schedule):
            schedule_meeting_reminders(
                meeting_id=42,
                meeting_time=meeting_time,
            )

        # Should schedule 3 jobs: 24h, 1h, 3d module nudge
        assert mock_schedule.call_count == 3

    def test_uses_lightweight_kwargs(self):
        """Should only pass meeting_id and reminder_type to schedule_reminder."""
        from core.notifications.actions import schedule_meeting_reminders

        mock_schedule = MagicMock()
        meeting_time = datetime.now(ZoneInfo("UTC")) + timedelta(days=7)

        with patch("core.notifications.actions.schedule_reminder", mock_schedule):
            schedule_meeting_reminders(
                meeting_id=42,
                meeting_time=meeting_time,
            )

        # Check first call (24h reminder)
        call_kwargs = mock_schedule.call_args_list[0][1]
        assert call_kwargs["meeting_id"] == 42
        assert call_kwargs["reminder_type"] == "reminder_24h"
        assert "run_at" in call_kwargs
        # Should NOT have old-style kwargs
        assert "user_ids" not in call_kwargs
        assert "context" not in call_kwargs
        assert "channel_id" not in call_kwargs
        assert "job_id" not in call_kwargs

    def test_calculates_correct_run_times(self):
        """Should calculate run times relative to meeting time using REMINDER_CONFIG."""
        from core.notifications.actions import schedule_meeting_reminders
        from core.notifications.scheduler import REMINDER_CONFIG

        mock_schedule = MagicMock()
        meeting_time = datetime(2026, 2, 10, 17, 0, tzinfo=ZoneInfo("UTC"))

        with patch("core.notifications.actions.schedule_reminder", mock_schedule):
            schedule_meeting_reminders(
                meeting_id=42,
                meeting_time=meeting_time,
            )

        # Extract run_at times
        run_times = {
            call[1]["reminder_type"]: call[1]["run_at"]
            for call in mock_schedule.call_args_list
        }

        # Verify each reminder type uses the correct offset from REMINDER_CONFIG
        for reminder_type, config in REMINDER_CONFIG.items():
            expected_time = meeting_time + config["offset"]
            assert run_times[reminder_type] == expected_time, (
                f"{reminder_type} should be at {expected_time}, got {run_times[reminder_type]}"
            )


class TestRescheduleMeetingReminders:
    """Test reschedule_meeting_reminders()."""

    def test_cancels_and_reschedules(self):
        """Should cancel existing reminders and schedule new ones."""
        from core.notifications.actions import reschedule_meeting_reminders

        mock_cancel = MagicMock(return_value=3)
        mock_schedule = MagicMock()
        new_time = datetime.now(ZoneInfo("UTC")) + timedelta(days=7)

        with (
            patch("core.notifications.actions.cancel_reminders", mock_cancel),
            patch("core.notifications.actions.schedule_reminder", mock_schedule),
        ):
            reschedule_meeting_reminders(
                meeting_id=42,
                new_meeting_time=new_time,
            )

        # Should cancel existing
        mock_cancel.assert_called_once_with("meeting_42_*")
        # Should schedule 3 new
        assert mock_schedule.call_count == 3
