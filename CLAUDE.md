# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Critical Rules

**NEVER push directly to `main` or `staging` branches.** These are production/staging servers used by real people. All changes must go through pull requests with CI checks. Always ask the user before pushing to any shared branch.

**Before pushing ANY code to GitHub**, run these checks:

```bash
# Frontend (from web_frontend/)
cd web_frontend
npm run lint          # ESLint
npm run build         # TypeScript type check + Vite/Vike build

# Backend (from repo root)
ruff check .          # Python linting
ruff format --check . # Python formatting check
pytest                # Run tests
```

Fix any errors before pushing. CI will run these same checks.

## Commands

Run the server: `python main.py`. This is a unified backend (FastAPI + Discord Bot) that also serves the frontend.

Options:
--dev (enables dev mode - API returns JSON at /, run Vike frontend separately)
--no-bot (without Discord bot)
--no-db (skip database check - for frontend-only development)
--port (defaults to API_PORT env var, or 8000)

**Database connection failures:** If the database connection fails, ask the user to start the database (Docker). Never use `--no-db` without explicit permission from the user.

**Tests:**

```bash
pytest                        # All tests
pytest discord_bot/tests/     # Discord bot tests
pytest core/tests/            # Core module tests
```

**Legacy (standalone, for reference):**

```bash
cd discord_bot && python main.py  # Discord bot only
cd web_api && python main.py      # FastAPI only
```

## Dev Server Management

Ports are auto-assigned based on workspace number:
- No suffix → API :8000, Frontend :3000
- `ws1` → API :8001, Frontend :3001
- `ws2` → API :8002, Frontend :3002
- etc.

Override via `.env.local` (gitignored) or CLI `--port`.

**Before killing any server, always list first:**
```bash
./scripts/list-servers
```
This shows which workspace started each server. Only kill servers from YOUR workspace (matching your current directory name).

**Killing a server by port:**
```bash
lsof -ti:<PORT> | xargs kill
```
Example: `lsof -ti:8000 | xargs kill` kills only the server on port 8000.

**Never use:** `pkill -f "python main.py"` - this kills ALL dev servers across all workspaces.

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
│   ├── users.py                # User profiles, availability storage
│   ├── cohorts.py              # Group creation, availability matching
│   ├── availability.py         # Availability data handling
│   ├── meetings.py             # Meeting/calendar operations
│   ├── database.py             # SQLAlchemy async engine
│   ├── tables.py               # SQLAlchemy ORM table definitions
│   ├── auth.py                 # Discord-to-Web auth flow
│   ├── config.py               # Configuration management
│   ├── enums.py                # Enum definitions
│   ├── timezone.py             # UTC/local conversions
│   ├── constants.py            # Day codes (M,T,W,R,F,S,U), timezones
│   ├── cohort_names.py         # Group name generation
│   ├── nickname.py             # User nickname management
│   ├── nickname_sync.py        # Discord nickname sync
│   ├── speech.py               # Speech/TTS integration
│   ├── stampy.py               # Stampy chatbot functionality
│   ├── google_docs.py          # Google Docs fetching/parsing
│   ├── data.py                 # JSON persistence (legacy)
│   ├── calendar/               # Google Calendar integration
│   │   ├── client.py           # Calendar API client
│   │   ├── events.py           # Event creation/management
│   │   └── rsvp.py             # RSVP tracking and sync
│   ├── content/                # Educational content from GitHub
│   │   ├── cache.py            # Content caching
│   │   ├── github_fetcher.py   # GitHub content retrieval
│   │   └── webhook_handler.py  # GitHub webhook handling
│   ├── modules/                # Course/module management
│   │   ├── types.py            # Type definitions
│   │   ├── content.py          # Module content
│   │   ├── chat.py             # LLM chat integration
│   │   ├── llm.py              # LLM provider logic (LiteLLM)
│   │   ├── loader.py           # Module loading
│   │   ├── course_loader.py    # Course loading
│   │   ├── markdown_parser.py  # Markdown parsing
│   │   ├── markdown_validator.py # Content validation
│   │   └── sessions.py         # Chat session management
│   ├── notifications/          # Multi-channel notification system
│   │   ├── actions.py          # Notification actions
│   │   ├── dispatcher.py       # Notification routing
│   │   ├── scheduler.py        # APScheduler integration
│   │   ├── templates.py        # Email/Discord templates
│   │   ├── urls.py             # Dynamic URL generation
│   │   └── channels/           # Channel implementations
│   │       ├── discord.py      # Discord notifications
│   │       └── email.py        # SendGrid email integration
│   ├── lessons/                # Lesson-related content
│   ├── queries/                # Database query builders
│   ├── transcripts/            # Chat transcript storage
│   └── tests/                  # Core unit tests
│
├── discord_bot/                # Layer 2a: Discord Adapter
│   ├── main.py                 # Bot setup (imported by root main.py)
│   ├── cogs/
│   │   ├── scheduler_cog.py    # /schedule command → calls core/
│   │   ├── enrollment_cog.py   # /signup UI → calls core/
│   │   ├── groups_cog.py       # /group command → calls core/
│   │   ├── breakout_cog.py     # Breakout room management
│   │   ├── nickname_cog.py     # Nickname sync commands
│   │   ├── stampy_cog.py       # Stampy chatbot integration
│   │   ├── sync_cog.py         # Slash command sync
│   │   └── ping_cog.py         # Health check command
│   ├── utils/                  # Re-exports from core/ for backward compat
│   └── tests/
│
├── web_api/                    # Layer 2b: FastAPI
│   ├── main.py                 # Legacy standalone entry (not used in unified mode)
│   ├── auth.py                 # JWT utilities (create_jwt, verify_jwt, get_current_user)
│   └── routes/                 # API endpoints (imported by root main.py)
│       ├── auth.py             # /auth/* - Discord OAuth, session management
│       ├── users.py            # /api/users/* - User profile endpoints
│       ├── cohorts.py          # /api/cohorts/* - Cohort management
│       ├── courses.py          # /api/courses/* - Course endpoints
│       ├── modules.py          # /api/modules/* - Module list endpoints
│       ├── module.py           # /api/module/* - Single module endpoints
│       ├── content.py          # /api/content/* - Educational content
│       ├── facilitator.py      # /api/facilitator/* - Facilitator endpoints
│       └── speech.py           # /api/speech/* - TTS endpoints
│
├── web_frontend/               # Layer 3: Vike + React frontend
│   ├── src/
│   │   ├── pages/              # Vike route pages
│   │   ├── components/         # React components
│   │   ├── hooks/              # Custom React hooks
│   │   ├── api/                # API client functions
│   │   ├── lib/                # Utility libraries
│   │   ├── utils/              # Helper utilities
│   │   ├── views/              # View components
│   │   ├── types/              # TypeScript types
│   │   └── styles/             # CSS/styling
│   └── dist/                   # Built Vike SPA (served by FastAPI)
│
├── migrations/                 # Raw SQL database migrations
├── alembic/                    # Alembic migration config
├── docs/                       # Design docs and implementation plans
├── scripts/                    # Utility scripts
└── static/                     # Static assets
```

Layer 2a (Discord adapter) and 2b (FastAPI) should never communicate directly. I.e., they should never import functions from each other directly.

### Core (`core/`)

**Platform-agnostic business logic** - no Discord imports, pure Python:

- `scheduling.py` - Stochastic greedy algorithm, `Person`/`Group` dataclasses
- `users.py` - `get_user_profile()`, `save_user_profile()`, `get_facilitators()`
- `cohorts.py` - `find_availability_overlap()`, `format_local_time()`
- `database.py` - SQLAlchemy async engine (`get_connection()`, `get_transaction()`)
- `tables.py` - SQLAlchemy ORM table definitions
- `auth.py` - Discord-to-Web auth flow (`create_auth_code()`, `get_or_create_user()`)
- `config.py` - Environment configuration management
- `modules/` - Course content loading, LLM chat integration
- `notifications/` - Multi-channel notification dispatcher (Discord, email via SendGrid)
- `calendar/` - Google Calendar integration for meeting scheduling
- `content/` - GitHub-based educational content fetching and caching

### Discord Bot (`discord_bot/`)

**Thin adapter cogs** - handle Discord UI/events, delegate logic to core/:

- `scheduler_cog.py` - `/schedule`, `/list-users` commands
- `enrollment_cog.py` - `/signup` flow with Views/Buttons/Selects
- `groups_cog.py` - `/group` command, channel/event creation
- `breakout_cog.py` - Breakout room management for sessions
- `nickname_cog.py` - Discord nickname synchronization
- `stampy_cog.py` - Stampy AI chatbot integration
- `sync_cog.py` - Slash command tree synchronization
- `ping_cog.py` - Health check and latency command

### Frontend (`web_frontend/`)

Vike (v0.4) + Vite (v7) + React 19 + Tailwind CSS v4. Uses partial SSG prerendering with SPA fallback.

**Development:**
```bash
cd web_frontend
npm run dev      # Vite dev server
npm run build    # Production build
npm run preview  # Preview production build
```

The built frontend (`dist/`) is served by FastAPI in production.

## Key Patterns

**Creating a new cog:**

```python
import discord
from discord import app_commands
from discord.ext import commands

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core import get_user_profile, save_user_profile  # Import from core

class MyCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="mycommand", description="Description")
    async def my_command(self, interaction: discord.Interaction):
        await interaction.response.send_message("Hello!")

async def setup(bot):
    await bot.add_cog(MyCog(bot))
```

Then add `"cogs.my_cog"` to `COGS` list in `discord_bot/main.py`.

**Admin-only commands:** Add `@app_commands.checks.has_permissions(administrator=True)`

**Data access (from cogs):**

```python
from core import (
    get_user_profile, save_user_profile,
    get_facilitators, is_facilitator
)
```

**Adding business logic:** Add to `core/` module, export in `core/__init__.py`, then import in cogs.

## UI/UX Patterns

**Never use `cursor-not-allowed`** - use `cursor-default` instead for non-interactive elements. The not-allowed cursor is visually aggressive and unnecessary; a default cursor with lack of hover feedback is sufficient to indicate non-interactivity.

## Hosting

Single Railway service running the unified backend (`uvicorn main:app`).
Database: PostgreSQL (Supabase-hosted, accessed via SQLAlchemy).

**Key integrations:**
- Sentry - Error tracking (backend and frontend)
- PostHog - Analytics
- SendGrid - Email notifications
- Google Calendar API - Meeting scheduling
- LiteLLM - LLM provider abstraction

**Railway CLI:**

```bash
# Link to staging (default for development)
railway link -p 779edcd4-bb95-40ad-836f-0bf4113c4453 -e 0cadba59-5e24-4d9f-8620-c8fc2722a2de -s lensacademy

# View logs
railway logs -n 100
```

For production access, go to Railway Dashboard → production environment and copy the URL.
