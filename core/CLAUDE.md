# Core Module

Platform-agnostic business logic layer. **No imports from `discord_bot/` or `web_api/`** - adapters import from core, not the other way around.

## Accessing Discord from Core

Core can use the `discord` library directly, but must access the bot instance through `core/discord_outbound/`:

```python
# core/discord_outbound/ - Discord API operations
from core.discord_outbound import (
    set_bot, get_bot, get_or_fetch_member,  # Bot instance management
    send_dm, send_channel_message,           # Messages
    create_category, create_text_channel, create_voice_channel,  # Channel creation
    grant_channel_access, revoke_channel_access, get_members_with_access,  # Permissions
    create_scheduled_event,                  # Discord events
)
```

**Usage in core modules:**
```python
from .discord_outbound import get_bot, get_or_fetch_member

# Check bot is available before using
bot = get_bot()
if not bot:
    return {"error": "bot_unavailable"}

channel = bot.get_channel(int(channel_id))
member = await get_or_fetch_member(guild, discord_id)
```

**Initialization (in main.py):**
```python
from core.discord_outbound import set_bot

@bot.event
async def on_ready():
    set_bot(bot)
```

This pattern allows core to use Discord APIs while keeping the bot instance injection centralized.

## Module Overview

### Base Modules

| Module | Purpose |
|--------|---------|
| `scheduling.py` | Stochastic greedy algorithm, `Person`/`Group` dataclasses |
| `users.py` | `get_user_profile()`, `save_user_profile()`, `get_facilitators()` |
| `cohorts.py` | `find_availability_overlap()`, `format_local_time()` |
| `availability.py` | Availability data handling |
| `meetings.py` | Meeting/calendar operations |
| `database.py` | SQLAlchemy async engine |
| `tables.py` | SQLAlchemy ORM table definitions |
| `auth.py` | Discord-to-Web auth flow (`create_auth_code()`, `get_or_create_user()`) |
| `config.py` | Environment configuration management |
| `enums.py` | Enum definitions |
| `timezone.py` | UTC/local conversions |
| `constants.py` | Day codes (M,T,W,R,F,S,U), timezones |
| `cohort_names.py` | Group name generation |
| `nickname.py` | User nickname management |
| `nickname_sync.py` | Discord nickname sync |
| `speech.py` | Speech/TTS integration |
| `stampy.py` | Stampy chatbot functionality |
| `google_docs.py` | Google Docs fetching/parsing |
| `data.py` | JSON persistence (legacy) |
| `sync.py` | Sync external systems (Discord, Calendar, Reminders) with group membership |
| `group_joining.py` | Direct group joining logic, joinable groups queries |

### Subdirectories

#### `calendar/` - Google Calendar Integration
- `client.py` - Calendar API client
- `events.py` - Event creation/management
- `rsvp.py` - RSVP tracking and sync

#### `content/` - Educational Content from GitHub
- `cache.py` - Content caching
- `github_fetcher.py` - GitHub content retrieval
- `webhook_handler.py` - GitHub webhook handling

#### `modules/` - Course/Module Management
- `types.py` - Type definitions
- `content.py` - Module content
- `chat.py` - LLM chat integration
- `llm.py` - LLM provider logic (LiteLLM)
- `loader.py` - Module loading
- `course_loader.py` - Course loading
- `markdown_parser.py` - Markdown parsing
- `sessions.py` - Chat session management

#### `discord_outbound/` - Discord API Operations
All Discord API calls go through this module. Provides primitives for:
- `bot.py` - Bot instance management (`set_bot`, `get_bot`, `get_or_fetch_member`)
- `messages.py` - DMs and channel messages (`send_dm`, `send_channel_message`)
- `channels.py` - Channel creation (`create_category`, `create_text_channel`, `create_voice_channel`)
- `permissions.py` - Channel permissions (`grant_channel_access`, `revoke_channel_access`)
- `events.py` - Discord scheduled events (`create_scheduled_event`)

#### `notifications/` - Multi-Channel Notification System
- `actions.py` - Notification actions
- `dispatcher.py` - Notification routing
- `scheduler.py` - APScheduler integration (background jobs)
- `templates.py` - Email/Discord templates
- `urls.py` - Dynamic URL generation
- `channels/email.py` - SendGrid email integration

#### Other Directories
- `lessons/` - Lesson-related content
- `queries/` - Database query builders
- `transcripts/` - Chat transcript storage
- `tests/` - Core unit tests

## Database Access Patterns

**Getting a connection:**
```python
from core.database import get_connection

async with get_connection() as conn:
    result = await conn.execute(query)
```

**Using a transaction:**
```python
from core.database import get_transaction

async with get_transaction() as conn:
    await conn.execute(insert_query)
    await conn.execute(update_query)
    # Auto-commits on success, rolls back on exception
```

## Adding New Business Logic

1. Add your module to `core/` (or appropriate subdirectory)
2. Export public functions in `core/__init__.py`
3. Import from `core` in adapters (discord_bot, web_api)

```python
# core/my_feature.py
async def do_something(user_id: int) -> Result:
    ...

# core/__init__.py
from .my_feature import do_something

# discord_bot/cogs/my_cog.py or web_api/routes/my_route.py
from core import do_something
```

## Testing

```bash
pytest core/tests/
```
