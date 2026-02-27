"""Tests for /ws/chat/roleplay unified WebSocket endpoint.

Tests the full WebSocket protocol: init → session, message → text + done.
Mocks: stream_chat (LLM), get_or_create_chat_session/add_chat_message (DB),
       load_flattened_module (filesystem).

Uses Starlette TestClient for text-only tests (no create_task needed).
"""

import sys
from dataclasses import dataclass, field
from pathlib import Path
from unittest.mock import AsyncMock, patch
from uuid import UUID

import pytest

project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from starlette.testclient import TestClient

from core.tts import is_tts_available
from web_api.routes.roleplay_ws import parse_tts_config


# ── Unit tests for parse_tts_config ─────────────────────────────────────


class TestParseTTSConfig:
    def test_with_voice(self):
        """Voice present → returns TTSConfig."""
        config = parse_tts_config(
            {
                "voice": "Ashley",
                "model": "inworld-tts-1.5-mini",
                "audio_encoding": "LINEAR16",
            }
        )
        assert config is not None
        assert config.voice_id == "Ashley"
        assert config.model_id == "inworld-tts-1.5-mini"
        assert config.audio_encoding == "LINEAR16"

    def test_without_voice(self):
        """No voice → returns None (text-only mode)."""
        config = parse_tts_config({})
        assert config is None


# ── WebSocket protocol tests ────────────────────────────────────────────


@dataclass
class FakeModule:
    content_id: UUID = UUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
    slug: str = "test/module"
    title: str = "Test Module"
    sections: list = field(default_factory=list)
    error: str | None = None


def _fake_session(messages=None, completed_at=None):
    return {
        "session_id": 42,
        "messages": messages or [],
        "completed_at": completed_at,
        "module_id": UUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"),
        "roleplay_id": UUID("11111111-2222-3333-4444-555555555555"),
        "user_id": None,
        "anonymous_token": UUID("deadbeef-dead-beef-dead-beefdeadbeef"),
    }


INIT_MSG = {
    "module_slug": "test/module",
    "roleplay_id": "11111111-2222-3333-4444-555555555555",
    "ai_instructions": "You are a test character.",
    "anonymous_token": "deadbeef-dead-beef-dead-beefdeadbeef",
}


async def _fake_stream_chat(**kwargs):
    """Fake stream_chat that yields a few text tokens and done."""
    yield {"type": "text", "content": "Hello "}
    yield {"type": "text", "content": "world!"}
    yield {"type": "done"}


def _apply_mocks():
    """Return a stack of patches for DB, LLM, and module loader."""
    return [
        patch(
            "web_api.routes.roleplay_ws.load_flattened_module",
            return_value=FakeModule(),
        ),
        patch(
            "web_api.routes.roleplay_ws.get_or_create_chat_session",
            new_callable=AsyncMock,
            return_value=_fake_session(),
        ),
        patch(
            "web_api.routes.roleplay_ws.add_chat_message",
            new_callable=AsyncMock,
        ),
        patch(
            "web_api.routes.roleplay_ws.get_connection",
        ),
        patch(
            "web_api.routes.roleplay_ws.stream_chat",
            side_effect=_fake_stream_chat,
        ),
    ]


class TestRoleplayWS:
    """WebSocket protocol tests using Starlette TestClient."""

    def _enter_mocks(self, mocks):
        """Enter a list of patch contexts, return their mocks."""
        entered = []
        for m in mocks:
            entered.append(m.__enter__())
        return entered

    def _exit_mocks(self, mocks):
        for m in mocks:
            m.__exit__(None, None, None)

    def test_init_returns_session(self):
        """Init message → {type: 'session', session_id, messages}."""
        from main import app

        mocks = _apply_mocks()
        entered = self._enter_mocks(mocks)
        # Patch get_connection to return an async context manager
        conn_mock = entered[3]
        fake_conn = AsyncMock()
        cm = AsyncMock()
        cm.__aenter__ = AsyncMock(return_value=fake_conn)
        cm.__aexit__ = AsyncMock(return_value=False)
        conn_mock.return_value = cm

        try:
            client = TestClient(app)
            with client.websocket_connect("/ws/chat/roleplay") as ws:
                ws.send_json(INIT_MSG)
                resp = ws.receive_json()
                assert resp["type"] == "session"
                assert resp["session_id"] == 42
                assert resp["messages"] == []
        finally:
            self._exit_mocks(mocks)

    def test_text_only_turn(self):
        """Send message → receive text events + done."""
        from main import app

        mocks = _apply_mocks()
        entered = self._enter_mocks(mocks)
        conn_mock = entered[3]
        fake_conn = AsyncMock()
        cm = AsyncMock()
        cm.__aenter__ = AsyncMock(return_value=fake_conn)
        cm.__aexit__ = AsyncMock(return_value=False)
        conn_mock.return_value = cm

        try:
            client = TestClient(app)
            with client.websocket_connect("/ws/chat/roleplay") as ws:
                # Init
                ws.send_json(INIT_MSG)
                resp = ws.receive_json()
                assert resp["type"] == "session"

                # Send message
                ws.send_json({"message": "Hello!"})

                texts = []
                while True:
                    msg = ws.receive_json()
                    if msg["type"] == "text":
                        texts.append(msg["content"])
                    elif msg["type"] == "done":
                        break

                assert "".join(texts) == "Hello world!"
        finally:
            self._exit_mocks(mocks)

    def test_opening_message_no_llm(self):
        """New session + opening_message → text + done, no LLM call."""
        from main import app

        mocks = _apply_mocks()
        entered = self._enter_mocks(mocks)
        conn_mock = entered[3]
        fake_conn = AsyncMock()
        cm = AsyncMock()
        cm.__aenter__ = AsyncMock(return_value=fake_conn)
        cm.__aexit__ = AsyncMock(return_value=False)
        conn_mock.return_value = cm

        stream_mock = entered[4]

        try:
            client = TestClient(app)
            with client.websocket_connect("/ws/chat/roleplay") as ws:
                ws.send_json(
                    {
                        **INIT_MSG,
                        "opening_message": "Greetings, adventurer!",
                    }
                )
                resp = ws.receive_json()
                assert resp["type"] == "session"

                # The opening message should arrive as text + done
                # without calling stream_chat at all
                ws.send_json({"message": ""})

                texts = []
                while True:
                    msg = ws.receive_json()
                    if msg["type"] == "text":
                        texts.append(msg["content"])
                    elif msg["type"] == "done":
                        break

                assert "".join(texts) == "Greetings, adventurer!"
                stream_mock.assert_not_called()
        finally:
            self._exit_mocks(mocks)

    def test_turn_guard(self):
        """Message during active turn → error."""
        from main import app

        # We need stream_chat to be slow so we can send a second message
        async def _slow_stream(**kwargs):
            import asyncio

            yield {"type": "text", "content": "thinking..."}
            await asyncio.sleep(10)
            yield {"type": "done"}

        mocks = _apply_mocks()
        entered = self._enter_mocks(mocks)
        conn_mock = entered[3]
        fake_conn = AsyncMock()
        cm = AsyncMock()
        cm.__aenter__ = AsyncMock(return_value=fake_conn)
        cm.__aexit__ = AsyncMock(return_value=False)
        conn_mock.return_value = cm

        entered[4].side_effect = _slow_stream

        try:
            client = TestClient(app)
            with client.websocket_connect("/ws/chat/roleplay") as ws:
                ws.send_json(INIT_MSG)
                ws.receive_json()  # session

                ws.send_json({"message": "first"})
                # Read first text token
                msg = ws.receive_json()
                assert msg["type"] == "text"

                # Now try to send during turn
                ws.send_json({"message": "second"})
                msg = ws.receive_json()
                assert msg["type"] == "error"
                assert "in progress" in msg["message"].lower()
        finally:
            self._exit_mocks(mocks)

    def test_cancel_during_turn(self):
        """Cancel during active turn → done."""
        from main import app

        async def _slow_stream(**kwargs):
            import asyncio

            yield {"type": "text", "content": "start "}
            await asyncio.sleep(10)
            yield {"type": "done"}

        mocks = _apply_mocks()
        entered = self._enter_mocks(mocks)
        conn_mock = entered[3]
        fake_conn = AsyncMock()
        cm = AsyncMock()
        cm.__aenter__ = AsyncMock(return_value=fake_conn)
        cm.__aexit__ = AsyncMock(return_value=False)
        conn_mock.return_value = cm

        entered[4].side_effect = _slow_stream

        try:
            client = TestClient(app)
            with client.websocket_connect("/ws/chat/roleplay") as ws:
                ws.send_json(INIT_MSG)
                ws.receive_json()  # session

                ws.send_json({"message": "hello"})
                msg = ws.receive_json()
                assert msg["type"] == "text"

                ws.send_json({"cancel": True})
                # Should get a done
                msg = ws.receive_json()
                assert msg["type"] == "done"
        finally:
            self._exit_mocks(mocks)

    def test_invalid_init_closes(self):
        """Missing module_slug → error + close."""
        from main import app

        client = TestClient(app)
        with client.websocket_connect("/ws/chat/roleplay") as ws:
            ws.send_json({"roleplay_id": "xxx"})
            msg = ws.receive_json()
            assert msg["type"] == "error"


# ── TTS integration test ────────────────────────────────────────────────
# Skipped unless INWORLD_API_KEY is set. Uses create_task internally,
# which requires httpx AsyncClient + ASGITransport (not Starlette TestClient).


@pytest.mark.skipif(
    not is_tts_available(),
    reason="INWORLD_API_KEY not set",
)
class TestRoleplayWSTTS:
    """Integration tests with real TTS (requires INWORLD_API_KEY)."""

    @pytest.mark.asyncio
    async def test_turn_with_tts_produces_audio(self):
        """Init with voice → send message → receive text + binary audio + done."""

        mocks = _apply_mocks()
        entered = []
        for m in mocks:
            entered.append(m.__enter__())

        conn_mock = entered[3]
        fake_conn = AsyncMock()
        cm = AsyncMock()
        cm.__aenter__ = AsyncMock(return_value=fake_conn)
        cm.__aexit__ = AsyncMock(return_value=False)
        conn_mock.return_value = cm

        try:
            # Test the orchestration logic directly via the handler functions
            # (httpx doesn't support WebSocket, Starlette TestClient can't handle create_task)
            from web_api.routes.roleplay_ws import _handle_turn_with_tts

            # Create a mock websocket that collects sent data
            collected_text = []
            collected_audio = bytearray()
            got_done = False

            class MockWS:
                async def send_json(self, data):
                    nonlocal got_done
                    if data.get("type") == "text":
                        collected_text.append(data["content"])
                    elif data.get("type") == "done":
                        got_done = True

                async def send_bytes(self, data):
                    collected_audio.extend(data)

            ctx = {
                "session_id": 42,
                "existing_messages": [],
                "module": FakeModule(),
                "ai_instructions": "You are a test character. Say hello briefly.",
                "scenario_content": None,
                "tts_config": parse_tts_config(
                    {
                        "voice": "Ashley",
                        "model": "inworld-tts-1.5-mini",
                        "audio_encoding": "LINEAR16",
                    }
                ),
            }

            mock_ws = MockWS()
            content = await _handle_turn_with_tts(mock_ws, ctx, "Hi!")

            assert len(content) > 0, "No LLM response"
            assert "".join(collected_text) == content
            assert len(collected_audio) > 100, (
                f"Too few audio bytes: {len(collected_audio)}"
            )
            assert got_done
        finally:
            for m in mocks:
                m.__exit__(None, None, None)

    @pytest.mark.asyncio
    async def test_eight_sentence_tts_full_audio(self):
        """E2E: 8-sentence LLM response must produce ≥15s of audio over WS.

        Mock: LLM (streams 8 sentences as word tokens), DB.
        Real: sentence buffer, QueueIterator, Inworld TTS client.

        This is the exact scenario that cuts off in production.
        """
        import asyncio

        from web_api.routes.roleplay_ws import _handle_turn_with_tts

        # 8 sentences, ~100 chars each — matches production failure case
        EIGHT_SENTENCES = (
            "AI safety is the study of ensuring that artificial intelligence "
            "systems behave in beneficial ways. "
            "Alignment research focuses on making AI systems that reliably do "
            "what humans actually want. "
            "Reward hacking occurs when AI finds unexpected shortcuts that "
            "satisfy its objective function. "
            "Interpretability research helps us understand what is happening "
            "inside neural networks. "
            "Scalable oversight addresses how humans can supervise AI systems "
            "smarter than themselves. "
            "Constitutional AI trains models to be helpful and harmless and "
            "honest through self-critique. "
            "Reinforcement learning from human feedback is widely used but "
            "has known limitations. "
            "The field of AI safety is evolving rapidly as capabilities "
            "continue to advance."
        )

        # Mock LLM: stream the text word-by-word with realistic pacing
        async def _eight_sentence_stream(**kwargs):
            for word in EIGHT_SENTENCES.split():
                yield {"type": "text", "content": word + " "}
                await asyncio.sleep(0.02)
            yield {"type": "done"}

        mocks = _apply_mocks()
        entered = []
        for m in mocks:
            entered.append(m.__enter__())

        conn_mock = entered[3]
        fake_conn = AsyncMock()
        cm = AsyncMock()
        cm.__aenter__ = AsyncMock(return_value=fake_conn)
        cm.__aexit__ = AsyncMock(return_value=False)
        conn_mock.return_value = cm

        # Point stream_chat at our 8-sentence generator
        entered[4].side_effect = _eight_sentence_stream

        try:
            collected_text = []
            collected_audio = bytearray()
            got_done = False

            class MockWS:
                async def send_json(self, data):
                    nonlocal got_done
                    if data.get("type") == "text":
                        collected_text.append(data["content"])
                    elif data.get("type") == "done":
                        got_done = True

                async def send_bytes(self, data):
                    collected_audio.extend(data)

            ctx = {
                "session_id": 42,
                "existing_messages": [],
                "module": FakeModule(),
                "ai_instructions": "Irrelevant — LLM is mocked.",
                "scenario_content": None,
                "tts_config": parse_tts_config(
                    {
                        "voice": "Ashley",
                        "model": "inworld-tts-1.5-mini",
                        "audio_encoding": "LINEAR16",
                    }
                ),
            }

            mock_ws = MockWS()
            content = await _handle_turn_with_tts(
                mock_ws, ctx, "Tell me about AI safety."
            )

            assert got_done, "Never received 'done' message"
            assert len(content) > 0, "No LLM text"

            total_text = "".join(collected_text)
            total_bytes = len(collected_audio)
            total_seconds = total_bytes / 2 / 48000  # LINEAR16 @ 48kHz

            print(f"\n  Text length: {len(total_text)} chars")
            print(f"  Audio: {total_bytes} bytes = {total_seconds:.2f}s")

            # 8 sentences × ~2s each = ~16s; require ≥15s
            assert total_seconds >= 15, (
                f"Audio too short: {total_seconds:.2f}s "
                f"(expected ≥15s for {len(total_text)} chars, 8 sentences). "
                f"Got {total_bytes} bytes over WebSocket."
            )
        finally:
            for m in mocks:
                m.__exit__(None, None, None)
