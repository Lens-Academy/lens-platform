"""
Shared constants used across the bot.
"""

# Day codes mapping for compact display
DAY_CODES = {
    "Monday": "M",
    "Tuesday": "T",
    "Wednesday": "W",
    "Thursday": "R",
    "Friday": "F",
    "Saturday": "S",
    "Sunday": "U"
}

# Day name list for ordering
DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

# Common timezones (max 25 for Discord select menu)
TIMEZONES = [
    # Americas
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Toronto",
    "America/Mexico_City",
    "America/Sao_Paulo",
    # Europe
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "Europe/Amsterdam",
    "Europe/Moscow",
    # Asia
    "Asia/Tokyo",
    "Asia/Shanghai",
    "Asia/Singapore",
    "Asia/Seoul",
    "Asia/Dubai",
    "Asia/Kolkata",
    # Pacific
    "Australia/Sydney",
    "Pacific/Auckland",
    "Pacific/Honolulu",
    # Africa
    "Africa/Cairo",
    "Africa/Johannesburg",
    # UTC
    "UTC"
]
