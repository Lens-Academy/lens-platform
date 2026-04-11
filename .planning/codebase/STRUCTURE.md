# Codebase Structure

**Analysis Date:** 2026-02-14

## Directory Layout

```
ai-safety-course-platform/
├── main.py                      # Unified entry point (FastAPI + Discord bot)
├── requirements.txt             # Python dependencies
├── requirements-dev.txt         # Dev dependencies (pytest, ruff, mypy)
├── conftest.py                  # Pytest global fixtures
├── alembic.ini                  # Alembic migration config
├── package.json                 # Root npm package (minimal)
│
├── core/                        # Layer 1: Platform-agnostic business logic
├── discord_bot/                 # Layer 2a: Discord adapter
├── web_api/                     # Layer 2b: FastAPI HTTP adapter
├── web_frontend/                # Layer 3: Vike + React frontend
│
├── alembic/                     # Alembic migration engine
├── migrations/                  # Raw SQL migrations (legacy)
├── fixtures/                    # Test data fixtures
├── static/                      # Static files (legacy)
├── scripts/                     # Utility scripts
├── docs/                        # Design docs and notes
│
├── .planning/                   # GSD planning documents
├── .github/workflows/           # CI/CD workflows
└── .jj/                         # jj version control metadata
```

## Directory Purposes

**core/**
- Purpose: Platform-agnostic business logic, no Discord/FastAPI imports
- Contains: User management, scheduling, cohorts, content fetching, notifications, database access
- Key files: `database.py` (SQLAlchemy), `tables.py` (schema), `users.py`, `scheduling.py`, `__init__.py` (exports)

**core/calendar/**
- Purpose: Google Calendar API integration
- Contains: `client.py` (Calendar API), `events.py` (event CRUD), `rsvp.py` (RSVP sync)

**core/content/**
- Purpose: Educational content from GitHub
- Contains: `cache.py` (in-memory cache), `github_fetcher.py` (fetch from GitHub), `webhook_handler.py` (GitHub webhook)

**core/modules/**
- Purpose: Course/module content management
- Contains: `types.py` (type definitions), `content.py` (content operations), `chat.py` (LLM chat), `llm.py` (LiteLLM provider), `loader.py` (module loading), `course_loader.py` (course loading)

**core/discord_outbound/**
- Purpose: Discord API operations (keeps core platform-agnostic)
- Contains: `bot.py` (bot instance), `messages.py` (DMs/messages), `channels.py` (channel creation), `permissions.py` (channel access), `events.py` (scheduled events)

**core/notifications/**
- Purpose: Multi-channel notification system
- Contains: `dispatcher.py` (routing), `actions.py` (high-level actions), `scheduler.py` (APScheduler), `templates.py` (email/Discord templates), `channels/email.py` (SendGrid)

**core/queries/**
- Purpose: Reusable database query builders
- Contains: `users.py`, `cohorts.py`, `groups.py`, `meetings.py`, `refresh_tokens.py`

**core/transcripts/**
- Purpose: Chat transcript storage
- Contains: Transcript management for module chat sessions

**core/tests/**
- Purpose: Core module unit tests
- Contains: pytest test files for core business logic

**discord_bot/**
- Purpose: Discord UI adapter, delegates to core
- Contains: `main.py` (bot entry), `cogs/` (slash commands)
- Key files: `cogs/enrollment_cog.py`, `cogs/scheduler_cog.py`, `cogs/groups_cog.py`

**discord_bot/cogs/**
- Purpose: Discord slash command handlers
- Contains: `ping_cog.py`, `enrollment_cog.py`, `scheduler_cog.py`, `groups_cog.py`, `breakout_cog.py`, `stampy_cog.py`, `attendance_cog.py`, `nickname_cog.py`, `sync_cog.py`

**discord_bot/tests/**
- Purpose: Discord bot integration tests
- Contains: pytest test files for Discord-specific functionality

**web_api/**
- Purpose: FastAPI HTTP adapter, delegates to core
- Contains: `auth.py` (JWT utilities), `routes/` (API endpoints), `rate_limit.py`
- Key files: `routes/auth.py`, `routes/users.py`, `routes/courses.py`, `routes/module.py`

**web_api/routes/**
- Purpose: FastAPI route handlers
- Contains: `auth.py` (OAuth/JWT), `users.py`, `cohorts.py`, `courses.py`, `modules.py`, `module.py`, `content.py`, `facilitator.py`, `speech.py`, `groups.py`, `admin.py`, `progress.py`

**web_api/tests/**
- Purpose: Web API integration tests
- Contains: pytest test files for API endpoints

**web_frontend/**
- Purpose: React frontend (Vike + Vite + Tailwind v4)
- Contains: `src/` (source), `dist/` (build output), `public/` (static assets)
- Key files: `vite.config.ts`, `package.json`, `tsconfig.json`

**web_frontend/src/pages/**
- Purpose: Vike file-based routes
- Contains: Route page components (`+Page.tsx`), data loaders (`+data.ts`), layouts (`+Layout.tsx`)

**web_frontend/src/components/**
- Purpose: Reusable React components
- Contains: `nav/`, `module/`, `course/`, `enroll/`, `schedule/`, `icons/`

**web_frontend/src/api/**
- Purpose: API client functions
- Contains: TypeScript functions for calling backend API endpoints

**web_frontend/src/hooks/**
- Purpose: Custom React hooks
- Contains: Reusable React hooks for auth, data fetching, UI state

**web_frontend/src/utils/**
- Purpose: Frontend utility functions
- Contains: Helper functions for formatting, validation, etc.

**web_frontend/dist/**
- Purpose: Vike build output (served by FastAPI in production)
- Contains: `client/` (SSG HTML + SPA assets), `server/` (Vike SSR server bundle)
- Generated: Yes
- Committed: No

**alembic/**
- Purpose: Alembic migration engine
- Contains: `env.py` (Alembic config), `versions/` (migration files)

**alembic/versions/**
- Purpose: Database migration files (auto-generated + manual)
- Contains: Python files with `upgrade()` and `downgrade()` functions

**migrations/**
- Purpose: Legacy raw SQL migrations (before Alembic)
- Contains: Numbered SQL files

**fixtures/**
- Purpose: Test data fixtures
- Contains: Sample data for pytest tests

**scripts/**
- Purpose: Utility scripts
- Contains: `list-servers` (dev server management), other helper scripts

**docs/**
- Purpose: Design documents and notes
- Contains: `architecture/`, `design/`, `plans/`, `notes/`, `reviews/`, `designs/`

**.planning/**
- Purpose: GSD planning documents
- Contains: `codebase/` (this file), `phases/`, `todos/`, `milestones/`, `research/`

**.github/workflows/**
- Purpose: CI/CD workflows
- Contains: `ci.yml` (lint + test), other workflow files

## Key File Locations

**Entry Points:**
- `main.py`: Unified backend (FastAPI + Discord bot)
- `discord_bot/main.py`: Bot-only mode (legacy)
- `web_api/main.py`: API-only mode (legacy)
- `web_frontend/src/pages/index/+Page.tsx`: Landing page

**Configuration:**
- `.env`: Environment variables (gitignored)
- `.env.local`: Local overrides (gitignored, loaded first)
- `alembic.ini`: Alembic migration config
- `requirements.txt`: Python dependencies
- `web_frontend/package.json`: Frontend dependencies
- `web_frontend/vite.config.ts`: Vite build config

**Core Logic:**
- `core/database.py`: SQLAlchemy async engine
- `core/tables.py`: Database schema (SQLAlchemy Core)
- `core/users.py`: User management
- `core/scheduling.py`: Cohort scheduling algorithm
- `core/sync.py`: External system sync operations
- `core/notifications/actions.py`: Notification actions

**Testing:**
- `conftest.py`: Global pytest fixtures
- `core/tests/`: Core unit tests
- `discord_bot/tests/`: Discord integration tests
- `web_api/tests/`: API integration tests
- `web_frontend/src/**/__tests__/`: Frontend component tests

## Naming Conventions

**Files:**
- Python modules: `snake_case.py` (e.g., `user_profile.py`)
- TypeScript/React: `PascalCase.tsx` for components, `camelCase.ts` for utilities
- Vike pages: `+Page.tsx`, `+data.ts`, `+Layout.tsx`

**Directories:**
- Python: `snake_case/` (e.g., `discord_bot/`, `web_api/`)
- TypeScript: `camelCase/` or `kebab-case/` (e.g., `components/`, `api/`)

## Where to Add New Code

**New Business Logic:**
- Primary code: `core/my_feature.py`
- Tests: `core/tests/test_my_feature.py`
- Export: Add to `core/__init__.py`

**New Discord Command:**
- Primary code: `discord_bot/cogs/my_cog.py`
- Tests: `discord_bot/tests/test_my_cog.py`
- Register: Add `"cogs.my_cog"` to `COGS` list in `discord_bot/main.py`

**New API Endpoint:**
- Primary code: `web_api/routes/my_route.py`
- Tests: `web_api/tests/test_my_route.py`
- Register: Import and `app.include_router()` in `main.py`

**New Frontend Page:**
- Primary code: `web_frontend/src/pages/my-page/+Page.tsx`
- Data loader (if needed): `web_frontend/src/pages/my-page/+data.ts`
- Route: File path determines URL (e.g., `/my-page`)

**New React Component:**
- Implementation: `web_frontend/src/components/my-component/MyComponent.tsx`
- Tests: `web_frontend/src/components/my-component/__tests__/MyComponent.test.tsx`

**Utilities:**
- Shared Python helpers: `core/utils.py` or `core/my_domain/utils.py`
- Shared TypeScript helpers: `web_frontend/src/utils/myUtil.ts`

**New Database Table:**
1. Edit schema: `core/tables.py` (add SQLAlchemy Table definition)
2. Generate migration: `.venv/bin/alembic revision --autogenerate -m "description"`
3. Review migration: `alembic/versions/XXXX_description.py`
4. Apply migration: `.venv/bin/alembic upgrade head`

## Special Directories

**node_modules/**
- Purpose: npm dependencies for frontend
- Generated: Yes (by `npm install`)
- Committed: No

**__pycache__/**
- Purpose: Python bytecode cache
- Generated: Yes (by Python interpreter)
- Committed: No

**.venv/**
- Purpose: Python virtual environment (symlink to repo root venv)
- Generated: Yes (by user)
- Committed: No

**.pytest_cache/**
- Purpose: pytest cache
- Generated: Yes (by pytest)
- Committed: No

**dist/**
- Purpose: Vike build output
- Generated: Yes (by `npm run build`)
- Committed: No

**static/spa/**
- Purpose: Legacy static SPA files
- Generated: No (manual)
- Committed: Yes

---

*Structure analysis: 2026-02-14*
