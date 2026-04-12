import pytest
from core.agents.sessions import load_or_create_open_ended_session, save_session
from core.agents.identity import PlatformIdentity, resolve_user_id


async def _get_test_user_id(suffix: int) -> int:
    identity = PlatformIdentity(type="discord", id=888888880000 + suffix, platform_name="discord_dm")
    return await resolve_user_id(identity)


@pytest.mark.asyncio
async def test_load_creates_new_session_if_none_exists():
    user_id = await _get_test_user_id(1)
    session = await load_or_create_open_ended_session(user_id)
    assert session["user_id"] == user_id
    assert session["messages"] == []
    assert session["module_id"] is None
    assert session["roleplay_id"] is None
    assert "session_id" in session


@pytest.mark.asyncio
async def test_load_returns_existing_session():
    user_id = await _get_test_user_id(2)
    session1 = await load_or_create_open_ended_session(user_id)
    # Reset to known state so the test is idempotent across re-runs
    session1["messages"] = [{"role": "user", "content": "hello"}]
    await save_session(session1)

    session2 = await load_or_create_open_ended_session(user_id)
    assert session2["session_id"] == session1["session_id"]
    assert len(session2["messages"]) == 1
    assert session2["messages"][0]["content"] == "hello"


@pytest.mark.asyncio
async def test_save_session_persists_messages():
    user_id = await _get_test_user_id(3)
    session = await load_or_create_open_ended_session(user_id)
    # Overwrite with known state so the test is idempotent across re-runs
    session["messages"] = [
        {"role": "user", "content": "hi", "platform": "discord_dm"},
        {"role": "assistant", "agent": "coach", "content": "hey there!"},
    ]
    await save_session(session)

    reloaded = await load_or_create_open_ended_session(user_id)
    assert len(reloaded["messages"]) == 2
    assert reloaded["messages"][1]["agent"] == "coach"
