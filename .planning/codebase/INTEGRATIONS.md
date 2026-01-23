# External Integrations

**Analysis Date:** 2026-01-21

## APIs & External Services

**Discord:**
- Purpose: Primary user identity, bot commands, group coordination
- SDK/Client: discord.py >=2.3.0 (`discord_bot/main.py`)
- Auth: `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`
- OAuth: Full OAuth2 flow for web login (`web_api/routes/auth.py`)
- Endpoints used:
  - `https://discord.com/oauth2/authorize` - OAuth start
  - `https://discord.com/api/oauth2/token` - Token exchange
  - `https://discord.com/api/users/@me` - User info fetch

**GitHub:**
- Purpose: Educational content storage and delivery
- Client: httpx async HTTP client (`core/content/github_fetcher.py`)
- Auth: `GITHUB_TOKEN` (optional, for higher rate limits)
- Repository: `lucbrinkman/lens-educational-content`
- APIs used:
  - `raw.githubusercontent.com` - File fetching (fast, 5min CDN cache)
  - `api.github.com/repos/.../contents` - File list and specific commits
  - `api.github.com/repos/.../commits` - Latest commit SHA
  - `api.github.com/repos/.../compare` - Diff between commits

**LLM Providers:**
- Purpose: AI tutor chat feature
- SDK/Client: litellm >=1.40.0 (`core/modules/llm.py`)
- Default provider: `anthropic/claude-sonnet-4-20250514`
- Supported: Claude (Anthropic), Gemini (Google), GPT-4o (OpenAI)
- Auth: `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`
- Streaming: Yes, via `litellm.acompletion(stream=True)`

**Google Calendar:**
- Purpose: Meeting scheduling and calendar invites
- SDK/Client: google-api-python-client (`core/calendar/client.py`)
- Auth: Service account JSON file (`GOOGLE_CALENDAR_CREDENTIALS_FILE`)
- Identity: `GOOGLE_CALENDAR_EMAIL` (service account acts as this user)
- Scopes: `https://www.googleapis.com/auth/calendar`

**SendGrid:**
- Purpose: Email notifications (welcome, group assignments, reminders)
- SDK/Client: sendgrid >=6.11.0 (`core/notifications/channels/email.py`)
- Auth: `SENDGRID_API_KEY`
- Sender: `FROM_EMAIL` (default: team@lensacademy.org)

## Data Storage

**Databases:**
- Type: PostgreSQL (Supabase-hosted pooler)
- Connection: `DATABASE_URL` environment variable
- Client: SQLAlchemy[asyncio] with asyncpg driver (`core/database.py`)
- Pooling: Supabase pgbouncer (transaction mode, statement cache disabled)
- Pool settings: size=5, max_overflow=10, pool_timeout=30, pool_recycle=1800

**File Storage:**
- Educational content: GitHub repository (read-only via API)
- Chat transcripts: `core/transcripts/` (local filesystem, JSON)
- No external object storage (S3, etc.)

**Caching:**
- In-memory content cache (`core/content/cache.py`)
- OAuth state: In-memory dict with TTL (`web_api/routes/auth.py`)
- No Redis or external cache service

## Authentication & Identity

**Auth Provider:**
- Primary: Discord OAuth2
- Implementation: Custom JWT-based sessions (`web_api/auth.py`)

**Auth Flow:**
1. User clicks "Sign in with Discord"
2. Redirect to Discord OAuth authorize URL
3. Discord redirects back with auth code
4. Server exchanges code for access token
5. Server fetches user info from Discord API
6. Server creates/updates user in database
7. Server issues JWT stored in HttpOnly cookie

**JWT Configuration:**
- Algorithm: HS256
- Expiration: 24 hours
- Secret: `JWT_SECRET` environment variable
- Cookie: `session`, HttpOnly, Secure in production

**Alternative Auth (from Discord bot):**
- Bot generates temporary auth code
- User visits `/auth/code?code=XXX`
- Server validates code and creates session

## Monitoring & Observability

**Error Tracking:**
- Backend: Sentry (`sentry-sdk[fastapi]`)
  - DSN: `SENTRY_DSN`
  - Initialization: `main.py` at startup
  - Sample rate: 10% for traces
- Frontend: Sentry (`@sentry/react`)
  - DSN: `VITE_SENTRY_DSN`
  - Initialization: `web_frontend/src/errorTracking.ts`
  - Integrations: Browser tracing, Session replay (on error only)

**Analytics:**
- Frontend only: PostHog (`posthog-js`)
  - Key: `VITE_POSTHOG_KEY`
  - Host: `VITE_POSTHOG_HOST` (default: eu.posthog.com)
  - Initialization: `web_frontend/src/analytics.ts`
  - Consent-based: Opt-in/opt-out via localStorage
  - Events: Page views, module progress, enrollment funnel

**Logs:**
- Python standard logging
- Console output to stdout/stderr
- Uvicorn request logging

## CI/CD & Deployment

**Hosting:**
- Platform: Railway
- Type: Single service running unified backend
- Startup: `uvicorn main:app`

**CI Pipeline:**
- GitHub Actions (assumed based on project structure)
- Pre-commit checks: `ruff check`, `ruff format --check`, `npm run lint`, `npm run build`, `pytest`

**Railway CLI:**
```bash
# Link to staging
railway link -p 779edcd4-bb95-40ad-836f-0bf4113c4453 -e 0cadba59-5e24-4d9f-8620-c8fc2722a2de -s lensacademy

# View logs
railway logs -n 100
```

## Environment Configuration

**Required env vars (production):**
- `DATABASE_URL` - PostgreSQL connection
- `JWT_SECRET` - Session signing
- `DISCORD_BOT_TOKEN` - Bot authentication
- `DISCORD_CLIENT_ID` - OAuth client
- `DISCORD_CLIENT_SECRET` - OAuth secret
- `EDUCATIONAL_CONTENT_BRANCH` - Content branch (main for prod)

**Optional but recommended:**
- `SENTRY_DSN` - Error tracking
- `VITE_SENTRY_DSN` - Frontend error tracking
- `SENDGRID_API_KEY` - Email notifications
- `GOOGLE_CALENDAR_CREDENTIALS_FILE` - Calendar integration
- `VITE_POSTHOG_KEY` - Analytics

**Secrets location:**
- Railway: Environment variables in service settings
- Local: `.env.local` file (gitignored)

## Webhooks & Callbacks

**Incoming:**
- `POST /api/content/webhook` - GitHub push webhook
  - Signature verification: HMAC SHA256 (`GITHUB_WEBHOOK_SECRET`)
  - Triggers: Incremental content cache refresh
  - Handler: `core/content/webhook_handler.py`

- `GET /auth/discord/callback` - Discord OAuth callback
  - Receives auth code from Discord
  - Exchanges for access token and user info

**Outgoing:**
- None (no webhook emissions to external services)

## Background Jobs

**Scheduler:** APScheduler (`core/notifications/scheduler.py`)

**Jobs:**
- RSVP sync: Every 6 hours, syncs calendar RSVPs for upcoming meetings
- Meeting reminders: Scheduled per-meeting at specific times

**Trigger:** Jobs initialized in `main.py` lifespan context

---

*Integration audit: 2026-01-21*
