# Design: Discord Code Organization

## Status: Draft

## Problem

Discord logic is scattered:
- `core/notifications/channels/discord.py` - sends DMs and channel messages
- `core/sync.py` - grants permissions, creates scheduled events (~200 lines of Discord API calls)
- `discord_bot/cogs/*.py` - handles slash commands and events

This creates confusion about where Discord logic should live.

## Proposed Solution

```
discord_bot/                    # Handles Discord events (slash commands, on_member_join, etc.)
  main.py
  cogs/
    groups_cog.py
    enrollment_cog.py
    ...

core/
  discord_outbound/             # Discord operations that core can call
    bot.py                      # set_bot(), _bot instance, get_or_fetch_member()
    permissions.py              # grant/revoke channel access
    messages.py                 # send DMs, channel messages
    channels.py                 # create text/voice channels
    events.py                   # create scheduled events
  sync.py                       # Orchestration - calls discord_outbound/
```

## Dependency Rules

```
discord_bot/  ──imports──▶  core/  ──imports──▶  core/discord_outbound/
     │                                                    ▲
     └──────────────imports───────────────────────────────┘
```

- `discord_outbound/` is a leaf (no internal imports except discord library)
- `discord_bot/` imports from `core/` and `core/discord_outbound/`
- `core/sync.py` imports from `core/discord_outbound/`

## What Moves

| From | To |
|------|-----|
| `core/notifications/channels/discord.py` | `core/discord_outbound/messages.py` + `bot.py` |
| Permission logic in `core/sync.py` | `core/discord_outbound/permissions.py` |
| Channel creation in `core/sync.py` | `core/discord_outbound/channels.py` |
| Event creation in `core/sync.py` | `core/discord_outbound/events.py` |

## What Stays

`core/sync.py` keeps:
- Orchestration (what to sync, in what order)
- Database queries (who should have access)
- Diff calculations (compare DB vs Discord state)
- Error handling and retry scheduling

## Benefits

1. Clear separation: handlers vs operations
2. Single location for all Discord API calls
3. Maintains existing dependency direction (discord_bot → core)
4. `discord_outbound/` can be tested independently with mock bot
