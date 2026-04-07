"""Tests for Discord message sync (insert/upsert)."""

import pytest
from datetime import datetime, timezone
from sqlalchemy import select, text

from core.database import get_transaction, get_connection
from core.discord_mcp.sync import upsert_channel, upsert_messages
from core.discord_mcp.tables import channels, messages


@pytest.fixture(autouse=True)
async def clean_discord_tables():
    """Clean discord tables before each test."""
    async with get_transaction() as conn:
        await conn.execute(text("DELETE FROM discord.messages"))
        await conn.execute(text("DELETE FROM discord.channels"))
    yield
    async with get_transaction() as conn:
        await conn.execute(text("DELETE FROM discord.messages"))
        await conn.execute(text("DELETE FROM discord.channels"))


@pytest.mark.asyncio
async def test_upsert_channel_insert():
    await upsert_channel(
        id=123456,
        guild_id=111111,
        name="general",
        type="text",
        parent_id=None,
        topic="General discussion",
    )
    async with get_connection() as conn:
        row = (
            (await conn.execute(select(channels).where(channels.c.id == 123456)))
            .mappings()
            .first()
        )
    assert row is not None
    assert row["name"] == "general"
    assert row["topic"] == "General discussion"


@pytest.mark.asyncio
async def test_upsert_channel_update():
    await upsert_channel(id=123456, guild_id=111111, name="general", type="text")
    await upsert_channel(id=123456, guild_id=111111, name="general-chat", type="text")
    async with get_connection() as conn:
        row = (
            (await conn.execute(select(channels).where(channels.c.id == 123456)))
            .mappings()
            .first()
        )
    assert row["name"] == "general-chat"


@pytest.mark.asyncio
async def test_upsert_messages_insert():
    await upsert_channel(id=100, guild_id=111111, name="general", type="text")

    msg_data = [
        {
            "id": 1001,
            "channel_id": 100,
            "author_id": 200,
            "author_name": "Alice",
            "content": "Hello world",
            "created_at": datetime(2026, 1, 1, tzinfo=timezone.utc),
        },
        {
            "id": 1002,
            "channel_id": 100,
            "author_id": 201,
            "author_name": "Bob",
            "content": "Hi Alice",
            "created_at": datetime(2026, 1, 1, 0, 1, tzinfo=timezone.utc),
        },
    ]
    count = await upsert_messages(msg_data)
    assert count == 2

    async with get_connection() as conn:
        rows = (
            (await conn.execute(select(messages).order_by(messages.c.id)))
            .mappings()
            .all()
        )
    assert len(rows) == 2
    assert rows[0]["author_name"] == "Alice"
    assert rows[1]["content"] == "Hi Alice"


@pytest.mark.asyncio
async def test_upsert_messages_skips_duplicates():
    await upsert_channel(id=100, guild_id=111111, name="general", type="text")

    msg = {
        "id": 1001,
        "channel_id": 100,
        "author_id": 200,
        "author_name": "Alice",
        "content": "Hello",
        "created_at": datetime(2026, 1, 1, tzinfo=timezone.utc),
    }
    await upsert_messages([msg])
    msg["content"] = "Hello (edited)"
    msg["edited_at"] = datetime(2026, 1, 1, 0, 5, tzinfo=timezone.utc)
    count = await upsert_messages([msg])
    assert count == 1

    async with get_connection() as conn:
        row = (
            (await conn.execute(select(messages).where(messages.c.id == 1001)))
            .mappings()
            .first()
        )
    assert row["content"] == "Hello (edited)"
    assert row["edited_at"] is not None
