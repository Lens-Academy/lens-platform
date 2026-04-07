# core/discord_mcp/send.py
"""Send messages to Discord channels via webhooks."""

import logging

import discord

from core.database import get_connection, get_transaction
from .tables import channels

logger = logging.getLogger(__name__)


async def _get_or_create_webhook(
    channel: discord.TextChannel,
    bot: discord.Client,
) -> discord.Webhook:
    """
    Get cached webhook for a channel, or create one.

    Caches webhook_id and webhook_token in discord.channels table.
    """
    from sqlalchemy import select, update

    # Check DB cache first
    async with get_connection() as conn:
        row = (
            (
                await conn.execute(
                    select(channels.c.webhook_id, channels.c.webhook_token).where(
                        channels.c.id == channel.id
                    )
                )
            )
            .mappings()
            .first()
        )

    if row and row["webhook_id"] and row["webhook_token"]:
        url = f"https://discord.com/api/webhooks/{row['webhook_id']}/{row['webhook_token']}"
        return discord.Webhook.from_url(url, client=bot)

    # Create new webhook
    webhook = await channel.create_webhook(name="Lens MCP")
    logger.info(f"Created webhook for #{channel.name}")

    # Cache in DB
    async with get_transaction() as conn:
        await conn.execute(
            update(channels)
            .where(channels.c.id == channel.id)
            .values(webhook_id=webhook.id, webhook_token=webhook.token)
        )

    return webhook


async def send_message(
    bot: discord.Client,
    guild_id: int,
    channel_identifier: str,
    content: str,
    display_name: str | None = None,
) -> dict:
    """
    Send a message to a Discord channel via webhook.

    Args:
        bot: Discord bot instance.
        guild_id: Guild ID.
        channel_identifier: Channel name or ID.
        content: Message content.
        display_name: Custom webhook display name. If None, uses "Lens MCP".

    Returns:
        Dict with message id and channel info.
    """
    guild = bot.get_guild(guild_id)
    if not guild:
        return {"error": f"Guild {guild_id} not found"}

    # Resolve channel by name or ID
    channel = None
    try:
        channel_id = int(channel_identifier)
        channel = guild.get_channel(channel_id)
    except ValueError:
        # Search by name
        for ch in guild.text_channels:
            if ch.name.lower() == channel_identifier.lower():
                channel = ch
                break

    if not channel:
        return {"error": f"Channel '{channel_identifier}' not found"}

    if not isinstance(channel, discord.TextChannel):
        return {"error": f"Channel '{channel_identifier}' is not a text channel"}

    webhook = await _get_or_create_webhook(channel, bot)

    try:
        msg = await webhook.send(
            content=content,
            username=display_name or "Lens MCP",
            wait=True,
        )
    except discord.NotFound:
        # Cached webhook was deleted — clear cache and retry once
        from sqlalchemy import update

        async with get_transaction() as conn:
            await conn.execute(
                update(channels)
                .where(channels.c.id == channel.id)
                .values(webhook_id=None, webhook_token=None)
            )
        webhook = await _get_or_create_webhook(channel, bot)
        msg = await webhook.send(
            content=content,
            username=display_name or "Lens MCP",
            wait=True,
        )

    return {
        "message_id": msg.id,
        "channel_id": channel.id,
        "channel_name": channel.name,
    }
