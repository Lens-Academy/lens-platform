# Discord Bot

Thin adapter layer for Discord. Cogs handle Discord UI/events and delegate business logic to `core/`.

**Never import from `web_api/`** - adapters should not communicate directly.

## Cogs

| Cog | Commands | Purpose |
|-----|----------|---------|
| `scheduler_cog.py` | `/schedule`, `/list-users` | Scheduling algorithm interface |
| `enrollment_cog.py` | `/signup` | User signup flow with Views/Buttons/Selects |
| `groups_cog.py` | `/group` | Group channel/event creation |
| `breakout_cog.py` | - | Breakout room management for sessions |
| `nickname_cog.py` | - | Discord nickname synchronization |
| `stampy_cog.py` | - | Stampy AI chatbot integration |
| `sync_cog.py` | `/sync` | Slash command tree synchronization |
| `ping_cog.py` | `/ping` | Health check and latency |

## Creating a New Cog

```python
import discord
from discord import app_commands
from discord.ext import commands

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core import get_user_profile, save_user_profile  # Import from core

class MyCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="mycommand", description="Description")
    async def my_command(self, interaction: discord.Interaction):
        await interaction.response.send_message("Hello!")

async def setup(bot):
    await bot.add_cog(MyCog(bot))
```

Then add `"cogs.my_cog"` to the `COGS` list in `discord_bot/main.py`.

## Common Patterns

**Admin-only commands:**
```python
@app_commands.command(name="admin-cmd", description="Admin only")
@app_commands.checks.has_permissions(administrator=True)
async def admin_command(self, interaction: discord.Interaction):
    ...
```

**Accessing data from core:**
```python
from core import (
    get_user_profile, save_user_profile,
    get_facilitators, is_facilitator
)
```

**Deferring long operations:**
```python
@app_commands.command(name="slow", description="Takes time")
async def slow_command(self, interaction: discord.Interaction):
    await interaction.response.defer()  # Prevents timeout
    result = await some_long_operation()
    await interaction.followup.send(f"Done: {result}")
```

**Ephemeral responses (only visible to user):**
```python
await interaction.response.send_message("Secret!", ephemeral=True)
```

## Testing

```bash
pytest discord_bot/tests/
```

## Bot Initialization

The bot is initialized in `discord_bot/main.py` and imported by the root `main.py`. In unified mode, the bot shares the same asyncio event loop as FastAPI.
