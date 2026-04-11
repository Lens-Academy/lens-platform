# Implementation Plan: core/discord_outbound/

## Overview

Extract Discord API operations from scattered locations into `core/discord_outbound/`.

## File Structure

```
core/discord_outbound/
  __init__.py           # Public exports
  bot.py                # Bot instance management
  permissions.py        # Channel permission operations
  messages.py           # DMs and channel messages
  channels.py           # Create categories and channels
  events.py             # Discord scheduled events
```

---

## Step 1: Create core/discord_outbound/bot.py

**Move from:** `core/notifications/channels/discord.py`

**Contents:**
```python
# core/discord_outbound/bot.py
import asyncio
import discord
from discord import Client, Guild, Member

_bot: Client | None = None
_dm_semaphore: asyncio.Semaphore | None = None

def set_bot(bot: Client) -> None:
    """Set the Discord bot instance. Called by main.py on startup."""
    global _bot, _dm_semaphore
    _bot = bot
    _dm_semaphore = asyncio.Semaphore(1)

def get_bot() -> Client | None:
    """Get the Discord bot instance."""
    return _bot

def get_dm_semaphore() -> asyncio.Semaphore | None:
    """Get the DM rate limit semaphore."""
    return _dm_semaphore

async def get_or_fetch_member(guild: Guild, discord_id: int) -> Member | None:
    """Get member from cache, falling back to API fetch."""
    member = guild.get_member(discord_id)
    if member:
        return member
    try:
        return await guild.fetch_member(discord_id)
    except discord.NotFound:
        return None
```

**Create:** `core/discord_outbound/__init__.py` with initial exports

---

## Step 2: Create core/discord_outbound/messages.py

**Move from:** `core/notifications/channels/discord.py`

**Contents:**
```python
# core/discord_outbound/messages.py
import asyncio
from .bot import get_bot, get_dm_semaphore

async def send_dm(discord_id: str, message: str) -> bool:
    """Send a DM to a user. Rate-limited to ~1/second."""
    bot = get_bot()
    if not bot:
        return False
    try:
        semaphore = get_dm_semaphore()
        if semaphore:
            async with semaphore:
                user = await bot.fetch_user(int(discord_id))
                await user.send(message)
                await asyncio.sleep(1)
        else:
            user = await bot.fetch_user(int(discord_id))
            await user.send(message)
        return True
    except Exception:
        return False

async def send_channel_message(channel_id: str, message: str) -> bool:
    """Send a message to a channel."""
    bot = get_bot()
    if not bot:
        return False
    try:
        channel = await bot.fetch_channel(int(channel_id))
        await channel.send(message)
        return True
    except Exception:
        return False
```

---

## Step 3: Create core/discord_outbound/channels.py

**Extract from:** `core/sync.py` - the Discord API calls only, not DB updates

**Contents:**
```python
# core/discord_outbound/channels.py
import discord

async def create_category(
    guild: discord.Guild,
    name: str,
) -> discord.CategoryChannel:
    """Create a Discord category channel."""
    overwrites = {
        guild.default_role: discord.PermissionOverwrite(view_channel=False),
        guild.me: discord.PermissionOverwrite(view_channel=True, manage_channels=True),
    }
    return await guild.create_category(name=name, overwrites=overwrites)

async def create_text_channel(
    category: discord.CategoryChannel,
    name: str,
) -> discord.TextChannel:
    """Create a text channel in a category."""
    return await category.create_text_channel(name=name)

async def create_voice_channel(
    category: discord.CategoryChannel,
    name: str,
) -> discord.VoiceChannel:
    """Create a voice channel in a category."""
    return await category.create_voice_channel(name=name)

async def get_or_fetch_channel(
    bot,
    channel_id: int,
) -> discord.abc.GuildChannel | None:
    """Get channel from cache or fetch from API."""
    channel = bot.get_channel(channel_id)
    if channel:
        return channel
    try:
        return await bot.fetch_channel(channel_id)
    except discord.NotFound:
        return None
```

---

## Step 4: Create core/discord_outbound/permissions.py

**Extract from:** `core/sync.py` (`sync_group_discord_permissions` inner loops)

**Contents:**
```python
# core/discord_outbound/permissions.py
import discord
import logging

logger = logging.getLogger(__name__)

async def grant_channel_access(
    member: discord.Member,
    text_channel: discord.TextChannel,
    voice_channel: discord.VoiceChannel | None = None,
    reason: str = "Group sync",
) -> bool:
    """Grant a member access to group channels."""
    try:
        await text_channel.set_permissions(
            member,
            view_channel=True,
            send_messages=True,
            read_message_history=True,
            reason=reason,
        )
        if voice_channel:
            await voice_channel.set_permissions(
                member,
                view_channel=True,
                connect=True,
                speak=True,
                reason=reason,
            )
        return True
    except Exception as e:
        logger.error(f"Failed to grant access to {member}: {e}")
        return False

async def revoke_channel_access(
    member: discord.Member,
    text_channel: discord.TextChannel,
    voice_channel: discord.VoiceChannel | None = None,
    reason: str = "Group sync",
) -> bool:
    """Revoke a member's access to group channels."""
    try:
        await text_channel.set_permissions(member, overwrite=None, reason=reason)
        if voice_channel:
            await voice_channel.set_permissions(member, overwrite=None, reason=reason)
        return True
    except Exception as e:
        logger.error(f"Failed to revoke access from {member}: {e}")
        return False

def get_members_with_access(channel: discord.TextChannel) -> set[str]:
    """Get Discord IDs of members who have view_channel permission."""
    member_ids = set()
    for target, perms in channel.overwrites.items():
        if isinstance(target, discord.Member) and perms.view_channel:
            member_ids.add(str(target.id))
    return member_ids
```

---

## Step 5: Create core/discord_outbound/events.py

**Extract from:** `core/sync.py` (`_ensure_meeting_discord_events` inner logic)

**Contents:**
```python
# core/discord_outbound/events.py
import discord
from datetime import datetime

async def create_scheduled_event(
    guild: discord.Guild,
    name: str,
    start_time: datetime,
    end_time: datetime,
    channel: discord.VoiceChannel,
    description: str = "",
) -> discord.ScheduledEvent:
    """Create a Discord scheduled event in a voice channel."""
    return await guild.create_scheduled_event(
        name=name,
        start_time=start_time,
        end_time=end_time,
        channel=channel,
        description=description,
        privacy_level=discord.PrivacyLevel.guild_only,
    )
```

---

## Step 6: Update core/discord_outbound/__init__.py

```python
# core/discord_outbound/__init__.py
"""Discord outbound operations - all Discord API calls go through here."""

from .bot import set_bot, get_bot, get_or_fetch_member
from .messages import send_dm, send_channel_message
from .channels import create_category, create_text_channel, create_voice_channel, get_or_fetch_channel
from .permissions import grant_channel_access, revoke_channel_access, get_members_with_access
from .events import create_scheduled_event

__all__ = [
    "set_bot",
    "get_bot",
    "get_or_fetch_member",
    "send_dm",
    "send_channel_message",
    "create_category",
    "create_text_channel",
    "create_voice_channel",
    "get_or_fetch_channel",
    "grant_channel_access",
    "revoke_channel_access",
    "get_members_with_access",
    "create_scheduled_event",
]
```

---

## Step 7: Update all importers

**Files that import from `core/notifications/channels/discord.py`:**

| File | Current Import | New Import |
|------|----------------|------------|
| `main.py` | `from core.notifications.channels.discord import set_bot` | `from core.discord_outbound import set_bot` |
| `core/sync.py` | `from .notifications.channels.discord import _bot, get_or_fetch_member, send_discord_channel_message` | `from .discord_outbound import get_bot, get_or_fetch_member, send_channel_message` |
| `core/notifications/dispatcher.py` | `from core.notifications.channels.discord import send_discord_dm, send_discord_channel_message` | `from core.discord_outbound import send_dm, send_channel_message` |
| `core/notifications/actions.py` | `from core.notifications.channels.discord import send_discord_channel_message` | `from core.discord_outbound import send_channel_message` |
| `discord_bot/cogs/nickname_cog.py` | `from core.notifications.channels.discord import get_or_fetch_member` | `from core.discord_outbound import get_or_fetch_member` |
| `discord_bot/cogs/ping_cog.py` | `from core.notifications.channels.discord import get_or_fetch_member` | `from core.discord_outbound import get_or_fetch_member` |
| `core/notifications/tests/test_discord_channel.py` | various | update to new paths |

**Note:** Function renames:
- `send_discord_dm` → `send_dm`
- `send_discord_channel_message` → `send_channel_message`
- `_bot` → `get_bot()` (function call instead of direct access)

---

## Step 8: Update core/sync.py to use new primitives

Refactor these functions to call `discord_outbound` instead of inline Discord API calls:
- `_ensure_cohort_category` → use `create_category`
- `_ensure_group_channels` → use `create_text_channel`, `create_voice_channel`
- `sync_group_discord_permissions` → use `grant_channel_access`, `revoke_channel_access`, `get_members_with_access`
- `_ensure_meeting_discord_events` → use `create_scheduled_event`

Keep orchestration logic (DB queries, decisions, error handling) in sync.py.

---

## Step 9: Delete old file and update docs

1. Delete `core/notifications/channels/discord.py`
2. Update `core/CLAUDE.md` to document `discord_outbound/`
3. Update `core/notifications/channels/__init__.py` if it exports discord functions

---

## Verification Checklist

- [ ] `ruff check .` passes
- [ ] `pytest core/tests/test_sync.py` passes
- [ ] `pytest core/notifications/tests/` passes
- [ ] `pytest` all tests pass
- [ ] No remaining imports from old path: `grep -r "notifications.channels.discord" --include="*.py" | grep -v "^docs/"`

---

## Commit Strategy

1. **Commit 1:** Create `core/discord_outbound/` with bot.py, messages.py, __init__.py
2. **Commit 2:** Create channels.py, permissions.py, events.py
3. **Commit 3:** Update all importers, refactor sync.py
4. **Commit 4:** Delete old file, update docs

Smaller commits allow easier review and rollback if needed.
