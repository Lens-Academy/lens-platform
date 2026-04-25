"""Tests for memory tools (read_file, edit_file, append_memory)."""

import pytest
from datetime import date
from core.agents.tools.memory_tools import (
    execute_read_file,
    execute_edit_file,
    execute_append_memory,
    MEMORY_TOOL_SCHEMAS,
    MEMORY_SOFT_LIMIT,
)
from core.agents.user_files import load_user_files, save_user_file


async def _setup_user(user_id: int):
    """Create a test user and initialize their files."""
    from core.database import get_transaction
    from core.tables import users
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    async with get_transaction() as conn:
        await conn.execute(
            pg_insert(users)
            .values(user_id=user_id, discord_id=f"test_mt_{user_id}")
            .on_conflict_do_nothing()
        )
    await load_user_files(user_id)


@pytest.mark.asyncio
async def test_read_file_returns_content():
    await _setup_user(90001)
    await save_user_file(90001, "agent_style.md", "Be concise.")
    result = await execute_read_file(90001, "agent_style.md")
    assert result == "Be concise."


@pytest.mark.asyncio
async def test_read_file_returns_empty_for_new_file():
    await _setup_user(90002)
    result = await execute_read_file(90002, "memory.md")
    assert result == "(empty)"


@pytest.mark.asyncio
async def test_read_file_rejects_unknown():
    result = await execute_read_file(1, "evil.md")
    assert "Unknown file" in result


@pytest.mark.asyncio
async def test_edit_file_replaces_text():
    await _setup_user(90003)
    await save_user_file(90003, "user.md", "Name: Alice\nGoal: Learn AI safety")
    result = await execute_edit_file(90003, "user.md", "Name: Alice", "Name: Bob")
    assert "Updated" in result
    files = await load_user_files(90003)
    assert files["user.md"] == "Name: Bob\nGoal: Learn AI safety"


@pytest.mark.asyncio
async def test_edit_file_not_found():
    await _setup_user(90004)
    await save_user_file(90004, "user.md", "Name: Alice")
    result = await execute_edit_file(90004, "user.md", "Name: Bob", "Name: Carol")
    assert "not found" in result.lower()


@pytest.mark.asyncio
async def test_edit_file_ambiguous_match():
    await _setup_user(90005)
    await save_user_file(90005, "user.md", "apple and apple")
    result = await execute_edit_file(90005, "user.md", "apple", "orange")
    assert "ambiguous" in result.lower() or "multiple" in result.lower()


@pytest.mark.asyncio
async def test_edit_file_rejects_unknown_filename():
    result = await execute_edit_file(1, "evil.md", "a", "b")
    assert "Unknown file" in result


@pytest.mark.asyncio
async def test_append_memory_adds_timestamped_note():
    await _setup_user(90006)
    result = await execute_append_memory(90006, "User prefers mornings")
    assert "Noted" in result or "Added" in result
    files = await load_user_files(90006)
    today = date.today().isoformat()
    assert f"- {today}: User prefers mornings" in files["memory.md"]


@pytest.mark.asyncio
async def test_append_memory_appends_multiple():
    await _setup_user(90007)
    await execute_append_memory(90007, "First note")
    await execute_append_memory(90007, "Second note")
    files = await load_user_files(90007)
    assert "First note" in files["memory.md"]
    assert "Second note" in files["memory.md"]


@pytest.mark.asyncio
async def test_append_memory_warns_at_soft_limit():
    await _setup_user(90008)
    big_content = "x" * (MEMORY_SOFT_LIMIT + 1)
    await save_user_file(90008, "memory.md", big_content)
    result = await execute_append_memory(90008, "One more note")
    assert "getting long" in result.lower() or "clean" in result.lower()


def test_schemas_have_correct_names():
    names = {s["function"]["name"] for s in MEMORY_TOOL_SCHEMAS}
    assert names == {"read_file", "edit_file", "append_memory"}
