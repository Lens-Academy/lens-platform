"""
Simple ping command to check if the bot is online.
"""

import discord
from discord import app_commands
from discord.ext import commands
from datetime import datetime


class PingCog(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @app_commands.command(name="ping", description="Check if the bot is online")
    async def ping(self, interaction: discord.Interaction):
        latency = round(self.bot.latency * 1000)
        await interaction.response.send_message(f"Pong! Latency: {latency}ms")

    @app_commands.command(name="embed", description="Test embed message")
    async def embed_test(self, interaction: discord.Interaction):
        """Send a test embed to see how embeds look."""
        embed = discord.Embed(
            title="🤖 AI Safety Fundamentals Course",
            url="https://aisafetyfundamentals.com/",
            description="""Welcome to the **AI Safety Fundamentals** course! This comprehensive program is designed to introduce you to the key concepts, challenges, and ongoing research in AI alignment and safety.

## What You'll Learn

Throughout this course, we'll explore critical questions:
- Why might advanced AI systems pose risks?
- What technical approaches exist for building safer AI?
- How do we ensure AI systems remain aligned with human values?

## Course Structure

The course runs for **8 weeks** with weekly readings, discussions, and exercises. Each cohort meets virtually with a dedicated facilitator to discuss the material and work through challenging concepts together.

> "The development of full artificial intelligence could spell the end of the human race... It would take off on its own, and re-design itself at an ever increasing rate." — Stephen Hawking

We believe that by bringing together motivated individuals from diverse backgrounds, we can make meaningful progress on these important problems.""",
            color=discord.Color.blue(),
            timestamp=datetime.now(),
        )
        embed.set_author(
            name="AI Safety Course Platform",
            icon_url="https://stampy.ai/images/stampy-logo.png",
            url="https://stampy.ai/"
        )
        embed.set_thumbnail(url="https://images.unsplash.com/photo-1677442136019-21780ecad995?w=200")
        embed.add_field(name="📅 Duration", value="8 weeks", inline=True)
        embed.add_field(name="⏰ Time Commitment", value="2-3 hrs/week", inline=True)
        embed.add_field(name="👥 Cohort Size", value="4-6 people", inline=True)
        embed.add_field(
            name="📚 Prerequisites",
            value="No prior AI/ML knowledge required! Just bring curiosity and willingness to engage with challenging ideas.",
            inline=False
        )
        embed.add_field(
            name="🎯 Who Should Join",
            value="• Students interested in AI research\n• Software engineers wanting to pivot to safety\n• Policy professionals exploring AI governance\n• Anyone curious about existential risk",
            inline=False
        )
        embed.add_field(
            name="🔗 Resources",
            value="[Course Website](https://aisafetyfundamentals.com/) • [Stampy FAQ](https://stampy.ai/) • [Alignment Forum](https://alignmentforum.org/)",
            inline=False
        )
        embed.set_image(url="https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=800")
        embed.set_footer(text="AI Safety Course Platform • Sign up with /signup", icon_url="https://stampy.ai/images/stampy-logo.png")

        await interaction.response.send_message(embed=embed)


async def setup(bot: commands.Bot):
    await bot.add_cog(PingCog(bot))
