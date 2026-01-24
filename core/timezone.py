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
    tz = pytz.timezone(user_tz_str)

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
    tz = pytz.timezone(user_tz_str)

    # Map day to date (Jan 1, 2024 is Monday)
    day_index = DAY_NAMES.index(day_name)

    # Create UTC datetime
    utc_dt = pytz.UTC.localize(datetime(2024, 1, 1 + day_index, hour, 0))

    # Convert to local
    local_dt = utc_dt.astimezone(tz)

    return (DAY_NAMES[local_dt.weekday()], local_dt.hour)


def format_datetime_in_timezone(
    utc_dt: datetime,
    tz_name: str,
) -> str:
    """
    Format a UTC datetime in the user's local timezone with explicit offset.

    Args:
        utc_dt: Datetime in UTC (naive datetimes treated as UTC)
        tz_name: Timezone string (e.g., "America/New_York")

    Returns:
        Formatted string like "Wednesday at 3:00 PM (UTC-5)"
    """
    # Ensure datetime is timezone-aware (treat naive as UTC)
    if utc_dt.tzinfo is None:
        utc_dt = pytz.UTC.localize(utc_dt)

    # Try to convert to user timezone, fall back to UTC
    try:
        tz = pytz.timezone(tz_name)
        local_dt = utc_dt.astimezone(tz)
    except pytz.UnknownTimeZoneError:
        local_dt = utc_dt.astimezone(pytz.UTC)

    # Format the time
    day_name = local_dt.strftime("%A")
    time_str = local_dt.strftime("%I:%M %p").lstrip("0")  # "3:00 PM" not "03:00 PM"

    # Get UTC offset string (e.g., "UTC+7" or "UTC-5")
    offset = local_dt.strftime("%z")  # "+0700" or "-0500"
    if offset:
        hours = int(offset[:3])
        minutes = int(offset[0] + offset[3:5])
        if minutes == 0:
            offset_str = f"UTC{hours:+d}" if hours != 0 else "UTC"
        else:
            offset_str = f"UTC{hours:+d}:{abs(minutes):02d}"
    else:
        offset_str = "UTC"

    return f"{day_name} at {time_str} ({offset_str})"


def format_date_in_timezone(
    utc_dt: datetime,
    tz_name: str,
) -> str:
    """
    Format a UTC datetime as just a date in the user's local timezone.

    Args:
        utc_dt: Datetime in UTC (naive datetimes treated as UTC)
        tz_name: Timezone string (e.g., "America/New_York")

    Returns:
        Formatted string like "Wednesday, January 10"
    """
    # Ensure datetime is timezone-aware (treat naive as UTC)
    if utc_dt.tzinfo is None:
        utc_dt = pytz.UTC.localize(utc_dt)

    # Try to convert to user timezone, fall back to UTC
    try:
        tz = pytz.timezone(tz_name)
        local_dt = utc_dt.astimezone(tz)
    except pytz.UnknownTimeZoneError:
        local_dt = utc_dt.astimezone(pytz.UTC)

    return local_dt.strftime("%A, %B %d").replace(
        " 0", " "
    )  # "January 9" not "January 09"
