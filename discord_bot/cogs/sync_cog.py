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
        # Copy global commands to this guild, then sync
        self.bot.tree.copy_global_to(guild=ctx.guild)
        synced = await self.bot.tree.sync(guild=ctx.guild)
        await ctx.send(f"Synced {len(synced)} commands to this server.")


async def setup(bot):
    await bot.add_cog(SyncCog(bot))
