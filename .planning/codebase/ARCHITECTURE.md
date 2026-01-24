# Architecture

**Analysis Date:** 2026-01-21

## Pattern Overview

**Overall:** 3-Layer Architecture with Unified Backend

**Key Characteristics:**
- Single Python process running FastAPI + Discord bot in one asyncio event loop
- Platform-agnostic business logic in `core/` shared by both adapters
- Adapters (Discord, FastAPI) never import from each other - communicate only through `core/`
- React frontend (Vike/Vite) served statically in production, separate dev server in development

## Layers

**Layer 1 - Core Business Logic:**
- Purpose: Platform-agnostic business logic, database access, external integrations
- Location: `core/`
- Contains: User management, scheduling algorithms, notifications, calendar integration, content loading
- Depends on: Database (PostgreSQL), external APIs (Discord OAuth, Google Calendar, SendGrid, LiteLLM)
- Used by: Discord bot (Layer 2a), FastAPI (Layer 2b)

**Layer 2a - Discord Adapter:**
- Purpose: Discord slash commands and events, thin adapter to core
- Location: `discord_bot/`
- Contains: Cogs (command handlers), Discord UI components (Views, Buttons, Selects)
- Depends on: `core/`, discord.py library
- Used by: Discord users via slash commands

**Layer 2b - FastAPI Adapter:**
- Purpose: HTTP API for React frontend
- Location: `web_api/`
- Contains: Route handlers, JWT authentication, request/response models
- Depends on: `core/`, FastAPI, httpx
- Used by: React frontend (Layer 3)

**Layer 3 - React Frontend:**
- Purpose: User-facing web interface
- Location: `web_frontend/`
- Contains: React components, Vike pages, API client, Tailwind styles
- Depends on: FastAPI API (Layer 2b)
- Used by: End users via browser

## Data Flow

**Authentication Flow (Discord OAuth):**

1. User clicks "Sign in with Discord" on frontend
2. Frontend redirects to `/auth/discord` (FastAPI)
3. FastAPI redirects to Discord OAuth URL with state
4. User authorizes on Discord
5. Discord redirects to `/auth/discord/callback` with code
6. FastAPI exchanges code for access token, fetches user info
7. `core.get_or_create_user()` creates/updates user in database
8. JWT issued and set as cookie, redirect to frontend

**Module Session Flow (Learning Content):**

1. User starts module → frontend calls `POST /api/module-sessions`
2. FastAPI route creates session via `core.modules.sessions.create_session()`
3. Session stored in `module_sessions` table with initial state
4. User progresses → frontend calls `POST /api/module-sessions/{id}/advance`
5. Backend updates `current_stage_index`, returns new stage content
6. LLM interactions streamed via SSE from `POST /api/module-sessions/{id}/message`

**Cohort Enrollment Flow:**

1. User provides availability via web form or Discord `/signup`
2. `core.save_user_profile()` stores availability in `users` table
3. Admin runs `/schedule` Discord command
4. `core.schedule_cohort()` runs scheduling algorithm (stochastic greedy)
5. Groups created in `groups` table, users assigned via `groups_users`
6. `core.notify_group_assigned()` sends notifications (email + Discord DM)

**State Management:**
- Server-side: PostgreSQL database, session state in `module_sessions` table
- Client-side: React state, no global state management library
- Auth: JWT in HttpOnly cookie, validated per-request

## Key Abstractions

**Person (Scheduling):**
- Purpose: Represents a user with availability for scheduling algorithm
- Examples: `core/scheduling.py`
- Pattern: Dataclass wrapping user ID, timezone, availability intervals

**Module/Stage (Content):**
- Purpose: Represents educational content structure
- Examples: `core/modules/types.py`, `core/modules/loader.py`
- Pattern: Typed dataclasses loaded from YAML, stages are polymorphic (article, video, chat)

**Session:**
- Purpose: Tracks user progress through a module
- Examples: `core/modules/sessions.py`, `core/tables.py` (module_sessions)
- Pattern: Database row with stage index, message history (JSONB), timestamps

**Notification:**
- Purpose: Multi-channel notification abstraction
- Examples: `core/notifications/dispatcher.py`, `core/notifications/channels/`
- Pattern: Dispatcher routes to channels (email, Discord DM), templates render content

## Entry Points

**Unified Backend (`main.py`):**
- Location: `/Users/luca/dev/ai-safety-course-platform/main.py`
- Triggers: `python main.py [--dev] [--no-bot] [--port PORT]`
- Responsibilities: Initialize FastAPI app, start Discord bot as background task, manage lifecycle

**FastAPI Routes:**
- Location: `web_api/routes/*.py`
- Triggers: HTTP requests to `/api/*`, `/auth/*`
- Responsibilities: Handle HTTP requests, validate auth, delegate to core

**Discord Cogs:**
- Location: `discord_bot/cogs/*.py`
- Triggers: Discord slash commands, events
- Responsibilities: Handle Discord interactions, delegate to core

**Frontend Pages:**
- Location: `web_frontend/src/pages/*/+Page.tsx`
- Triggers: Browser navigation
- Responsibilities: Render UI, call API, manage local state

## Error Handling

**Strategy:** Exceptions bubble up, handled at adapter layer

**Patterns:**
- Core raises domain exceptions (e.g., `SessionNotFoundError`, `SessionAlreadyClaimedError`)
- FastAPI routes catch and convert to `HTTPException` with appropriate status codes
- Discord cogs catch and send ephemeral error messages
- Sentry captures unhandled exceptions in both backend and frontend

**Backend Error Flow:**
```python
# core/modules/sessions.py
raise SessionNotFoundError(f"Session not found: {session_id}")

# web_api/routes/modules.py
try:
    session = await get_session(session_id)
except SessionNotFoundError:
    raise HTTPException(status_code=404, detail="Session not found")
```

**Frontend Error Flow:**
- API client functions throw on non-OK responses
- Components catch and display error UI
- Sentry captures with context (endpoint, user info)

## Cross-Cutting Concerns

**Logging:**
- Backend: Python `print()` statements for startup, critical events
- Frontend: `console.error()` for API failures, Sentry for errors

**Validation:**
- Backend: Pydantic models in FastAPI routes, SQLAlchemy for database constraints
- Frontend: TypeScript types, runtime validation in API client

**Authentication:**
- JWT tokens in HttpOnly cookies
- `web_api.auth.get_current_user()` FastAPI dependency extracts user from token
- `web_api.auth.get_optional_user()` for endpoints that work with/without auth

**Database Access:**
- Async SQLAlchemy Core (not ORM) via `core/database.py`
- `get_connection()` for reads, `get_transaction()` for writes with auto-commit/rollback
- Connection pooling configured for Supabase pgbouncer compatibility

---

*Architecture analysis: 2026-01-21*
