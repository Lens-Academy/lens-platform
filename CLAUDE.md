# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**See also:** Subdirectory-specific guidance in `core/CLAUDE.md`, `discord_bot/CLAUDE.md`, `web_api/CLAUDE.md`, and `web_frontend/CLAUDE.md`.

## Critical Rules

**NEVER push directly to `main`** All changes must go through pull requests with CI checks. 

Always ask the user before pushing to any shared branch, including `staging`.

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

## Python Virtual Environment

A shared venv lives at the repo root (`../.venv/` relative to any workspace). Use it for running Python tools:

```bash
../.venv/bin/python main.py    # Run server
../.venv/bin/alembic            # Run alembic
../.venv/bin/pytest             # Run tests
```

## Commands

Run the server: `python main.py`. This is a unified backend (FastAPI + Discord Bot) that also serves the frontend.

Options:
- `--dev` - Dev mode: API returns JSON at /, run Vike frontend separately
- `--no-bot` - Without Discord bot
- `--no-db` - Skip database check (for frontend-only development)
- `--port` - Override port (defaults to API_PORT env var, or 8000)

**Database connection failures:** If the database connection fails, ask the user to start the database (Docker). Never use `--no-db` without explicit permission from the user.

**Tests:**
```bash
pytest                        # All tests
pytest core/tests/            # Core module tests
pytest discord_bot/tests/     # Discord bot tests
pytest web_api/tests/         # Web API tests
```

## Dev Server Management

Ports are auto-assigned based on workspace number (offset by 100 to avoid collisions when servers auto-increment):
- No suffix → API :8000, Frontend :3000
- `ws1` → API :8100, Frontend :3100
- `ws2` → API :8200, Frontend :3200
- `ws3` → API :8300, Frontend :3300
- etc.

The frontend and backend ports must be exactly 5000 apart, or they won't be able to connect to each other.

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

**Never use:** `pkill -f "python main.py"` - this kills ALL dev servers across all workspaces.

## Architecture

Discord bot + web platform for AI Safety education course logistics.

### Unified Backend

**One process, one asyncio event loop** running two peer services:

- **FastAPI** (HTTP server on :8000) - serves web API for React frontend
- **Discord bot** (WebSocket to Discord) - handles slash commands and events

Both services share the same event loop, `core/` business logic, and database connections (PostgreSQL via SQLAlchemy).

### 3-Layer Architecture

```
ai-safety-course-platform/
├── main.py                     # Unified entry point (FastAPI + Discord bot)
├── requirements.txt            # Python dependencies
│
├── core/                       # Layer 1: Business Logic (platform-agnostic)
│   ├── *.py                    # Base modules (see core/CLAUDE.md)
│   ├── calendar/               # Google Calendar integration
│   ├── content/                # GitHub content fetching
│   ├── modules/                # Course/module management
│   ├── notifications/          # Multi-channel notifications
│   └── tests/
│
├── discord_bot/                # Layer 2a: Discord Adapter (see discord_bot/CLAUDE.md)
│   ├── main.py
│   ├── cogs/                   # Slash commands
│   └── tests/
│
├── web_api/                    # Layer 2b: FastAPI (see web_api/CLAUDE.md)
│   ├── auth.py                 # JWT utilities
│   ├── routes/                 # API endpoints
│   └── tests/
│
├── web_frontend/               # Layer 3: Vike + React (see web_frontend/CLAUDE.md)
│   ├── src/
│   └── dist/                   # Built SPA (served by FastAPI)
│
├── migrations/                 # Raw SQL database migrations
├── alembic/                    # Alembic migration config
├── docs/                       # Design docs
└── scripts/                    # Utility scripts
```

**Layer separation:** Layer 2a (Discord) and Layer 2b (FastAPI) should never import from each other. Both delegate to `core/`.

## Database Migrations

**Workflow for schema changes:**

1. **Edit SQLAlchemy schema** in `core/tables.py`
2. **Auto-generate migration** with Alembic:
   ```bash
   ../.venv/bin/alembic revision --autogenerate -m "description of change"
   ```
3. **Manually review and fix** the generated migration file in `alembic/versions/`
   - Alembic autogenerate is imperfect - always verify the SQL is correct
   - Add data migrations if needed
   - Test both upgrade and downgrade paths
4. **Walk through migration with user** - Show the user the migration and explain changes
5. **Run the migration** after user approval

Never write raw SQL migrations directly. Always start from SQLAlchemy schema changes.

## UI/UX Patterns

**Never use `cursor-not-allowed`** - use `cursor-default` instead for non-interactive elements.

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

For production access, go to Railway Dashboard → production environment.
