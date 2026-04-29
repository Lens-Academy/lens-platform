"""
Timezone conversion utilities.
"""

from datetime import datetime, timedelta
import pytz

from .constants import DAY_NAMES


_DAY_LOOKUP: dict[str, str] = {}
for _d in DAY_NAMES:
    _DAY_LOOKUP[_d.lower()] = _d
    _DAY_LOOKUP[_d[:3].lower()] = _d
_FILLER_TOKENS = {"at", "utc", "-"}


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


def parse_recurring_meeting_time(s: str | None) -> tuple[str, int, int] | None:
    """
    Parse a recurring meeting time string into (day_name, hour, minute).

    Accepts a variety of forms: "Wednesday 15:00", "Wed 15:00",
    "wednesday 15:00", "Wednesday at 15:00", "Wednesday 15:00 UTC",
    "Wednesday 15:00-16:00" (range tail dropped). Returns None for
    unparseable inputs ("TBD", "Wednesday 3pm", missing day, etc.).
    """
    if not s:
        return None
    tokens = [t for t in s.split() if t.lower() not in _FILLER_TOKENS]

    day_name: str | None = None
    hour: int | None = None
    minute: int | None = None

    for tok in tokens:
        if day_name is None:
            mapped = _DAY_LOOKUP.get(tok.lower())
            if mapped is not None:
                day_name = mapped
                continue
        if hour is None and ":" in tok:
            time_part = tok.split("-")[0]  # "15:00-16:30" -> "15:00"
            try:
                hour_str, minute_str = time_part.split(":", 1)
                h = int(hour_str)
                m = int(minute_str)
            except ValueError:
                continue
            if 0 <= h < 24 and 0 <= m < 60:
                hour = h
                minute = m

    if day_name is None or hour is None:
        return None
    return (day_name, hour, minute or 0)


def _format_offset(local_dt: datetime) -> str:
    """Format the UTC-offset suffix, e.g. 'UTC+7' or 'UTC-5:30' or 'UTC'."""
    offset = local_dt.strftime("%z")  # "+0700" or "-0500"
    if not offset:
        return "UTC"
    hours = int(offset[:3])
    minutes = int(offset[0] + offset[3:5])
    if minutes == 0:
        return f"UTC{hours:+d}" if hours != 0 else "UTC"
    return f"UTC{hours:+d}:{abs(minutes):02d}"


def format_recurring_time_in_timezone(
    day_name: str,
    hour: int,
    minute: int,
    tz_name: str,
    reference_dt: datetime | None = None,
) -> str:
    """
    Format a recurring weekly meeting slot in the user's local timezone.

    Returns e.g. "Wednesday at 10:00 PM (UTC+7)". Falls back to UTC on
    unknown timezone.

    `reference_dt` anchors the offset computation, which matters for DST:
    a recurring "15:00 UTC" slot maps to UTC-5 in NY in January but UTC-4
    in July. Defaults to `datetime.now(UTC)` so the offset is correct for
    the immediate horizon. For perfect correctness across DST boundaries,
    pass the actual upcoming meeting datetime.
    """
    try:
        tz = pytz.timezone(tz_name)
    except pytz.UnknownTimeZoneError:
        tz = pytz.UTC

    if reference_dt is None:
        reference_dt = datetime.now(pytz.UTC)
    elif reference_dt.tzinfo is None:
        reference_dt = pytz.UTC.localize(reference_dt)
    else:
        reference_dt = reference_dt.astimezone(pytz.UTC)

    day_index = DAY_NAMES.index(day_name)
    days_ahead = (day_index - reference_dt.weekday()) % 7
    candidate = reference_dt.replace(
        hour=hour, minute=minute, second=0, microsecond=0
    ) + timedelta(days=days_ahead)
    if candidate <= reference_dt:
        candidate += timedelta(days=7)

    local_dt = candidate.astimezone(tz)
    local_day = local_dt.strftime("%A")
    time_str = local_dt.strftime("%I:%M %p").lstrip("0")
    offset_str = _format_offset(local_dt)
    return f"{local_day} at {time_str} ({offset_str})"


def format_recurring_time_utc(day_name: str, hour: int, minute: int) -> str:
    """
    Format a recurring weekly meeting slot in 24h UTC.

    Returns e.g. "Wednesday at 15:00 UTC". Used as fallback when the user
    has no timezone configured.
    """
    return f"{day_name} at {hour:02d}:{minute:02d} UTC"


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
