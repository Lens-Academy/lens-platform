"""
Sync Cog

Provides a prefix command to sync slash commands to the current server.
Uses guild-specific sync to avoid conflicts with Discord Activities Entry Point.
"""

import discord
from discord.ext import commands


class SyncCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @commands.command(name="sync")
    @commands.has_permissions(administrator=True)
    async def sync(self, ctx: commands.Context):
        """Sync slash commands to this server."""
        # Clear existing guild commands first to remove stale ones
        self.bot.tree.clear_commands(guild=ctx.guild)
        # Copy global commands to this guild, then sync
        self.bot.tree.copy_global_to(guild=ctx.guild)
        synced = await self.bot.tree.sync(guild=ctx.guild)
        await ctx.send(
            f"Synced {len(synced)} commands to this server.\n"
            f"💡 **Tip:** If you see stale/duplicate commands, run `!clear-commands` first, then `!sync` again."
        )

    @commands.command(name="clear-commands")
    @commands.has_permissions(administrator=True)
    async def clear_commands(self, ctx: commands.Context):
        """Remove ALL slash commands using Discord HTTP API directly."""
        await ctx.send("Clearing all slash commands via HTTP API...")

        app_id = self.bot.application_id

        try:
            # Clear guild commands
            await ctx.send("Clearing guild commands...")
            await self.bot.http.bulk_upsert_guild_commands(app_id, ctx.guild.id, [])
            await ctx.send("✓ Guild commands cleared")
        except Exception as e:
            await ctx.send(f"Guild clear error: {type(e).__name__}: {e}")

        # Step 1: Delete global commands one by one (including Entry Point)
        try:
            await ctx.send("Fetching global commands...")
            global_cmds = await self.bot.http.get_global_commands(app_id)
            await ctx.send(f"Found {len(global_cmds)} global commands")

            deleted = 0
            failed = 0
            for cmd in global_cmds:
                cmd_type = cmd.get("type", 1)
                type_label = " (Entry Point)" if cmd_type == 4 else ""

                try:
                    await self.bot.http.delete_global_command(app_id, cmd["id"])
                    await ctx.send(f"✓ Deleted: `{cmd['name']}`{type_label}")
                    deleted += 1
                except Exception as e:
                    await ctx.send(f"✗ Failed: `{cmd['name']}`{type_label}: {e}")
                    failed += 1

            await ctx.send(f"Individual delete: {deleted} deleted, {failed} failed")
        except Exception as e:
            await ctx.send(f"Individual delete error: {type(e).__name__}: {e}")

        # Step 2: Bulk clear to catch any remaining
        try:
            await ctx.send("Running bulk clear...")
            await self.bot.http.bulk_upsert_global_commands(app_id, [])
            await ctx.send("✓ Bulk clear successful")
        except discord.HTTPException as e:
            if e.code == 50240:
                await ctx.send(f"⚠️ Bulk clear failed (Entry Point still exists): {e}")
            else:
                await ctx.send(f"✗ Bulk clear failed: {e}")
        except Exception as e:
            await ctx.send(f"✗ Bulk clear error: {type(e).__name__}: {e}")

        await ctx.send("Done! Run `!sync` to add commands back.")

    @commands.command(name="list-commands")
    @commands.has_permissions(administrator=True)
    async def list_commands(self, ctx: commands.Context):
        """List all registered slash commands (global and guild)."""
        app_id = self.bot.application_id

        # Fetch global commands
        await ctx.send("**Global commands:**")
        try:
            global_cmds = await self.bot.http.get_global_commands(app_id)
            if global_cmds:
                for cmd in global_cmds:
                    cmd_type = cmd.get("type", 1)
                    type_label = " (Entry Point)" if cmd_type == 4 else ""
                    await ctx.send(f"  - `{cmd['name']}`{type_label}")
            else:
                await ctx.send("  (none)")
        except Exception as e:
            await ctx.send(f"  Error: {e}")

        # Fetch guild commands
        await ctx.send(f"**Guild commands ({ctx.guild.name}):**")
        try:
            guild_cmds = await self.bot.http.get_guild_commands(app_id, ctx.guild.id)
            if guild_cmds:
                for cmd in guild_cmds:
                    await ctx.send(f"  - `{cmd['name']}`")
            else:
                await ctx.send("  (none)")
        except Exception as e:
            await ctx.send(f"  Error: {e}")


async def setup(bot):
    await bot.add_cog(SyncCog(bot))
