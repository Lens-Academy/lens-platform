"""Prompt Lab LLM regeneration with thinking support.

Wraps stream_chat() from core/modules/llm.py with Prompt Lab-specific concerns:
custom system prompts, thinking/chain-of-thought support, and no database writes.

Per INFRA-03: imports from core/modules/llm.py directly, NOT from chat.py or scoring.py.
Per INFRA-04: does NOT import database modules or write to any tables.
"""

from typing import AsyncIterator

from core.modules.llm import stream_chat


async def regenerate_response(
    messages: list[dict],
    system_prompt: str,
    enable_thinking: bool = True,
    effort: str = "low",
    provider: str | None = None,
    max_tokens: int = 16384,
) -> AsyncIterator[dict]:
    """
    Regenerate an AI response with a custom system prompt.

    This is the core Prompt Lab function. Unlike the production chat flow,
    it accepts an arbitrary system prompt (editable by facilitator) and
    optionally enables chain-of-thought/thinking blocks.

    Defaults match normal chat: adaptive thinking ON, effort "low".
    Prompt Lab UI can override these.

    Args:
        messages: Conversation history up to (but not including) the response
                  to generate. List of {"role": "user"|"assistant", "content": str}.
        system_prompt: The full system prompt (base + instructions), editable
                       by facilitator.
        enable_thinking: Whether to request thinking/chain-of-thought from the LLM.
        effort: Thinking effort level — "low", "medium", or "high".
        provider: LLM provider string. If None, uses DEFAULT_PROVIDER.
        max_tokens: Maximum tokens in response.

    Yields:
        Normalized events:
        - {"type": "thinking", "content": str} for thinking/CoT chunks
        - {"type": "text", "content": str} for text chunks
        - {"type": "done"} when complete
        - {"type": "error", "message": str} on error

    Note: Does NOT write to any database. The caller (API route) is responsible
    for state management, which in Prompt Lab is all client-side.
    """
    try:
        async for event in stream_chat(
            messages=messages,
            system=system_prompt,
            provider=provider,
            max_tokens=max_tokens,
            thinking=enable_thinking,
            effort=effort,
        ):
            yield event
    except Exception as e:
        yield {"type": "error", "message": str(e)}
        yield {"type": "done"}


async def continue_conversation(
    messages: list[dict],
    system_prompt: str,
    enable_thinking: bool = True,
    effort: str = "low",
    provider: str | None = None,
    max_tokens: int = 16384,
) -> AsyncIterator[dict]:
    """
    Continue a conversation with a follow-up message.

    Semantically distinct from regenerate_response (continue adds after the
    last message, regenerate replaces an existing message), but functionally
    identical: both take messages + system_prompt and stream a response.

    Args:
        messages: Full conversation including the follow-up user message.
        system_prompt: Current system prompt.
        enable_thinking: Whether to include chain-of-thought.
        effort: Thinking effort level — "low", "medium", or "high".
        provider: LLM provider string.
        max_tokens: Maximum tokens in response.

    Yields:
        Same normalized events as regenerate_response().
    """
    async for event in regenerate_response(
        messages=messages,
        system_prompt=system_prompt,
        enable_thinking=enable_thinking,
        effort=effort,
        provider=provider,
        max_tokens=max_tokens,
    ):
        yield event
