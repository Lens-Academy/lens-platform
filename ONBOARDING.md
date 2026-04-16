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

Copy `.env.example` → `.env.local` and fill in just these:

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres
JWT_SECRET=<random string — generate with: python -c "import secrets; print(secrets.token_urlsafe(32))">
ANTHROPIC_API_KEY=<your own key>
EDUCATIONAL_CONTENT_BRANCH=main
```

Everything else (Discord, SendGrid, Sentry, PostHog, Zoom, Google Calendar, Supabase, SendGrid) is **optional** — leave blank unless you're specifically testing that integration. **Don't ask for the team's keys**; the ones in `.env.example` paths are production.

### Discord login

Discord OAuth requires `DISCORD_CLIENT_ID` + `DISCORD_CLIENT_SECRET` + `DISCORD_REDIRECT_URI`. If you skip these you can't log in through the UI — use `reset_dev_database.py` to create a user matching your Discord ID, then you'll need to either (a) set up your own Discord OAuth app, or (b) ask the team for a shared dev OAuth app.

### Discord bot

`--no-bot` skips it entirely. If you want to test the bot, create your own at https://discord.com/developers/applications and set `DISCORD_BOT_TOKEN` + `DISCORD_SERVER_ID` to a server you control. **Do not** use the team's bot token.

## 4. Run it

Two terminals:

```bash
# Backend (with --dev, API returns JSON at /; without it, serves built frontend)
.venv/bin/python main.py --dev --no-bot

# Frontend
cd web_frontend && npm run dev
```

Open the frontend URL printed in the Vite output.

## 5. Before pushing

```bash
ruff check . && ruff format --check . && pytest
cd web_frontend && npm run lint && npm run build
```

CI runs the same checks. **Never push to `main`** — PRs only.

## Gotchas

- **`./scripts/list-servers`** — run before killing any dev server. Each workspace (`ws1`, `ws2`, …) uses its own port offset. Don't `pkill python` — you'll kill other people's servers if you're on the shared VPS.
- **Backend restart required** after any Python change. Frontend hot-reloads.
- **Migrations** — edit `core/tables.py`, then `alembic revision --autogenerate -m "..."`, review the generated SQL, then `alembic upgrade head`. Details in `docs/database-migrations.md`.
- **Tests that hit the DB** use a separate test DB — see `conftest.py`.
- **Repo uses `jj`** for version control (git-compatible). If you use plain git, that's fine — the `.git` directory is real. If you want to try jj, see `~/.claude/jj.md` or `jj help`.

## When stuck

Ask Claude Code — it has access to all the `CLAUDE.md` files, the codebase, and can read migrations/tests to figure most things out. Escalate to a human for: production credentials, shared infra, or anything touching `main` / `staging`.
