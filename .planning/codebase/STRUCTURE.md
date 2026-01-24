# Codebase Structure

**Analysis Date:** 2026-01-21

## Directory Layout

```
ai-safety-course-platform/
├── core/                       # Layer 1: Business logic (platform-agnostic)
│   ├── calendar/               # Google Calendar integration
│   ├── content/                # GitHub content fetching
│   ├── modules/                # Course/module management
│   ├── notifications/          # Multi-channel notifications
│   ├── queries/                # Database query builders
│   ├── transcripts/            # Chat transcript storage
│   ├── tests/                  # Core unit tests
│   └── *.py                    # Base modules
├── discord_bot/                # Layer 2a: Discord adapter
│   ├── cogs/                   # Slash command handlers
│   ├── utils/                  # Discord-specific utilities
│   └── tests/
├── web_api/                    # Layer 2b: FastAPI adapter
│   ├── routes/                 # HTTP endpoint handlers
│   └── tests/
├── web_frontend/               # Layer 3: React frontend
│   ├── src/
│   │   ├── pages/              # Vike route pages
│   │   ├── components/         # React components
│   │   ├── views/              # Page view components
│   │   ├── api/                # API client functions
│   │   ├── hooks/              # Custom React hooks
│   │   ├── types/              # TypeScript types
│   │   ├── utils/              # Helper utilities
│   │   ├── styles/             # CSS/Tailwind
│   │   └── assets/             # Static assets
│   ├── public/                 # Public static files
│   └── dist/                   # Built SPA (gitignored)
├── migrations/                 # Raw SQL migrations (manual)
├── alembic/                    # Alembic migration config
├── scripts/                    # Utility scripts
├── static/                     # Backend static files
├── docs/                       # Design documentation
├── main.py                     # Unified backend entry point
├── conftest.py                 # Pytest configuration
├── requirements.txt            # Python dependencies
└── CLAUDE.md                   # AI assistant instructions
```

## Directory Purposes

**`core/`:**
- Purpose: All business logic shared between Discord and web
- Contains: Database operations, scheduling algorithms, notifications, external API clients
- Key files:
  - `__init__.py` - Public API exports
  - `database.py` - Async SQLAlchemy connection management
  - `tables.py` - SQLAlchemy table definitions
  - `users.py` - User CRUD operations
  - `scheduling.py` - Cohort scheduling algorithm
  - `config.py` - Environment configuration

**`core/modules/`:**
- Purpose: Course and module content management
- Contains: YAML loaders, markdown parsers, LLM chat, session management
- Key files:
  - `loader.py` - Load module from YAML
  - `course_loader.py` - Load course structure
  - `sessions.py` - Session state management
  - `chat.py` - LLM conversation handling
  - `llm.py` - LiteLLM provider abstraction
  - `types.py` - Module/Stage type definitions

**`core/notifications/`:**
- Purpose: Multi-channel notification dispatch
- Contains: Email (SendGrid), Discord DM, scheduling (APScheduler)
- Key files:
  - `dispatcher.py` - Route notifications to channels
  - `scheduler.py` - Background job scheduling
  - `templates.py` - Email/message templates
  - `actions.py` - High-level notification actions
  - `channels/email.py` - SendGrid integration
  - `channels/discord.py` - Discord DM sending

**`core/queries/`:**
- Purpose: Reusable database query builders
- Contains: SQLAlchemy Core queries organized by domain
- Key files:
  - `users.py` - User queries
  - `cohorts.py` - Cohort queries
  - `groups.py` - Group queries
  - `meetings.py` - Meeting queries
  - `progress.py` - Learning progress queries

**`discord_bot/cogs/`:**
- Purpose: Discord slash command handlers
- Contains: Cogs loaded by discord.py
- Key files:
  - `enrollment_cog.py` - `/signup` command
  - `scheduler_cog.py` - `/schedule`, `/list-users`
  - `groups_cog.py` - `/group` channel creation
  - `breakout_cog.py` - Breakout room management
  - `stampy_cog.py` - AI chatbot integration
  - `ping_cog.py` - Health check

**`web_api/routes/`:**
- Purpose: FastAPI HTTP endpoints
- Contains: Router modules grouped by domain
- Key files:
  - `auth.py` - `/auth/*` Discord OAuth, sessions
  - `users.py` - `/api/users/*` profile endpoints
  - `modules.py` - `/api/modules/*` module content
  - `courses.py` - `/api/courses/*` course endpoints
  - `cohorts.py` - `/api/cohorts/*` enrollment
  - `facilitator.py` - `/api/facilitator/*` admin endpoints

**`web_frontend/src/pages/`:**
- Purpose: Vike file-based routing
- Contains: Page components following `@param` convention for dynamic routes
- Key files:
  - `index/+Page.tsx` - Landing page `/`
  - `course/+Page.tsx` - Course overview `/course`
  - `course/@courseId/+Page.tsx` - Course detail `/course/:courseId`
  - `course/@courseId/module/@moduleId/+Page.tsx` - Module page
  - `enroll/+Page.tsx` - Enrollment flow
  - `availability/+Page.tsx` - Availability picker
  - `facilitator/+Page.tsx` - Facilitator dashboard

**`web_frontend/src/components/`:**
- Purpose: Reusable React components
- Contains: UI components organized by feature
- Key files:
  - `Layout.tsx` - Page layout wrapper
  - `ModuleHeader.tsx` - Module page header
  - `nav/` - Navigation components
  - `module/` - Module-specific components
  - `course/` - Course-specific components
  - `schedule/` - Availability scheduling UI

**`web_frontend/src/views/`:**
- Purpose: Page-level view components (heavier logic)
- Contains: Full page implementations
- Key files:
  - `Module.tsx` - Module learning experience
  - `CourseOverview.tsx` - Course listing/progress
  - `Facilitator.tsx` - Facilitator dashboard
  - `Availability.tsx` - Availability picker view

**`web_frontend/src/api/`:**
- Purpose: API client functions
- Contains: Typed fetch wrappers for backend endpoints
- Key files:
  - `modules.ts` - Module/session API calls
  - (other API clients)

## Key File Locations

**Entry Points:**
- `main.py`: Unified backend entry point (FastAPI + Discord)
- `discord_bot/main.py`: Discord bot factory (imported by root main.py)
- `web_frontend/src/pages/+config.ts`: Vike configuration

**Configuration:**
- `.env` / `.env.local`: Environment variables
- `requirements.txt`: Python dependencies
- `web_frontend/package.json`: Node dependencies
- `web_frontend/vite.config.ts`: Vite build config
- `web_frontend/tsconfig.json`: TypeScript config
- `alembic.ini`: Database migration config

**Core Logic:**
- `core/__init__.py`: Public API - import from here
- `core/database.py`: Database connection management
- `core/tables.py`: All database table definitions
- `core/scheduling.py`: Cohort scheduling algorithm

**Testing:**
- `conftest.py`: Root pytest config
- `core/tests/`: Core business logic tests
- `discord_bot/tests/`: Discord adapter tests
- `web_api/tests/`: FastAPI route tests
- `core/*/tests/`: Submodule tests

## Naming Conventions

**Files:**
- Python: `snake_case.py` (e.g., `module_sessions.py`)
- TypeScript: `camelCase.ts` or `PascalCase.tsx` for components
- Cogs: `*_cog.py` (e.g., `enrollment_cog.py`)
- Tests: `test_*.py` (Python), `*.test.ts` (TypeScript)

**Directories:**
- Lowercase with underscores for Python (e.g., `discord_bot/`)
- Lowercase for frontend (e.g., `components/`, `pages/`)
- Vike pages use `@param` for dynamic routes (e.g., `@courseId/`)

**Database Tables:**
- Plural nouns: `users`, `cohorts`, `groups`, `meetings`
- Junction tables: `groups_users` (not `group_users`)

## Where to Add New Code

**New Business Logic:**
- Primary code: `core/` or `core/<subdomain>/`
- Export in `core/__init__.py` for public API
- Tests: `core/tests/` or `core/<subdomain>/tests/`

**New API Endpoint:**
- Route handler: `web_api/routes/<domain>.py`
- Add router to `main.py` includes
- Tests: `web_api/tests/test_<domain>.py`

**New Discord Command:**
- Cog: `discord_bot/cogs/<feature>_cog.py`
- Add to `COGS` list in `discord_bot/main.py`
- Tests: `discord_bot/tests/test_<feature>_cog.py`

**New Frontend Page:**
- Page: `web_frontend/src/pages/<route>/+Page.tsx`
- Dynamic params: `@paramName/+Page.tsx`
- Data loading: `+data.ts` alongside `+Page.tsx`

**New React Component:**
- Shared: `web_frontend/src/components/<ComponentName>.tsx`
- Feature-specific: `web_frontend/src/components/<feature>/<ComponentName>.tsx`

**New API Client Function:**
- Add to existing file in `web_frontend/src/api/` or create new
- Export types from `web_frontend/src/types/`

**Utilities:**
- Python (shared): `core/<module>.py`
- Frontend: `web_frontend/src/utils/<utility>.ts`
- Discord-specific: `discord_bot/utils/<utility>.py`

## Special Directories

**`migrations/`:**
- Purpose: Raw SQL migration files (numbered, manual)
- Generated: No (hand-written)
- Committed: Yes

**`alembic/versions/`:**
- Purpose: Alembic migration scripts
- Generated: Via `alembic revision`
- Committed: Yes

**`web_frontend/dist/`:**
- Purpose: Built frontend for production
- Generated: Via `npm run build`
- Committed: No (gitignored)

**`scripts/`:**
- Purpose: Utility scripts for development/testing
- Generated: No
- Committed: Yes
- Key scripts:
  - `create_cohort.py` - Create test cohort
  - `create_test_scheduling_data.py` - Generate test data
  - `list-servers` - Show running dev servers

**`.planning/`:**
- Purpose: GSD planning documents
- Generated: By AI assistant
- Committed: Yes

---

*Structure analysis: 2026-01-21*
