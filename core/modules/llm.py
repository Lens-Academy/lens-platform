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
        - {"type": "tool_use", "name": str} for tool calls
        - {"type": "done"} when complete
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

    # Track if we're in a tool call
    current_tool_name = None

    async for chunk in response:
        delta = chunk.choices[0].delta if chunk.choices else None
        if not delta:
            continue

        # Handle thinking/reasoning content
        reasoning = getattr(delta, "reasoning_content", None)
        if reasoning:
            yield {"type": "thinking", "content": reasoning}

        # Handle text content
        if delta.content:
            yield {"type": "text", "content": delta.content}

        # Handle tool calls
        if delta.tool_calls:
            for tool_call in delta.tool_calls:
                if tool_call.function and tool_call.function.name:
                    # New tool call starting
                    current_tool_name = tool_call.function.name
                    yield {"type": "tool_use", "name": current_tool_name}

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
