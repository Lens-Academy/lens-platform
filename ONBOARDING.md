# Onboarding

Short guide to get the Lens Platform running locally. For architecture, commands, and conventions see [`CLAUDE.md`](./CLAUDE.md) and the per-directory `CLAUDE.md` files — Claude Code will pick those up automatically.

## 1. Install dependencies

```bash
python -m venv .venv
.venv/bin/pip install -r requirements.txt -r requirements-dev.txt
cd web_frontend && npm install && cd ..
```

## 2. PostgreSQL

Run your own locally. Docker is easiest:

```bash
docker run -d --name lens-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
```

Apply migrations, then seed a dev DB with an admin user + test cohort:

```bash
.venv/bin/alembic upgrade head
.venv/bin/python scripts/reset_dev_database.py --discord-id YOUR_DISCORD_ID
```

(Your Discord ID: enable Developer Mode in Discord → right-click your name → Copy User ID. Only needed if you want to log in as admin; you can skip and log in as a normal user.)

## 3. `.env.local` (repo root)

Copy `.env.example` → `.env.local`. **You don't need any credentials from the team** to get a working setup — the values below are all self-generated or public:

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres
JWT_SECRET=<any random string — generate with: python -c "import secrets; print(secrets.token_urlsafe(32))">
EDUCATIONAL_CONTENT_BRANCH=staging
```

- `DATABASE_URL` — points at your local Postgres from step 2.
- `JWT_SECRET` — any random string, only used to sign session cookies locally. Not a shared secret.
- `EDUCATIONAL_CONTENT_BRANCH` — selects which branch of the public [`lens-edu-relay`](https://github.com/Lens-Academy/lens-edu-relay) repo to clone for course content. Use `staging` for dev (stable but includes in-progress content); use `main` only when mirroring production. No GitHub token required — the repo is public.

### Optional (skip for basic setup)

- **Anthropic / OpenAI / Gemini keys** — only needed to use the AI tutor/chat or speech-to-text. Use your own keys, not the team's.
- **Discord OAuth** (`DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` / `DISCORD_REDIRECT_URI`) — only needed to log in through the UI via Discord. Skip, and test against the admin user created by `reset_dev_database.py` instead (there's usually a dev login bypass, or ask someone on the team how they log in locally).
- **Discord bot** (`DISCORD_BOT_TOKEN` / `DISCORD_SERVER_ID`) — only needed to test the bot. Run with `--no-bot` to skip. If you do want to test it, [create your own bot](https://discord.com/developers/applications) pointing at a server you control. **Do not** use the team's bot token.
- **GITHUB_TOKEN** — only required if you're testing the tutor's private-source search (`core/content/private_sources.py`), which clones a private repo of copyrighted books. Skip otherwise.
- **SendGrid / Resend / Sentry / PostHog / Zoom / Google Calendar / Supabase** — production integrations, all optional. Leave blank.

**Don't ask for the team's production keys** — most integrations (SendGrid, Sentry, etc.) use our production accounts, so the credentials can't be shared. Use your own keys or skip.

## 4. Verify your setup

Start the dev server and run the test suite. If either fails, fix whatever's missing (wrong Python/Node version, missing system package, etc.) before moving on.

```bash
# Start the backend
.venv/bin/python main.py --dev --no-bot

# In a second terminal, start the frontend
cd web_frontend && npm run dev
```

Open the frontend URL printed in the Vite output — you should see the app load.

Then run the full test + lint suite:

```bash
ruff check . && ruff format --check . && pytest
cd web_frontend && npm run lint && npm run build
```

These are the same checks CI runs. Everything should pass on a fresh clone — if something fails, it's a setup issue, not a codebase issue. **Never push to `main`** — PRs only.

## Gotchas

- **`./scripts/list-servers`** — run before killing any dev server. Each workspace (`ws1`, `ws2`, …) uses its own port offset. Don't `pkill python` — you'll kill other people's servers if you're on the shared VPS.
- **Backend restart required** after any Python change. Frontend hot-reloads.
- **Migrations** — edit `core/tables.py`, then `alembic revision --autogenerate -m "..."`, review the generated SQL, then `alembic upgrade head`. Details in `docs/database-migrations.md`.
- **Tests that hit the DB** use a separate test DB — see `conftest.py`.
- **Repo uses `jj`** for version control (git-compatible). If you use plain git, that's fine — the `.git` directory is real. If you want to try jj, see `~/.claude/jj.md` or `jj help`.

## When stuck

Ask Claude Code — it has access to all the `CLAUDE.md` files, the codebase, and can read migrations/tests to figure most things out. Escalate to a human for: production credentials, shared infra, or anything touching `main` / `staging`.
