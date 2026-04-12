import pytest
from core.agents.agent import Agent
from core.agents.caching import estimate_input_tokens, apply_cache_control


def _make_agent(prompt="You are a coach."):
    return Agent(name="coach", system_prompt=prompt, model="anthropic/claude-sonnet-4-6")


def test_estimate_input_tokens_returns_positive_int():
    agent = _make_agent()
    messages = [{"role": "user", "content": "Hello, how are you?"}]
    count = estimate_input_tokens(messages, agent)
    assert isinstance(count, int)
    assert count > 0


def test_estimate_input_tokens_grows_with_messages():
    agent = _make_agent()
    short = [{"role": "user", "content": "Hi"}]
    long = [{"role": "user", "content": "Hi " * 500}]
    assert estimate_input_tokens(long, agent) > estimate_input_tokens(short, agent)


def test_apply_cache_control_transforms_last_message():
    messages = [
        {"role": "user", "content": "first"},
        {"role": "user", "content": "second"},
    ]
    result = apply_cache_control(messages)
    assert result[0]["content"] == "first"
    last = result[-1]
    assert isinstance(last["content"], list)
    assert last["content"][0]["type"] == "text"
    assert last["content"][0]["text"] == "second"
    assert last["content"][0]["cache_control"] == {"type": "ephemeral"}


def test_apply_cache_control_preserves_existing_block_format():
    messages = [
        {"role": "user", "content": [{"type": "text", "text": "already a block"}]},
    ]
    result = apply_cache_control(messages)
    block = result[0]["content"][0]
    assert block["cache_control"] == {"type": "ephemeral"}
    assert block["text"] == "already a block"


def test_apply_cache_control_skips_empty_list():
    result = apply_cache_control([])
    assert result == []
