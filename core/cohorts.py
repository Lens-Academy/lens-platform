"""
Cohort creation and availability matching.
"""

import json
from datetime import datetime
from typing import Optional
import pytz

from .database import get_connection
from .queries import users as user_queries
from .timezone import utc_to_local_time


async def find_availability_overlap(
    member_ids: list[str],
) -> Optional[tuple[str, int]]:
    """
    Find a 1-hour slot where all members are available.

    Args:
        member_ids: List of Discord user ID strings

    Returns:
        (day_name, hour) in UTC or None if no overlap found.
        Prefers fully available slots over if-needed slots.
    """
    # Batch fetch all users from database
    async with get_connection() as conn:
        users = await user_queries.get_users_by_discord_ids(conn, member_ids)

    # Build lookup by discord_id
    user_by_id = {u["discord_id"]: u for u in users}

    # Collect all availability
    all_available = {}  # {(day, hour): [user_ids who are available]}
    all_if_needed = {}  # {(day, hour): [user_ids who marked if-needed]}

    for member_id in member_ids:
        user = user_by_id.get(member_id)
        if not user:
            continue

        # Parse availability from JSON strings
        availability_str = user.get("availability_utc")
        if_needed_str = user.get("if_needed_availability_utc")

        availability = json.loads(availability_str) if availability_str else {}
        if_needed = json.loads(if_needed_str) if if_needed_str else {}

        for day, slots in availability.items():
            for slot in slots:
                hour = int(slot.split(":")[0])
                key = (day, hour)
                if key not in all_available:
                    all_available[key] = []
                all_available[key].append(member_id)

        for day, slots in if_needed.items():
            for slot in slots:
                hour = int(slot.split(":")[0])
                key = (day, hour)
                if key not in all_if_needed:
                    all_if_needed[key] = []
                all_if_needed[key].append(member_id)

    member_id_set = set(member_ids)

    # First pass: look for slots where everyone is fully available
    for (day, hour), user_ids in all_available.items():
        if set(user_ids) == member_id_set:
            return (day, hour)

    # Second pass: look for slots where everyone is available or if-needed
    for (day, hour) in all_available.keys() | all_if_needed.keys():
        available_ids = set(all_available.get((day, hour), []))
        if_needed_ids = set(all_if_needed.get((day, hour), []))
        combined = available_ids | if_needed_ids

        if combined == member_id_set:
            return (day, hour)

    return None


def format_local_time(day: str, hour: int, tz_name: str) -> tuple[str, str]:
    """
    Convert UTC day/hour to local time string.

    Args:
        day: Day name in UTC (e.g., "Monday")
        hour: Hour in UTC (0-23)
        tz_name: Timezone string (e.g., "America/New_York")

    Returns:
        (local_day_name, formatted_time_string)
        e.g., ("Wednesday", "Wednesdays 3:00-4:00pm EST")
    """
    local_day, local_hour = utc_to_local_time(day, hour, tz_name)

    # Format hour as 12-hour time
    if local_hour == 0:
        start = "12:00am"
        end = "1:00am"
    elif local_hour < 12:
        start = f"{local_hour}:00am"
        end = f"{local_hour + 1}:00am" if local_hour + 1 < 12 else "12:00pm"
    elif local_hour == 12:
        start = "12:00pm"
        end = "1:00pm"
    else:
        start = f"{local_hour - 12}:00pm"
        end_hour = local_hour + 1
        if end_hour == 24:
            end = "12:00am"
        elif end_hour > 12:
            end = f"{end_hour - 12}:00pm"
        else:
            end = f"{end_hour}:00am"

    time_str = f"{start[:-2]}-{end}"

    # Get timezone abbreviation
    try:
        tz = pytz.timezone(tz_name)
        now = datetime.now(pytz.UTC)
        abbrev = now.astimezone(tz).strftime('%Z')
    except:
        abbrev = tz_name

    return (local_day, f"{local_day}s {time_str} {abbrev}")


def get_timezone_abbrev(tz_name: str) -> str:
    """
    Get the current timezone abbreviation for a timezone.

    Args:
        tz_name: Timezone string (e.g., "America/New_York")

    Returns:
        Timezone abbreviation (e.g., "EST", "EDT")
    """
    try:
        tz = pytz.timezone(tz_name)
        now = datetime.now(pytz.UTC)
        return now.astimezone(tz).strftime('%Z')
    except:
        return tz_name
