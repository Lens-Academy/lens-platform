"""Tests for per-user file storage."""

import pytest
from core.agents.user_files import (
    load_user_files,
    save_user_file,
    VALID_FILENAMES,
    FILE_DEFAULTS,
    DEFAULT_AGENT_STYLE,
)


# These tests hit the real DB (unit+1 style).
# The conftest.py autouse fixture resets the engine per test.


@pytest.mark.asyncio
async def test_load_returns_defaults_for_new_user():
    """First load returns default content without creating DB rows."""
    from core.database import get_transaction, get_connection
    from core.tables import users, coach_user_files
    from sqlalchemy import select, delete
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    # Use a unique user_id and ensure clean state
    uid = 99950
    async with get_transaction() as conn:
        await conn.execute(delete(coach_user_files).where(coach_user_files.c.user_id == uid))
        await conn.execute(
            pg_insert(users).values(user_id=uid, discord_id=f"test_uf_{uid}").on_conflict_do_nothing()
        )

    files = await load_user_files(uid)
    assert set(files.keys()) == {"agent_style.md", "user.md", "memory.md"}
    assert files["agent_style.md"] == DEFAULT_AGENT_STYLE
    assert files["user.md"] == ""
    assert files["memory.md"] == ""

    # Verify no rows were created in DB
    async with get_connection() as conn:
        result = await conn.execute(
            select(coach_user_files).where(coach_user_files.c.user_id == uid)
        )
        assert result.fetchall() == []


@pytest.mark.asyncio
async def test_save_materializes_row_on_first_write():
    """First save creates the DB row (lazy initialization)."""
    from core.database import get_transaction, get_connection
    from core.tables import users, coach_user_files
    from sqlalchemy import select, delete
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    uid = 99951
    async with get_transaction() as conn:
        await conn.execute(delete(coach_user_files).where(coach_user_files.c.user_id == uid))
        await conn.execute(
            pg_insert(users).values(user_id=uid, discord_id=f"test_uf_{uid}").on_conflict_do_nothing()
        )

    # Save some content — this is the first write
    await save_user_file(uid, "agent_style.md", "Name: Kai | Vibe: casual")

    # Reload — saved content comes from DB, others still defaults
    files = await load_user_files(uid)
    assert files["agent_style.md"] == "Name: Kai | Vibe: casual"
    assert files["user.md"] == ""
    assert files["memory.md"] == ""

    # Verify only one row was created (only the file we saved)
    async with get_connection() as conn:
        result = await conn.execute(
            select(coach_user_files).where(coach_user_files.c.user_id == uid)
        )
        rows = result.fetchall()
        assert len(rows) == 1


@pytest.mark.asyncio
async def test_save_rejects_unknown_filename():
    """save_user_file raises ValueError for unknown filenames."""
    with pytest.raises(ValueError, match="Unknown file"):
        await save_user_file(1, "evil.md", "bad content")


def test_valid_filenames():
    """VALID_FILENAMES contains exactly the three expected files."""
    assert VALID_FILENAMES == {"agent_style.md", "user.md", "memory.md"}


def test_default_agent_style_has_bootstrap():
    """Default agent_style.md contains the first conversation guide."""
    assert "First Conversation Guide" in DEFAULT_AGENT_STYLE
    assert "replace" in DEFAULT_AGENT_STYLE and "this entire file" in DEFAULT_AGENT_STYLE
