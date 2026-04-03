"""Voice attendance tracking — record check-ins from Discord voice joins.

Note: With the migration to Zoom, voice-based attendance via Discord is no
longer the primary path.  The record_voice_attendance function is retained for
backwards compatibility but meetings no longer store discord_voice_channel_id.
"""

import logging

logger = logging.getLogger(__name__)


async def record_voice_attendance(
    discord_id: str,
    voice_channel_id: str,
) -> dict | None:
    """
    Record attendance for a user joining a meeting voice channel.

    Note: With meetings moved to Zoom, this function is largely unused.
    Meetings no longer store discord_voice_channel_id, so this will
    always return None until a new attendance mechanism is implemented.

    Args:
        discord_id: The user's Discord ID (as string).
        voice_channel_id: The Discord voice channel ID (as string).

    Returns:
        None (no matching meetings since voice channel IDs are no longer stored).
    """
    return None
