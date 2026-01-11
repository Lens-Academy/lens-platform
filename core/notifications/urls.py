"""URL builder utilities for notification templates."""

import os

from core.config import get_frontend_url


DISCORD_SERVER_ID = os.environ.get("DISCORD_SERVER_ID", "")


def build_lesson_url(lesson_id: str) -> str:
    """Build URL to a lesson page."""
    base = get_frontend_url()
    return f"{base}/lesson/{lesson_id}"


def build_profile_url() -> str:
    """Build URL to user profile/signup page."""
    base = get_frontend_url()
    return f"{base}/signup"


def build_discord_channel_url(server_id: str | None = None, channel_id: str = "") -> str:
    """
    Build URL to a Discord channel.

    Args:
        server_id: Discord server ID (uses env var if not provided)
        channel_id: Discord channel ID
    """
    sid = server_id or DISCORD_SERVER_ID
    return f"https://discord.com/channels/{sid}/{channel_id}"
