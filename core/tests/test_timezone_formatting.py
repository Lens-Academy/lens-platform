"""Tests for timezone formatting utilities."""

from datetime import datetime
from zoneinfo import ZoneInfo


class TestFormatDatetimeInTimezone:
    def test_formats_in_user_timezone_with_offset(self):
        """Meeting at Wed 15:00 UTC should show as Wed 10:00 PM (UTC+7) in Bangkok."""
        from core.timezone import format_datetime_in_timezone

        utc_dt = datetime(2024, 1, 10, 15, 0, tzinfo=ZoneInfo("UTC"))  # Wed 15:00 UTC
        result = format_datetime_in_timezone(utc_dt, "Asia/Bangkok")

        assert "Wednesday" in result
        assert "10:00 PM" in result
        assert "(UTC+7)" in result

    def test_formats_date_correctly_when_day_changes(self):
        """Meeting at Wed 01:00 UTC should show as Tue in PST (day changes)."""
        from core.timezone import format_datetime_in_timezone

        utc_dt = datetime(2024, 1, 10, 1, 0, tzinfo=ZoneInfo("UTC"))  # Wed 01:00 UTC
        result = format_datetime_in_timezone(utc_dt, "America/Los_Angeles")

        assert "Tuesday" in result  # Day changed due to -8 offset
        assert "(UTC-8)" in result

    def test_falls_back_to_utc_for_invalid_timezone(self):
        """Invalid timezone should fall back to UTC."""
        from core.timezone import format_datetime_in_timezone

        utc_dt = datetime(2024, 1, 10, 15, 0, tzinfo=ZoneInfo("UTC"))
        result = format_datetime_in_timezone(utc_dt, "Invalid/Timezone")

        assert "Wednesday" in result
        assert "3:00 PM" in result
        assert "(UTC)" in result

    def test_formats_naive_datetime_as_utc(self):
        """Naive datetime should be treated as UTC."""
        from core.timezone import format_datetime_in_timezone

        naive_dt = datetime(2024, 1, 10, 15, 0)  # No timezone
        result = format_datetime_in_timezone(naive_dt, "Asia/Tokyo")

        assert "Thursday" in result  # +9 hours from Wed 15:00 = Thu 00:00
        assert "(UTC+9)" in result


class TestFormatDateInTimezone:
    def test_formats_date_only(self):
        """Should format just the date portion."""
        from core.timezone import format_date_in_timezone

        utc_dt = datetime(2024, 1, 10, 15, 0, tzinfo=ZoneInfo("UTC"))
        result = format_date_in_timezone(utc_dt, "America/New_York")

        assert "Wednesday" in result
        assert "January 10" in result
        # No time component
        assert ":" not in result

    def test_date_changes_with_timezone(self):
        """Date should change when timezone crosses midnight."""
        from core.timezone import format_date_in_timezone

        # Wed Jan 10 at 01:00 UTC = Tue Jan 9 in LA
        utc_dt = datetime(2024, 1, 10, 1, 0, tzinfo=ZoneInfo("UTC"))
        result = format_date_in_timezone(utc_dt, "America/Los_Angeles")

        assert "Tuesday" in result
        assert "January 9" in result


class TestParseRecurringMeetingTime:
    def test_parses_basic_format(self):
        from core.timezone import parse_recurring_meeting_time

        assert parse_recurring_meeting_time("Wednesday 15:00") == ("Wednesday", 15, 0)

    def test_parses_with_minutes(self):
        from core.timezone import parse_recurring_meeting_time

        assert parse_recurring_meeting_time("Monday 09:30") == ("Monday", 9, 30)

    def test_parses_range_form(self):
        from core.timezone import parse_recurring_meeting_time

        assert parse_recurring_meeting_time("Wednesday 15:00-16:30") == (
            "Wednesday",
            15,
            0,
        )

    def test_parses_spaced_range(self):
        """'Wednesday 15:00 - 16:00' (spaced dash) should also work."""
        from core.timezone import parse_recurring_meeting_time

        assert parse_recurring_meeting_time("Wednesday 15:00 - 16:00") == (
            "Wednesday",
            15,
            0,
        )

    def test_parses_case_insensitive_day(self):
        from core.timezone import parse_recurring_meeting_time

        assert parse_recurring_meeting_time("wednesday 15:00") == ("Wednesday", 15, 0)
        assert parse_recurring_meeting_time("WEDNESDAY 15:00") == ("Wednesday", 15, 0)

    def test_parses_three_letter_abbreviation(self):
        from core.timezone import parse_recurring_meeting_time

        assert parse_recurring_meeting_time("Wed 15:00") == ("Wednesday", 15, 0)
        assert parse_recurring_meeting_time("wed 15:00") == ("Wednesday", 15, 0)
        assert parse_recurring_meeting_time("Mon 09:30") == ("Monday", 9, 30)

    def test_parses_with_at_connector(self):
        from core.timezone import parse_recurring_meeting_time

        assert parse_recurring_meeting_time("Wednesday at 15:00") == (
            "Wednesday",
            15,
            0,
        )

    def test_parses_with_utc_suffix(self):
        from core.timezone import parse_recurring_meeting_time

        assert parse_recurring_meeting_time("Wednesday 15:00 UTC") == (
            "Wednesday",
            15,
            0,
        )

    def test_returns_none_for_tbd(self):
        from core.timezone import parse_recurring_meeting_time

        assert parse_recurring_meeting_time("TBD") is None

    def test_returns_none_for_empty(self):
        from core.timezone import parse_recurring_meeting_time

        assert parse_recurring_meeting_time("") is None
        assert parse_recurring_meeting_time(None) is None

    def test_returns_none_for_garbage(self):
        from core.timezone import parse_recurring_meeting_time

        assert parse_recurring_meeting_time("not a time") is None
        assert parse_recurring_meeting_time("Wednesday") is None


class TestFormatRecurringTimeInTimezone:
    def test_formats_with_offset(self):
        """Wednesday 15:00 UTC -> Wednesday at 10:00 PM (UTC+7) in Bangkok."""
        from core.timezone import format_recurring_time_in_timezone

        result = format_recurring_time_in_timezone("Wednesday", 15, 0, "Asia/Bangkok")
        assert result == "Wednesday at 10:00 PM (UTC+7)"

    def test_day_shifts_when_timezone_crosses_midnight(self):
        """Wednesday 01:00 UTC = Tuesday 17:00 in LA -> Tuesday at 5:00 PM."""
        from core.timezone import format_recurring_time_in_timezone

        # Use a winter reference so LA is on PST (UTC-8)
        winter = datetime(2026, 1, 15, tzinfo=ZoneInfo("UTC"))
        result = format_recurring_time_in_timezone(
            "Wednesday", 1, 0, "America/Los_Angeles", reference_dt=winter
        )
        assert result == "Tuesday at 5:00 PM (UTC-8)"

    def test_preserves_minutes(self):
        from core.timezone import format_recurring_time_in_timezone

        winter = datetime(2026, 1, 15, tzinfo=ZoneInfo("UTC"))
        result = format_recurring_time_in_timezone(
            "Monday", 9, 30, "America/New_York", reference_dt=winter
        )
        assert result == "Monday at 4:30 AM (UTC-5)"

    def test_dst_summer_shows_correct_offset_in_us_east(self):
        """Reviewer #1: anchored to summer reference, NY is UTC-4 (EDT), not -5."""
        from core.timezone import format_recurring_time_in_timezone

        summer = datetime(2026, 7, 15, tzinfo=ZoneInfo("UTC"))
        result = format_recurring_time_in_timezone(
            "Wednesday", 15, 0, "America/New_York", reference_dt=summer
        )
        assert "(UTC-4)" in result
        assert "11:00 AM" in result

    def test_dst_winter_shows_standard_offset_in_us_east(self):
        from core.timezone import format_recurring_time_in_timezone

        winter = datetime(2026, 1, 15, tzinfo=ZoneInfo("UTC"))
        result = format_recurring_time_in_timezone(
            "Wednesday", 15, 0, "America/New_York", reference_dt=winter
        )
        assert "(UTC-5)" in result
        assert "10:00 AM" in result

    def test_utc_falls_back_with_marker(self):
        from core.timezone import format_recurring_time_in_timezone

        result = format_recurring_time_in_timezone("Wednesday", 15, 0, "UTC")
        assert result == "Wednesday at 3:00 PM (UTC)"

    def test_invalid_timezone_falls_back_to_utc(self):
        from core.timezone import format_recurring_time_in_timezone

        result = format_recurring_time_in_timezone(
            "Wednesday", 15, 0, "Invalid/Timezone"
        )
        assert result == "Wednesday at 3:00 PM (UTC)"


class TestFormatRecurringTimeUtc:
    def test_formats_in_24h_with_utc_marker(self):
        from core.timezone import format_recurring_time_utc

        assert format_recurring_time_utc("Wednesday", 15, 0) == (
            "Wednesday at 15:00 UTC"
        )

    def test_pads_minutes(self):
        from core.timezone import format_recurring_time_utc

        assert format_recurring_time_utc("Monday", 9, 5) == "Monday at 09:05 UTC"
