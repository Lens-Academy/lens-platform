"""Chat sessions service.

Manages chat history separately from progress tracking.
Supports archiving old sessions and creating new ones.
"""

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import exists, select, update, and_
from sqlalchemy.ext.asyncio import AsyncConnection

from core.tables import chat_sessions


async def get_or_create_chat_session(
    conn: AsyncConnection,
    *,
    user_id: int | None,
    anonymous_token: UUID | None,
    module_id: UUID | None,
    roleplay_id: UUID | None = None,
    segment_snapshot: dict | None = None,
) -> dict:
    """Get active chat session or create new one.

    Active = archived_at IS NULL

    Session isolation:
    - Tutor chat: one active per user per module (roleplay_id IS NULL)
    - Roleplay: one active per user per module per roleplay (roleplay_id IS NOT NULL)

    Uses SELECT-then-INSERT with retry on unique constraint violation
    to handle race conditions gracefully.
    """
    from sqlalchemy.exc import IntegrityError

    # Build WHERE clause for active session
    conditions = [chat_sessions.c.archived_at.is_(None)]

    if module_id is not None:
        conditions.append(chat_sessions.c.module_id == module_id)
    else:
        conditions.append(chat_sessions.c.module_id.is_(None))

    if roleplay_id is not None:
        conditions.append(chat_sessions.c.roleplay_id == roleplay_id)
    else:
        conditions.append(chat_sessions.c.roleplay_id.is_(None))

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
        "module_id": module_id,
        "roleplay_id": roleplay_id,
        "segment_snapshot": segment_snapshot,
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


async def complete_chat_session(
    conn: AsyncConnection,
    *,
    session_id: int,
) -> None:
    """Mark a chat session as completed (roleplay finished)."""
    await conn.execute(
        update(chat_sessions)
        .where(chat_sessions.c.session_id == session_id)
        .values(completed_at=datetime.now(timezone.utc))
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

    Skips sessions where the user already has an active session for the same
    (module_id, roleplay_id) combination to avoid unique constraint violations.

    Handles NULL roleplay_id correctly: tutor sessions (roleplay_id IS NULL) and
    roleplay sessions (roleplay_id IS NOT NULL) are deduplicated independently.

    Returns count of sessions claimed.
    """
    from sqlalchemy import text as sa_text

    # Use an aliased reference for the correlated subquery.
    # The outer UPDATE targets chat_sessions directly; the EXISTS subquery
    # checks if the user already owns an active session with the same
    # (module_id, roleplay_id) pair, using IS NOT DISTINCT FROM for NULL-safe
    # comparison on roleplay_id.
    anon_sessions = chat_sessions.alias("anon_sessions")

    # Build the NOT EXISTS condition: skip anonymous sessions where the user
    # already has a matching active session
    already_exists = exists(
        select(chat_sessions.c.session_id).where(
            and_(
                chat_sessions.c.user_id == user_id,
                chat_sessions.c.archived_at.is_(None),
                sa_text(
                    "chat_sessions.module_id IS NOT DISTINCT FROM anon_sessions.module_id "
                    "AND chat_sessions.roleplay_id IS NOT DISTINCT FROM anon_sessions.roleplay_id"
                ),
            )
        )
    )

    # Only claim sessions where the user doesn't already have a matching active session
    result = await conn.execute(
        anon_sessions.update()
        .where(
            and_(
                anon_sessions.c.anonymous_token == anonymous_token,
                ~already_exists,
            )
        )
        .values(user_id=user_id, anonymous_token=None)
    )
    # No explicit commit - let the caller's transaction context handle it
    return result.rowcount
