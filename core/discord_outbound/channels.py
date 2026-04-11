# core/discord_outbound/channels.py
import discord


async def create_category(
    guild: discord.Guild,
    name: str,
) -> discord.CategoryChannel:
    """Create a Discord category channel."""
    overwrites = {
        guild.default_role: discord.PermissionOverwrite(view_channel=False),
        guild.me: discord.PermissionOverwrite(view_channel=True, manage_channels=True),
    }
    return await guild.create_category(name=name, overwrites=overwrites)


async def create_text_channel(
    category: discord.CategoryChannel,
    name: str,
) -> discord.TextChannel:
    """Create a text channel in a category."""
    return await category.create_text_channel(name=name)


async def create_voice_channel(
    category: discord.CategoryChannel,
    name: str,
) -> discord.VoiceChannel:
    """Create a voice channel in a category."""
    return await category.create_voice_channel(name=name)


async def get_or_fetch_channel(
    bot,
    channel_id: int,
) -> discord.abc.GuildChannel | None:
    """Get channel from cache or fetch from API."""
    channel = bot.get_channel(channel_id)
    if channel:
        return channel
    try:
        return await bot.fetch_channel(channel_id)
    except discord.NotFound:
        return None
