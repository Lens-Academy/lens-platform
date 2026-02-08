"""Progress tracking service.

Handles user progress through course content using UUID-based tracking.
Supports both authenticated users (user_id) and anonymous users (anonymous_token).
"""

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select, update, and_, case, func, cast, Integer, extract
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncConnection

from core.tables import user_content_progress


async def get_or_create_progress(
    conn: AsyncConnection,
    *,
    user_id: int | None,
    anonymous_token: UUID | None,
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
    elif anonymous_token is not None:
        insert_values["anonymous_token"] = anonymous_token
        # Use the partial unique index for anonymous users
        conflict_target = ["anonymous_token", "content_id"]
        conflict_where = user_content_progress.c.anonymous_token.isnot(None)
    else:
        raise ValueError("Either user_id or anonymous_token must be provided")

    # INSERT ... ON CONFLICT DO UPDATE
    # Backfill content_title if existing record has empty title and new value is non-empty
    stmt = pg_insert(user_content_progress).values(**insert_values)
    stmt = stmt.on_conflict_do_update(
        index_elements=conflict_target,
        index_where=conflict_where,
        set_={
            "content_title": case(
                (
                    and_(
                        user_content_progress.c.content_title == "",
                        stmt.excluded.content_title != "",
                    ),
                    stmt.excluded.content_title,
                ),
                else_=user_content_progress.c.content_title,
            ),
        },
    ).returning(user_content_progress)

    result = await conn.execute(stmt)
    row = result.fetchone()
    # No explicit commit - let the caller's transaction context handle it
    return dict(row._mapping)


async def mark_content_complete(
    conn: AsyncConnection,
    *,
    user_id: int | None,
    anonymous_token: UUID | None,
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
        anonymous_token=anonymous_token,
        content_id=content_id,
        content_type=content_type,
        content_title=content_title,
    )

    # If already completed, just return
    if progress.get("completed_at"):
        return progress

    # Update to mark complete — snapshot accumulated time, not the parameter
    now = datetime.now(timezone.utc)
    result = await conn.execute(
        update(user_content_progress)
        .where(user_content_progress.c.id == progress["id"])
        .values(
            completed_at=now,
            time_to_complete_s=progress["total_time_spent_s"],
        )
        .returning(user_content_progress)
    )
    row = result.fetchone()
    # No explicit commit - let the caller's transaction context handle it
    return dict(row._mapping)


MAX_HEARTBEAT_DELTA_S = 40  # 2x the 20s heartbeat interval


async def update_time_spent(
    conn: AsyncConnection,
    *,
    user_id: int | None,
    anonymous_token: UUID | None,
    content_id: UUID,
) -> None:
    """Compute time delta from last_heartbeat_at and add to total_time_spent_s.

    Uses a single atomic UPDATE to prevent concurrent-ping double-counting.
    First ping (last_heartbeat_at is NULL): sets timestamp, adds 0 time.
    Subsequent pings: computes delta = clamp(now - last_heartbeat_at, 0, MAX_HEARTBEAT_DELTA_S).
    """
    # Build WHERE clause
    if user_id is not None:
        where_clause = and_(
            user_content_progress.c.user_id == user_id,
            user_content_progress.c.content_id == content_id,
        )
    elif anonymous_token is not None:
        where_clause = and_(
            user_content_progress.c.anonymous_token == anonymous_token,
            user_content_progress.c.content_id == content_id,
        )
    else:
        return

    # Compute clamped delta entirely in SQL
    now = func.now()
    raw_delta = extract("epoch", now - user_content_progress.c.last_heartbeat_at)
    clamped_delta = case(
        (user_content_progress.c.last_heartbeat_at.is_(None), 0),
        else_=func.least(
            func.greatest(cast(func.round(raw_delta), Integer), 0),
            MAX_HEARTBEAT_DELTA_S,
        ),
    )

    await conn.execute(
        update(user_content_progress)
        .where(where_clause)
        .values(
            last_heartbeat_at=now,
            total_time_spent_s=user_content_progress.c.total_time_spent_s
            + clamped_delta,
        )
    )


async def get_module_progress(
    conn: AsyncConnection,
    *,
    user_id: int | None,
    anonymous_token: UUID | None,
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
    elif anonymous_token is not None:
        where_clause = and_(
            user_content_progress.c.anonymous_token == anonymous_token,
            user_content_progress.c.content_id.in_(lens_ids),
        )
    else:
        return {}

    result = await conn.execute(select(user_content_progress).where(where_clause))

    return {row.content_id: dict(row._mapping) for row in result.fetchall()}


async def claim_progress_records(
    conn: AsyncConnection,
    *,
    anonymous_token: UUID,
    user_id: int,
) -> int:
    """Claim all anonymous progress records for a user.

    Skips records where the user already has progress for that content_id
    to avoid unique constraint violations.

    Returns count of records claimed.
    """
    # Subquery to find content_ids where the user already has progress
    existing_content_ids = (
        select(user_content_progress.c.content_id)
        .where(user_content_progress.c.user_id == user_id)
        .scalar_subquery()
    )

    # Only claim anonymous records for content the user doesn't already have
    result = await conn.execute(
        update(user_content_progress)
        .where(
            and_(
                user_content_progress.c.anonymous_token == anonymous_token,
                ~user_content_progress.c.content_id.in_(existing_content_ids),
            )
        )
        .values(user_id=user_id, anonymous_token=None)
    )
    # No explicit commit - let the caller's transaction context handle it
    return result.rowcount
