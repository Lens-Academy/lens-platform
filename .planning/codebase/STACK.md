# Technology Stack

**Analysis Date:** 2026-02-14

## Languages

**Primary:**
- Python 3.12 - Backend (Discord bot, FastAPI server, business logic)
- TypeScript 5.x - Frontend (React components, Vike pages)

**Secondary:**
- JavaScript ES2022 - Build tooling, config files

## Runtime

**Environment:**
- Python 3.12.3
- Node.js v24.13.0

**Package Manager:**
- Python: pip (with requirements.txt)
- Node: npm v11.6.2
- Lockfile: package-lock.json present

**Virtual Environment:**
- Python venv at `.venv/` (symlinked per workspace)

## Frameworks

**Core:**
- FastAPI >= 0.109.0 - HTTP server for web API and frontend serving
- discord.py >= 2.3.0 - Discord bot framework
- React 19.2.3 - Frontend UI library
- Vike v0.4.252 - SSR/SSG framework (file-based routing)
- Vite 7.3.1 - Frontend build tool and dev server

**Testing:**
- pytest (Python) - Backend testing with async support
- Vitest 4.0.18 - Frontend testing
- @testing-library/react 16.3.2 - React component testing

**Build/Dev:**
- uvicorn[standard] >= 0.27.0 - ASGI server
- Ruff 0.15.0 - Python linting and formatting
- ESLint 9.x - JavaScript/TypeScript linting
- Alembic >= 1.13.0 - Database migrations

## Key Dependencies

**Critical:**
- sqlalchemy[asyncio] >= 2.0.0 - Database ORM with async support
- asyncpg >= 0.29.0 - PostgreSQL async driver
- litellm >= 1.40.0 - LLM provider abstraction (AI tutor)
- pyjwt >= 2.8.0 - JWT authentication

**Infrastructure:**
- httpx >= 0.27.0 - Async HTTP client
- python-dotenv >= 1.0.0 - Environment variable loading
- google-api-python-client >= 2.100.0 - Google Calendar API
- sendgrid >= 6.11.0 - Email delivery
- apscheduler >= 3.10.0 - Background task scheduling
- cohort-scheduler (from github.com/cpdally/cohort-scheduler.git) - Stochastic greedy scheduling algorithm

**Frontend:**
- vike-react v0.6.18 - Vike + React integration
- @tailwindcss/postcss v4 - CSS framework
- posthog-js v1.325.0 - Analytics
- @sentry/react v10.35.0 - Error tracking
- react-markdown v10.1.0 - Markdown rendering
- lucide-react v0.562.0 - Icon library

**Development:**
- playwright v1.57.0 - E2E browser testing (root package.json)
- jsdom v27.4.0 - DOM testing environment

## Configuration

**Environment:**
- Configuration via `.env` and `.env.local` (gitignored overrides)
- Required: DATABASE_URL, JWT_SECRET, DISCORD_BOT_TOKEN, DISCORD_SERVER_ID
- Optional: SENDGRID_API_KEY, GOOGLE_CALENDAR_CREDENTIALS_FILE, ANTHROPIC_API_KEY, SENTRY_DSN, VITE_POSTHOG_KEY
- `core/config.py` - Centralized environment config with workspace-aware port assignment

**Build:**
- Python: `pyproject.toml` (Ruff config only, not a package)
- Python: `alembic.ini` (database migration config)
- Frontend: `web_frontend/vite.config.ts` - Vite build, dev server proxy, Vike prerendering
- Frontend: `web_frontend/tsconfig.json` - TypeScript compiler options
- Frontend: `web_frontend/eslint.config.mjs` - ESLint rules
- Python: `pytest.ini` - Test configuration with importlib mode

## Platform Requirements

**Development:**
- Python 3.12+ with venv
- Node.js 24.x + npm 11.x
- PostgreSQL connection (local or Supabase)
- Discord bot token (for Discord integration)

**Production:**
- Railway (PAAS) - Single service running unified backend
- Database: PostgreSQL via Supabase (connection pooler mode)
- Environment detection via RAILWAY_ENVIRONMENT_NAME env var

---

*Stack analysis: 2026-02-14*
