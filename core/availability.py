"""
Availability format conversion utilities.

Handles conversion between:
- JSON format: {"Monday": ["08:00-08:30", "08:30-09:00"], ...}
- Scheduler format: "M08:00 M09:00, T14:00 T15:00"
- Interval tuples: [(480, 540), (840, 900)]
"""

import json
from typing import Optional

import cohort_scheduler

from .constants import DAY_CODES


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
) -> list[tuple[int, int]]:
    """
    Convert JSON availability string to scheduler interval tuples.

    Args:
        json_str: JSON string like '{"Monday": ["08:00-08:30", "08:30-09:00"], ...}'
                  Also handles legacy format '{"Monday": ["08:00", "08:30"], ...}'

    Returns:
        List of (start_minutes, end_minutes) tuples for the scheduler.
        Minutes are counted from start of week (Monday 00:00 = 0).
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

        day_code = DAY_CODES.get(day, day[0].upper())

        # Merge adjacent slots for efficiency
        merged = merge_adjacent_slots(slots)

        for start, end in merged:
            interval_strs.append(f"{day_code}{start} {day_code}{end}")

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
