"""Load/save open-ended chat sessions (module_id IS NULL, roleplay_id IS NULL)."""

import json
from datetime import datetime, timezone

from sqlalchemy import select, insert, update

from core.database import get_connection, get_transaction
from core.tables import chat_sessions


async def load_or_create_open_ended_session(user_id: int) -> dict:
    """Load the active open-ended session for a user, or create one.

    Open-ended sessions have module_id=NULL and roleplay_id=NULL.
    Returns a mutable dict with session_id, user_id, messages, etc.
    """
    async with get_connection() as conn:
        result = await conn.execute(
            select(chat_sessions).where(
                chat_sessions.c.user_id == user_id,
                chat_sessions.c.module_id.is_(None),
                chat_sessions.c.roleplay_id.is_(None),
                chat_sessions.c.archived_at.is_(None),
            )
        )
        row = result.mappings().first()

    if row:
        session = dict(row)
        if isinstance(session["messages"], str):
            session["messages"] = json.loads(session["messages"])
        return session

    # Create new session
    async with get_transaction() as conn:
        result = await conn.execute(
            insert(chat_sessions)
            .values(
                user_id=user_id,
                module_id=None,
                roleplay_id=None,
                messages=[],
            )
            .returning(chat_sessions)
        )
        row = result.mappings().first()
        return dict(row)


async def save_session(session: dict) -> None:
    """Persist the session's messages and last_active_at to the database."""
    async with get_transaction() as conn:
        await conn.execute(
            update(chat_sessions)
            .where(chat_sessions.c.session_id == session["session_id"])
            .values(
                messages=session["messages"],
                last_active_at=datetime.now(timezone.utc),
            )
        )
