# core/modules/chat.py
"""
Module chat - LLM integration with stage-aware prompting and tool execution loop.
"""

import logging
import os
from typing import AsyncIterator

from litellm import acompletion, stream_chunk_builder

from .llm import iter_chunk_events, DEFAULT_PROVIDER
from .context import SectionContext
from .prompts import assemble_chat_prompt, DEFAULT_BASE_PROMPT, TOOL_USAGE_GUIDANCE
from .types import Stage, ArticleStage, VideoStage, ChatStage
from .content import (
    load_article_with_metadata,
    load_video_transcript_with_metadata,
    ArticleContent,
    ArticleMetadata,
)
from .tools import get_tools, execute_tool
from ..transcripts.tools import get_text_at_time

logger = logging.getLogger(__name__)

MAX_TOOL_ROUNDS = 3


def _build_system_prompt(
    current_stage: Stage,
    current_content: str | None,
    section_context: SectionContext | None,
    course_overview: str | None = None,
) -> str:
    """Build the system prompt based on current stage and context.

    Args:
        current_stage: The current module stage
        current_content: Content of current stage (for article/video stages)
        section_context: Previous/current content from the section
        course_overview: Optional course overview to inject after base prompt
    """

    base = DEFAULT_BASE_PROMPT

    if course_overview:
        base += f"\n\n{course_overview}"

    if isinstance(current_stage, ChatStage):
        # Active chat stage - use shared assembly
        context = (
            section_context
            if not current_stage.hide_previous_content_from_tutor
            else None
        )
        prompt = assemble_chat_prompt(base, current_stage.instructions, context)

    elif isinstance(current_stage, (ArticleStage, VideoStage)):
        # User is consuming content - be helpful but brief
        content_type = (
            "reading an article"
            if isinstance(current_stage, ArticleStage)
            else "watching a video"
        )
        prompt = (
            base
            + f"""
The user is currently {content_type}. Answer the student's questions to help them understand the content, but don't lengthen the conversation. There will be more time for chatting after they are done reading/watching.
"""
        )
        if current_content:
            prompt += f"\n\nContent the user is viewing:\n---\n{current_content}\n---"

    else:
        prompt = base

    return prompt


def get_stage_content(stage: Stage) -> ArticleContent | None:
    """
    Get the content for a stage (article or video transcript).

    For articles, returns ArticleContent with:
    - content: The markdown text (possibly an excerpt)
    - metadata: Title, author, source_url from frontmatter
    - is_excerpt: True if from/to were used

    For videos, returns ArticleContent with just content (no metadata).

    Returns None if content not found.
    """
    if isinstance(stage, ArticleStage):
        try:
            return load_article_with_metadata(
                stage.source,
                stage.from_text,
                stage.to_text,
            )
        except FileNotFoundError as e:
            logger.warning(f"Article not found for stage {stage.source}: {e}")
            return None

    elif isinstance(stage, VideoStage):
        try:
            # Load video metadata to get video_id
            transcript_data = load_video_transcript_with_metadata(stage.source)
            video_id = transcript_data.metadata.video_id

            if not video_id:
                logger.warning(f"No video_id found for video stage {stage.source}")
                return None

            # Get transcript text for the time range
            end_seconds = stage.to_seconds if stage.to_seconds else 9999
            transcript_text = get_text_at_time(
                video_id, stage.from_seconds, end_seconds
            )

            # Return as ArticleContent for compatibility
            return ArticleContent(
                content=transcript_text,
                metadata=ArticleMetadata(
                    title=transcript_data.metadata.title,
                    source_url=transcript_data.metadata.url,
                ),
                is_excerpt=stage.from_seconds > 0 or stage.to_seconds is not None,
            )
        except FileNotFoundError as e:
            logger.warning(
                f"Transcript not found for video {stage.source} "
                f"(time {stage.from_seconds}-{stage.to_seconds}): {e}"
            )
            return None

    return None


async def send_module_message(
    messages: list[dict],
    current_stage: Stage,
    current_content: str | None = None,
    section_context: SectionContext | None = None,
    provider: str | None = None,
    course_overview: str | None = None,
    mcp_manager=None,
) -> AsyncIterator[dict]:
    """
    Send messages to an LLM and stream the response, with multi-round tool execution.

    Args:
        messages: List of {"role": "user"|"assistant"|"system", "content": str}
        current_stage: The current module stage
        current_content: Content of current stage (for article/video stages)
        section_context: Previous/current content from the section
        provider: LLM provider string (e.g., "anthropic/claude-sonnet-4-20250514")
                  If None, uses DEFAULT_PROVIDER from environment.
        course_overview: Optional course overview text for system prompt
        mcp_manager: Optional MCPClientManager for tool access

    Yields:
        Dicts with either:
        - {"type": "thinking", "content": str} for thinking chunks
        - {"type": "text", "content": str} for text chunks
        - {"type": "tool_use", "name": str} for tool calls
        - {"type": "done"} when complete
    """
    system = _build_system_prompt(
        current_stage, current_content, section_context, course_overview
    )

    # Get available tools if mcp_manager provided
    tools = None
    if mcp_manager is not None:
        tools = await get_tools(mcp_manager)
        if tools:
            system += TOOL_USAGE_GUIDANCE

    # Debug mode: show system prompt in chat
    if os.environ.get("DEBUG") == "1":
        debug_text = f"**[DEBUG - System Prompt]**\n\n```\n{system}\n```\n\n**[DEBUG - Messages]**\n\n```\n{messages}\n```\n\n---\n\n"
        yield {"type": "text", "content": debug_text}

    # Filter out system messages (stage transition markers) - LLM APIs don't accept them in messages
    api_messages = [m for m in messages if m["role"] != "system"]

    model = provider or DEFAULT_PROVIDER

    # Tool execution loop
    for round_num in range(MAX_TOOL_ROUNDS + 1):
        llm_messages = [{"role": "system", "content": system}] + api_messages
        kwargs = {
            "model": model,
            "messages": llm_messages,
            "max_tokens": 16384,
            "stream": True,
            "thinking": {"type": "adaptive"},
            "output_config": {"effort": "low"},
        }
        if tools:
            kwargs["tools"] = tools
            if round_num == MAX_TOOL_ROUNDS:
                kwargs["tool_choice"] = "none"  # force text on final round

        response = await acompletion(**kwargs)
        chunks = []
        async for chunk in response:
            chunks.append(chunk)
            for event in iter_chunk_events(chunk):
                yield event

        built = stream_chunk_builder(chunks, messages=llm_messages)
        assistant_message = built.choices[0].message

        if not assistant_message.tool_calls:
            break

        # Execute tool calls
        api_messages.append(assistant_message.model_dump(exclude_none=True))
        for tc in assistant_message.tool_calls:
            yield {"type": "tool_use", "name": tc.function.name}
            result = await execute_tool(mcp_manager, tc)
            api_messages.append(
                {
                    "tool_call_id": tc.id,
                    "role": "tool",
                    "name": tc.function.name,
                    "content": result,
                }
            )

    yield {"type": "done"}
