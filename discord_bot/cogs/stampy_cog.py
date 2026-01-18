"""
Stampy Discord cog.
This cog deals with formatting Stampy messages in a way that works with the Discord UI.
Any Stampy logic such as adding message history and system prompts should be done in /core,
though currently (29.12.25) this is not implemented.
"""

import discord
from discord.ext import commands
import traceback
import asyncio
import time
import os
import re

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core import stampy

ASK_STAMPY_CHANNEL = os.getenv("ASK_STAMPY_CHANNEL", "ask-stampy")
STAMPY_DEBUG = os.getenv("STAMPY_DEBUG", "false").lower() == "true"
STAMPY_NAME = "Stampy"
STAMPY_AVATAR = "https://raw.githubusercontent.com/StampyAI/StampyAIAssets/main/profile/stampy-profile-228.png"

# Scrolling codeblock settings
SCROLL_LINES = 5
SCROLL_LINE_WIDTH = 50
SCROLL_UPDATE_INTERVAL = 0.5  # 2fps (safe margin under 2.5/sec rate limit)


def format_thinking(text: str, prefix: str = "*Thinking...*") -> str:
    """Format thinking text with quote+subtext styling."""
    lines = text.split("\n")
    formatted = "\n".join(f"> -# {line}" if line.strip() else "> " for line in lines)
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


def get_ref_mapping(text: str) -> tuple[list[str], dict[str, str]]:
    """Extract reference mapping from text.

    Returns (ordered_refs, ref_to_display) where:
    - ordered_refs: list of ref numbers in order of first appearance
    - ref_to_display: mapping from ref number to display number
    """
    all_refs = re.findall(r"\d+", "".join(re.findall(r"\[[\d,\s]+\]", text)))
    seen = set()
    ordered_refs = []
    for ref in all_refs:
        if ref not in seen:
            seen.add(ref)
            ordered_refs.append(ref)
    ref_to_display = {ref: str(i + 1) for i, ref in enumerate(ordered_refs)}
    return ordered_refs, ref_to_display


def format_refs_inline(text: str, ref_to_display: dict[str, str] = None) -> str:
    """Format [1], [1, 2] style references to display numbers.

    Maps references to display numbers in order of first appearance.
    If ref_to_display is provided, uses that mapping; otherwise computes it.

    When STAMPY_DEBUG=true: Shows [Ref 1→1] format with mapping
    When STAMPY_DEBUG=false: Shows clean [1] format (display number only)
    """
    if ref_to_display is None:
        _, ref_to_display = get_ref_mapping(text)

    def replace_refs(match):
        bracket_content = match.group(1)
        refs = re.findall(r"\d+", bracket_content)
        parts = []
        for ref in refs:
            display = ref_to_display.get(ref, "?")
            if STAMPY_DEBUG:
                parts.append(f"Ref {ref}→{display}")
            else:
                parts.append(display)
        return f"[{', '.join(parts)}]"

    return re.sub(r"\[([\d,\s]+)\]", replace_refs, text)


class ThinkingExpandView(discord.ui.View):
    """View with button to expand/collapse full thinking - works during and after streaming."""

    def __init__(self):
        super().__init__(timeout=600)  # 10 min timeout
        self.thinking_text = ""
        self.expanded = False
        self.is_streaming = True  # Still receiving thinking chunks
        self.phase = "thinking"  # "thinking", "answering", or "done"

    def update_thinking(self, text: str):
        """Update the thinking text (called during streaming)."""
        self.thinking_text = text

    def finish_streaming(self):
        """Mark streaming as complete."""
        self.is_streaming = False

    def get_display_content(self, phase: str = "thinking") -> discord.Embed:
        """Get the appropriate embed based on expanded state.

        phase: "thinking", "answering", or "done"
        """
        if phase == "done":
            title = None  # No title when done
        elif phase == "answering":
            title = "Answering..." if not self.expanded else "Answering... (full view)"
        else:
            title = "Thinking..." if not self.expanded else "Thinking... (full view)"

        if self.expanded:
            # Show full text in embed (4096 char description limit)
            max_len = 4000  # Leave room for code block formatting
            text = self.thinking_text
            if len(text) > max_len:
                cut_point = text.rfind(" ", 0, max_len)
                if cut_point == -1:
                    cut_point = max_len
                text = text[:cut_point] + "\n... (truncated)"
            description = f"```\n{text}\n```"
        else:
            # Show scrolling last 5 lines
            description = format_scrolling_codeblock(self.thinking_text)

        embed = discord.Embed(
            title=title, description=description, color=discord.Color.blue()
        )
        return embed

    @discord.ui.button(label="▼ Expand", style=discord.ButtonStyle.secondary)
    async def toggle_button(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ):
        self.expanded = not self.expanded
        button.label = "▲ Collapse" if self.expanded else "▼ Expand"

        await interaction.response.edit_message(
            content=None,
            embed=self.get_display_content(self.phase),
            attachments=[],
            view=self,
        )


class SourcesView(discord.ui.View):
    """View with button to show/hide sources."""

    def __init__(self, citations: list, answer_text: str):
        super().__init__(timeout=600)  # 10 min timeout
        self.citations = citations
        self.answer_text = answer_text
        self.showing_sources = False

    def format_sources(self) -> str:
        """Format citations as a readable list."""
        if not self.citations:
            return "No sources available."

        lines = ["**Sources:**"]
        for i, citation in enumerate(self.citations, 1):
            title = citation.get("title", "Untitled")
            url = citation.get("url", "")
            if url:
                lines.append(f"{i}. [{title}]({url})")
            else:
                lines.append(f"{i}. {title}")
        return "\n".join(lines)

    @discord.ui.button(label="📚 Show sources", style=discord.ButtonStyle.secondary)
    async def toggle_button(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ):
        self.showing_sources = not self.showing_sources

        if self.showing_sources:
            button.label = "📚 Hide sources"
            sources = self.format_sources()
            # Combine answer with sources
            content = f"{self.answer_text}\n\n{sources}"
            if len(content) > 2000:
                content = content[:1997] + "..."
        else:
            button.label = "📚 Show sources"
            content = self.answer_text

        await interaction.response.edit_message(content=content, view=self)


class StampyCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self._webhooks: dict[int, discord.Webhook] = {}

    async def _get_webhook(self, channel: discord.TextChannel) -> discord.Webhook:
        """Get or create a webhook for the channel."""
        print(f"[Stampy] Getting webhook for channel {channel.name} ({channel.id})")

        if channel.id in self._webhooks:
            print("[Stampy] Using cached webhook")
            return self._webhooks[channel.id]

        try:
            webhooks = await channel.webhooks()
            print(f"[Stampy] Found {len(webhooks)} existing webhooks")
            for wh in webhooks:
                if wh.name == STAMPY_NAME:
                    print("[Stampy] Found existing Stampy webhook")
                    self._webhooks[channel.id] = wh
                    return wh

            print("[Stampy] Creating new webhook...")
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
            except discord.HTTPException:
                pass  # Channel may be deleted or permissions changed

    async def _stream_response(self, message: discord.Message):
        """Stream Stampy response via webhook with scrolling thinking + answer messages."""
        print("[Stampy] Starting stream_response")

        webhook = await self._get_webhook(message.channel)
        print("[Stampy] Got webhook, sending initial thinking message...")

        # Create view with toggle button (added once we have enough text)
        thinking_view = ThinkingExpandView()
        view_added = False
        MIN_LINES_FOR_BUTTON = 3

        # Initial thinking message without button
        initial_embed = discord.Embed(
            title="Thinking...", description="```\n...\n```", color=discord.Color.blue()
        )
        thinking_msg = await webhook.send(
            embed=initial_embed,
            username=STAMPY_NAME,
            avatar_url=STAMPY_AVATAR,
            wait=True,
        )
        print(f"[Stampy] Sent thinking message: {thinking_msg.id}")

        thinking_chunks = []
        answer_chunks = []
        citations = []
        answer_msg = None
        answer_msg_precreated = (
            False  # Track if answer msg was pre-created during thinking
        )
        last_thinking_update = time.time()
        last_answer_update = 0  # Start at 0 so first update happens immediately

        # Timing instrumentation
        last_chunk_time = time.time()
        chunk_count = 0
        stream_start_time = None

        try:
            async for state, content in stampy.ask(message.content):
                # Measure time since last chunk
                now = time.time()
                chunk_gap = (now - last_chunk_time) * 1000  # ms
                last_chunk_time = now
                chunk_count += 1
                print(
                    f"[Timing] Chunk #{chunk_count} ({state}): gap={chunk_gap:.0f}ms, content_len={len(content) if isinstance(content, str) else 'N/A'}"
                )

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

                            t0 = time.time()
                            await thinking_msg.edit(
                                embed=thinking_view.get_display_content("thinking"),
                                view=thinking_view if view_added else None,
                            )
                            print(
                                f"[Timing] thinking_msg.edit took {(time.time() - t0) * 1000:.0f}ms"
                            )

                            # Pre-create answer message during thinking phase (after ~3 lines)
                            # This eliminates the expensive webhook.send() from the critical path
                            if (
                                not answer_msg_precreated
                                and num_lines >= MIN_LINES_FOR_BUTTON
                            ):
                                t0 = time.time()
                                answer_msg = await webhook.send(
                                    "...",
                                    username=STAMPY_NAME,
                                    avatar_url=STAMPY_AVATAR,
                                    wait=True,
                                )
                                answer_msg_precreated = True
                                print(
                                    f"[Timing] Pre-created answer message in {(time.time() - t0) * 1000:.0f}ms: {answer_msg.id}"
                                )

                        except discord.errors.HTTPException as e:
                            print(f"[Stampy] Rate limited on thinking update: {e}")
                            await asyncio.sleep(1.0)  # Rate limited, back off more
                        last_thinking_update = now

                elif state == "citations":
                    citations = content  # content is list of citation dicts
                    print(f"[Stampy] Got {len(citations)} citations")

                elif state == "streaming":
                    # First streaming chunk - finalize thinking, start/update answer
                    if len(answer_chunks) == 0:  # First streaming chunk
                        stream_start_time = time.time()
                        print(
                            f"[Timing] First streaming chunk arrived, answer_msg_precreated={answer_msg_precreated}"
                        )

                        thinking_view.finish_streaming()
                        thinking_view.phase = (
                            "answering"  # Transition to answering phase
                        )
                        final_thinking = "".join(thinking_chunks)

                        # Fire-and-forget thinking finalization (non-blocking)
                        async def finalize_thinking():
                            try:
                                if final_thinking:
                                    num_lines = len(wrap_text_to_lines(final_thinking))
                                    await thinking_msg.edit(
                                        embed=thinking_view.get_display_content(
                                            "answering"
                                        ),
                                        view=thinking_view
                                        if num_lines >= MIN_LINES_FOR_BUTTON
                                        else None,
                                    )
                                    print(
                                        "[Timing] Fire-and-forget thinking finalization done"
                                    )
                                else:
                                    no_content_embed = discord.Embed(
                                        description="*(No thinking content)*",
                                        color=discord.Color.blue(),
                                    )
                                    await thinking_msg.edit(
                                        embed=no_content_embed, view=None
                                    )
                            except discord.errors.HTTPException as e:
                                print(
                                    f"[Stampy] Rate limited on thinking finalization: {e}"
                                )

                        asyncio.create_task(finalize_thinking())

                        if not answer_msg_precreated:
                            # Fallback: create answer message now (shouldn't normally happen)
                            print(
                                "[Timing] Answer message not pre-created, creating now..."
                            )
                            t0 = time.time()
                            answer_msg = await webhook.send(
                                "...",
                                username=STAMPY_NAME,
                                avatar_url=STAMPY_AVATAR,
                                wait=True,
                            )
                            print(
                                f"[Timing] Fallback webhook.send (answer) took {(time.time() - t0) * 1000:.0f}ms"
                            )
                        else:
                            print(
                                f"[Timing] Using pre-created answer message: {answer_msg.id}"
                            )

                        print(
                            f"[Timing] Total time from first stream chunk to answer ready: {(time.time() - stream_start_time) * 1000:.0f}ms"
                        )

                        # Reset timing for answer updates - allow immediate first update
                        last_chunk_time = time.time()
                        last_answer_update = 0

                    answer_chunks.append(content)
                    current = "".join(answer_chunks)

                    # Update answer at 2fps
                    now = time.time()
                    if now - last_answer_update >= SCROLL_UPDATE_INTERVAL:
                        # Format references inline during streaming
                        display = format_refs_inline(current)
                        display = (
                            display[:1990] + "..." if len(display) > 1990 else display
                        )
                        try:
                            t0 = time.time()
                            await answer_msg.edit(content=display)
                            print(
                                f"[Timing] answer_msg.edit took {(time.time() - t0) * 1000:.0f}ms, content_len={len(current)}"
                            )
                        except discord.errors.HTTPException as e:
                            print(f"[Stampy] Rate limited on answer update: {e}")
                            await asyncio.sleep(1.0)
                        last_answer_update = now

            # Final answer
            final_answer = "".join(answer_chunks)
            print(
                f"[Stampy] Got {len(final_answer)} chars of answer, {len(citations)} citations"
            )

            # Debug: print citations
            for i, c in enumerate(citations):
                print(
                    f"[Stampy] Citation {i + 1}: {c.get('title', 'no title')} - {c.get('url', 'no url')[:50]}"
                )

            if answer_msg:
                # Build ref -> display number mapping (order of first appearance)
                ordered_refs, ref_to_display = get_ref_mapping(final_answer)
                print(f"[Stampy] Ref to display mapping: {ref_to_display}")

                # Replace refs in answer with debug format
                answer_content = (
                    format_refs_inline(final_answer, ref_to_display)
                    if final_answer
                    else "No response received"
                )

                # Split answer into chunks if needed (2000 char limit)
                if len(answer_content) > 2000:
                    await answer_msg.edit(content=answer_content[:1997] + "...")
                    # Send remaining chunks
                    for i in range(1997, len(answer_content), 1997):
                        chunk = answer_content[i : i + 1997]
                        if i + 1997 < len(answer_content):
                            chunk += "..."
                        await webhook.send(
                            chunk,
                            username=STAMPY_NAME,
                            avatar_url=STAMPY_AVATAR,
                        )
                else:
                    await answer_msg.edit(content=answer_content)

                # Send sources as separate message
                if citations:
                    # Find which references are actually used in the answer
                    used_refs = set(ordered_refs)
                    print(f"[Stampy] References used in answer: {used_refs}")

                    # Filter and sort citations by display number (order of appearance)
                    used_citations = [
                        c for c in citations if c.get("reference") in used_refs
                    ]
                    sorted_citations = sorted(
                        used_citations,
                        key=lambda c: int(ref_to_display.get(c.get("reference"), "99")),
                    )

                    if sorted_citations:
                        sources_lines = [
                            "**Sources:** (debug mode)"
                            if STAMPY_DEBUG
                            else "**Sources:**"
                        ]
                        for c in sorted_citations:
                            ref = c.get("reference", "?")
                            display = ref_to_display.get(ref, "?")
                            title = c.get("title", "Untitled")[:50]
                            url = c.get("url", "")
                            if "#" in url:
                                url = url.split("#")[0]
                            if url:
                                if STAMPY_DEBUG:
                                    sources_lines.append(
                                        f"{display}. [{title}](<{url}>) (ref {ref})"
                                    )
                                else:
                                    sources_lines.append(
                                        f"{display}. [{title}](<{url}>)"
                                    )
                            else:
                                if STAMPY_DEBUG:
                                    sources_lines.append(
                                        f"{display}. {title} (ref {ref})"
                                    )
                                else:
                                    sources_lines.append(f"{display}. {title}")

                        sources_text = "\n".join(sources_lines)
                        if len(sources_text) <= 2000:
                            await webhook.send(
                                sources_text,
                                username=STAMPY_NAME,
                                avatar_url=STAMPY_AVATAR,
                            )

                # Transition to "done" - remove status title from thinking embed
                thinking_view.phase = "done"
                final_thinking = "".join(thinking_chunks)
                if final_thinking:
                    num_lines = len(wrap_text_to_lines(final_thinking))
                    try:
                        await thinking_msg.edit(
                            embed=thinking_view.get_display_content("done"),
                            view=thinking_view
                            if num_lines >= MIN_LINES_FOR_BUTTON
                            else None,
                        )
                    except discord.errors.HTTPException:
                        pass  # Best effort, not critical

            else:
                # No streaming content received, just thinking
                thinking_view.finish_streaming()
                thinking_view.phase = "done"
                final_thinking = "".join(thinking_chunks)
                if final_thinking:
                    # Ensure view is added if we have enough lines
                    num_lines = len(wrap_text_to_lines(final_thinking))
                    if num_lines >= MIN_LINES_FOR_BUTTON:
                        view_added = True
                    await thinking_msg.edit(
                        embed=thinking_view.get_display_content("done"),
                        view=thinking_view if view_added else None,
                    )
                else:
                    no_response_embed = discord.Embed(
                        description="*(No response received)*",
                        color=discord.Color.blue(),
                    )
                    await thinking_msg.edit(embed=no_response_embed, view=None)

        except Exception as e:
            print(f"[Stampy] Error streaming: {e}")
            traceback.print_exc()
            error_embed = discord.Embed(
                title="Error", description=str(e), color=discord.Color.red()
            )
            if answer_msg:
                await answer_msg.edit(content=f"Error: {str(e)}")
            else:
                await thinking_msg.edit(embed=error_embed, view=None)


async def setup(bot):
    await bot.add_cog(StampyCog(bot))
