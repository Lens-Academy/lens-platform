# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.



## Commands

Run the server: `python main.py --dev`. This is a unified backend (FastAPI + Discord Bot) that also serves the frontend.

Options:
--dev (runs Vite dev server. Without --dev, FastAPI serves the compiled frontend.)
--no-bot (without Discord bot)
--port (defaults to 8000)
--vite-port (defaults to 5173)

**Tests:**

```bash
pytest discord_bot/tests/         # Scheduler algorithm tests
```

**Legacy (standalone, for reference):**

```bash
cd discord_bot && python main.py  # Discord bot only
cd web_api && python main.py      # FastAPI only
```

## Architecture

This is a Discord bot + web platform for AI Safety education course logistics.

### Unified Backend

**One process, one asyncio event loop** running two peer services:

- **FastAPI** (HTTP server on :8000) - serves web API for React frontend
- **Discord bot** (WebSocket to Discord) - handles slash commands and events

Both services share:

- The same event loop (can call each other's async functions directly)
- The same `core/` business logic
- The same database connections (PostgreSQL via SQLAlchemy)

This eliminates need for IPC/message queues between services.

### 3-Layer Architecture

```
ai-safety-course-platform/
├── main.py                     # Unified backend entry point (FastAPI + Discord bot)
├── requirements.txt            # Combined Python dependencies
│
├── core/                       # Layer 1: Business Logic (platform-agnostic)
│   ├── scheduling.py           # Scheduling algorithm + Person/Group dataclasses
│   ├── courses.py              # Course management (create, sync, progress)
│   ├── enrollment.py           # User profiles, availability storage
│   ├── cohorts.py              # Cohort creation, availability matching
│   ├── data.py                 # JSON persistence
│   ├── timezone.py             # UTC/local conversions
│   ├── constants.py            # Day codes (M,T,W,R,F,S,U), timezones
│   ├── google_docs.py          # Google Docs fetching/parsing
│   └── cohort_names.py         # Cohort name generation
│
├── discord_bot/                # Layer 2a: Discord Adapter
│   ├── main.py                 # Bot setup (imported by root main.py)
│   ├── cogs/
│   │   ├── scheduler_cog.py    # /schedule command → calls core/
│   │   ├── courses_cog.py      # /add-course, reactions → calls core/
│   │   ├── enrollment_cog.py   # /signup UI → calls core/
│   │   └── cohorts_cog.py      # /cohort command → calls core/
│   ├── utils/                  # Re-exports from core/ for backward compat
│   └── tests/
│
├── web_api/                    # Layer 2b: FastAPI
│   ├── main.py                 # Legacy standalone entry (not used in unified mode)
│   ├── auth.py                 # JWT utilities (create_jwt, verify_jwt, get_current_user)
│   └── routes/                 # API endpoints (imported by root main.py)
│       ├── auth.py             # /auth/* - Discord OAuth, session management
│       └── users.py            # /api/users/* - User profile endpoints
│
├── web_frontend/               # Layer 3: React frontend
└── activities/                 # Discord Activities (vanilla JS)
```

Layer 2a (Discord adapter) and 2b (FastAPI) should never communicate directly. I.e., they should never import functions from each other directly.

### Core (`core/`)

**Platform-agnostic business logic** - no Discord imports, pure Python:

- `scheduling.py` - Stochastic greedy algorithm, `Person`/`Group` dataclasses
- `courses.py` - `create_course()`, `mark_week_complete()`, `get_user_progress()`
- `enrollment.py` - `get_user_profile()`, `save_user_profile()`, `get_facilitators()`
- `cohorts.py` - `find_availability_overlap()`, `format_local_time()`
- `data.py` - JSON persistence (legacy, being migrated to PostgreSQL)
- `database.py` - SQLAlchemy async engine (`get_connection()`, `get_transaction()`)
- `auth.py` - Discord-to-Web auth flow (`create_auth_code()`, `get_or_create_user()`)

### Discord Bot (`discord_bot/`)

**Thin adapter cogs** - handle Discord UI/events, delegate logic to core/:

- `scheduler_cog.py` - `/schedule`, `/list-users` commands
- `courses_cog.py` - `/add-course`, `/sync-course`, reaction handling
- `enrollment_cog.py` - `/signup` flow with Views/Buttons/Selects
- `cohorts_cog.py` - `/cohort` command, channel/event creation

**Data persistence** - JSON files in `discord_bot/`:

- `user_data.json` - User profiles, availability, course progress
- `courses.json` - Course structure and Discord channel mappings

This will later be refactored to use the database instead.

### Activities (`activities/`)

Static HTML/JS Discord Activities served via `npx serve`. Each subfolder is a route. Currently vanilla JS, planned migration to React.

## Key Patterns

**Creating a new cog:**

```python
import discord
from discord import app_commands
from discord.ext import commands

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core import get_user_data, save_user_data  # Import from core

class MyCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="mycommand", description="Description")
    async def my_command(self, interaction: discord.Interaction):
        await interaction.response.send_message("Hello!")

async def setup(bot):
    await bot.add_cog(MyCog(bot))
```

Then add `"cogs.my_cog"` to `COGS` list in `main.py`.

**Admin-only commands:** Add `@app_commands.checks.has_permissions(administrator=True)`

**Data access (from cogs):**

```python
from core import (
    load_data, save_data, get_user_data, save_user_data,
    load_courses, save_courses, get_course,
    get_user_profile, save_user_profile
)
```

**Adding business logic:** Add to `core/` module, export in `core/__init__.py`, then import in cogs.

## Hosting

Single Railway service running the unified backend (`uvicorn main:app`).
Database: PostgreSQL (Supabase-hosted, accessed via SQLAlchemy).z
