"""Token counting and prompt cache control helpers."""

import copy
from litellm import token_counter
from core.agents.agent import Agent
from core.agents.tools import build_all_transfer_tools


def estimate_input_tokens(messages: list[dict], agent: Agent) -> int:
    """Estimate total input token count for an agent turn.
    Uses litellm.token_counter() for local estimation.
    We compensate for known undercounting with a 5k safety margin in the dispatcher.
    """
    llm_messages = [{"role": "system", "content": agent.system_prompt}]
    for m in messages:
        clean = {"role": m["role"], "content": m.get("content", "")}
        if "tool_calls" in m:
            clean["tool_calls"] = m["tool_calls"]
        if "tool_call_id" in m:
            clean["tool_call_id"] = m["tool_call_id"]
        llm_messages.append(clean)

    tools = list(agent.extra_tools) + build_all_transfer_tools()
    return token_counter(model=agent.model, messages=llm_messages, tools=tools)


def apply_cache_control(messages: list[dict]) -> list[dict]:
    """Transform the last message's content to a content-block list with cache_control.

    LiteLLM only propagates cache_control on content blocks (not sibling keys
    or top-level request field). Converts the last message's content to block
    form if needed.

    Returns a shallow copy of the list — only the last message is deep-copied.
    """
    if not messages:
        return []

    result = list(messages)
    last = copy.deepcopy(result[-1])

    content = last.get("content")
    if content is None:
        return result

    if isinstance(content, str):
        last["content"] = [
            {"type": "text", "text": content, "cache_control": {"type": "ephemeral"}}
        ]
    elif isinstance(content, list):
        if content:
            content[-1]["cache_control"] = {"type": "ephemeral"}

    result[-1] = last
    return result
