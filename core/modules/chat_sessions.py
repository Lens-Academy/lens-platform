"""Chat sessions service.

Manages chat history separately from progress tracking.
Supports archiving old sessions and creating new ones.
"""

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select, update, and_
from sqlalchemy.ext.asyncio import AsyncConnection

from core.tables import chat_sessions


async def get_or_create_chat_session(
    conn: AsyncConnection,
    *,
    user_id: int | None,
    anonymous_token: UUID | None,
    content_id: UUID | None,
    content_type: str | None,
) -> dict:
    """Get active chat session or create new one.

    Active = archived_at IS NULL

    Uses SELECT-then-INSERT with retry on unique constraint violation
    to handle race conditions gracefully.
    """
    from sqlalchemy.exc import IntegrityError

    # Build WHERE clause for active session
    conditions = [chat_sessions.c.archived_at.is_(None)]

    if content_id is not None:
        conditions.append(chat_sessions.c.content_id == content_id)
    else:
        conditions.append(chat_sessions.c.content_id.is_(None))

    if user_id is not None:
        conditions.append(chat_sessions.c.user_id == user_id)
    elif anonymous_token is not None:
        conditions.append(chat_sessions.c.anonymous_token == anonymous_token)
    else:
        raise ValueError("Either user_id or anonymous_token must be provided")

    # Check for existing active session
    result = await conn.execute(select(chat_sessions).where(and_(*conditions)))
    row = result.fetchone()

    if row:
        return dict(row._mapping)

    # Create new session
    insert_values = {
        "content_id": content_id,
        "content_type": content_type,
        "messages": [],
    }
    if user_id is not None:
        insert_values["user_id"] = user_id
    else:
        insert_values["anonymous_token"] = anonymous_token

    try:
        result = await conn.execute(
            chat_sessions.insert().values(**insert_values).returning(chat_sessions)
        )
        row = result.fetchone()
        await conn.commit()
        return dict(row._mapping)
    except IntegrityError:
        # Race condition: another request created the session first
        # Rollback and fetch the existing session
        await conn.rollback()
        result = await conn.execute(select(chat_sessions).where(and_(*conditions)))
        row = result.fetchone()
        if row:
            return dict(row._mapping)
        # Should never happen, but re-raise if it does
        raise


async def add_chat_message(
    conn: AsyncConnection,
    *,
    session_id: int,
    role: str,
    content: str,
    icon: str | None = None,
) -> None:
    """Append message to chat session."""
    message = {"role": role, "content": content}
    if icon:
        message["icon"] = icon

    # Use PostgreSQL jsonb_insert or || operator
    await conn.execute(
        update(chat_sessions)
        .where(chat_sessions.c.session_id == session_id)
        .values(
            messages=chat_sessions.c.messages + [message],
            last_active_at=datetime.now(timezone.utc),
        )
    )
    await conn.commit()


async def archive_chat_session(
    conn: AsyncConnection,
    *,
    session_id: int,
) -> None:
    """Archive a chat session (soft delete)."""
    await conn.execute(
        update(chat_sessions)
        .where(chat_sessions.c.session_id == session_id)
        .values(archived_at=datetime.now(timezone.utc))
    )
    await conn.commit()


async def get_chat_session(
    conn: AsyncConnection,
    *,
    session_id: int,
) -> dict | None:
    """Get chat session by ID."""
    result = await conn.execute(
        select(chat_sessions).where(chat_sessions.c.session_id == session_id)
    )
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def claim_chat_sessions(
    conn: AsyncConnection,
    *,
    anonymous_token: UUID,
    user_id: int,
) -> int:
    """Claim anonymous chat sessions for a user.

    Skips sessions where the user already has an active session for the same content_id
    to avoid unique constraint violations.

    Returns count of sessions claimed.
    """
    # Subquery to find content_ids where user already has an active session
    existing_content_ids = (
        select(chat_sessions.c.content_id)
        .where(
            and_(
                chat_sessions.c.user_id == user_id,
                chat_sessions.c.archived_at.is_(None),
            )
        )
        .scalar_subquery()
    )

    # Only claim sessions for content the user doesn't already have
    result = await conn.execute(
        update(chat_sessions)
        .where(
            and_(
                chat_sessions.c.anonymous_token == anonymous_token,
                ~chat_sessions.c.content_id.in_(existing_content_ids),
            )
        )
        .values(user_id=user_id, anonymous_token=None)
    )
    # No explicit commit - let the caller's transaction context handle it
    return result.rowcount
