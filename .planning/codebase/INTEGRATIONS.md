# External Integrations

**Analysis Date:** 2026-02-14

## APIs & External Services

**Discord:**
- Discord Bot API - Discord bot for slash commands, events, channel management
  - SDK/Client: discord.py >= 2.3.0
  - Auth: DISCORD_BOT_TOKEN (bot token)
  - Server ID: DISCORD_SERVER_ID
- Discord OAuth2 - Web frontend user authentication
  - Client: httpx (manual OAuth flow)
  - Auth: DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET
  - Redirect: DISCORD_REDIRECT_URI

**GitHub:**
- GitHub API - Fetch educational content from Lens-Academy/lens-edu-relay repository
  - SDK/Client: httpx (raw REST API calls)
  - Auth: Public repo access (no token required) or GITHUB_WEBHOOK_SECRET for webhook verification
  - Implementation: `core/content/github_fetcher.py`, `core/content/webhook_handler.py`
  - Branch: EDUCATIONAL_CONTENT_BRANCH (e.g., staging, main)
  - Webhook endpoint: POST `/api/content/webhook` (FastAPI route in `web_api/routes/content.py`)

**LLM Providers (AI Tutor):**
- LiteLLM - Multi-provider LLM abstraction for chat functionality
  - SDK/Client: litellm >= 1.40.0
  - Default: anthropic/claude-sonnet-4-20250514
  - Auth: ANTHROPIC_API_KEY (or GEMINI_API_KEY, OPENAI_API_KEY)
  - Configuration: LLM_PROVIDER env var (optional, defaults to Claude)
  - Implementation: `core/modules/llm.py`

## Data Storage

**Databases:**
- PostgreSQL (Supabase-hosted)
  - Connection: DATABASE_URL
  - Client: SQLAlchemy 2.0+ with asyncpg driver
  - ORM: SQLAlchemy Core (no ORM classes, raw SQL with async connections)
  - Migrations: Alembic (autogenerate from `core/tables.py`)
  - Connection pooling: Configured for Supabase pooler (pgbouncer transaction mode, statement_cache_size=0)
  - Implementation: `core/database.py`, `core/tables.py`

**File Storage:**
- Local filesystem only (no cloud storage integration)
- Content cache stored in memory (`core/content/cache.py`)

**Caching:**
- In-memory content cache (educational content from GitHub)
  - Implementation: `core/content/cache.py`
  - Refresh: Webhook-triggered incremental updates or manual refresh

## Authentication & Identity

**Auth Provider:**
- Discord OAuth2
  - Implementation: `web_api/routes/auth.py`, `core/auth.py`
  - Flow: Discord OAuth → backend creates auth code → frontend exchanges for JWT
  - Session: JWT tokens (cookie-based)
  - JWT secret: JWT_SECRET

**User Management:**
- Database: users table in PostgreSQL
- Profile: Discord ID, username, email (optional), nickname
- Implementation: `core/users.py`

## Monitoring & Observability

**Error Tracking:**
- Sentry
  - Backend: sentry-sdk[fastapi] >= 1.40.0
  - Frontend: @sentry/react v10.35.0
  - Config: SENTRY_DSN (backend), VITE_SENTRY_DSN (frontend)
  - Environment: Auto-detected from RAILWAY_ENVIRONMENT_NAME or ENVIRONMENT
  - Implementation: `main.py` (backend init), `web_frontend/src/errorTracking.ts` (frontend)

**Analytics:**
- PostHog (product analytics)
  - SDK: posthog-js v1.325.0
  - Config: VITE_POSTHOG_KEY, VITE_POSTHOG_HOST (defaults to eu.posthog.com)
  - Production-only: Only runs when import.meta.env.PROD is true
  - Implementation: `web_frontend/src/analytics.ts`

**Logs:**
- Python logging module (stdout/stderr)
- Railway captures stdout for log aggregation
- Sentry captures exceptions and fatal messages

## CI/CD & Deployment

**Hosting:**
- Railway - Single service running unified backend (FastAPI + Discord bot)
  - Command: `uvicorn main:app`
  - Environment: Production and staging environments
  - CLI: railway link, railway logs

**CI Pipeline:**
- Not detected (CI configuration not in codebase)

**Deployment:**
- Railway auto-deploys from GitHub on push to main/staging

## Environment Configuration

**Required env vars:**
- DATABASE_URL - PostgreSQL connection string (Supabase)
- JWT_SECRET - Secret for JWT token signing
- DISCORD_BOT_TOKEN - Discord bot authentication
- DISCORD_SERVER_ID - Discord server for bot operations
- DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET - OAuth credentials

**Optional env vars (integrations):**
- SENDGRID_API_KEY - Email delivery
- FROM_EMAIL - Sender email address (defaults to team@lensacademy.org)
- GOOGLE_CALENDAR_CREDENTIALS_FILE or GOOGLE_CALENDAR_CREDENTIALS_JSON - Calendar API service account
- GOOGLE_CALENDAR_EMAIL - Calendar user email
- ANTHROPIC_API_KEY (or GEMINI_API_KEY, OPENAI_API_KEY) - LLM provider
- LLM_PROVIDER - LLM model identifier (defaults to anthropic/claude-sonnet-4-20250514)
- SENTRY_DSN - Backend error tracking
- VITE_SENTRY_DSN - Frontend error tracking
- VITE_POSTHOG_KEY - Analytics
- GITHUB_WEBHOOK_SECRET - Webhook signature verification
- EDUCATIONAL_CONTENT_BRANCH - GitHub branch for content

**Secrets location:**
- `.env.local` (gitignored, local dev overrides)
- `.env` (example in repo as `.env.example`)
- Railway environment variables (production/staging)

## Webhooks & Callbacks

**Incoming:**
- POST `/api/content/webhook` - GitHub push webhook for content updates
  - Signature verification: X-Hub-Signature-256 header with GITHUB_WEBHOOK_SECRET
  - Event filter: Only 'push' events to EDUCATIONAL_CONTENT_BRANCH
  - Handler: `core/content/webhook_handler.py`
- POST `/auth/discord/callback` - Discord OAuth callback
  - Implementation: `web_api/routes/auth.py`

**Outgoing:**
- None detected

## Third-Party Services Summary

| Service | Purpose | Config | Critical |
|---------|---------|--------|----------|
| Supabase | PostgreSQL database | DATABASE_URL | Yes |
| Discord | Bot API + OAuth | DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID | Yes |
| Sentry | Error tracking | SENTRY_DSN, VITE_SENTRY_DSN | No |
| PostHog | Analytics | VITE_POSTHOG_KEY | No |
| SendGrid | Email delivery | SENDGRID_API_KEY | No |
| Google Calendar | Meeting scheduling | GOOGLE_CALENDAR_CREDENTIALS_FILE | No |
| Anthropic/Claude | AI tutor | ANTHROPIC_API_KEY | No |
| GitHub | Content repository | EDUCATIONAL_CONTENT_BRANCH | Yes |
| Railway | Hosting | RAILWAY_ENVIRONMENT_NAME (auto-set) | Yes |

---

*Integration audit: 2026-02-14*
