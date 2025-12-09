"""
Nickname sync - re-exports Discord nickname update for web API.

Actual logic lives in discord_bot/cogs/nickname_cog.py.
This module exists so web_api imports from core (not discord_bot directly).

NOTE: Discord.py's load_extension() creates a NEW module instance (for reload support),
so we can't import the function at module load time. Instead, we access the bot's
loaded extension at call time via sys.modules.
"""

import sys


async def update_nickname_in_discord(discord_id: str, nickname: str | None) -> bool:
    """
    Update user's nickname in Discord. Delegates to the bot's loaded nickname_cog.

    Must be called after the bot has loaded its extensions.
    """
    # Access the module that discord.py's load_extension() created
    # This is the one with _bot set, not our import-time copy
    module = sys.modules.get("discord_bot.cogs.nickname_cog")
    if module is None:
        print("[nickname_sync] Module not loaded yet")
        return False

    return await module.update_nickname_in_discord(discord_id, nickname)


__all__ = ["update_nickname_in_discord"]
