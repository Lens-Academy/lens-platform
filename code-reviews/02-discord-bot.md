# Code Review: `discord_bot/` Directory

**Date:** 2026-01-09
**Reviewer:** Claude Code (superpowers:code-reviewer)

## Summary

The Discord bot codebase is generally well-structured with clear separation between cogs and proper delegation to the `core/` layer. However, I found several issues ranging from potential bugs to code quality improvements.

---

## File: `discord_bot/main.py`

### Issue 1: Import inside event handler
**Lines:** 75-77
**Severity:** Minor

The `traceback` module is imported inside the exception handler rather than at module level.

```python
except Exception as e:
    import traceback  # <-- Should be at module level
    print(f"  ... Error loading {cog}: {e}")
    traceback.print_exc()
```

**Suggested fix:** Move `import traceback` to the top of the file with other imports.

### Issue 2: Inconsistent cog path naming
**Lines:** 32-42
**Severity:** Minor

Most cogs use short paths (`"cogs.ping_cog"`) but one uses a full path (`"discord_bot.cogs.nickname_cog"`). The comment explains the reason, but this inconsistency could cause confusion.

```python
COGS = [
    "cogs.ping_cog",
    # ...
    "discord_bot.cogs.nickname_cog",  # Full path so web_api gets same module instance
]
```

**Suggestion:** Consider adding a more detailed comment explaining the architectural reason for this.

---

## File: `discord_bot/cogs/scheduler_cog.py`

### Issue 3: Swallowed exception in progress callback
**Lines:** 79-86
**Severity:** Important

Exceptions in the progress callback are silently swallowed, which could hide important errors:

```python
async def update_progress(current, total, best_score, total_people):
    try:
        await progress_msg.edit(...)
    except Exception:
        pass  # All exceptions swallowed
```

**Suggested fix:** At minimum, log the exception for debugging:

```python
except discord.HTTPException:
    pass  # Rate limited, expected
except Exception as e:
    print(f"[SchedulerCog] Progress update failed: {e}")
```

### Issue 4: Division by zero potential
**Lines:** 105-106
**Severity:** Minor (handled)

The code correctly handles the zero case but the pattern is somewhat awkward:

```python
total_users = result.users_grouped + result.users_ungroupable
placement_rate = (result.users_grouped * 100 // total_users) if total_users else 0
```

This is fine, just noting the defensive handling is in place.

---

## File: `discord_bot/cogs/enrollment_cog.py`

### Issue 5: Duplicate URL construction logic
**Lines:** 37-38 and 51-52
**Severity:** Important (DRY violation)

URL construction is duplicated between `signup` and `availability` commands:

```python
# In signup:
web_url = os.environ.get("FRONTEND_URL", "http://localhost:5173")
link = f"{web_url}/auth/code?code={code}&next=/signup"

# In availability:
web_url = os.environ.get("FRONTEND_URL", "http://localhost:5173")
link = f"{web_url}/auth/code?code={code}&next=/availability"
```

**Suggested fix:** Extract a helper method:

```python
def _build_auth_link(code: str, next_path: str) -> str:
    web_url = os.environ.get("FRONTEND_URL", "http://localhost:5173")
    return f"{web_url}/auth/code?code={code}&next={next_path}"
```

### Issue 6: TODO comment for dead/legacy code
**Lines:** 59-108
**Severity:** Minor

The `toggle-facilitator` command has a TODO suggesting it should be removed. If it's truly unused, consider removing it to reduce maintenance burden.

---

## File: `discord_bot/cogs/groups_cog.py`

### Issue 7: Missing await for async context manager
**Lines:** 39-40
**Severity:** Critical (Potential Bug)

The autocomplete function uses `async with get_connection()` correctly, but the same pattern in `cohort_autocomplete` could be vulnerable to connection leaks if an exception occurs after the connection is obtained but before choices are built. However, the current implementation looks correct.

### Issue 8: Bare except clause
**Lines:** 283-285
**Severity:** Important

Bare `except:` clause swallows all exceptions:

```python
except discord.HTTPException:
    pass  # Skip if event creation fails
```

This is actually fine - the issue is elsewhere:

```python
# Line 188-190:
except:  # <-- This is the problematic bare except
    pass
```

**Suggested fix:**

```python
except discord.HTTPException:
    pass  # Channel may have been deleted during cleanup
```

### Issue 9: Repeated permission-setting code
**Lines:** 128-144 and 366-378
**Severity:** Important (DRY violation)

Channel permission logic is duplicated between `realize_groups` and `on_member_join`:

```python
# In realize_groups:
await text_channel.set_permissions(
    member,
    view_channel=True,
    send_messages=True,
    read_message_history=True,
)

# In on_member_join:
await text_channel.set_permissions(
    member,
    view_channel=True,
    send_messages=True,
    read_message_history=True,
)
```

**Suggested fix:** Extract a helper method:

```python
async def _grant_channel_permissions(
    self,
    member: discord.Member,
    text_channel: discord.TextChannel,
    voice_channel: discord.VoiceChannel
):
    """Grant standard group channel permissions to a member."""
    await text_channel.set_permissions(
        member,
        view_channel=True,
        send_messages=True,
        read_message_history=True,
    )
    await voice_channel.set_permissions(
        member,
        view_channel=True,
        connect=True,
        speak=True,
    )
```

### Issue 10: Incomplete TODO for local time conversion
**Lines:** 313-320
**Severity:** Minor

TODO comment indicates incomplete functionality:

```python
# TODO: Convert UTC time to local for each member
# For now, just show UTC
```

The `schedule_lines` variable is built but never used in the welcome message.

### Issue 11: Silent failure in on_member_join
**Lines:** 389
**Severity:** Minor

Exception handling is overly broad:

```python
except discord.HTTPException:
    pass  # Channel may have been deleted
```

This could hide legitimate errors. Consider logging at debug level.

---

## File: `discord_bot/cogs/breakout_cog.py`

### Issue 12: Bare except clause
**Lines:** 188-190
**Severity:** Important

```python
except:
    pass
```

**Suggested fix:**

```python
except discord.HTTPException:
    pass
```

### Issue 13: Code duplication in interaction response handling
**Lines:** 91-118 and 241-246
**Severity:** Important (DRY violation)

The pattern of checking `interaction.response.is_done()` and choosing between `send_message` and `followup.send` is repeated multiple times:

```python
if interaction.response.is_done():
    await interaction.followup.send("...", ephemeral=True)
else:
    await interaction.response.send_message("...", ephemeral=True)
```

**Suggested fix:** Create a helper method:

```python
async def _send_response(self, interaction: discord.Interaction, content: str, ephemeral: bool = True):
    if interaction.response.is_done():
        await interaction.followup.send(content, ephemeral=ephemeral)
    else:
        await interaction.response.send_message(content, ephemeral=ephemeral)
```

### Issue 14: Potential race condition in session management
**Lines:** 100-105, 163-167, 292
**Severity:** Minor

The `_active_sessions` dict is accessed without locking. In a Discord bot this is unlikely to cause issues since the event loop is single-threaded, but worth noting for future refactoring.

---

## File: `discord_bot/cogs/ping_cog.py`

### Issue 15: Large test/demo code in ping_cog
**Lines:** 76-648
**Severity:** Minor

The ping cog contains extensive test commands (`/embed`, `/txt`, `/spoiler`, `/collapse`, `/test-presence`, etc.) that are likely developer tools rather than production features. Consider:
1. Moving these to a separate `debug_cog.py`
2. Adding admin-only checks to these commands
3. Disabling them in production via environment variable

### Issue 16: Import inside function
**Lines:** 79, 618
**Severity:** Minor

`import io` is done inside functions:

```python
@app_commands.command(name="txt", ...)
async def txt_test(self, interaction: discord.Interaction):
    import io  # Should be at top of file
```

---

## File: `discord_bot/cogs/stampy_cog.py`

### Issue 17: Import statement in wrong location
**Lines:** 60
**Severity:** Minor

`import re` appears after the function definitions instead of at the top:

```python
import re  # Should be at top with other imports

def get_ref_mapping(text: str) -> tuple[list[str], dict[str, str]]:
```

### Issue 18: Bare except clause
**Lines:** 263
**Severity:** Important

```python
except:
    pass
```

**Suggested fix:**

```python
except discord.HTTPException:
    pass
```

### Issue 19: Complex streaming logic could benefit from state machine
**Lines:** 305-543
**Severity:** Minor (suggestion)

The `_stream_response` method is 240+ lines with complex state management. While functional, it could be more maintainable as a state machine or broken into smaller methods.

### Issue 20: Excessive debug logging in production
**Lines:** 219-242, 253-259, 268-290, etc.
**Severity:** Minor

Many print statements remain in the code. Consider using proper logging levels:

```python
import logging
logger = logging.getLogger(__name__)

# Instead of:
print(f"[Stampy] Got webhook, sending initial thinking message...")
# Use:
logger.debug("Got webhook, sending initial thinking message")
```

---

## File: `discord_bot/cogs/nickname_cog.py`

### Issue 21: Global state for bot reference
**Lines:** 17-18, 94-96
**Severity:** Minor

Using a module-level `_bot` variable is a code smell, though documented:

```python
_bot = None

async def setup(bot):
    global _bot
    _bot = bot
```

**Alternative approach:** Pass the bot reference through a more explicit mechanism, such as storing it on the cog instance and exposing a method to access it.

---

## File: `discord_bot/utils/__init__.py`

### Issue 22: sys.path manipulation
**Lines:** 11-13
**Severity:** Minor

```python
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
```

This pattern is repeated across many files. Consider using proper package installation or a project-level `conftest.py` to handle imports.

---

## File: `discord_bot/test_bot_manager.py`

### Issue 23: Closure variable capture issue
**Lines:** 37-39
**Severity:** Critical (Bug)

The `on_ready` event handler has a closure variable capture issue. While default arguments are used to capture variables, this pattern can be error-prone:

```python
@client.event
async def on_ready(c=client, idx=i, evt=ready_event):
    print(f"    Test bot {idx + 1} connected: {c.user}")
    evt.set()
```

The `c=client` default argument pattern works but is fragile. A cleaner approach would use a factory function or a class-based handler.

---

## File: `discord_bot/tests/fake_interaction.py`

### Issue 24: Unused import
**Lines:** 9
**Severity:** Minor

`MagicMock` is imported but never used:

```python
from unittest.mock import MagicMock  # Unused
```

---

## Summary of Issues by Severity

### Critical (2)
1. Closure variable capture in test_bot_manager.py (potential bug)
2. (No other critical issues - the bare except clauses are important but not critical)

### Important (7)
1. Swallowed exceptions in scheduler_cog.py progress callback
2. DRY violation in enrollment_cog.py URL construction
3. Bare except clause in groups_cog.py line 188-190
4. DRY violation in groups_cog.py permission-setting code
5. Bare except clause in breakout_cog.py line 188-190
6. DRY violation in breakout_cog.py interaction response handling
7. Bare except clause in stampy_cog.py line 263

### Minor (15)
1. Import inside exception handler in main.py
2. Inconsistent cog path naming in main.py
3. TODO for legacy code in enrollment_cog.py
4. Incomplete TODO for local time conversion in groups_cog.py
5. Silent failure logging in groups_cog.py
6. Large test code in ping_cog.py
7. Import inside function in ping_cog.py
8. Import statement location in stampy_cog.py
9. Complex streaming logic in stampy_cog.py
10. Excessive debug logging in stampy_cog.py
11. Global state pattern in nickname_cog.py
12. sys.path manipulation pattern across files
13. Unused import in fake_interaction.py
14. Potential race condition note in breakout_cog.py
15. Division handling note in scheduler_cog.py

---

## Positive Observations

1. **Good architecture**: Cogs properly delegate to `core/` layer, keeping Discord-specific code thin
2. **Proper async handling**: Consistent use of `async/await` throughout
3. **Good error messages**: User-facing error messages are clear and helpful
4. **Proper interaction deferral**: Long-running operations correctly defer responses
5. **Good use of embeds**: Progress updates and results use embeds effectively
6. **Autocomplete implementation**: Cohort autocomplete is well-implemented with proper Discord limits (25 choices)
7. **Event listeners**: Proper use of `@commands.Cog.listener()` for member events
