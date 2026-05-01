"""Tests for parsing meeting duration from recurring_meeting_time_utc strings.

The string format is produced by cohort_scheduler.format_time_range, e.g.
"Monday 09:00 - 10:00" or "Monday 23:00 - Tuesday 01:00".
"""

import pytest

from core.scheduling import parse_meeting_duration_minutes


@pytest.mark.parametrize(
    "s,expected",
    [
        ("Monday 09:00 - 10:00", 60),
        ("Wednesday 14:00 - 15:30", 90),
        ("Friday 09:00 - 11:00", 120),
        ("Tuesday 10:00 - 10:30", 30),
        ("Monday 23:00 - Tuesday 01:00", 120),  # overnight
        ("Sunday 23:30 - Monday 00:30", 60),  # week wrap
    ],
)
def test_parses_durations(s, expected):
    assert parse_meeting_duration_minutes(s) == expected


@pytest.mark.parametrize("s", [None, "", "TBD"])
def test_falls_back_to_default(s):
    assert parse_meeting_duration_minutes(s) == 60


@pytest.mark.parametrize(
    "s",
    [
        "not a meeting time",
        "Funday 09:00 - 10:00",  # invalid day
        "Monday 25:00 - 26:00",  # invalid hour
        "Monday 09:00",  # missing range
    ],
)
def test_malformed_raises(s):
    with pytest.raises(ValueError):
        parse_meeting_duration_minutes(s)
