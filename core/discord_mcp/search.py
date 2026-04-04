"""Keyword search over Discord messages using PostgreSQL tsvector."""

from sqlalchemy import func, select

from core.database import get_connection
from .tables import channels, messages


async def search_keyword(
    query: str,
    *,
    channel: str | None = None,
    limit: int = 10,
) -> list[dict]:
    """
    Full-text search over discord.messages using tsvector/tsquery.

    Args:
        query: Search query (natural language, converted to tsquery).
        channel: Optional channel name (or ID) to filter by.
        limit: Max results to return.

    Returns:
        List of message dicts with author_name, channel_name, content, etc.
        Ordered by relevance (ts_rank_cd).
    """
    ts_query = func.plainto_tsquery("english", query)

    stmt = (
        select(
            messages.c.id,
            messages.c.channel_id,
            channels.c.name.label("channel_name"),
            messages.c.thread_id,
            messages.c.author_id,
            messages.c.author_name,
            messages.c.content,
            messages.c.created_at,
            messages.c.edited_at,
            messages.c.reference_id,
            func.ts_rank_cd(messages.c.search_vector, ts_query).label("rank"),
        )
        .select_from(messages.join(channels, messages.c.channel_id == channels.c.id))
        .where(messages.c.search_vector.op("@@")(ts_query))
        .order_by(func.ts_rank_cd(messages.c.search_vector, ts_query).desc())
        .limit(limit)
    )

    if channel:
        try:
            channel_id = int(channel)
            stmt = stmt.where(channels.c.id == channel_id)
        except ValueError:
            stmt = stmt.where(func.lower(channels.c.name) == channel.lower())

    async with get_connection() as conn:
        result = await conn.execute(stmt)
        rows = result.mappings().all()

    return [
        {
            "id": row["id"],
            "channel_id": row["channel_id"],
            "channel_name": row["channel_name"],
            "thread_id": row["thread_id"],
            "author_id": row["author_id"],
            "author_name": row["author_name"],
            "content": row["content"],
            "created_at": row["created_at"].isoformat(),
            "edited_at": row["edited_at"].isoformat() if row["edited_at"] else None,
            "reference_id": row["reference_id"],
        }
        for row in rows
    ]
