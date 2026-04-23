"""
LLM provider abstraction using LiteLLM.

Provides a unified interface for Claude, Gemini, and other providers.
Normalizes streaming events to our internal format.
"""

import os
from typing import AsyncIterator

from litellm import acompletion


# Default provider - can be overridden per-call or via environment
DEFAULT_PROVIDER = os.environ.get("LLM_PROVIDER", "anthropic/claude-sonnet-4-6")


# Models selectable from the Prompt Lab UI. The `id` is passed to LiteLLM's
# acompletion(). Kept here (not in promptlab/) so both the tutor and promptlab
# can reference the same list. Add/remove entries to change what's selectable.
MODEL_CHOICES: list[dict] = [
    {"id": "anthropic/claude-opus-4-7", "label": "Claude Opus 4.7"},
    {"id": "anthropic/claude-opus-4-5", "label": "Claude Opus 4.5"},
    {"id": "anthropic/claude-sonnet-4-6", "label": "Claude Sonnet 4.6"},
    {"id": "anthropic/claude-haiku-4-5-20251001", "label": "Claude Haiku 4.5"},
    {"id": "gemini/gemini-2.5-pro", "label": "Gemini 2.5 Pro"},
]


def iter_chunk_events(chunk) -> list[dict]:
    """Normalize a single streaming chunk into event dicts.

    Extracts thinking and text events only. Tool call events are NOT emitted
    here -- they are handled by the tool execution loop in chat.py after
    full message reconstruction via stream_chunk_builder.

    Returns:
        List of event dicts (may be empty for chunks with no relevant content).
    """
    events = []
    delta = chunk.choices[0].delta if chunk.choices else None
    if not delta:
        return events

    reasoning = getattr(delta, "reasoning_content", None)
    if reasoning:
        events.append({"type": "thinking", "content": reasoning})

    if delta.content:
        events.append({"type": "text", "content": delta.content})

    return events


async def stream_chat(
    messages: list[dict],
    system: str,
    tools: list[dict] | None = None,
    provider: str | None = None,
    max_tokens: int = 16384,
    thinking: bool = True,
    effort: str = "low",
) -> AsyncIterator[dict]:
    """
    Stream a chat completion from any LLM provider.

    Args:
        messages: List of {"role": "user"|"assistant", "content": str}
        system: System prompt
        tools: Optional list of tool definitions (OpenAI format)
        provider: Model string like "anthropic/claude-sonnet-4-6" or "gemini/gemini-1.5-pro"
        max_tokens: Maximum tokens in response
        thinking: Enable adaptive thinking (default True)
        effort: Thinking effort level — "low", "medium", or "high" (default "low")

    Yields:
        Normalized events:
        - {"type": "thinking", "content": str} for reasoning chunks
        - {"type": "text", "content": str} for text chunks
        - {"type": "done"} when complete

    Note: Tool call events are NOT yielded here. Tool calls are handled
    by the tool execution loop in chat.py after full message reconstruction.
    """
    model = provider or DEFAULT_PROVIDER

    # LiteLLM uses OpenAI-style messages with system as a message
    llm_messages = [{"role": "system", "content": system}] + messages

    # Build kwargs
    kwargs = {
        "model": model,
        "messages": llm_messages,
        "max_tokens": max_tokens,
        "stream": True,
    }
    if thinking:
        kwargs["thinking"] = {"type": "adaptive"}
        kwargs["output_config"] = {"effort": effort}
    if tools:
        kwargs["tools"] = tools

    response = await acompletion(**kwargs)

    async for chunk in response:
        for event in iter_chunk_events(chunk):
            yield event

    yield {"type": "done"}


async def complete(
    messages: list[dict],
    system: str,
    response_format: dict | None = None,
    provider: str | None = None,
    max_tokens: int = 1024,
) -> str:
    """
    Non-streaming completion for structured responses (e.g., scoring).

    Args:
        messages: List of {"role": "user"|"assistant", "content": str}
        system: System prompt
        response_format: Optional JSON schema for structured output
        provider: Model string (uses DEFAULT_PROVIDER if None)
        max_tokens: Maximum tokens in response

    Returns:
        Full response content as string
    """
    model = provider or DEFAULT_PROVIDER

    # LiteLLM uses OpenAI-style messages with system as a message
    llm_messages = [{"role": "system", "content": system}] + messages

    kwargs = {
        "model": model,
        "messages": llm_messages,
        "max_tokens": max_tokens,
    }
    if response_format:
        kwargs["response_format"] = response_format

    response = await acompletion(**kwargs)
    return response.choices[0].message.content
