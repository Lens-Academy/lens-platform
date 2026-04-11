# Architecture

**Analysis Date:** 2026-02-14

## Pattern Overview

**Overall:** 3-Layer Unified Backend with Peer Services

**Key Characteristics:**
- Single Python process running FastAPI + Discord bot in one asyncio event loop
- Strict layer separation: adapters (`discord_bot/`, `web_api/`) delegate to platform-agnostic `core/`
- Shared database connections (PostgreSQL via async SQLAlchemy)
- Outbound Discord operations abstracted through `core/discord_outbound/` to keep core platform-agnostic
- Diff-based sync operations reconcile external systems (Discord, Calendar, Reminders) with database state

## Layers

**Layer 1: Core Business Logic**
- Purpose: Platform-agnostic business logic and data access
- Location: `core/`
- Contains: User management, scheduling algorithm, cohort logic, content fetching, notifications, database queries
- Depends on: Database (SQLAlchemy), external APIs (Google Calendar, GitHub, SendGrid, LiteLLM)
- Used by: `discord_bot/`, `web_api/`, background tasks
- Rule: **NEVER** imports from `discord_bot/` or `web_api/`

**Layer 2a: Discord Adapter**
- Purpose: Discord UI/events adapter
- Location: `discord_bot/`
- Contains: Discord.py cogs (slash commands), event handlers, Discord Views/Buttons
- Depends on: `core/`, Discord.py library
- Used by: Unified backend (`main.py`) via `bot.start()`
- Rule: **NEVER** imports from `web_api/`

**Layer 2b: Web API Adapter**
- Purpose: HTTP API for React frontend
- Location: `web_api/`
- Contains: FastAPI routes, JWT auth utilities, rate limiting
- Depends on: `core/`, FastAPI
- Used by: Unified backend (`main.py`) via FastAPI app instance
- Rule: **NEVER** imports from `discord_bot/`

**Layer 3: Frontend**
- Purpose: Web UI for learners and facilitators
- Location: `web_frontend/`
- Contains: Vike + React 19 + Tailwind v4
- Depends on: Web API (`/api/*`, `/auth/*` endpoints)
- Used by: End users via browser

## Data Flow

**Discord Command Flow:**

1. User types `/schedule` in Discord
2. Discord bot cog (`discord_bot/cogs/scheduler_cog.py`) receives command
3. Cog calls `core.schedule_cohort(users)` with scheduling parameters
4. Core runs algorithm, returns `CohortSchedulingResult`
5. Cog sends result to Discord channel as formatted message
6. If groups created, cog calls `core.sync_group()` to sync Discord/Calendar/Reminders

**Web API Flow:**

1. Browser sends `GET /api/courses/default` with JWT cookie
2. `web_api/routes/courses.py` route validates JWT via `get_current_user` dependency
3. Route calls `core.modules.course_loader.load_course(slug)`
4. Core loads course content from GitHub cache
5. Route returns JSON to browser
6. React frontend renders course content

**Background Job Flow:**

1. `main.py` lifespan initializes APScheduler
2. Scheduler triggers `core.sync.sync_all_group_rsvps()` every 6 hours
3. Core fetches calendar RSVPs from Google Calendar API
4. Core updates database RSVP records
5. Core logs sync results to Sentry

**State Management:**
- Database as source of truth (PostgreSQL via SQLAlchemy)
- External systems (Discord channels, Calendar events, APScheduler jobs) synced via diff-based reconciliation
- Frontend state managed via React hooks, no global state library

## Key Abstractions

**User:**
- Purpose: Represents a platform user (learner or facilitator)
- Examples: `core/users.py`, `core/tables.py` (users table)
- Pattern: Database record + business logic functions (`get_user_profile`, `save_user_profile`)

**Cohort:**
- Purpose: A scheduled instance of a course with enrolled users
- Examples: `core/cohorts.py`, `core/tables.py` (cohorts table)
- Pattern: Database record + scheduling algorithm (`core/scheduling.py`)

**Group:**
- Purpose: Small learning group within a cohort (4-6 learners + facilitator)
- Examples: `core/tables.py` (groups, groups_users tables), `core/sync.py`
- Pattern: Database record + sync operations to external systems

**Module:**
- Purpose: Unit of course content (reading + exercises + chat)
- Examples: `core/modules/types.py`, `core/modules/content.py`
- Pattern: YAML files loaded from GitHub, cached in memory, flattened for API consumption

**Notification:**
- Purpose: Multi-channel message (Email, Discord DM) sent to user
- Examples: `core/notifications/actions.py`, `core/notifications/dispatcher.py`
- Pattern: Template rendering + channel routing (SendGrid for email, Discord bot for DMs)

## Entry Points

**Unified Backend (Production):**
- Location: `main.py`
- Triggers: `python main.py` (or Railway deployment)
- Responsibilities: Start FastAPI + Discord bot in single event loop, initialize scheduler, serve built frontend from `web_frontend/dist/`

**Dev Mode Backend:**
- Location: `main.py --dev`
- Triggers: `python main.py --dev`
- Responsibilities: API-only mode (returns JSON at `/`), expects separate Vite dev server for frontend

**Frontend Dev Server:**
- Location: `web_frontend/` → `npm run dev`
- Triggers: Developer running Vite
- Responsibilities: Hot-reloading React dev server, proxies `/api` and `/auth` to backend

**Discord Bot Standalone (Legacy):**
- Location: `discord_bot/main.py`
- Triggers: `python discord_bot/main.py` (not used in production)
- Responsibilities: Bot-only mode for testing

**Web API Standalone (Legacy):**
- Location: `web_api/main.py`
- Triggers: `cd web_api && python main.py` (not used in production)
- Responsibilities: API-only mode for testing

## Error Handling

**Strategy:** Layered error handling with Sentry integration

**Patterns:**
- **Startup failures:** `fatal_startup_error()` in `main.py` logs to Sentry + exits cleanly (Railway captures this)
- **API errors:** FastAPI `HTTPException` for 4xx errors, unhandled exceptions become 500s captured by Sentry
- **Discord errors:** Global `@bot.tree.error` handler in `discord_bot/main.py` sends user-friendly messages
- **Background jobs:** Try/except in scheduled functions, log to Sentry, continue running
- **Database errors:** SQLAlchemy exceptions propagate up, automatic rollback in `get_transaction()` context manager

## Cross-Cutting Concerns

**Logging:** Python `logging` module, structured logs via `logger.info/error`, Sentry for production

**Validation:** Pydantic models in `web_api/` routes, manual validation in `core/` business logic, database constraints in `core/tables.py`

**Authentication:** Discord OAuth → FastAPI JWT (HTTP-only cookies) + Refresh tokens (database-backed with rotation)

---

*Architecture analysis: 2026-02-14*
