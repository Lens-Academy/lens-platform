# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Default Ports by Workspace

When starting the server, use the default port based on the workspace directory:

| Workspace | Default Port |
|-----------|--------------|
| `ai-safety-course-platform` | 8000 |
| `ai-safety-course-platform-ws2` | 8001 |

This allows running both workspaces simultaneously without port conflicts.

## Commands

**Unified Backend (FastAPI + Discord Bot):**

```bash
pip install -r requirements.txt

python main.py                      # Default: with Discord bot
python main.py --no-bot             # Without Discord bot
python main.py --port 8000          # Use workspace default port (8000 for this repo)
python main.py --no-bot --port 8000 # Both options

# Development mode (spawns Vite dev server with HMR):
python main.py --dev                # FastAPI :8000 + Vite :5173
python main.py --dev --no-bot       # Without Discord bot
python main.py --dev --vite-port 5174  # Custom Vite port

# Requires .env with:
#   DISCORD_BOT_TOKEN=your_token
#   DATABASE_URL=postgresql://...
```

**Web Frontend (React/Vite):**

In dev mode (`--dev`), Vite is spawned automatically. Access the frontend at `http://localhost:5173` for HMR.

For manual frontend-only development:

```bash
cd web_frontend
npm install
npm run dev                       # Serves on localhost:5173
```

### Workspace-Specific Ports

When running multiple workspaces simultaneously, use different ports to avoid conflicts:

| Workspace | FastAPI | Vite | Command |
|-----------|---------|------|---------|
| WS1 (ai-safety-course-platform) | 8000 | 5173 | `python main.py --dev` |
| WS2 | 8001 | 5174 | `python main.py --dev --port 8001 --vite-port 5174` |

**Tests:**

```bash
pytest discord_bot/tests/         # Scheduler algorithm tests
```

**Legacy (standalone, for reference):**

```bash
cd discord_bot && python main.py  # Discord bot only
cd web_api && python main.py      # FastAPI only
```

## Architecture

This is a Discord bot + web platform for AI Safety education course logistics.

### Unified Backend

**One process, one asyncio event loop** running two peer services:

- **FastAPI** (HTTP server on :8000) - serves web API for React frontend
- **Discord bot** (WebSocket to Discord) - handles slash commands and events

Both services share:

- The same event loop (can call each other's async functions directly)
- The same `core/` business logic
- The same database connections (PostgreSQL via SQLAlchemy)

This eliminates need for IPC/message queues between services.

### 3-Layer Architecture

```
ai-safety-course-platform/
├── main.py                     # Unified backend entry point (FastAPI + Discord bot)
├── requirements.txt            # Combined Python dependencies
│
├── core/                       # Layer 1: Business Logic (platform-agnostic)
│   ├── scheduling.py           # Scheduling algorithm + Person/Group dataclasses
│   ├── courses.py              # Course management (create, sync, progress)
│   ├── enrollment.py           # User profiles, availability storage
│   ├── cohorts.py              # Cohort creation, availability matching
│   ├── data.py                 # JSON persistence
│   ├── timezone.py             # UTC/local conversions
│   ├── constants.py            # Day codes (M,T,W,R,F,S,U), timezones
│   ├── google_docs.py          # Google Docs fetching/parsing
│   └── cohort_names.py         # Cohort name generation
│
├── discord_bot/                # Layer 2a: Discord Adapter
│   ├── main.py                 # Bot setup (imported by root main.py)
│   ├── cogs/
│   │   ├── scheduler_cog.py    # /schedule command → calls core/
│   │   ├── courses_cog.py      # /add-course, reactions → calls core/
│   │   ├── enrollment_cog.py   # /signup UI → calls core/
│   │   └── cohorts_cog.py      # /cohort command → calls core/
│   ├── utils/                  # Re-exports from core/ for backward compat
│   └── tests/
│
├── web_api/                    # Layer 2b: REST API
│   ├── main.py                 # Legacy standalone entry (not used in unified mode)
│   ├── auth.py                 # JWT utilities (create_jwt, verify_jwt, get_current_user)
│   └── routes/                 # API endpoints (imported by root main.py)
│       ├── auth.py             # /auth/* - Discord OAuth, session management
│       └── users.py            # /api/users/* - User profile endpoints
│
├── web_frontend/               # Layer 3: React frontend
└── activities/                 # Discord Activities (vanilla JS)
```

### Core (`core/`)

**Platform-agnostic business logic** - no Discord imports, pure Python:

- `scheduling.py` - Stochastic greedy algorithm, `Person`/`Group` dataclasses
- `courses.py` - `create_course()`, `mark_week_complete()`, `get_user_progress()`
- `enrollment.py` - `get_user_profile()`, `save_user_profile()`, `get_facilitators()`
- `cohorts.py` - `find_availability_overlap()`, `format_local_time()`
- `data.py` - JSON persistence (legacy, being migrated to PostgreSQL)
- `database.py` - SQLAlchemy async engine (`get_connection()`, `get_transaction()`)
- `auth.py` - Discord-to-Web auth flow (`create_auth_code()`, `get_or_create_user()`)

### Discord Bot (`discord_bot/`)

**Thin adapter cogs** - handle Discord UI/events, delegate logic to core/:

- `scheduler_cog.py` - `/schedule`, `/list-users` commands
- `courses_cog.py` - `/add-course`, `/sync-course`, reaction handling
- `enrollment_cog.py` - `/signup` flow with Views/Buttons/Selects
- `cohorts_cog.py` - `/cohort` command, channel/event creation

**Data persistence** - JSON files in `discord_bot/`:

- `user_data.json` - User profiles, availability, course progress
- `courses.json` - Course structure and Discord channel mappings

### Activities (`activities/`)

Static HTML/JS Discord Activities served via `npx serve`. Each subfolder is a route. Currently vanilla JS, planned migration to React.

## Key Patterns

**Creating a new cog:**

```python
import discord
from discord import app_commands
from discord.ext import commands

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core import get_user_data, save_user_data  # Import from core

class MyCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="mycommand", description="Description")
    async def my_command(self, interaction: discord.Interaction):
        await interaction.response.send_message("Hello!")

async def setup(bot):
    await bot.add_cog(MyCog(bot))
```

Then add `"cogs.my_cog"` to `COGS` list in `main.py`.

**Admin-only commands:** Add `@app_commands.checks.has_permissions(administrator=True)`

**Data access (from cogs):**

```python
from core import (
    load_data, save_data, get_user_data, save_user_data,
    load_courses, save_courses, get_course,
    get_user_profile, save_user_profile
)
```

**Adding business logic:** Add to `core/` module, export in `core/__init__.py`, then import in cogs.

## Hosting

Single Railway service running the unified backend (`uvicorn main:app`).
Database: PostgreSQL (Supabase-hosted, accessed via SQLAlchemy).

# jj

I use jj in all my repos. Don't be afraid to make destructive changes, as long as you run `jj status` before and after them.

## Core Concepts (Git vs jj)

**Working Copy as Commit**: Unlike Git's "dirty" working directory, jj automatically commits working copy changes on every command. No staging area - files are tracked and committed automatically.

**Change ID vs Commit ID**:

- **Change ID** (12 letters, z-k range): Stable identifier that persists through rewrites (like `ywnkulko`)
- **Commit ID** (hex): Changes when commit is rewritten (like `46b50ed7`)
- Use change IDs for most operations; commit IDs for specific snapshots

**No Current Branch**: Bookmarks don't automatically move. No equivalent to Git's HEAD following a branch. Update bookmarks manually with `jj bookmark set`.

**Always Succeeds**: Operations like rebase never fail - conflicts are recorded in commits and resolved later.

**Consistent Parameters**: jj cli parameters mean the same thing when possible

**Git Compatibility**: jj stores commits in .git and uses .gitignore

## Instant Tutorial

```bash
jj git init --colocate   # Create repo (git-backed)
echo "hello" > file.txt  # Edit files
jj describe -m "msg"     # Describe current change (and detect and track file.txt)
echo "hiya" > file.txt   # Edit again
jj new                   # Start new change (after saving "hiya" to change named "msg")
jj log                   # View history
jj log -p                # View history with patches
```

## File Management

```bash
jj status                # Status (like git status) - run often, updates current change and saves anonymous undo history
jj file list             # List tracked files
jj file untrack <file>   # Untrack ignored file (keep in working copy - requires .gitignore)
jj restore <file>        # Restore file from parent
jj restore               # Clear all working copy changes (jj undo if done by accident)
```

Files automatically tracked when added. Use `.gitignore` for exclusions.

## Basic Workflow

```bash
# Start work
jj new [parent] -m "msg"   # Create new change (somewhat like git checkout [parent] && git add . && git commit -m '' && git checkout [parent])
jj describe -m "msg"     # Set description of current WIP (anytime, not just at commit - like git commit --amend -m 'msg')
# or
jj commit -m "msg"       # describe and new combined - more familiar

# View work
jj show [rev]           # Show commit diff (like git show)
jj diff [--from X --to Y] # Show diffs
jj log                  # View history (like git log --graph)

# "jj commit" is not "git commit", "jj st" is - changes auto-committed on every command, just run "jj st" to commit to evolog and update current change
```

## History and Branching

**Anonymous Branches**: Don't need names - just create changes with `jj new`. View with `jj log -r 'heads(all())'`.

**Revsets** (like Git's rev syntax but more powerful):

```bash
@                       # Current working copy
@-                      # Parent of working copy
trunk()                 # Main branch (auto-detected)
heads(all())           # All branch heads
::@                    # Ancestors of @ (like git log)
```

**Branch Operations**:

```bash
jj new parent1 parent2  # Create merge (no special merge command)
jj rebase -r X -d Y     # Move single revision X to destination D
jj rebase -s X -d Y     # Move X and descendants to D
jj duplicate X -d Y     # Copy commit (like git cherry-pick)
```

## Change Manipulation

```bash
# Split/combine
jj split [-r X]         # Split commit interactively (unavailable to claude)
jj squash               # Move @ into parent (like git commit --amend)
jj squash -i            # Interactive selection (unavailable to claude)
jj squash --from X --into Y  # Move changes between arbitrary commits

# Edit
jj edit X               # Set working copy to commit X
jj next/prev            # Move working copy up/down
jj diffedit -r X        # Edit commit's diff directly (unavailable to claude)
```

## Conflict Handling

**Conflicts are Committable**: Can rebase/merge conflicted commits. Resolve when ready.

```bash
# Conflict markers differ from Git:
<<<<<<< Conflict 1 of 1
+++++++ Contents of side #1
content1
%%%%%%% Changes from base to side #2
-old line
+new line
>>>>>>> Conflict 1 of 1 ends
```

Resolution: Apply the diff to the snapshot. Use `jj resolve` for 3-way merge tools.

**Auto-rebase**: Descendants automatically rebase when you rewrite commits - even conflicted ones.

## Remote Operations

**Bookmarks = Git Branches**:

```bash
jj bookmark create name  # Create bookmark at @
jj bookmark set name     # Move bookmark to @
jj bookmark list         # List bookmarks
jj bookmark track name@remote  # Track remote bookmark
```

**Git Interop**:

```bash
jj git fetch            # Fetch from remotes
jj git push             # Push tracked bookmarks
jj git push -c @        # Create bookmark and push current change
jj git push --bookmark name  # Push specific bookmark
```

## Advanced Operations

**Operation Log** (like unlimited undo):

```bash
jj op log               # View operation history
jj undo                 # Undo last operation
jj op restore X         # Restore repo to operation X
```

**Working with Git repos**:

```bash
jj git clone URL        # Clone git repo
jj git init --colocate  # Initialize in existing git repo
```

## Two Workflow Patterns

**Squash Workflow** (like git add -p):

1. `jj describe -m "feature"` - describe planned work, DOES NOT MAKE A NEW CHANGE
2. `jj new` - create scratch space, DOES make a new change
3. Make changes, then `jj squash [-i]` to move into described commit

**Edit Workflow**:

1. `jj new -m "feature"` - create and start working
2. If need prep work: `jj new -B @ -m "prep"` (insert before current)
3. `jj next --edit` to return to feature work

## Cheat Sheet

| Task               | jj command              | Git equivalent                |
| ------------------ | ----------------------- | ----------------------------- |
| Status             | `jj st`                 | `git status`                  |
| Start new work     | `jj new`                | `git checkout -b branch`      |
| Commit message     | `jj describe -m "msg"`  | `git commit --amend -m "msg"` |
| View history       | `jj log`                | `git log --graph`             |
| Show commit        | `jj show X`             | `git show X`                  |
| Interactive rebase | `jj split`, `jj squash` | `git rebase -i`               |
| Cherry-pick        | `jj duplicate X -d Y`   | `git cherry-pick X`           |
| Stash              | `jj new @-`             | `git stash`                   |
| Undo last action   | `jj undo`               | N/A                           |
| Push current work  | `jj git push -c @`      | `git push -u origin branch`   |

## Key Files to Read More

In ~/jj/docs,

- **working-copy.md**: Auto-commit behavior, conflict handling
- **git-comparison.md**: Detailed Git equivalencies
- **revsets.md**: Query language for selecting commits
- **operation-log.md**: Undo system
- **bookmarks.md**: Branch management
- **conflicts.md**: First-class conflict support

## Remember for Git Users

1. Run `jj st` frequently - it's fast and shows what jj did
2. Changes auto-committed ≠ changes shared (still need push)
3. Bookmark movement is manual (`jj bookmark set`)
4. Conflicts don't block operations - resolve when convenient
5. Working copy is always a commit; you can `jj edit` others
6. `jj new` starts work, `jj describe` names current work, or `jj commit` does both; use new+describe or commit
7. Everything is undoable with `jj undo` (one op) or `jj op restore` (target op)

REMEMBER: always run `jj st` before and after edits
