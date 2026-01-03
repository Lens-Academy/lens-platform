# core/lessons/chat.py
"""
Lesson chat - Claude SDK integration with stage-aware prompting.
"""

import os
from typing import AsyncIterator

from anthropic import AsyncAnthropic

from .types import Stage, ArticleStage, VideoStage, ChatStage
from .content import (
    load_article,
    extract_article_section,
    load_article_with_metadata,
    load_video_transcript_with_metadata,
    ArticleContent,
    ArticleMetadata,
)
from ..transcripts.tools import get_text_at_time


# Tool for transitioning to next stage
TRANSITION_TOOL = {
    "name": "transition_to_next",
    "description": (
        "Call this when the conversation has reached a good stopping point "
        "and the user is ready to move to the next stage. "
        "Use this after 2-4 meaningful exchanges, or when the user indicates readiness."
    ),
    "input_schema": {
        "type": "object",
        "properties": {},
        "required": [],
    },
}


def _build_system_prompt(
    current_stage: Stage,
    current_content: str | None,
    previous_content: str | None,
) -> str:
    """Build the system prompt based on current stage and context.

    Args:
        current_stage: The current lesson stage
        current_content: Content of current stage (for article/video stages)
        previous_content: Content from previous stage (for chat stages, if showTutorPreviousContent)
    """

    base = """You are a Socratic tutor helping someone learn about AI safety.

Your role:
- Ask probing questions to help them think deeply
- Challenge their assumptions constructively
- Keep responses concise (2-3 sentences typically)
- After 2-4 meaningful exchanges, use the transition_to_next tool

Do NOT:
- Give long lectures
- Simply agree with everything they say
"""

    if isinstance(current_stage, ChatStage):
        # Active chat stage - use authored context
        prompt = base + f"\n\nInstructions:\n{current_stage.instructions}"

        if current_stage.show_tutor_previous_content and previous_content:
            prompt += f"\n\nThe user just engaged with this content:\n---\n{previous_content}\n---"

    elif isinstance(current_stage, (ArticleStage, VideoStage)):
        # User is consuming content - be helpful but brief
        content_type = "reading an article" if isinstance(current_stage, ArticleStage) else "watching a video"
        prompt = f"""You are an AI tutor. The user is currently {content_type}.

Keep responses brief - the user should focus on the content.
Answer questions if asked, but don't initiate lengthy discussion.
"""
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
            transcript_text = get_text_at_time(video_id, stage.from_seconds, end_seconds)

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


async def send_message(
    messages: list[dict],
    current_stage: Stage,
    current_content: str | None = None,
    previous_content: str | None = None,
) -> AsyncIterator[dict]:
    """
    Send messages to Claude and stream the response.

    Args:
        messages: List of {"role": "user"|"assistant"|"system", "content": str}
        current_stage: The current lesson stage
        current_content: Content of current stage (for article/video stages)
        previous_content: Content from previous stage (for chat stages)

    Yields:
        Dicts with either:
        - {"type": "text", "content": str} for text chunks
        - {"type": "tool_use", "name": str} for tool calls
        - {"type": "done"} when complete
    """
    client = AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

    system = _build_system_prompt(current_stage, current_content, previous_content)

    # Filter out system messages (stage transition markers) - Claude API doesn't accept them
    api_messages = [m for m in messages if m["role"] != "system"]

    # Only include transition tool for chat stages
    tools = [TRANSITION_TOOL] if isinstance(current_stage, ChatStage) else []
    # Build kwargs - only include tools if we have them (API rejects tools=None)
    stream_kwargs = {
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 1024,
        "system": system,
        "messages": api_messages,
    }
    if tools:
        stream_kwargs["tools"] = tools

    async with client.messages.stream(**stream_kwargs) as stream:
        async for event in stream:
            if event.type == "content_block_start":
                if event.content_block.type == "tool_use":
                    yield {"type": "tool_use", "name": event.content_block.name}
            elif event.type == "content_block_delta":
                if event.delta.type == "text_delta":
                    yield {"type": "text", "content": event.delta.text}

        yield {"type": "done"}
