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
