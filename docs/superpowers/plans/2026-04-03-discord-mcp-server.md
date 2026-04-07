# Discord MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose Discord content search (keyword), live message reading, and webhook-based writing as MCP tools at `/discord-mcp`, backed by a `discord` PostgreSQL schema populated via periodic backfill.

**Architecture:** FastMCP server mounted as a Starlette sub-app inside the existing FastAPI application. Shares the same database engine and discord.py bot instance. Periodic backfill via APScheduler scrapes `channel.history()` into a `discord.messages` table with tsvector full-text search. Live reads and writes go directly through the Discord API.

**Tech Stack:** FastMCP (mcp Python SDK), SQLAlchemy Core (async), discord.py, APScheduler, PostgreSQL tsvector/tsquery. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-03-discord-mcp-server-design.md`

---

## File Structure

```
core/discord_mcp/
  __init__.py        - Package init, re-exports create_mcp_app
  tables.py          - SQLAlchemy table definitions (discord schema)
  search.py          - Keyword search (tsvector queries)
  sync.py            - Message insert/upsert to DB
  export.py          - channel.history() backfill logic
  send.py            - Webhook-based message sending
  server.py          - FastMCP tool definitions + create_mcp_app factory

Modified:
  main.py            - Mount MCP app, add backfill scheduler job
  alembic/env.py     - Include discord schema in migrations
  .env.example       - Add DISCORD_MCP_AUTH_TOKEN
```

---

### Task 1: Database Table Definitions

**Files:**
- Create: `core/discord_mcp/__init__.py`
- Create: `core/discord_mcp/tables.py`

- [ ] **Step 1: Create package init**

```python
# core/discord_mcp/__init__.py
"""Discord MCP server — search, read, and write Discord messages via MCP."""
```

- [ ] **Step 2: Create SQLAlchemy table definitions**

```python
# core/discord_mcp/tables.py
"""SQLAlchemy Core table definitions for the discord schema."""

from sqlalchemy import (
    BigInteger,
    Column,
    Computed,
    DateTime,
    ForeignKey,
    Index,
    MetaData,
    Table,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR

# Separate metadata for discord schema — not managed by alembic autogenerate
discord_metadata = MetaData(schema="discord")

channels = Table(
    "channels",
    discord_metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=False),
    Column("guild_id", BigInteger, nullable=False),
    Column("name", Text, nullable=False),
    Column("type", Text, nullable=False),
    Column("parent_id", BigInteger),
    Column("topic", Text),
    Column("webhook_id", BigInteger),
    Column("webhook_token", Text),
    Column("synced_at", DateTime(timezone=True)),
)

messages = Table(
    "messages",
    discord_metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=False),
    Column(
        "channel_id",
        BigInteger,
        ForeignKey("discord.channels.id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("thread_id", BigInteger),
    Column("author_id", BigInteger, nullable=False),
    Column("author_name", Text, nullable=False),
    Column("content", Text, nullable=False, server_default=""),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("edited_at", DateTime(timezone=True)),
    Column("reference_id", BigInteger),
    Column("metadata_", JSONB, key="metadata"),
    Column(
        "search_vector",
        TSVECTOR,
        Computed("to_tsvector('english', content)", persisted=True),
    ),
    Index("ix_discord_messages_channel_created", "channel_id", "created_at"),
    Index(
        "ix_discord_messages_search_vector",
        "search_vector",
        postgresql_using="gin",
    ),
)
```

Note: The JSONB column is named `metadata_` in SQLAlchemy (to avoid shadowing the MetaData import) but maps to `metadata` in the database via `key="metadata"`. When using this column in queries, reference it as `messages.c.metadata`.

- [ ] **Step 3: Commit**

```
jj commit -m "feat(discord-mcp): add SQLAlchemy table definitions for discord schema"
```

---

### Task 2: Alembic Migration

**Files:**
- Create: `alembic/versions/xxxx_add_discord_schema.py` (via alembic CLI)

- [ ] **Step 1: Generate empty migration**

```bash
.venv/bin/alembic revision -m "add discord schema with channels and messages tables"
```

- [ ] **Step 2: Write the migration**

Open the generated file and replace the `upgrade()` and `downgrade()` functions:

```python
def upgrade() -> None:
    # Create discord schema
    op.execute("CREATE SCHEMA IF NOT EXISTS discord")

    # Create channels table
    op.create_table(
        "channels",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("guild_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("parent_id", sa.BigInteger(), nullable=True),
        sa.Column("topic", sa.Text(), nullable=True),
        sa.Column("webhook_id", sa.BigInteger(), nullable=True),
        sa.Column("webhook_token", sa.Text(), nullable=True),
        sa.Column(
            "synced_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("id"),
        schema="discord",
    )

    # Create messages table
    op.create_table(
        "messages",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("channel_id", sa.BigInteger(), nullable=False),
        sa.Column("thread_id", sa.BigInteger(), nullable=True),
        sa.Column("author_id", sa.BigInteger(), nullable=False),
        sa.Column("author_name", sa.Text(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reference_id", sa.BigInteger(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(), nullable=True),
        sa.Column(
            "search_vector",
            TSVECTOR(),
            sa.Computed("to_tsvector('english', content)", persisted=True),
        ),
        sa.ForeignKeyConstraint(
            ["channel_id"],
            ["discord.channels.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        schema="discord",
    )

    # Indexes
    op.create_index(
        "ix_discord_messages_channel_created",
        "messages",
        ["channel_id", "created_at"],
        schema="discord",
    )
    op.create_index(
        "ix_discord_messages_search_vector",
        "messages",
        ["search_vector"],
        schema="discord",
        postgresql_using="gin",
    )


def downgrade() -> None:
    op.drop_table("messages", schema="discord")
    op.drop_table("channels", schema="discord")
    op.execute("DROP SCHEMA IF EXISTS discord")
```

Add these imports at the top of the migration file (alongside existing ones):

```python
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import TSVECTOR
```

- [ ] **Step 3: Run the migration locally**

```bash
.venv/bin/alembic upgrade head
```

Expected: Migration applies successfully, both tables created in `discord` schema.

- [ ] **Step 4: Verify tables exist**

```bash
.venv/bin/python -c "
import asyncio, os
from dotenv import load_dotenv
load_dotenv('.env'); load_dotenv('.env.local', override=True)
from sqlalchemy import text
from core.database import get_connection

async def check():
    async with get_connection() as conn:
        r = await conn.execute(text(\"SELECT table_name FROM information_schema.tables WHERE table_schema = 'discord'\"))
        print([row[0] for row in r.fetchall()])

asyncio.run(check())
"
```

Expected: `['channels', 'messages']`

- [ ] **Step 5: Commit**

```
jj commit -m "feat(discord-mcp): add alembic migration for discord schema"
```

---

### Task 3: Message Sync (DB Insert/Upsert)

**Files:**
- Create: `core/discord_mcp/sync.py`
- Create: `core/discord_mcp/tests/test_sync.py`

- [ ] **Step 1: Write tests for sync functions**

```python
# core/discord_mcp/tests/__init__.py
# (empty)
```

```python
# core/discord_mcp/tests/test_sync.py
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
            await conn.execute(select(channels).where(channels.c.id == 123456))
        ).mappings().first()
    assert row is not None
    assert row["name"] == "general"
    assert row["topic"] == "General discussion"


@pytest.mark.asyncio
async def test_upsert_channel_update():
    await upsert_channel(id=123456, guild_id=111111, name="general", type="text")
    await upsert_channel(id=123456, guild_id=111111, name="general-chat", type="text")
    async with get_connection() as conn:
        row = (
            await conn.execute(select(channels).where(channels.c.id == 123456))
        ).mappings().first()
    assert row["name"] == "general-chat"


@pytest.mark.asyncio
async def test_upsert_messages_insert():
    # Need a channel first
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
        rows = (await conn.execute(select(messages).order_by(messages.c.id))).mappings().all()
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
    # Upsert again — should update, not fail
    msg["content"] = "Hello (edited)"
    msg["edited_at"] = datetime(2026, 1, 1, 0, 5, tzinfo=timezone.utc)
    count = await upsert_messages([msg])
    assert count == 1

    async with get_connection() as conn:
        row = (
            await conn.execute(select(messages).where(messages.c.id == 1001))
        ).mappings().first()
    assert row["content"] == "Hello (edited)"
    assert row["edited_at"] is not None
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
.venv/bin/pytest core/discord_mcp/tests/test_sync.py -v
```

Expected: ImportError — `core.discord_mcp.sync` does not exist yet.

- [ ] **Step 3: Implement sync module**

```python
# core/discord_mcp/sync.py
"""Insert/upsert Discord messages and channels into the database."""

from datetime import datetime, timezone

from sqlalchemy.dialects.postgresql import insert

from core.database import get_transaction
from .tables import channels, messages


async def upsert_channel(
    *,
    id: int,
    guild_id: int,
    name: str,
    type: str,
    parent_id: int | None = None,
    topic: str | None = None,
) -> None:
    """Insert or update a channel in discord.channels."""
    stmt = insert(channels).values(
        id=id,
        guild_id=guild_id,
        name=name,
        type=type,
        parent_id=parent_id,
        topic=topic,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=[channels.c.id],
        set_={
            "name": stmt.excluded.name,
            "type": stmt.excluded.type,
            "parent_id": stmt.excluded.parent_id,
            "topic": stmt.excluded.topic,
        },
    )
    async with get_transaction() as conn:
        await conn.execute(stmt)


async def upsert_messages(msg_list: list[dict]) -> int:
    """
    Bulk insert/upsert messages into discord.messages.

    Each dict must have: id, channel_id, author_id, author_name, content, created_at.
    Optional: thread_id, edited_at, reference_id, metadata.

    Returns the number of rows upserted.
    """
    if not msg_list:
        return 0

    rows = []
    for m in msg_list:
        rows.append(
            {
                "id": m["id"],
                "channel_id": m["channel_id"],
                "thread_id": m.get("thread_id"),
                "author_id": m["author_id"],
                "author_name": m["author_name"],
                "content": m.get("content", ""),
                "created_at": m["created_at"],
                "edited_at": m.get("edited_at"),
                "reference_id": m.get("reference_id"),
                "metadata_": m.get("metadata"),
            }
        )

    stmt = insert(messages).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=[messages.c.id],
        set_={
            "content": stmt.excluded.content,
            "edited_at": stmt.excluded.edited_at,
            "author_name": stmt.excluded.author_name,
            "metadata_": stmt.excluded.metadata_,
        },
    )
    async with get_transaction() as conn:
        await conn.execute(stmt)

    return len(rows)


async def update_channel_synced_at(channel_id: int) -> None:
    """Mark a channel as synced now."""
    from sqlalchemy import update

    async with get_transaction() as conn:
        await conn.execute(
            update(channels)
            .where(channels.c.id == channel_id)
            .values(synced_at=datetime.now(timezone.utc))
        )
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
.venv/bin/pytest core/discord_mcp/tests/test_sync.py -v
```

Expected: All 4 tests pass.

- [ ] **Step 5: Commit**

```
jj commit -m "feat(discord-mcp): add message sync (insert/upsert) module with tests"
```

---

### Task 4: Keyword Search

**Files:**
- Create: `core/discord_mcp/search.py`
- Create: `core/discord_mcp/tests/test_search.py`

- [ ] **Step 1: Write tests for keyword search**

```python
# core/discord_mcp/tests/test_search.py
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
.venv/bin/pytest core/discord_mcp/tests/test_search.py -v
```

Expected: ImportError — `core.discord_mcp.search` does not exist yet.

- [ ] **Step 3: Implement search module**

```python
# core/discord_mcp/search.py
"""Keyword search over Discord messages using PostgreSQL tsvector."""

from sqlalchemy import func, select, cast, String

from core.database import get_connection
from .tables import channels, messages


async def search_keyword(
    query: str,
    *,
    channel: str | None = None,
    limit: int = 10,
) -> list[dict]:
    """
    Full-text search over discord.messages using tsvector/tsquery.

    Args:
        query: Search query (natural language, converted to tsquery).
        channel: Optional channel name to filter by.
        limit: Max results to return.

    Returns:
        List of message dicts with author_name, channel_name, content, etc.
        Ordered by relevance (ts_rank_cd).
    """
    # Convert plain text query to tsquery using plainto_tsquery
    # (handles natural language input without requiring boolean syntax)
    ts_query = func.plainto_tsquery("english", query)

    stmt = (
        select(
            messages.c.id,
            messages.c.channel_id,
            channels.c.name.label("channel_name"),
            messages.c.thread_id,
            messages.c.author_id,
            messages.c.author_name,
            messages.c.content,
            messages.c.created_at,
            messages.c.edited_at,
            messages.c.reference_id,
            func.ts_rank_cd(messages.c.search_vector, ts_query).label("rank"),
        )
        .select_from(messages.join(channels, messages.c.channel_id == channels.c.id))
        .where(messages.c.search_vector.op("@@")(ts_query))
        .order_by(func.ts_rank_cd(messages.c.search_vector, ts_query).desc())
        .limit(limit)
    )

    if channel:
        # Try matching by name (case-insensitive) or by ID
        try:
            channel_id = int(channel)
            stmt = stmt.where(channels.c.id == channel_id)
        except ValueError:
            stmt = stmt.where(func.lower(channels.c.name) == channel.lower())

    async with get_connection() as conn:
        result = await conn.execute(stmt)
        rows = result.mappings().all()

    return [
        {
            "id": row["id"],
            "channel_id": row["channel_id"],
            "channel_name": row["channel_name"],
            "thread_id": row["thread_id"],
            "author_id": row["author_id"],
            "author_name": row["author_name"],
            "content": row["content"],
            "created_at": row["created_at"].isoformat(),
            "edited_at": row["edited_at"].isoformat() if row["edited_at"] else None,
            "reference_id": row["reference_id"],
        }
        for row in rows
    ]
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
.venv/bin/pytest core/discord_mcp/tests/test_search.py -v
```

Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```
jj commit -m "feat(discord-mcp): add keyword search module with tests"
```

---

### Task 5: Channel Export / Backfill

**Files:**
- Create: `core/discord_mcp/export.py`

- [ ] **Step 1: Implement the export module**

This module uses the discord.py bot to iterate channel history and sync to the database. It cannot be meaningfully unit-tested without a live Discord connection, so we test it manually in Task 9.

```python
# core/discord_mcp/export.py
"""Backfill Discord message history into the database."""

import asyncio
import logging
from datetime import datetime, timezone

import discord

from .sync import upsert_channel, upsert_messages, update_channel_synced_at
from .tables import channels
from core.database import get_connection

logger = logging.getLogger(__name__)

# Batch size for DB inserts
BATCH_SIZE = 100


def _message_to_dict(msg: discord.Message) -> dict:
    """Convert a discord.Message to a plain dict for upsert."""
    return {
        "id": msg.id,
        "channel_id": msg.channel.id,
        "thread_id": msg.channel.id if isinstance(msg.channel, discord.Thread) else None,
        "author_id": msg.author.id,
        "author_name": msg.author.display_name,
        "content": msg.content or "",
        "created_at": msg.created_at,
        "edited_at": msg.edited_at,
        "reference_id": msg.reference.message_id if msg.reference else None,
        "metadata": {
            "attachments": [
                {"url": a.url, "filename": a.filename} for a in msg.attachments
            ],
            "embeds": [e.to_dict() for e in msg.embeds],
        }
        if msg.attachments or msg.embeds
        else None,
    }


async def _get_last_synced_at(channel_id: int) -> datetime | None:
    """Get the created_at of the most recent synced message for a channel."""
    from sqlalchemy import select, func
    from .tables import messages

    async with get_connection() as conn:
        result = await conn.execute(
            select(func.max(messages.c.created_at)).where(
                messages.c.channel_id == channel_id
            )
        )
        return result.scalar()


async def sync_channel(
    channel: discord.TextChannel | discord.ForumChannel | discord.Thread,
    guild_id: int,
) -> int:
    """
    Sync a single channel's message history to the database.

    Resumes from the last synced message. Returns count of new messages inserted.
    """
    # Upsert channel metadata
    parent_id = None
    if isinstance(channel, discord.Thread):
        parent_id = channel.parent_id
    elif channel.category:
        parent_id = channel.category_id

    await upsert_channel(
        id=channel.id,
        guild_id=guild_id,
        name=channel.name,
        type=_channel_type_str(channel),
        parent_id=parent_id,
        topic=getattr(channel, "topic", None),
    )

    # Find where to resume
    last_synced = await _get_last_synced_at(channel.id)
    after = last_synced if last_synced else None

    total = 0
    batch: list[dict] = []

    try:
        async for msg in channel.history(
            limit=None, oldest_first=True, after=after
        ):
            batch.append(_message_to_dict(msg))

            if len(batch) >= BATCH_SIZE:
                count = await upsert_messages(batch)
                total += count
                batch = []

        # Flush remaining
        if batch:
            count = await upsert_messages(batch)
            total += count

        await update_channel_synced_at(channel.id)

    except discord.Forbidden:
        logger.warning(f"No access to channel #{channel.name} ({channel.id}), skipping")
    except Exception as e:
        logger.error(f"Error syncing channel #{channel.name}: {e}")

    return total


async def sync_guild(bot: discord.Client, guild_id: int) -> dict:
    """
    Sync all text channels, forum channels, and threads in a guild.

    Returns dict with total messages synced and channel count.
    """
    guild = bot.get_guild(guild_id)
    if not guild:
        try:
            guild = await bot.fetch_guild(guild_id)
        except discord.NotFound:
            return {"error": f"Guild {guild_id} not found"}

    total_messages = 0
    channel_count = 0

    # Text channels
    for channel in guild.text_channels:
        count = await sync_channel(channel, guild_id)
        total_messages += count
        channel_count += 1
        if count > 0:
            logger.info(f"  #{channel.name}: {count} new messages")

    # Forum channels
    for forum in guild.forum_channels:
        # Sync the forum itself (metadata only)
        await upsert_channel(
            id=forum.id,
            guild_id=guild_id,
            name=forum.name,
            type="forum",
            parent_id=forum.category_id,
            topic=forum.topic,
        )
        channel_count += 1

        # Sync each thread (active + archived)
        threads = list(forum.threads)
        try:
            async for thread in forum.archived_threads(limit=None):
                threads.append(thread)
        except discord.Forbidden:
            logger.warning(f"No access to archived threads in #{forum.name}")

        for thread in threads:
            count = await sync_channel(thread, guild_id)
            total_messages += count
            channel_count += 1
            if count > 0:
                logger.info(f"  #{forum.name}/{thread.name}: {count} new messages")

    # Active threads in text channels
    try:
        active_threads = await guild.active_threads()
        for thread in active_threads:
            # Skip forum threads (already handled above)
            if isinstance(thread.parent, discord.ForumChannel):
                continue
            count = await sync_channel(thread, guild_id)
            total_messages += count
            channel_count += 1
            if count > 0:
                logger.info(f"  Thread {thread.name}: {count} new messages")
    except discord.Forbidden:
        logger.warning("No access to fetch active threads")

    logger.info(
        f"Guild sync complete: {total_messages} messages across {channel_count} channels"
    )
    return {"messages_synced": total_messages, "channels": channel_count}


def _channel_type_str(
    channel: discord.TextChannel | discord.ForumChannel | discord.Thread,
) -> str:
    """Get a string type for a channel."""
    if isinstance(channel, discord.Thread):
        return "thread"
    if isinstance(channel, discord.ForumChannel):
        return "forum"
    if isinstance(channel, discord.VoiceChannel):
        return "voice"
    return "text"
```

- [ ] **Step 2: Commit**

```
jj commit -m "feat(discord-mcp): add channel export/backfill module"
```

---

### Task 6: Webhook Message Sending

**Files:**
- Create: `core/discord_mcp/send.py`

- [ ] **Step 1: Implement send module**

```python
# core/discord_mcp/send.py
"""Send messages to Discord channels via webhooks."""

import logging

import discord

from core.database import get_connection, get_transaction
from .tables import channels

logger = logging.getLogger(__name__)


async def _get_or_create_webhook(
    channel: discord.TextChannel,
    bot: discord.Client,
) -> discord.Webhook:
    """
    Get cached webhook for a channel, or create one.

    Caches webhook_id and webhook_token in discord.channels table.
    """
    from sqlalchemy import select, update

    # Check DB cache first
    async with get_connection() as conn:
        row = (
            await conn.execute(
                select(channels.c.webhook_id, channels.c.webhook_token).where(
                    channels.c.id == channel.id
                )
            )
        ).mappings().first()

    if row and row["webhook_id"] and row["webhook_token"]:
        url = f"https://discord.com/api/webhooks/{row['webhook_id']}/{row['webhook_token']}"
        return discord.Webhook.from_url(url, client=bot)

    # Create new webhook
    webhook = await channel.create_webhook(name="Lens MCP")
    logger.info(f"Created webhook for #{channel.name}")

    # Cache in DB
    async with get_transaction() as conn:
        await conn.execute(
            update(channels)
            .where(channels.c.id == channel.id)
            .values(webhook_id=webhook.id, webhook_token=webhook.token)
        )

    return webhook


async def send_message(
    bot: discord.Client,
    guild_id: int,
    channel_identifier: str,
    content: str,
    display_name: str | None = None,
) -> dict:
    """
    Send a message to a Discord channel via webhook.

    Args:
        bot: Discord bot instance.
        guild_id: Guild ID.
        channel_identifier: Channel name or ID.
        content: Message content.
        display_name: Custom webhook display name. If None, uses "Lens MCP".

    Returns:
        Dict with message id and channel info.
    """
    guild = bot.get_guild(guild_id)
    if not guild:
        return {"error": f"Guild {guild_id} not found"}

    # Resolve channel by name or ID
    channel = None
    try:
        channel_id = int(channel_identifier)
        channel = guild.get_channel(channel_id)
    except ValueError:
        # Search by name
        for ch in guild.text_channels:
            if ch.name.lower() == channel_identifier.lower():
                channel = ch
                break

    if not channel:
        return {"error": f"Channel '{channel_identifier}' not found"}

    if not isinstance(channel, discord.TextChannel):
        return {"error": f"Channel '{channel_identifier}' is not a text channel"}

    webhook = await _get_or_create_webhook(channel, bot)

    msg = await webhook.send(
        content=content,
        username=display_name or "Lens MCP",
        wait=True,
    )

    return {
        "message_id": msg.id,
        "channel_id": channel.id,
        "channel_name": channel.name,
    }
```

- [ ] **Step 2: Commit**

```
jj commit -m "feat(discord-mcp): add webhook message sending module"
```

---

### Task 7: MCP Server (FastMCP Tools + App Factory)

**Files:**
- Create: `core/discord_mcp/server.py`
- Modify: `core/discord_mcp/__init__.py`

- [ ] **Step 1: Implement the MCP server**

```python
# core/discord_mcp/server.py
"""FastMCP server exposing Discord search, read, write, and sync tools."""

import asyncio
import logging
import os
from typing import Any

import discord
from mcp.server.fastmcp import FastMCP
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)


class BearerAuthMiddleware(BaseHTTPMiddleware):
    """Simple bearer token auth middleware."""

    def __init__(self, app, token: str):
        super().__init__(app)
        self.token = token

    async def dispatch(self, request: Request, call_next):
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer ") or auth[7:] != self.token:
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        return await call_next(request)


def create_mcp_app(
    bot: discord.Client,
    guild_id: int,
) -> Starlette:
    """
    Create the MCP Starlette app with all tools registered.

    Args:
        bot: Discord bot instance (must be ready).
        guild_id: Discord guild ID to operate on.

    Returns:
        Starlette app ready to be mounted on FastAPI.
    """
    mcp = FastMCP(
        "Lens Discord MCP",
        instructions=(
            "Search, read, and write messages in the Lens Academy Discord server. "
            "Use search_messages for keyword search, read_messages for live channel "
            "reading, send_message to post via webhook, and list_channels to discover channels."
        ),
        stateless_http=True,
        json_response=True,
    )

    # -- Tools --

    @mcp.tool()
    async def search_messages(
        query: str,
        channel: str | None = None,
        limit: int = 10,
    ) -> list[dict]:
        """Search Discord messages by keyword. Uses PostgreSQL full-text search.

        Args:
            query: Search terms (natural language).
            channel: Optional channel name or ID to filter results.
            limit: Max results (default 10).
        """
        from .search import search_keyword

        return await search_keyword(query, channel=channel, limit=limit)

    @mcp.tool()
    async def read_messages(
        channel: str,
        around_message_id: int | None = None,
        limit: int = 50,
    ) -> list[dict]:
        """Read messages from a Discord channel (live from Discord API).

        Args:
            channel: Channel name or ID.
            around_message_id: If provided, read messages around this message ID.
            limit: Max messages to return (default 50).
        """
        guild = bot.get_guild(guild_id)
        if not guild:
            return [{"error": f"Guild {guild_id} not found"}]

        # Resolve channel
        ch = _resolve_channel(guild, channel)
        if not ch:
            return [{"error": f"Channel '{channel}' not found"}]

        msgs = []
        if around_message_id:
            msg_ref = discord.Object(id=around_message_id)
            async for msg in ch.history(limit=limit, around=msg_ref):
                msgs.append(_format_message(msg, ch.name))
        else:
            async for msg in ch.history(limit=limit):
                msgs.append(_format_message(msg, ch.name))

        msgs.sort(key=lambda m: m["created_at"])
        return msgs

    @mcp.tool()
    async def list_channels() -> list[dict]:
        """List all channels in the Discord server with their types and topics."""
        from sqlalchemy import select, func

        from core.database import get_connection
        from .tables import channels, messages

        async with get_connection() as conn:
            stmt = (
                select(
                    channels.c.id,
                    channels.c.name,
                    channels.c.type,
                    channels.c.topic,
                    channels.c.parent_id,
                    func.count(messages.c.id).label("message_count"),
                )
                .select_from(
                    channels.outerjoin(messages, channels.c.id == messages.c.channel_id)
                )
                .group_by(channels.c.id)
                .order_by(channels.c.name)
            )
            rows = (await conn.execute(stmt)).mappings().all()

        return [
            {
                "id": row["id"],
                "name": row["name"],
                "type": row["type"],
                "topic": row["topic"],
                "parent_id": row["parent_id"],
                "message_count": row["message_count"],
            }
            for row in rows
        ]

    @mcp.tool()
    async def send_message(
        channel: str,
        content: str,
        display_name: str | None = None,
    ) -> dict:
        """Send a message to a Discord channel via webhook.

        Args:
            channel: Channel name or ID.
            content: Message text to send.
            display_name: Custom sender name (shown in Discord). Defaults to "Lens MCP".
        """
        from .send import send_message as _send

        return await _send(bot, guild_id, channel, content, display_name)

    @mcp.tool()
    async def sync_channel(channel: str | None = None) -> dict:
        """Trigger a message sync/backfill for a channel or the entire server.

        Args:
            channel: Channel name or ID. If omitted, syncs all channels.
        """
        from .export import sync_channel as _sync_channel, sync_guild

        if channel:
            guild = bot.get_guild(guild_id)
            if not guild:
                return {"error": f"Guild {guild_id} not found"}
            ch = _resolve_channel(guild, channel)
            if not ch:
                return {"error": f"Channel '{channel}' not found"}
            count = await _sync_channel(ch, guild_id)
            return {"channel": ch.name, "messages_synced": count}
        else:
            # Full guild sync — run in background
            result = await sync_guild(bot, guild_id)
            return result

    # -- Helpers --

    def _resolve_channel(
        guild: discord.Guild, identifier: str
    ) -> discord.TextChannel | None:
        """Resolve a channel by name or ID."""
        try:
            channel_id = int(identifier)
            return guild.get_channel(channel_id)
        except ValueError:
            for ch in guild.text_channels:
                if ch.name.lower() == identifier.lower():
                    return ch
            return None

    def _format_message(msg: discord.Message, channel_name: str) -> dict:
        """Format a discord.Message for MCP tool output."""
        return {
            "id": msg.id,
            "channel_name": channel_name,
            "author_name": msg.author.display_name,
            "content": msg.content,
            "created_at": msg.created_at.isoformat(),
            "edited_at": msg.edited_at.isoformat() if msg.edited_at else None,
        }

    # Build the Starlette app
    starlette_app = mcp.streamable_http_app()

    # Add auth middleware if token is configured
    auth_token = os.environ.get("DISCORD_MCP_AUTH_TOKEN")
    if auth_token:
        starlette_app.add_middleware(BearerAuthMiddleware, token=auth_token)

    return starlette_app
```

- [ ] **Step 2: Update package init**

```python
# core/discord_mcp/__init__.py
"""Discord MCP server — search, read, and write Discord messages via MCP."""

from .server import create_mcp_app

__all__ = ["create_mcp_app"]
```

- [ ] **Step 3: Commit**

```
jj commit -m "feat(discord-mcp): add FastMCP server with all tools"
```

---

### Task 8: Mount in main.py + Scheduler Job

**Files:**
- Modify: `main.py`
- Modify: `.env.example`

- [ ] **Step 1: Add MCP app mount and backfill scheduler job to main.py**

In `main.py`, add the MCP app mount inside the `lifespan` function, after the bot is ready (after the `on_bot_ready()` task is created, around line 339). Add the following block:

```python
    # Mount Discord MCP server
    discord_server_id = os.environ.get("DISCORD_SERVER_ID")
    if bot and discord_server_id and not skip_db:
        from core.discord_mcp import create_mcp_app

        mcp_starlette = create_mcp_app(
            bot=bot,
            guild_id=int(discord_server_id),
        )
        app.mount("/discord-mcp", mcp_starlette)
        print("Discord MCP server mounted at /discord-mcp")

        # Schedule periodic backfill
        if scheduler:
            from core.discord_mcp.export import sync_guild

            async def _backfill_job():
                if bot.is_ready():
                    await sync_guild(bot, int(discord_server_id))

            scheduler.add_job(
                _backfill_job,
                trigger="interval",
                minutes=30,
                id="discord_mcp_backfill",
                replace_existing=True,
            )
            print("Scheduled Discord backfill job (every 30 minutes)")

            # Run initial backfill after bot is ready (delay 3 minutes)
            from datetime import timedelta

            scheduler.add_job(
                _backfill_job,
                trigger="date",
                run_date=datetime.now(timezone.utc) + timedelta(minutes=3),
                id="discord_mcp_backfill_initial",
                replace_existing=True,
            )
            print("Scheduled initial Discord backfill (in ~3 minutes)")
```

Note: The `app.mount()` call must happen BEFORE the `yield` statement. The `datetime` and `timedelta` imports should already exist at the top of `main.py`; if not, add them.

- [ ] **Step 2: Add env var to .env.example**

Add at the end of `.env.example`:

```
# Discord MCP Server
# Bearer token for MCP endpoint authentication (generate a random string)
# DISCORD_MCP_AUTH_TOKEN=your-random-secret-token
```

- [ ] **Step 3: Commit**

```
jj commit -m "feat(discord-mcp): mount MCP server in main.py with periodic backfill"
```

---

### Task 9: Manual Integration Test

**Files:** None (testing only)

- [ ] **Step 1: Start the dev server**

```bash
.venv/bin/python main.py --dev --port 8100
```

Wait for the bot to be ready and the Discord MCP server mount message.

- [ ] **Step 2: Verify MCP endpoint responds**

From another terminal:

```bash
curl -X POST http://localhost:8100/discord-mcp/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "method": "initialize", "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "test", "version": "1.0"}}, "id": 1}'
```

Expected: JSON response with server info and tool list.

- [ ] **Step 3: Trigger a manual sync via MCP tool**

Use Claude Code's MCP integration or curl to call `sync_channel` to backfill a test channel. Verify messages appear in the database:

```bash
.venv/bin/python -c "
import asyncio
from dotenv import load_dotenv
load_dotenv('.env'); load_dotenv('.env.local', override=True)
from sqlalchemy import text
from core.database import get_connection

async def check():
    async with get_connection() as conn:
        r = await conn.execute(text('SELECT count(*) FROM discord.messages'))
        print(f'Messages: {r.scalar()}')
        r = await conn.execute(text('SELECT count(*) FROM discord.channels'))
        print(f'Channels: {r.scalar()}')

asyncio.run(check())
"
```

- [ ] **Step 4: Test keyword search**

After sync has some data, verify search works by calling the `search_messages` tool (via MCP client or curl) with a query that matches known Discord content.

- [ ] **Step 5: Test send_message**

Call the `send_message` tool with a test channel and verify the message appears in Discord with the custom display name.

- [ ] **Step 6: Test read_messages**

Call `read_messages` with a channel name and verify live messages are returned from the Discord API.

---

### Task 10: Configure Claude Code MCP Client

**Files:** None (client configuration only)

- [ ] **Step 1: Add MCP server to Claude Code**

For local development (no auth token needed if not set):

```bash
claude mcp add lens-discord --transport http http://localhost:8100/discord-mcp/mcp
```

For production (with auth via Cloudflare Tunnel):

```bash
claude mcp add lens-discord --transport http \
  --header "Authorization: Bearer YOUR_TOKEN" \
  https://discord-mcp.lensacademy.org/discord-mcp/mcp
```

- [ ] **Step 2: Verify tools are available**

Start a new Claude Code session and verify the Discord MCP tools appear (search_messages, read_messages, list_channels, send_message, sync_channel).

- [ ] **Step 3: Test a search from Claude Code**

Ask Claude to search Discord for a term and verify results come back correctly.
