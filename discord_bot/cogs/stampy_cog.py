"""
Stampy Discord cog.
"""
import discord
from discord.ext import commands
import traceback
import asyncio
import time
import io

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core import stampy

ASK_STAMPY_CHANNEL = "ask-stampy"
STAMPY_NAME = "Stampy"
STAMPY_AVATAR = "https://raw.githubusercontent.com/StampyAI/StampyAIAssets/main/profile/stampy-profile-228.png"

# Scrolling codeblock settings
SCROLL_LINES = 5
SCROLL_LINE_WIDTH = 60
SCROLL_UPDATE_INTERVAL = 0.5  # 2fps (safe margin under 2.5/sec rate limit)


def format_thinking(text: str, prefix: str = "*Thinking...*") -> str:
    """Format thinking text with quote+subtext styling."""
    lines = text.split('\n')
    formatted = '\n'.join(f'> -# {line}' if line.strip() else '> ' for line in lines)
    return f"{prefix}\n{formatted}"


def wrap_text_to_lines(text: str, width: int = SCROLL_LINE_WIDTH) -> list[str]:
    """Wrap text to lines of specified width."""
    lines = []
    current_line = ""
    for word in text.split():
        if len(current_line) + len(word) + 1 > width:
            if current_line:
                lines.append(current_line.strip())
            current_line = word + " "
        else:
            current_line += word + " "
    if current_line.strip():
        lines.append(current_line.strip())
    return lines


def format_scrolling_codeblock(text: str, num_lines: int = SCROLL_LINES) -> str:
    """Format text as a scrolling codeblock showing last N lines."""
    lines = wrap_text_to_lines(text)
    display_lines = lines[-num_lines:] if len(lines) > num_lines else lines
    return "```\n" + "\n".join(display_lines) + "\n```"


class ThinkingExpandView(discord.ui.View):
    """View with button to expand/collapse full thinking - works during and after streaming."""
    def __init__(self):
        super().__init__(timeout=600)  # 10 min timeout
        self.thinking_text = ""
        self.expanded = False
        self.is_streaming = True  # Still receiving thinking chunks

    def update_thinking(self, text: str):
        """Update the thinking text (called during streaming)."""
        self.thinking_text = text

    def finish_streaming(self):
        """Mark streaming as complete."""
        self.is_streaming = False

    def get_display_content(self) -> str:
        """Get the appropriate content based on expanded state."""
        status = "thinking..." if self.is_streaming else "done"
        if self.expanded:
            # Show full text (truncated if too long for Discord message)
            max_len = 1900
            text = self.thinking_text
            if len(text) > max_len:
                # Cut at last space before max_len to avoid mid-word cuts
                cut_point = text.rfind(' ', 0, max_len)
                if cut_point == -1:
                    cut_point = max_len
                text = text[:cut_point] + "\n... (truncated, click again when done for full file)"
            return f"**Stampy is {status}** (full view)\n```\n{text}\n```"
        else:
            # Show scrolling last 5 lines
            display = format_scrolling_codeblock(self.thinking_text)
            return f"**Stampy is {status}**\n{display}"

    @discord.ui.button(label="▼ Expand", style=discord.ButtonStyle.secondary)
    async def toggle_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        self.expanded = not self.expanded

        if self.expanded:
            button.label = "▲ Collapse"
        else:
            button.label = "▼ Expand"

        # If streaming is done and expanded, offer file download
        if not self.is_streaming and self.expanded:
            file = discord.File(io.StringIO(self.thinking_text), filename="stampy_thinking.txt")
            await interaction.response.edit_message(
                content="**Stampy's reasoning** (complete)",
                attachments=[file],
                view=self
            )
        else:
            await interaction.response.edit_message(
                content=self.get_display_content(),
                attachments=[],
                view=self
            )


class StampyCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self._webhooks: dict[int, discord.Webhook] = {}

    async def _get_webhook(self, channel: discord.TextChannel) -> discord.Webhook:
        """Get or create a webhook for the channel."""
        print(f"[Stampy] Getting webhook for channel {channel.name} ({channel.id})")

        if channel.id in self._webhooks:
            print(f"[Stampy] Using cached webhook")
            return self._webhooks[channel.id]

        try:
            webhooks = await channel.webhooks()
            print(f"[Stampy] Found {len(webhooks)} existing webhooks")
            for wh in webhooks:
                if wh.name == STAMPY_NAME:
                    print(f"[Stampy] Found existing Stampy webhook")
                    self._webhooks[channel.id] = wh
                    return wh

            print(f"[Stampy] Creating new webhook...")
            webhook = await channel.create_webhook(name=STAMPY_NAME)
            print(f"[Stampy] Created webhook: {webhook.id}")
            self._webhooks[channel.id] = webhook
            return webhook
        except Exception as e:
            print(f"[Stampy] Error getting/creating webhook: {e}")
            traceback.print_exc()
            raise

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        """Respond to messages in #ask-stampy channel."""
        if message.author.bot:
            return

        if message.channel.name != ASK_STAMPY_CHANNEL:
            return

        print(f"[Stampy] Received message in #ask-stampy: {message.content[:50]}...")

        try:
            await self._stream_response(message)
        except Exception as e:
            print(f"[Stampy] Error in on_message: {e}")
            traceback.print_exc()
            # Fallback to regular message if webhook fails
            try:
                await message.reply(f"Error: {e}")
            except:
                pass

    async def _stream_response(self, message: discord.Message):
        """Stream Stampy response via webhook with scrolling thinking + answer messages."""
        print(f"[Stampy] Starting stream_response")

        webhook = await self._get_webhook(message.channel)
        print(f"[Stampy] Got webhook, sending initial thinking message...")

        # Create view with toggle button (added once we have enough text)
        thinking_view = ThinkingExpandView()
        view_added = False
        MIN_LINES_FOR_BUTTON = 3

        # Initial thinking message without button
        thinking_msg = await webhook.send(
            "**Stampy is thinking...**\n```\n...\n```",
            username=STAMPY_NAME,
            avatar_url=STAMPY_AVATAR,
            wait=True,
        )
        print(f"[Stampy] Sent thinking message: {thinking_msg.id}")

        thinking_chunks = []
        answer_chunks = []
        answer_msg = None
        last_thinking_update = time.time()
        last_answer_update = time.time()

        try:
            async for state, content in stampy.ask(message.content):
                if state == "thinking":
                    thinking_chunks.append(content)
                    full_thinking = "".join(thinking_chunks)
                    thinking_view.update_thinking(full_thinking)

                    # Check if we have enough lines to show the button
                    num_lines = len(wrap_text_to_lines(full_thinking))

                    # Update at 2fps (every 500ms)
                    now = time.time()
                    if now - last_thinking_update >= SCROLL_UPDATE_INTERVAL:
                        try:
                            # Add view once we have enough lines
                            if num_lines >= MIN_LINES_FOR_BUTTON and not view_added:
                                view_added = True

                            await thinking_msg.edit(
                                content=thinking_view.get_display_content(),
                                view=thinking_view if view_added else None
                            )
                        except discord.errors.HTTPException as e:
                            print(f"[Stampy] Rate limited on thinking update: {e}")
                            await asyncio.sleep(1.0)  # Rate limited, back off more
                        last_thinking_update = now

                elif state == "streaming":
                    # First streaming chunk - finalize thinking, start answer
                    if answer_msg is None:
                        thinking_view.finish_streaming()
                        final_thinking = "".join(thinking_chunks)
                        if final_thinking:
                            # Ensure view is added if we have enough lines
                            num_lines = len(wrap_text_to_lines(final_thinking))
                            if num_lines >= MIN_LINES_FOR_BUTTON:
                                view_added = True
                            await thinking_msg.edit(
                                content=thinking_view.get_display_content(),
                                view=thinking_view if view_added else None
                            )
                            print(f"[Stampy] Finalized thinking: {len(final_thinking)} chars")
                        else:
                            await thinking_msg.edit(content="*(No thinking content)*", view=None)

                        # Start answer message
                        answer_msg = await webhook.send(
                            "**Answer:**\nGenerating...",
                            username=STAMPY_NAME,
                            avatar_url=STAMPY_AVATAR,
                            wait=True,
                        )
                        print(f"[Stampy] Sent answer message: {answer_msg.id}")

                    answer_chunks.append(content)
                    current = "".join(answer_chunks)

                    # Update answer at 2fps
                    now = time.time()
                    if now - last_answer_update >= SCROLL_UPDATE_INTERVAL:
                        display = current[:1990] + "..." if len(current) > 1990 else current
                        try:
                            await answer_msg.edit(content=display)
                        except discord.errors.HTTPException as e:
                            print(f"[Stampy] Rate limited on answer update: {e}")
                            await asyncio.sleep(1.0)
                        last_answer_update = now

            # Final answer
            final_answer = "".join(answer_chunks)
            print(f"[Stampy] Got {len(final_answer)} chars of answer")

            if answer_msg:
                header = "**Answer:**\n"
                if len(header + final_answer) > 2000:
                    await answer_msg.edit(content=header + final_answer[:1990-len(header)] + "...")
                    for i in range(1990-len(header), len(final_answer), 1990):
                        await webhook.send(
                            final_answer[i:i+1990],
                            username=STAMPY_NAME,
                            avatar_url=STAMPY_AVATAR,
                        )
                else:
                    await answer_msg.edit(content=header + final_answer if final_answer else "No response received")
            else:
                # No streaming content received, just thinking
                thinking_view.finish_streaming()
                final_thinking = "".join(thinking_chunks)
                if final_thinking:
                    # Ensure view is added if we have enough lines
                    num_lines = len(wrap_text_to_lines(final_thinking))
                    if num_lines >= MIN_LINES_FOR_BUTTON:
                        view_added = True
                    await thinking_msg.edit(
                        content=thinking_view.get_display_content(),
                        view=thinking_view if view_added else None
                    )
                else:
                    await thinking_msg.edit(content="*(No response received)*", view=None)

        except Exception as e:
            print(f"[Stampy] Error streaming: {e}")
            traceback.print_exc()
            if answer_msg:
                await answer_msg.edit(content=f"Error: {str(e)}")
            else:
                await thinking_msg.edit(content=f"Error: {str(e)}")


async def setup(bot):
    await bot.add_cog(StampyCog(bot))
