"""
Availability format conversion utilities.

Handles conversion between:
- JSON format: {"Monday": ["08:00-08:30", "08:30-09:00"], ...}
- Scheduler format: "M08:00 M09:00, T14:00 T15:00"
- Interval tuples: [(480, 540), (840, 900)]

Times are stored in user's local timezone and converted to UTC at scheduling time.
This ensures DST changes are handled correctly (user's "9am" stays 9am local).
"""

import json
from datetime import datetime, timedelta
from typing import Optional

import pytz
import cohort_scheduler

from .constants import DAY_CODES, DAY_NAMES


def get_dst_transitions(timezone_str: str, weeks_ahead: int = 12) -> list[datetime]:
    """
    Find DST transitions for a timezone in the next N weeks.

    Args:
        timezone_str: Timezone string (e.g., "America/New_York")
        weeks_ahead: How many weeks to look ahead (default 12)

    Returns:
        List of datetime objects when DST transitions occur
    """
    try:
        tz = pytz.timezone(timezone_str)
    except pytz.UnknownTimeZoneError:
        return []

    # Get transition times from pytz
    if not hasattr(tz, '_utc_transition_times') or not tz._utc_transition_times:
        return []  # No DST for this timezone

    now = datetime.now(pytz.UTC)
    end_date = now + timedelta(weeks=weeks_ahead)

    transitions = []
    for transition_time in tz._utc_transition_times:
        if transition_time is None:
            continue
        # Make timezone-aware
        transition_dt = pytz.UTC.localize(transition_time)
        if now <= transition_dt <= end_date:
            transitions.append(transition_dt)

    return transitions


def check_dst_warnings(
    timezones: list[str],
    weeks_ahead: int = 12,
) -> list[str]:
    """
    Check for upcoming DST transitions across multiple timezones.

    Args:
        timezones: List of timezone strings
        weeks_ahead: How many weeks to look ahead

    Returns:
        List of warning messages about DST transitions
    """
    warnings = []
    tz_transitions: dict[str, list[datetime]] = {}

    for tz_str in set(timezones):
        if not tz_str or tz_str == "UTC":
            continue
        transitions = get_dst_transitions(tz_str, weeks_ahead)
        if transitions:
            tz_transitions[tz_str] = transitions

    if not tz_transitions:
        return []

    # Group timezones by transition date
    date_to_timezones: dict[str, list[str]] = {}
    for tz_str, transitions in tz_transitions.items():
        for dt in transitions:
            date_str = dt.strftime("%B %d, %Y")
            if date_str not in date_to_timezones:
                date_to_timezones[date_str] = []
            date_to_timezones[date_str].append(tz_str)

    # Generate warnings
    for date_str, affected_tzs in sorted(date_to_timezones.items()):
        if len(affected_tzs) == 1:
            warnings.append(
                f"DST transition on {date_str} for {affected_tzs[0]}. "
                f"Meeting times will shift by 1 hour for users in this timezone."
            )
        else:
            tz_list = ", ".join(affected_tzs[:3])
            if len(affected_tzs) > 3:
                tz_list += f" and {len(affected_tzs) - 3} more"
            warnings.append(
                f"DST transition on {date_str} for {tz_list}. "
                f"Meeting times will shift by 1 hour for affected users."
            )

    return warnings

# Reverse mapping: day code -> day name
DAY_CODE_TO_NAME = {v: k for k, v in DAY_CODES.items()}


def local_time_to_utc(
    day_name: str,
    time_str: str,
    timezone_str: str,
) -> tuple[str, str]:
    """
    Convert a local day/time to UTC day/time.

    Args:
        day_name: Day name (e.g., "Monday")
        time_str: Time string "HH:MM" (e.g., "09:30")
        timezone_str: Timezone string (e.g., "America/New_York")

    Returns:
        Tuple of (utc_day_code, utc_time_str) e.g., ("M", "14:30")
    """
    try:
        tz = pytz.timezone(timezone_str)
    except pytz.UnknownTimeZoneError:
        tz = pytz.UTC

    # Parse time
    hour, minute = map(int, time_str.split(":"))

    # Map day to date (Jan 6, 2025 is Monday - using a recent date for accurate DST)
    day_index = DAY_NAMES.index(day_name)

    # Create local datetime
    local_dt = tz.localize(datetime(2025, 1, 6 + day_index, hour, minute))

    # Convert to UTC
    utc_dt = local_dt.astimezone(pytz.UTC)

    # Get UTC day and time
    utc_day_code = DAY_CODES[DAY_NAMES[utc_dt.weekday()]]
    utc_time_str = f"{utc_dt.hour:02d}:{utc_dt.minute:02d}"

    return (utc_day_code, utc_time_str)


def merge_adjacent_slots(slots: list[str]) -> list[tuple[str, str]]:
    """
    Merge adjacent time slots into continuous ranges.

    Args:
        slots: List of "HH:MM-HH:MM" strings (e.g., ["08:00-08:30", "08:30-09:00"])

    Returns:
        List of (start, end) tuples (e.g., [("08:00", "09:00")])
    """
    if not slots:
        return []

    # Parse slots into (start, end) tuples and sort by start time
    parsed = []
    for slot in slots:
        start, end = slot.split("-")
        parsed.append((start, end))

    parsed.sort(key=lambda x: x[0])

    # Merge adjacent slots
    merged = []
    current_start, current_end = parsed[0]

    for start, end in parsed[1:]:
        if start == current_end:
            # Adjacent - extend the current range
            current_end = end
        else:
            # Gap - save current range and start new one
            merged.append((current_start, current_end))
            current_start, current_end = start, end

    merged.append((current_start, current_end))
    return merged


def availability_json_to_intervals(
    json_str: Optional[str],
    timezone_str: str = "UTC",
) -> list[tuple[int, int]]:
    """
    Convert JSON availability string to scheduler interval tuples in UTC.

    Args:
        json_str: JSON string like '{"Monday": ["08:00-08:30", "08:30-09:00"], ...}'
        timezone_str: User's timezone (e.g., "America/New_York"). Times in json_str
                      are in this timezone and will be converted to UTC.

    Returns:
        List of (start_minutes, end_minutes) tuples for the scheduler.
        Minutes are counted from start of week (Monday 00:00 UTC = 0).
    """
    if not json_str:
        return []

    try:
        data = json.loads(json_str)
    except json.JSONDecodeError:
        return []

    interval_strs = []

    for day, slots in data.items():
        if not slots:
            continue

        # Merge adjacent slots in local time first
        merged = merge_adjacent_slots(slots)

        for start_local, end_local in merged:
            # Convert start and end times from local to UTC
            start_day_code, start_utc = local_time_to_utc(day, start_local, timezone_str)
            end_day_code, end_utc = local_time_to_utc(day, end_local, timezone_str)

            interval_strs.append(f"{start_day_code}{start_utc} {end_day_code}{end_utc}")

    if not interval_strs:
        return []

    return cohort_scheduler.parse_interval_string(", ".join(interval_strs))


def availability_json_to_interval_string(json_str: Optional[str]) -> str:
    """
    Convert JSON availability to scheduler interval string format.

    Args:
        json_str: JSON string like '{"Monday": ["08:00-08:30"], ...}'

    Returns:
        Interval string like "M08:00 M08:30, T14:00 T15:00"
    """
    if not json_str:
        return ""

    try:
        data = json.loads(json_str)
    except json.JSONDecodeError:
        return ""

    interval_strs = []

    for day, slots in data.items():
        if not slots:
            continue

        day_code = DAY_CODES.get(day, day[0].upper())
        merged = merge_adjacent_slots(slots)

        for start, end in merged:
            interval_strs.append(f"{day_code}{start} {day_code}{end}")

    return ", ".join(interval_strs)
