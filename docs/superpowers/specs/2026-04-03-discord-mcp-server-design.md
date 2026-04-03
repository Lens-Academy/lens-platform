# Discord MCP Server Design

## Overview

A Discord content indexing and search system inside lens-platform, exposed as an MCP endpoint at `/discord-mcp`. Periodically scrapes all Discord messages into a `discord` PostgreSQL schema, provides keyword search via tsvector, reads messages live from the Discord API, and allows writing messages via webhooks with custom display names.

## Goals

- Make all Discord content searchable (keyword) from any MCP client
- Read messages in real-time with surrounding context
- Send messages as any display name via webhooks
- Minimal coupling to existing code — no refactoring of stampy_cog or message handling

## Non-Goals

- Real-time message sync (periodic backfill is sufficient)
- Semantic / vector search (can be added later with a `discord.chunks` table and embedding pipeline — no schema changes needed on existing tables)
- Replacing the existing discord.py bot or its event handling
- Multi-guild support (single guild, expandable later)

## Data Flow

```
Discord Guild
    |
    +-- Backfill (periodic): APScheduler task
    |     channel.history() --> core/discord_mcp/export --> core/discord_mcp/sync
    |                          (iterates channels)         (DB insert)
    |
    +-- MCP clients (Claude Code, AI tutor, etc.)
          |
          v
        FastAPI @ /discord-mcp (streamable-http transport)
          |
          +-- search_messages(query)     --> PostgreSQL tsvector/tsquery on DB
          +-- read_messages(channel)     --> Discord REST API (live)
          +-- list_channels()            --> DB lookup
          +-- send_message(channel, ...) --> Discord webhook (live)
          +-- sync_channel(channel?)     --> triggers backfill task
```

## Database Schema

All tables live in the `discord` PostgreSQL schema within the existing Supabase database.

### `discord.channels`

Cached channel metadata. Updated during backfill.

| Column | Type | Notes |
|--------|------|-------|
| `id` | BIGINT PK | Discord channel ID |
| `guild_id` | BIGINT NOT NULL | |
| `name` | TEXT NOT NULL | |
| `type` | TEXT NOT NULL | text, voice, forum, thread, etc. |
| `parent_id` | BIGINT | Category or parent channel for threads |
| `topic` | TEXT | Channel topic/description |
| `webhook_id` | BIGINT | Cached webhook ID for sending |
| `webhook_token` | TEXT | Cached webhook token for sending |
| `synced_at` | TIMESTAMPTZ | Last full sync timestamp |

### `discord.messages`

Search index. Populated by periodic backfill.

| Column | Type | Notes |
|--------|------|-------|
| `id` | BIGINT PK | Discord message ID |
| `channel_id` | BIGINT NOT NULL FK | -> discord.channels |
| `thread_id` | BIGINT | Thread ID if in a thread |
| `author_id` | BIGINT NOT NULL | Discord user ID |
| `author_name` | TEXT NOT NULL | Display name at time of message |
| `content` | TEXT NOT NULL | Message text |
| `created_at` | TIMESTAMPTZ NOT NULL | |
| `edited_at` | TIMESTAMPTZ | |
| `reference_id` | BIGINT | Reply-to message ID |
| `metadata` | JSONB | Attachments, embeds, reactions |
| `search_vector` | TSVECTOR | Generated: `to_tsvector('english', content)` |

### Indexes

- GIN on `search_vector` (keyword search)
- B-tree on `(channel_id, created_at)` (context reads, backfill resume)

### Alembic Migration

Single migration that:
1. `CREATE SCHEMA IF NOT EXISTS discord`
2. Creates both tables with indexes
3. `search_vector` is a PostgreSQL generated stored column (`GENERATED ALWAYS AS (to_tsvector('english', content)) STORED`)

## Code Layout

```
core/
  discord_mcp/
    __init__.py
    server.py              # FastMCP tool definitions + app factory
    sync.py                # Message indexing: insert/upsert to DB
    export.py              # channel.history() backfill logic
    search.py              # Keyword search queries
    tables.py              # SQLAlchemy table defs for discord.* schema
    send.py                # Webhook message sending
```

No changes to `discord_bot/cogs/stampy_cog.py` or any existing business logic.

## MCP Server

### Transport

Uses `FastMCP` from the `mcp` Python SDK with `streamable-http` transport. Mounted inside the existing FastAPI app as a sub-application at `/discord-mcp`.

### Mounting in `main.py`

```python
from core.discord_mcp.server import create_mcp_app

mcp_app = create_mcp_app(db_engine=engine, bot=bot)
app.mount("/discord-mcp", mcp_app)
```

Happens in the lifespan after bot is ready and DB is connected. Shares the same database engine and bot instance.

### Authentication

Bearer token on the `/discord-mcp` endpoint. Static secret in `DISCORD_MCP_AUTH_TOKEN` env var.

Client config:
```json
{
  "type": "http",
  "url": "https://discord-mcp.lensacademy.org/discord-mcp",
  "headers": {"Authorization": "Bearer <token>"}
}
```

### Tools

#### `search_messages(query: str, channel: str | None = None, limit: int = 10) -> list[dict]`

PostgreSQL `tsquery` against `search_vector`. Supports boolean operators (AND, OR, NOT). Ranked by `ts_rank_cd`. Returns messages with author, channel, timestamp, content. Optional filter by channel name.

#### `read_messages(channel: str, around_message_id: int | None = None, limit: int = 50) -> list[dict]`

Reads messages live from Discord REST API via the bot instance. If `around_message_id` is provided, fetches context window centered on that message. Channel identified by name or ID.

#### `list_channels() -> list[dict]`

Returns all channels from `discord.channels` with type, topic, and message count (from DB).

#### `send_message(channel: str, content: str, display_name: str | None = None) -> dict`

Sends via Discord webhook. If `display_name` is provided, uses a webhook with that name. Creates and caches the webhook in `discord.channels` on first use per channel. Channel identified by name or ID.

#### `sync_channel(channel: str | None = None) -> dict`

Triggers backfill for a specific channel or all channels. Returns count of new messages indexed. Runs as background task for full-guild sync.

## Backfill / Export

Periodic sync via APScheduler (already used in the project):

- Runs every 30 minutes (configurable)
- Iterates all text channels + forum channels + threads in the guild
- Per channel: queries `MAX(created_at)` from `discord.messages` to resume from last sync
- Uses `channel.history(after=last_synced, oldest_first=True, limit=None)`
- Batches: 100 messages per DB insert
- Updates `discord.channels` metadata and `synced_at` timestamp
- Also callable on-demand via `sync_channel` MCP tool
- First run does full historical backfill

## Changes to Existing Code

1. **`main.py`** — Mount MCP app at `/discord-mcp` in lifespan. Add APScheduler job for periodic backfill.
2. **Alembic** — New migration for `discord` schema + tables.
3. **`.env.example`** — Add `DISCORD_MCP_AUTH_TOKEN`.

No changes to `stampy_cog.py`, `core/tables.py`, or any existing business logic.

## Dependencies

- `mcp` — already in requirements.txt (used as client; now also used as server)
- `discord.py` — already in requirements.txt, bot instance used for REST API reads + channel.history()
- `apscheduler` — already in requirements.txt, used for periodic backfill scheduling

No new dependencies required.

## Future: Semantic Search

When keyword search proves insufficient, semantic search can be added without changing existing tables:

1. Add a `discord.chunks` table (concatenated message groups with a VECTOR column)
2. Add `pgvector` dependency and embedding pipeline
3. Chunk strategy: threads as natural units, LLM-based topic grouping for non-threaded messages
4. Add a `search_semantic` MCP tool alongside the existing `search_messages`
