# core/modules/chat.py
"""
Module chat - LLM integration with stage-aware prompting and tool execution loop.
"""

import json
import logging
from typing import AsyncIterator

from litellm import acompletion, stream_chunk_builder

from .llm import iter_chunk_events, DEFAULT_PROVIDER
from .prompts import DEFAULT_BASE_PROMPT
from .types import Stage, ArticleStage, VideoStage
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
    course_overview: str | None = None,
    base_prompt: str | None = None,
) -> str:
    """Build the system prompt based on current stage and context.

    The system prompt is fully static (no user-specific content) for prompt
    caching. Dynamic content (segments, position, instructions) is injected
    into the conversation history instead.

    Args:
        current_stage: The current module stage
        current_content: Content of current stage (for article/video stages)
        course_overview: Optional course overview to inject after base prompt
        base_prompt: Override for DEFAULT_BASE_PROMPT (used by Prompt Lab to
            iterate on the tutor persona). None uses the production default.
    """

    base = base_prompt if base_prompt is not None else DEFAULT_BASE_PROMPT
    role_block = f"# General Instructions\n\n{base}"

    if isinstance(current_stage, (ArticleStage, VideoStage)):
        content_type = (
            "reading an article"
            if isinstance(current_stage, ArticleStage)
            else "watching a video"
        )
        prompt = (
            role_block
            + f"""
The user is currently {content_type}. Answer the student's questions to help them understand the content, but don't lengthen the conversation. There will be more time for chatting after they are done reading/watching.
"""
        )
        if course_overview:
            prompt += f"\n\n# Course Overview\n\n{course_overview}"
        if current_content:
            prompt += f"\n\nContent the user is viewing:\n---\n{current_content}\n---"
    else:
        prompt = role_block
        if course_overview:
            prompt += f"\n\n# Course Overview\n\n{course_overview}"

    # Repeat general instructions at the end for improved adherence
    prompt += f"\n\n# General Instructions\n\n{base}"

    return prompt


def assemble_llm_request(
    *,
    messages: list[dict],
    current_stage: Stage,
    current_content: str | None = None,
    course_overview: str | None = None,
    base_prompt: str | None = None,
    model: str,
    thinking: bool = True,
    effort: str = "low",
    tools: list | None = None,
    system_prompt_override: str | None = None,
) -> dict:
    """Return {system_prompt, llm_messages, llm_kwargs} for the first LLM call.

    Pure helper — no async, no side effects, no tool loop. Used by
    send_module_message (which then runs the tool loop with this as the
    round-zero baseline) and by /api/promptlab/inspect (which shows what
    the LLM will see without invoking it).

    When system_prompt_override is given, the rendered system prompt is the
    override verbatim — _build_system_prompt is not called.

    tool_choice is intentionally not set here: it's round-dependent (forced
    to "none" on the final tool-loop round) and belongs in the loop.
    """
    if system_prompt_override is not None:
        system_prompt = system_prompt_override
    else:
        system_prompt = _build_system_prompt(
            current_stage, current_content, course_overview, base_prompt
        )

    # Filter: drop system-role (stage-transition markers — LLM APIs don't
    # accept them in messages). When tools are not offered to the model,
    # also strip tool_calls metadata and tool results — Anthropic rejects
    # assistant tool_calls when tools= is not set.
    if tools:
        api_messages = [m for m in messages if m["role"] != "system"]
    else:
        api_messages = []
        for m in messages:
            if m["role"] == "system":
                continue
            if m["role"] == "tool":
                continue
            if m["role"] == "assistant" and "tool_calls" in m:
                api_messages.append(
                    {"role": "assistant", "content": m.get("content", "")}
                )
            else:
                api_messages.append(m)

    llm_messages = [{"role": "system", "content": system_prompt}] + api_messages

    llm_kwargs: dict = {
        "model": model,
        "messages": llm_messages,
        "max_tokens": 16384,
        "stream": True,
    }
    if thinking:
        llm_kwargs["thinking"] = {"type": "adaptive"}
        llm_kwargs["output_config"] = {"effort": effort}
    if tools:
        llm_kwargs["tools"] = tools

    return {
        "system_prompt": system_prompt,
        "llm_messages": llm_messages,
        "llm_kwargs": llm_kwargs,
    }


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
    provider: str | None = None,
    course_overview: str | None = None,
    mcp_manager=None,
    content_index=None,
    thinking: bool = True,
    effort: str = "low",
    base_prompt: str | None = None,
    enable_tools: bool = True,
    system_prompt_override: str | None = None,
) -> AsyncIterator[dict]:
    """
    Send messages to an LLM and stream the response, with multi-round tool execution.

    Args:
        messages: List of {"role": "user"|"assistant"|"system", "content": str}
        current_stage: The current module stage
        current_content: Content of current stage (for article/video stages)
        provider: LLM provider string (e.g., "anthropic/claude-sonnet-4-20250514")
                  If None, uses DEFAULT_PROVIDER from environment.
        course_overview: Optional course overview text for system prompt
        mcp_manager: Optional MCPClientManager for tool access
        thinking: Enable adaptive thinking / chain-of-thought (default True).
        effort: Thinking effort level — "low", "medium", or "high" (default "low").
        base_prompt: Override for DEFAULT_BASE_PROMPT (Prompt Lab).
        enable_tools: When False, skip loading/passing tools even if mcp_manager
            is provided. Used by Prompt Lab to isolate tool behavior.
        system_prompt_override: Prompt Lab only. When set, the rendered system
            prompt is this string verbatim — base_prompt / course_overview /
            content blocks are ignored. Intended for iterating on a fully
            hand-crafted prompt.

    Yields:
        Dicts with either:
        - {"type": "thinking", "content": str} for thinking chunks
        - {"type": "text", "content": str} for text chunks
        - {"type": "tool_use", "name": str} for tool calls
        - {"type": "done"} when complete
    """
    tools = None
    if enable_tools and mcp_manager is not None:
        tools = await get_tools(mcp_manager, content_index=content_index)

    model = provider or DEFAULT_PROVIDER

    request = assemble_llm_request(
        messages=messages,
        current_stage=current_stage,
        current_content=current_content,
        course_overview=course_overview,
        base_prompt=base_prompt,
        model=model,
        thinking=thinking,
        effort=effort,
        tools=tools,
        system_prompt_override=system_prompt_override,
    )
    system = request["system_prompt"]
    base_kwargs = request["llm_kwargs"]
    # api_messages is the filtered, non-system message list (grows per round
    # as tool_calls + tool results are appended).
    api_messages = list(request["llm_messages"][1:])

    for round_num in range(MAX_TOOL_ROUNDS + 1):
        llm_messages = [{"role": "system", "content": system}] + api_messages
        kwargs = dict(base_kwargs)
        kwargs["messages"] = llm_messages
        if tools and round_num == MAX_TOOL_ROUNDS:
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
        # Save the assistant message with tool_calls to DB
        assistant_msg_for_db = {
            "role": "assistant",
            "content": assistant_message.content or "",
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments,
                    },
                }
                for tc in assistant_message.tool_calls
            ],
        }
        yield {"type": "tool_save", "message": assistant_msg_for_db}

        api_messages.append(assistant_message.model_dump(exclude_none=True))
        for tc in assistant_message.tool_calls:
            try:
                args = json.loads(tc.function.arguments)
            except (json.JSONDecodeError, TypeError):
                args = {}
            yield {
                "type": "tool_use",
                "name": tc.function.name,
                "state": "calling",
                "arguments": args,
            }
            result = await execute_tool(mcp_manager, tc, content_index=content_index)
            is_error = result.startswith("Error:") or result.startswith(
                "Tool timed out"
            )
            result_preview = result[:500] + ("…" if len(result) > 500 else "")
            yield {
                "type": "tool_use",
                "name": tc.function.name,
                "state": "error" if is_error else "result",
                "result": result_preview,
            }

            # Save tool result to DB
            tool_msg_for_db = {
                "role": "tool",
                "tool_call_id": tc.id,
                "name": tc.function.name,
                "content": result,
            }
            yield {"type": "tool_save", "message": tool_msg_for_db}

            api_messages.append(
                {
                    "tool_call_id": tc.id,
                    "role": "tool",
                    "name": tc.function.name,
                    "content": result,
                }
            )

    yield {"type": "done"}
