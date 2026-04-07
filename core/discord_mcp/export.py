"""Backfill Discord message history into the database."""

import logging
from datetime import datetime

import discord

from .sync import upsert_channel, upsert_messages, update_channel_synced_at
from core.database import get_connection

logger = logging.getLogger(__name__)

# Batch size for DB inserts
BATCH_SIZE = 100


def _message_to_dict(msg: discord.Message) -> dict:
    """Convert a discord.Message to a plain dict for upsert."""
    return {
        "id": msg.id,
        "channel_id": msg.channel.id,
        "thread_id": msg.channel.id if isinstance(msg.channel, discord.Thread) else None,
        "author_id": msg.author.id,
        "author_name": msg.author.display_name,
        "content": msg.content or "",
        "created_at": msg.created_at,
        "edited_at": msg.edited_at,
        "reference_id": msg.reference.message_id if msg.reference else None,
        "metadata": {
            "attachments": [
                {"url": a.url, "filename": a.filename} for a in msg.attachments
            ],
            "embeds": [e.to_dict() for e in msg.embeds],
        }
        if msg.attachments or msg.embeds
        else None,
    }


async def _get_last_synced_at(channel_id: int) -> datetime | None:
    """Get the created_at of the most recent synced message for a channel."""
    from sqlalchemy import select, func
    from .tables import messages

    async with get_connection() as conn:
        result = await conn.execute(
            select(func.max(messages.c.created_at)).where(
                messages.c.channel_id == channel_id
            )
        )
        return result.scalar()


async def sync_channel(
    channel: discord.TextChannel | discord.ForumChannel | discord.Thread,
    guild_id: int,
) -> int:
    """
    Sync a single channel's message history to the database.

    Resumes from the last synced message. Returns count of new messages inserted.
    """
    # Upsert channel metadata
    parent_id = None
    if isinstance(channel, discord.Thread):
        parent_id = channel.parent_id
    elif channel.category:
        parent_id = channel.category_id

    await upsert_channel(
        id=channel.id,
        guild_id=guild_id,
        name=channel.name,
        type=_channel_type_str(channel),
        parent_id=parent_id,
        topic=getattr(channel, "topic", None),
    )

    # Find where to resume
    last_synced = await _get_last_synced_at(channel.id)
    after = last_synced if last_synced else None

    total = 0
    batch: list[dict] = []

    try:
        async for msg in channel.history(
            limit=None, oldest_first=True, after=after
        ):
            batch.append(_message_to_dict(msg))

            if len(batch) >= BATCH_SIZE:
                count = await upsert_messages(batch)
                total += count
                batch = []

        # Flush remaining
        if batch:
            count = await upsert_messages(batch)
            total += count

        await update_channel_synced_at(channel.id)

    except discord.Forbidden:
        logger.warning(f"No access to channel #{channel.name} ({channel.id}), skipping")
    except Exception as e:
        logger.error(f"Error syncing channel #{channel.name}: {e}")

    return total


async def sync_guild(bot: discord.Client, guild_id: int) -> dict:
    """
    Sync all text channels, forum channels, and threads in a guild.

    Returns dict with total messages synced and channel count.
    """
    guild = bot.get_guild(guild_id)
    if not guild:
        try:
            guild = await bot.fetch_guild(guild_id)
        except discord.NotFound:
            return {"error": f"Guild {guild_id} not found"}

    total_messages = 0
    channel_count = 0

    # Text channels
    for channel in guild.text_channels:
        count = await sync_channel(channel, guild_id)
        total_messages += count
        channel_count += 1
        if count > 0:
            logger.info(f"  #{channel.name}: {count} new messages")

    # Forum channels
    for forum in guild.forums:
        # Sync the forum itself (metadata only)
        await upsert_channel(
            id=forum.id,
            guild_id=guild_id,
            name=forum.name,
            type="forum",
            parent_id=forum.category_id,
            topic=forum.topic,
        )
        channel_count += 1

        # Sync each thread (active + archived)
        threads = list(forum.threads)
        try:
            async for thread in forum.archived_threads(limit=None):
                threads.append(thread)
        except discord.Forbidden:
            logger.warning(f"No access to archived threads in #{forum.name}")

        for thread in threads:
            count = await sync_channel(thread, guild_id)
            total_messages += count
            channel_count += 1
            if count > 0:
                logger.info(f"  #{forum.name}/{thread.name}: {count} new messages")

    # Active threads in text channels
    try:
        active_threads = await guild.active_threads()
        for thread in active_threads:
            # Skip forum threads (already handled above)
            if isinstance(thread.parent, discord.ForumChannel):
                continue
            count = await sync_channel(thread, guild_id)
            total_messages += count
            channel_count += 1
            if count > 0:
                logger.info(f"  Thread {thread.name}: {count} new messages")
    except discord.Forbidden:
        logger.warning("No access to fetch active threads")

    logger.info(
        f"Guild sync complete: {total_messages} messages across {channel_count} channels"
    )
    return {"messages_synced": total_messages, "channels": channel_count}


async def run_backfill() -> dict | None:
    """
    Top-level backfill entry point for APScheduler.

    Gets bot and guild_id from environment/singletons.
    Must be a module-level function so APScheduler can serialize the reference.
    """
    import os
    from core.discord_outbound import get_bot

    bot = get_bot()
    if not bot or not bot.is_ready():
        logger.warning("Bot not ready, skipping backfill")
        return None

    guild_id = os.environ.get("DISCORD_SERVER_ID")
    if not guild_id:
        logger.warning("DISCORD_SERVER_ID not set, skipping backfill")
        return None

    return await sync_guild(bot, int(guild_id))


def _channel_type_str(
    channel: discord.TextChannel | discord.ForumChannel | discord.Thread,
) -> str:
    """Get a string type for a channel."""
    if isinstance(channel, discord.Thread):
        return "thread"
    if isinstance(channel, discord.ForumChannel):
        return "forum"
    return "text"
