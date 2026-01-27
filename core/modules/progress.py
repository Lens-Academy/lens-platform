"""Progress tracking service.

Handles user progress through course content using UUID-based tracking.
Supports both authenticated users (user_id) and anonymous users (session_token).
"""

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select, update, and_, case
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncConnection

from core.tables import user_content_progress


async def get_or_create_progress(
    conn: AsyncConnection,
    *,
    user_id: int | None,
    session_token: UUID | None,
    content_id: UUID,
    content_type: str,
    content_title: str,
) -> dict:
    """Get existing progress record or create new one.

    Returns dict with: id, started_at, completed_at, time_to_complete_s, total_time_spent_s

    Uses INSERT ... ON CONFLICT to handle race conditions where two concurrent
    requests might both try to create a record for the same user/content.
    """
    # Build insert values
    insert_values = {
        "content_id": content_id,
        "content_type": content_type,
        "content_title": content_title,
    }

    if user_id is not None:
        insert_values["user_id"] = user_id
        # Use the partial unique index for authenticated users
        conflict_target = ["user_id", "content_id"]
        conflict_where = user_content_progress.c.user_id.isnot(None)
    elif session_token is not None:
        insert_values["session_token"] = session_token
        # Use the partial unique index for anonymous users
        conflict_target = ["session_token", "content_id"]
        conflict_where = user_content_progress.c.session_token.isnot(None)
    else:
        raise ValueError("Either user_id or session_token must be provided")

    # INSERT ... ON CONFLICT DO UPDATE (no-op update to return existing row)
    stmt = pg_insert(user_content_progress).values(**insert_values)
    stmt = stmt.on_conflict_do_update(
        index_elements=conflict_target,
        index_where=conflict_where,
        set_={"started_at": user_content_progress.c.started_at},  # No-op update
    ).returning(user_content_progress)

    result = await conn.execute(stmt)
    row = result.fetchone()
    await conn.commit()
    return dict(row._mapping)


async def mark_content_complete(
    conn: AsyncConnection,
    *,
    user_id: int | None,
    session_token: UUID | None,
    content_id: UUID,
    content_type: str,
    content_title: str,
    time_spent_s: int = 0,
) -> dict:
    """Mark content as complete, creating record if needed.

    Returns updated progress record.
    """
    # Get or create the record first
    progress = await get_or_create_progress(
        conn,
        user_id=user_id,
        session_token=session_token,
        content_id=content_id,
        content_type=content_type,
        content_title=content_title,
    )

    # If already completed, just return
    if progress.get("completed_at"):
        return progress

    # Update to mark complete
    now = datetime.now(timezone.utc)
    result = await conn.execute(
        update(user_content_progress)
        .where(user_content_progress.c.id == progress["id"])
        .values(
            completed_at=now,
            time_to_complete_s=time_spent_s,
        )
        .returning(user_content_progress)
    )
    row = result.fetchone()
    await conn.commit()
    return dict(row._mapping)


async def update_time_spent(
    conn: AsyncConnection,
    *,
    user_id: int | None,
    session_token: UUID | None,
    content_id: UUID,
    time_delta_s: int,
) -> None:
    """Add time to total_time_spent_s (and time_to_complete_s if not yet completed)."""
    # Build WHERE clause
    if user_id is not None:
        where_clause = and_(
            user_content_progress.c.user_id == user_id,
            user_content_progress.c.content_id == content_id,
        )
    elif session_token is not None:
        where_clause = and_(
            user_content_progress.c.session_token == session_token,
            user_content_progress.c.content_id == content_id,
        )
    else:
        return  # No identity, can't track

    # Update time columns
    # time_to_complete_s only updates if not yet completed (SQL CASE expression)
    await conn.execute(
        update(user_content_progress)
        .where(where_clause)
        .values(
            total_time_spent_s=user_content_progress.c.total_time_spent_s
            + time_delta_s,
            time_to_complete_s=case(
                (
                    user_content_progress.c.completed_at.is_(None),
                    user_content_progress.c.time_to_complete_s + time_delta_s,
                ),
                else_=user_content_progress.c.time_to_complete_s,
            ),
        )
    )
    await conn.commit()


async def get_module_progress(
    conn: AsyncConnection,
    *,
    user_id: int | None,
    session_token: UUID | None,
    lens_ids: list[UUID],
) -> dict[UUID, dict]:
    """Get progress for multiple content items (lenses in a module).

    Returns dict mapping content_id to progress record.
    """
    if not lens_ids:
        return {}

    # Build WHERE clause
    if user_id is not None:
        where_clause = and_(
            user_content_progress.c.user_id == user_id,
            user_content_progress.c.content_id.in_(lens_ids),
        )
    elif session_token is not None:
        where_clause = and_(
            user_content_progress.c.session_token == session_token,
            user_content_progress.c.content_id.in_(lens_ids),
        )
    else:
        return {}

    result = await conn.execute(select(user_content_progress).where(where_clause))

    return {row.content_id: dict(row._mapping) for row in result.fetchall()}


async def claim_progress_records(
    conn: AsyncConnection,
    *,
    session_token: UUID,
    user_id: int,
) -> int:
    """Claim all anonymous progress records for a user.

    Returns count of records claimed.
    """
    result = await conn.execute(
        update(user_content_progress)
        .where(user_content_progress.c.session_token == session_token)
        .values(user_id=user_id, session_token=None)
    )
    await conn.commit()
    return result.rowcount
