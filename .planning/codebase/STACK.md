# Technology Stack

**Analysis Date:** 2026-01-21

## Languages

**Primary:**
- Python 3.11+ (target version in `pyproject.toml`) - Backend (FastAPI, Discord bot, core business logic)
- TypeScript 5.x - Frontend (React 19, Vike)

**Secondary:**
- SQL - Database migrations (`migrations/`, `alembic/`)
- Markdown - Educational content and documentation

## Runtime

**Environment:**
- Python 3.11+ (target), current system: Python 3.13.11
- Node.js (current system: v25.2.1)

**Package Manager:**
- pip (Python) - `requirements.txt`
- npm (Node.js) - `web_frontend/package.json`
- Lockfile: `web_frontend/package-lock.json` (frontend)

## Frameworks

**Core:**
- FastAPI >=0.109.0 - HTTP API server (`main.py`, `web_api/routes/`)
- discord.py >=2.3.0 - Discord bot (`discord_bot/`)
- SQLAlchemy[asyncio] >=2.0.0 - Database ORM (`core/database.py`, `core/tables.py`)
- React 19.2.3 - Frontend UI (`web_frontend/src/`)
- Vike 0.4.252 - File-based routing and SSG (`web_frontend/src/pages/`)
- Vite 7.3.1 - Frontend build tool (`web_frontend/vite.config.ts`)
- Tailwind CSS 4 - Styling (`web_frontend/src/styles/`)

**Testing:**
- pytest - Python testing
- Playwright 1.57.0 - E2E testing (root `package.json`)

**Build/Dev:**
- uvicorn[standard] >=0.27.0 - ASGI server
- ruff >=0.8.0 - Python linting and formatting
- ESLint 9 - TypeScript/React linting
- Alembic >=1.13.0 - Database migrations

## Key Dependencies

**Critical:**
- asyncpg >=0.29.0 - Async PostgreSQL driver for SQLAlchemy
- pyjwt >=2.8.0 - JWT authentication (`web_api/auth.py`)
- httpx >=0.27.0 - Async HTTP client for Discord OAuth, GitHub API
- litellm >=1.40.0 - LLM provider abstraction (`core/modules/llm.py`)

**Infrastructure:**
- sendgrid >=6.11.0 - Email notifications (`core/notifications/channels/email.py`)
- google-api-python-client >=2.100.0 - Google Calendar API (`core/calendar/`)
- google-auth >=2.25.0 - Google authentication
- apscheduler >=3.10.0 - Background job scheduling (`core/notifications/scheduler.py`)
- sentry-sdk[fastapi] >=1.40.0 - Error tracking
- python-dotenv >=1.0.0 - Environment configuration
- cohort-scheduler (git) - Custom scheduling algorithm

**Frontend Critical:**
- @sentry/react ^10.35.0 - Frontend error tracking (`web_frontend/src/errorTracking.ts`)
- posthog-js ^1.325.0 - Product analytics (`web_frontend/src/analytics.ts`)
- vike-react ^0.6.18 - Vike React integration
- react-markdown ^10.1.0 - Markdown rendering
- lucide-react ^0.562.0 - Icon library
- @floating-ui/react ^0.27.16 - Tooltips and popovers

## Configuration

**Environment:**
- `.env.example` - Template for required environment variables
- `.env.local` - Local overrides (gitignored)
- `web_frontend/.env.example` - Frontend environment template

**Key Environment Variables:**
```
# Database
DATABASE_URL              # PostgreSQL connection string

# Discord
DISCORD_BOT_TOKEN         # Bot authentication
DISCORD_CLIENT_ID         # OAuth client ID
DISCORD_CLIENT_SECRET     # OAuth secret
DISCORD_SERVER_ID         # Target server

# Auth
JWT_SECRET                # JWT signing key

# External Services
SENDGRID_API_KEY          # Email service
GOOGLE_CALENDAR_CREDENTIALS_FILE  # Calendar service account JSON
GOOGLE_CALENDAR_EMAIL     # Calendar email identity
ANTHROPIC_API_KEY         # Default LLM provider

# Content
EDUCATIONAL_CONTENT_BRANCH  # GitHub content branch (staging/main)
GITHUB_TOKEN              # GitHub API access
GITHUB_WEBHOOK_SECRET     # Webhook signature verification

# Observability
SENTRY_DSN                # Backend error tracking
VITE_SENTRY_DSN           # Frontend error tracking
VITE_POSTHOG_KEY          # Analytics
VITE_POSTHOG_HOST         # Analytics host (eu.posthog.com)
```

**Build:**
- `pyproject.toml` - Ruff configuration (line-length: 88, target: py311)
- `web_frontend/tsconfig.json` - TypeScript (ES2022, strict mode)
- `web_frontend/vite.config.ts` - Vite build configuration
- `web_frontend/eslint.config.mjs` - ESLint configuration
- `web_frontend/postcss.config.mjs` - PostCSS for Tailwind
- `alembic.ini` - Database migration configuration

## Platform Requirements

**Development:**
- Python 3.11+
- Node.js (LTS recommended)
- PostgreSQL (via Docker or Supabase)
- Discord bot token and OAuth credentials
- Optional: Google service account for Calendar

**Production:**
- Single Railway service running unified backend
- PostgreSQL (Supabase-hosted)
- All external service credentials configured

**Server Startup:**
```bash
python main.py            # Production (serves frontend from dist/)
python main.py --dev      # Dev mode (API only, run Vite separately)
python main.py --no-bot   # Without Discord bot
python main.py --no-db    # Skip database (frontend-only dev)
```

**Frontend Build:**
```bash
cd web_frontend
npm run dev               # Vite dev server with HMR
npm run build             # Production build to dist/
npm run lint              # ESLint check
```

## Port Configuration

Auto-assigned based on workspace directory name:
- No suffix: API :8000, Frontend :3000
- `-ws1`: API :8001, Frontend :3001
- `-ws2`: API :8002, Frontend :3002

Override via `API_PORT`/`FRONTEND_PORT` env vars or CLI `--port`.

---

*Stack analysis: 2026-01-21*
