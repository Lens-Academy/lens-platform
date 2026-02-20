"""Prompt Lab LLM regeneration with thinking support.

Wraps stream_chat() from core/modules/llm.py with Prompt Lab-specific concerns:
custom system prompts, thinking/chain-of-thought support, and no database writes.

Per INFRA-03: imports from core/modules/llm.py directly, NOT from chat.py or scoring.py.
Per INFRA-04: does NOT import database modules or write to any tables.
"""

from typing import AsyncIterator

from core.modules.llm import stream_chat, DEFAULT_PROVIDER
from litellm import acompletion


async def regenerate_response(
    messages: list[dict],
    system_prompt: str,
    enable_thinking: bool = False,
    thinking_budget: int = 4096,
    provider: str | None = None,
    max_tokens: int = 2048,
) -> AsyncIterator[dict]:
    """
    Regenerate an AI response with a custom system prompt.

    This is the core Prompt Lab function. Unlike the production chat flow,
    it accepts an arbitrary system prompt (editable by facilitator) and
    optionally enables chain-of-thought/thinking blocks.

    Args:
        messages: Conversation history up to (but not including) the response
                  to generate. List of {"role": "user"|"assistant", "content": str}.
        system_prompt: The full system prompt (base + instructions), editable
                       by facilitator.
        enable_thinking: Whether to request thinking/chain-of-thought from the LLM.
        thinking_budget: Token budget for thinking blocks (only if enable_thinking=True).
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
        if not enable_thinking:
            # Simple case: delegate to stream_chat() which handles system prompt
            # prepending and event normalization
            async for event in stream_chat(
                messages=messages,
                system=system_prompt,
                provider=provider,
                max_tokens=max_tokens,
            ):
                yield event
        else:
            # Thinking mode: call acompletion directly with the thinking parameter.
            # LiteLLM supports extended thinking for Anthropic models via the
            # `thinking` parameter. This may need adjustment based on the actual
            # LiteLLM version and provider support.
            model = provider or DEFAULT_PROVIDER

            llm_messages = [{"role": "system", "content": system_prompt}] + messages

            response = await acompletion(
                model=model,
                messages=llm_messages,
                max_tokens=max_tokens,
                stream=True,
                thinking={"type": "enabled", "budget_tokens": thinking_budget},
            )

            async for chunk in response:
                delta = chunk.choices[0].delta if chunk.choices else None
                if not delta:
                    continue

                # Check for thinking/reasoning content.
                # LiteLLM normalizes this differently per provider -- try
                # reasoning_content first (Anthropic/OpenAI), then thinking.
                reasoning = getattr(delta, "reasoning_content", None)
                if reasoning:
                    yield {"type": "thinking", "content": reasoning}

                # Handle regular text content
                if delta.content:
                    yield {"type": "text", "content": delta.content}

            yield {"type": "done"}

    except Exception as e:
        yield {"type": "error", "message": str(e)}
        yield {"type": "done"}


async def continue_conversation(
    messages: list[dict],
    system_prompt: str,
    enable_thinking: bool = False,
    thinking_budget: int = 4096,
    provider: str | None = None,
    max_tokens: int = 2048,
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
        thinking_budget: Token budget for thinking blocks.
        provider: LLM provider string.
        max_tokens: Maximum tokens in response.

    Yields:
        Same normalized events as regenerate_response().
    """
    async for event in regenerate_response(
        messages=messages,
        system_prompt=system_prompt,
        enable_thinking=enable_thinking,
        thinking_budget=thinking_budget,
        provider=provider,
        max_tokens=max_tokens,
    ):
        yield event
