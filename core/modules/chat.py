# core/modules/chat.py
"""
Module chat - Claude SDK integration with stage-aware prompting.
"""

import os
from typing import AsyncIterator

from .llm import stream_chat

from .types import Stage, ArticleStage, VideoStage, ChatStage
from .content import (
    load_article_with_metadata,
    load_video_transcript_with_metadata,
    ArticleContent,
    ArticleMetadata,
)
from ..transcripts.tools import get_text_at_time


# Tool for transitioning to next stage (OpenAI function calling format)
TRANSITION_TOOL = {
    "type": "function",
    "function": {
        "name": "transition_to_next",
        "description": (
            "Call this when the conversation has reached a good stopping point "
            "and the user is ready to move to the next stage. "
            "Use this after 2-3 exchanges, or when the user indicates readiness."
        ),
        "parameters": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
}


def _build_system_prompt(
    current_stage: Stage,
    current_content: str | None,
    previous_content: str | None,
) -> str:
    """Build the system prompt based on current stage and context.

    Args:
        current_stage: The current module stage
        current_content: Content of current stage (for article/video stages)
        previous_content: Content from previous stage (for chat stages, unless hidePreviousContentFromTutor)
    """

    base = """You are a tutor helping someone learn about AI safety. Each piece of content (article, video) has different topics and learning objectives.
"""

    if isinstance(current_stage, ChatStage):
        # Active chat stage - use authored context
        prompt = base + f"\n\nInstructions:\n{current_stage.instructions}"

        if not current_stage.hide_previous_content_from_tutor and previous_content:
            prompt += f"\n\nThe user just engaged with this content:\n---\n{previous_content}\n---"

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
        except FileNotFoundError:
            return None

    elif isinstance(stage, VideoStage):
        try:
            # Load video metadata to get video_id
            transcript_data = load_video_transcript_with_metadata(stage.source)
            video_id = transcript_data.metadata.video_id

            if not video_id:
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
        except FileNotFoundError:
            return None

    return None


async def send_module_message(
    messages: list[dict],
    current_stage: Stage,
    current_content: str | None = None,
    previous_content: str | None = None,
    provider: str | None = None,
) -> AsyncIterator[dict]:
    """
    Send messages to an LLM and stream the response.

    Args:
        messages: List of {"role": "user"|"assistant"|"system", "content": str}
        current_stage: The current module stage
        current_content: Content of current stage (for article/video stages)
        previous_content: Content from previous stage (for chat stages)
        provider: LLM provider string (e.g., "anthropic/claude-sonnet-4-20250514")
                  If None, uses DEFAULT_PROVIDER from environment.

    Yields:
        Dicts with either:
        - {"type": "text", "content": str} for text chunks
        - {"type": "tool_use", "name": str} for tool calls
        - {"type": "done"} when complete
    """
    system = _build_system_prompt(current_stage, current_content, previous_content)

    # Debug mode: show system prompt in chat
    if os.environ.get("DEBUG") == "1":
        debug_text = f"**[DEBUG - System Prompt]**\n\n```\n{system}\n```\n\n**[DEBUG - Messages]**\n\n```\n{messages}\n```\n\n---\n\n"
        yield {"type": "text", "content": debug_text}

    # Filter out system messages (stage transition markers) - LLM APIs don't accept them in messages
    api_messages = [m for m in messages if m["role"] != "system"]

    # Only include transition tool for chat stages
    tools = [TRANSITION_TOOL] if isinstance(current_stage, ChatStage) else None

    async for event in stream_chat(
        messages=api_messages,
        system=system,
        tools=tools,
        provider=provider,
        max_tokens=1024,
    ):
        yield event
