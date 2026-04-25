"""Tests for per-user file storage."""

import pytest
from core.agents.user_files import load_user_files, save_user_file, VALID_FILENAMES


# These tests hit the real DB (unit+1 style).
# The conftest.py autouse fixture resets the engine per test.


@pytest.mark.asyncio
async def test_load_creates_empty_files_for_new_user():
    """First load for a user creates three empty files."""
    from core.database import get_transaction
    from core.tables import users
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    async with get_transaction() as conn:
        await conn.execute(
            pg_insert(users)
            .values(user_id=99999, discord_id="test_uf_99999")
            .on_conflict_do_nothing()
        )

    files = await load_user_files(99999)
    assert set(files.keys()) == {"agent_style.md", "user.md", "memory.md"}
    assert all(v == "" for v in files.values())


@pytest.mark.asyncio
async def test_load_returns_existing_content():
    """After saving, load returns the saved content."""
    from core.database import get_transaction
    from core.tables import users
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    async with get_transaction() as conn:
        await conn.execute(
            pg_insert(users)
            .values(user_id=99998, discord_id="test_uf_99998")
            .on_conflict_do_nothing()
        )

    # First load creates files
    await load_user_files(99998)

    # Save some content
    await save_user_file(99998, "agent_style.md", "Be direct and concise.")

    # Reload
    files = await load_user_files(99998)
    assert files["agent_style.md"] == "Be direct and concise."
    assert files["user.md"] == ""
    assert files["memory.md"] == ""


@pytest.mark.asyncio
async def test_save_rejects_unknown_filename():
    """save_user_file raises ValueError for unknown filenames."""
    with pytest.raises(ValueError, match="Unknown file"):
        await save_user_file(1, "evil.md", "bad content")


def test_valid_filenames():
    """VALID_FILENAMES contains exactly the three expected files."""
    assert VALID_FILENAMES == {"agent_style.md", "user.md", "memory.md"}
