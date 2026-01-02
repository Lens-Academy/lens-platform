# Architecture

This document describes the architecture of the AI Safety Course Platform.

## Overview

A Discord bot + web platform for AI Safety education course logistics, including cohort enrollment, scheduling, and progress tracking.

## 3-Layer Architecture

```
        ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
        │   LLM APIs      │  │   Supabase      │  │   Google Docs   │
        │   (Anthropic)   │  │   (PostgreSQL)  │  │   API           │
        └─────────────────┘  └─────────────────┘  └─────────────────┘
                 │                    │                    │
                 └────────────────────┼────────────────────┘
                                      ▼
                  ┌─────────────────────┐
                  │   Layer 1: Core     │
                  │  (Business Logic)   │
                  └─────────────────────┘
                       ▲            ▲
                       │            │ direct function calls
                       ▼            ▼
        ┌────────────────────┐  ┌────────────────────┐
        │ Layer 2a: Discord  │  │ Layer 2b: Web API  │
        │ Bot (Cogs +        │  │ (FastAPI Routes)   │
        │ Commands)          │  │                    │
        └────────────────────┘  └────────────────────┘
                ▲                        ▲
                │ WebSocket              │ HTTP/REST
                ▼                        ▼
        ┌────────────────────┐  ┌────────────────────┐
        │  Layer 3a:         │  │  Layer 3b: React   │
        │  Discord Client    │  │  Frontend (SPA)    │
        │  (native UI)       │  │                    │
        └────────────────────┘  └────────────────────┘
```

## Layer Details

### Layer 1: Core (`core/`)

Platform-agnostic business logic. No Discord or web framework imports.

| Module | Responsibility |
|--------|----------------|
| `scheduling.py` | Stochastic greedy cohort scheduling algorithm |
| `enrollment.py` | User profile management, facilitator tracking |
| `courses.py` | Course CRUD, week completion, progress tracking |
| `cohorts.py` | Availability overlap, timezone-aware formatting |
| `auth.py` | Discord-to-Web auth flow, auth code generation |
| `database.py` | Supabase client singleton |
| `data.py` | JSON persistence (legacy, migrating to Supabase) |
| `timezone.py` | UTC/local timezone conversions |
| `google_docs.py` | Google Docs API integration |
| `constants.py` | Day codes, timezone list |
| `cohort_names.py` | Cohort name generation |

All exports centralized in `core/__init__.py`.

### Layer 2a: Discord Adapter (`discord_bot/`)

Thin adapter cogs that handle Discord UI/events and delegate to `core/`.

| Cog | Commands | Purpose |
|-----|----------|---------|
| `scheduler_cog.py` | `/schedule` | Run scheduling algorithm |
| `enrollment_cog.py` | `/signup`, `/view-availability` | User enrollment flow |
| `groups_cog.py` | `/group` | Manual group creation (needs refactor) |
| `sync_cog.py` | `/sync` | Slash command sync |
| `ping_cog.py` | `/ping` | Health check |

### Layer 2b: Web API (`web_api/`)

FastAPI routes for web frontend communication.

| Route | Endpoints | Purpose |
|-------|-----------|---------|
| `/auth/*` | OAuth, code validation, sessions | Authentication |
| `/api/users/*` | `PATCH /me` | User profile updates |

**Auth utilities:** `auth.py` provides JWT creation/verification, session cookies.

### Layer 3a: Discord Client

Native Discord UI via slash commands, buttons, selects, embeds.

### Layer 3b: React Frontend (`web_frontend/`)

React 19 + Vite + TypeScript SPA.

| Route | Purpose |
|-------|---------|
| `/` | Home page |
| `/signup` | Multi-step enrollment wizard |
| `/auth/code` | Auth code callback |

## Unified Backend

The key architectural decision: **one Python process runs both services**.

```python
# main.py
@asynccontextmanager
async def lifespan(app: FastAPI):
    bot_task = asyncio.create_task(start_bot())
    yield  # FastAPI runs here, bot runs alongside
    await stop_bot()
```

**Benefits:**
- Shared asyncio event loop
- Services can call each other's async functions directly
- No IPC or message queues needed
- Single deployment unit

**Trade-offs:**
- Scaling requires scaling both together
- One service blocking affects the other

## Authentication Flow

Three paths to establish a session:

### 1. Discord OAuth (full flow)
```
Frontend → /auth/discord → Discord → /auth/discord/callback → Session cookie
```

### 2. Auth Code (bot-initiated)
```
Discord /signup → create_auth_code() → User clicks link → /auth/code → Session
```

### 3. Session Verification
```
Frontend → GET /auth/me (with cookie) → User info or 401
```

## Data Flow Examples

### User Signup
```
1. User: /signup in Discord
2. Bot: create_auth_code(discord_id) → Supabase auth_codes table
3. Bot: sends link with code
4. User: clicks link → /auth/code validates → session cookie
5. User: fills form → PATCH /api/users/me → Supabase users table
```

### Cohort Scheduling
```
1. Admin: /schedule in Discord
2. Cog: loads user_data.json → Person objects
3. Cog: groups by course
4. Cog: run_scheduling(people, iterations=1000)
5. Core: stochastic greedy algorithm finds optimal groups
6. Cog: creates Discord channels/events for each cohort
```

### Course Creation
```
1. Admin: /add-course <google_doc_url>
2. Cog: extracts doc ID, fetches via Google Docs API
3. Cog: parses tabs → week chapters
4. Cog: creates Discord category + channels
5. Cog: saves to courses.json
```

## Scheduling Algorithm

Location: `core/scheduling.py`

**Algorithm:** Stochastic greedy with 1000 iterations
1. Sort people by available time slots (with random jitter)
2. For each person, place in valid existing group or create new
3. Group valid if all members share at least one meeting time
4. Track best solution across iterations
5. Optional: balance cohort sizes, require facilitator per cohort

**Key types:**
```python
@dataclass
class Person:
    id, name, intervals, if_needed_intervals, timezone, courses, experience

@dataclass
class Group:
    id, name, people, facilitator_id, selected_time
```

## Tech Stack

**Backend:**
- Python 3.11+
- discord.py ≥2.3.0
- FastAPI ≥0.109.0
- Supabase (PostgreSQL)
- pytz, PyJWT, httpx

**Frontend:**
- React 19, TypeScript
- Vite, Tailwind CSS
- react-router

## Deployment

Single Railway service running:
```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

Required environment variables:
- `DISCORD_BOT_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_KEY`
- `JWT_SECRET`
- `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`
- `FRONTEND_URL`
- `GOOGLE_CREDENTIALS_FILE` (optional)
