"""
Timezone conversion utilities.
"""

from datetime import datetime
import pytz

from .constants import DAY_NAMES


def local_to_utc_time(day_name: str, hour: int, user_tz_str: str) -> tuple:
    """
    Convert local day/hour to UTC day/hour.

    Args:
        day_name: Name of the day (e.g., "Monday")
        hour: Hour in 24-hour format (0-23)
        user_tz_str: Timezone string (e.g., "America/New_York")

    Returns:
        Tuple of (utc_day_name, utc_hour)
    """
    try:
        tz = pytz.timezone(user_tz_str)
    except:
        tz = pytz.UTC

    # Map day to date (Jan 1, 2024 is Monday)
    day_index = DAY_NAMES.index(day_name)

    # Create local datetime
    local_dt = tz.localize(datetime(2024, 1, 1 + day_index, hour, 0))

    # Convert to UTC
    utc_dt = local_dt.astimezone(pytz.UTC)

    return (DAY_NAMES[utc_dt.weekday()], utc_dt.hour)


def utc_to_local_time(day_name: str, hour: int, user_tz_str: str) -> tuple:
    """
    Convert UTC day/hour to local day/hour.

    Args:
        day_name: Name of the day in UTC (e.g., "Monday")
        hour: Hour in 24-hour format (0-23) in UTC
        user_tz_str: Timezone string (e.g., "America/New_York")

    Returns:
        Tuple of (local_day_name, local_hour)
    """
    try:
        tz = pytz.timezone(user_tz_str)
    except:
        tz = pytz.UTC

    # Map day to date (Jan 1, 2024 is Monday)
    day_index = DAY_NAMES.index(day_name)

    # Create UTC datetime
    utc_dt = pytz.UTC.localize(datetime(2024, 1, 1 + day_index, hour, 0))

    # Convert to local
    local_dt = utc_dt.astimezone(tz)

    return (DAY_NAMES[local_dt.weekday()], local_dt.hour)
