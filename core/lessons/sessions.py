"""Lesson session management - database operations."""

from datetime import datetime, timezone

from sqlalchemy import select, update, insert

from core.database import get_connection, get_transaction
from core.tables import lesson_sessions


class SessionNotFoundError(Exception):
    """Raised when a session cannot be found."""
    pass


async def create_session(user_id: int, lesson_id: str) -> dict:
    """
    Create a new lesson session.

    Args:
        user_id: The user's database ID
        lesson_id: The lesson ID to start

    Returns:
        Dict with session data including session_id
    """
    async with get_transaction() as conn:
        result = await conn.execute(
            insert(lesson_sessions)
            .values(
                user_id=user_id,
                lesson_id=lesson_id,
                current_stage_index=0,
                messages=[],
            )
            .returning(lesson_sessions)
        )
        row = result.mappings().one()
        return dict(row)


async def get_session(session_id: int) -> dict:
    """
    Get a session by ID.

    Args:
        session_id: The session ID

    Returns:
        Dict with session data

    Raises:
        SessionNotFoundError: If session doesn't exist
    """
    async with get_connection() as conn:
        result = await conn.execute(
            select(lesson_sessions).where(lesson_sessions.c.session_id == session_id)
        )
        row = result.mappings().first()

        if not row:
            raise SessionNotFoundError(f"Session not found: {session_id}")

        return dict(row)


async def get_user_sessions(user_id: int) -> list[dict]:
    """
    Get all sessions for a user.

    Args:
        user_id: The user's database ID

    Returns:
        List of session dicts
    """
    async with get_connection() as conn:
        result = await conn.execute(
            select(lesson_sessions)
            .where(lesson_sessions.c.user_id == user_id)
            .order_by(lesson_sessions.c.last_active_at.desc())
        )
        return [dict(row) for row in result.mappings().all()]


async def add_message(session_id: int, role: str, content: str) -> dict:
    """
    Add a message to session history.

    Args:
        session_id: The session ID
        role: "user" or "assistant"
        content: Message content

    Returns:
        Updated session dict
    """
    session = await get_session(session_id)
    messages = session["messages"] + [{"role": role, "content": content}]

    async with get_transaction() as conn:
        await conn.execute(
            update(lesson_sessions)
            .where(lesson_sessions.c.session_id == session_id)
            .values(
                messages=messages,
                last_active_at=datetime.now(timezone.utc),
            )
        )

    return await get_session(session_id)


async def advance_stage(session_id: int) -> dict:
    """
    Move to the next stage.

    Args:
        session_id: The session ID

    Returns:
        Updated session dict
    """
    session = await get_session(session_id)
    new_index = session["current_stage_index"] + 1

    async with get_transaction() as conn:
        await conn.execute(
            update(lesson_sessions)
            .where(lesson_sessions.c.session_id == session_id)
            .values(
                current_stage_index=new_index,
                last_active_at=datetime.now(timezone.utc),
            )
        )

    return await get_session(session_id)


async def complete_session(session_id: int) -> dict:
    """
    Mark a session as completed.

    Args:
        session_id: The session ID

    Returns:
        Updated session dict
    """
    async with get_transaction() as conn:
        await conn.execute(
            update(lesson_sessions)
            .where(lesson_sessions.c.session_id == session_id)
            .values(
                completed_at=datetime.now(timezone.utc),
                last_active_at=datetime.now(timezone.utc),
            )
        )

    return await get_session(session_id)
