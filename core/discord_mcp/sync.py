"""Insert/upsert Discord messages and channels into the database."""

from datetime import datetime, timezone

from sqlalchemy.dialects.postgresql import insert

from core.database import get_transaction
from .tables import channels, messages


async def upsert_channel(
    *,
    id: int,
    guild_id: int,
    name: str,
    type: str,
    parent_id: int | None = None,
    topic: str | None = None,
) -> None:
    """Insert or update a channel in discord.channels."""
    stmt = insert(channels).values(
        id=id,
        guild_id=guild_id,
        name=name,
        type=type,
        parent_id=parent_id,
        topic=topic,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=[channels.c.id],
        set_={
            "name": stmt.excluded.name,
            "type": stmt.excluded.type,
            "parent_id": stmt.excluded.parent_id,
            "topic": stmt.excluded.topic,
        },
    )
    async with get_transaction() as conn:
        await conn.execute(stmt)


async def upsert_messages(msg_list: list[dict]) -> int:
    """
    Bulk insert/upsert messages into discord.messages.

    Each dict must have: id, channel_id, author_id, author_name, content, created_at.
    Optional: thread_id, edited_at, reference_id, metadata.

    Returns the number of rows upserted.
    """
    if not msg_list:
        return 0

    rows = []
    for m in msg_list:
        rows.append(
            {
                "id": m["id"],
                "channel_id": m["channel_id"],
                "thread_id": m.get("thread_id"),
                "author_id": m["author_id"],
                "author_name": m["author_name"],
                "content": m.get("content", ""),
                "created_at": m["created_at"],
                "edited_at": m.get("edited_at"),
                "reference_id": m.get("reference_id"),
                "metadata": m.get("metadata"),
            }
        )

    stmt = insert(messages).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=[messages.c.id],
        set_={
            "content": stmt.excluded.content,
            "edited_at": stmt.excluded.edited_at,
            "author_name": stmt.excluded.author_name,
            "metadata": stmt.excluded.metadata,
        },
    )
    async with get_transaction() as conn:
        await conn.execute(stmt)

    return len(rows)


async def update_channel_synced_at(channel_id: int) -> None:
    """Mark a channel as synced now."""
    from sqlalchemy import update

    async with get_transaction() as conn:
        await conn.execute(
            update(channels)
            .where(channels.c.id == channel_id)
            .values(synced_at=datetime.now(timezone.utc))
        )
