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
        await ctx.send(f"Synced {len(synced)} commands to this server.")

    @commands.command(name="clear-commands")
    @commands.has_permissions(administrator=True)
    async def clear_commands(self, ctx: commands.Context):
        """Remove ALL slash commands using Discord HTTP API directly."""
        await ctx.send("Clearing all slash commands via HTTP API...")

        app_id = self.bot.application_id

        # Use HTTP API to bulk overwrite with empty array (this actually deletes from Discord)
        # Clear guild commands
        await self.bot.http.bulk_upsert_guild_commands(app_id, ctx.guild.id, [])

        # Clear global commands
        await self.bot.http.bulk_upsert_global_commands(app_id, [])

        await ctx.send("Done! All commands cleared from Discord. Run `!sync` to add them back.")


async def setup(bot):
    await bot.add_cog(SyncCog(bot))
