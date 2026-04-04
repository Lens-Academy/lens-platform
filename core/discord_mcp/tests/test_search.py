"""Tests for Discord keyword search."""

import pytest
from datetime import datetime, timezone
from sqlalchemy import text

from core.database import get_transaction
from core.discord_mcp.search import search_keyword
from core.discord_mcp.sync import upsert_channel, upsert_messages


@pytest.fixture(autouse=True)
async def seed_data():
    """Seed test data for search tests."""
    async with get_transaction() as conn:
        await conn.execute(text("DELETE FROM discord.messages"))
        await conn.execute(text("DELETE FROM discord.channels"))

    await upsert_channel(id=100, guild_id=1, name="general", type="text")
    await upsert_channel(id=200, guild_id=1, name="alignment", type="text")

    await upsert_messages([
        {
            "id": 1,
            "channel_id": 100,
            "author_id": 10,
            "author_name": "Alice",
            "content": "The alignment tax is a real concern for AI safety",
            "created_at": datetime(2026, 1, 1, tzinfo=timezone.utc),
        },
        {
            "id": 2,
            "channel_id": 100,
            "author_id": 11,
            "author_name": "Bob",
            "content": "I think instrumental convergence is underrated",
            "created_at": datetime(2026, 1, 1, 0, 1, tzinfo=timezone.utc),
        },
        {
            "id": 3,
            "channel_id": 200,
            "author_id": 10,
            "author_name": "Alice",
            "content": "Module 3 on alignment was really helpful",
            "created_at": datetime(2026, 1, 1, 0, 2, tzinfo=timezone.utc),
        },
    ])
    yield
    async with get_transaction() as conn:
        await conn.execute(text("DELETE FROM discord.messages"))
        await conn.execute(text("DELETE FROM discord.channels"))


@pytest.mark.asyncio
async def test_search_finds_matching_messages():
    results = await search_keyword("alignment")
    assert len(results) >= 2
    contents = [r["content"] for r in results]
    assert any("alignment tax" in c for c in contents)
    assert any("Module 3 on alignment" in c for c in contents)


@pytest.mark.asyncio
async def test_search_returns_message_fields():
    results = await search_keyword("instrumental convergence")
    assert len(results) >= 1
    r = results[0]
    assert r["author_name"] == "Bob"
    assert r["channel_name"] == "general"
    assert "id" in r
    assert "created_at" in r


@pytest.mark.asyncio
async def test_search_filters_by_channel():
    results = await search_keyword("alignment", channel="alignment")
    assert len(results) == 1
    assert results[0]["channel_name"] == "alignment"


@pytest.mark.asyncio
async def test_search_respects_limit():
    results = await search_keyword("alignment", limit=1)
    assert len(results) == 1


@pytest.mark.asyncio
async def test_search_no_results():
    results = await search_keyword("xyznonexistent")
    assert results == []
