"""Integration tests for Inworld TTS — hits the real API.

Requires INWORLD_API_KEY in .env / .env.local (loaded by root conftest).
Skip automatically if the key is missing.

These tests verify:
1. Single-chunk synthesis produces audio bytes
2. Multi-chunk (simulated LLM token) synthesis produces audio bytes
3. The streaming queue-backed iterator works end-to-end
"""

import asyncio

import pytest

from core.tts import InworldTTSClient, TTSConfig, is_tts_available

pytestmark = pytest.mark.skipif(
    not is_tts_available(),
    reason="INWORLD_API_KEY not set — skipping Inworld integration tests",
)

SHORT_TEXT = "Hello, this is a quick test."
LONGER_TEXT = (
    "Artificial intelligence safety is the field of research that studies how to "
    "ensure AI systems behave in ways that are beneficial and aligned with human "
    "values. This is a critical area because advanced AI could be transformative."
)


@pytest.fixture
async def client():
    """Fresh InworldTTSClient, closed after test."""
    c = InworldTTSClient()
    yield c
    await c.close()


# -- 1. Basic single-chunk synthesis --


async def test_single_chunk_synthesize(client: InworldTTSClient):
    """Send full text as one chunk, expect at least one audio chunk back."""

    async def single_chunk():
        yield SHORT_TEXT

    config = TTSConfig(audio_encoding="LINEAR16")
    chunks: list[bytes] = []

    async for audio in client.synthesize(single_chunk(), config):
        chunks.append(audio)

    assert len(chunks) > 0, "Expected at least one audio chunk"
    total_bytes = sum(len(c) for c in chunks)
    # SHORT_TEXT (~28 chars) should produce at least 1s of audio at 48kHz 16-bit mono
    min_bytes = 48000 * 2 * 1  # 1 second
    assert total_bytes > min_bytes, (
        f"Audio too short: {total_bytes} bytes = {total_bytes / 2 / 48000:.2f}s "
        f"(expected >1s for '{SHORT_TEXT[:30]}...')"
    )


# -- 2. Multi-chunk (simulated LLM tokens) synthesis --


async def test_multi_chunk_synthesize(client: InworldTTSClient):
    """Stream text word-by-word (like LLM tokens), expect full audio back.

    This is the key test for the streaming pipeline: text arrives incrementally
    (like from an LLM) and Inworld must synthesize the complete sentence.
    With auto_mode=True, Inworld synthesizes each sentence as it arrives.
    """

    async def word_tokens():
        for word in LONGER_TEXT.split():
            yield word + " "
            await asyncio.sleep(0.02)

    config = TTSConfig(audio_encoding="LINEAR16")
    chunks: list[bytes] = []

    async for audio in client.synthesize(word_tokens(), config):
        chunks.append(audio)

    assert len(chunks) > 0, "Expected at least one audio chunk from multi-token input"
    total_bytes = sum(len(c) for c in chunks)
    # LONGER_TEXT (~176 chars) should produce at least 5s of audio
    min_bytes = 48000 * 2 * 5  # 5 seconds
    assert total_bytes > min_bytes, (
        f"Audio too short: {total_bytes} bytes = {total_bytes / 2 / 48000:.2f}s "
        f"(expected >5s for multi-sentence text)"
    )


# -- 3. Queue-backed iterator (matches streaming WebSocket protocol) --


async def test_queue_iterator_synthesis(client: InworldTTSClient):
    """Simulate the _QueueIterator pattern from tts_stream.py streaming mode."""
    queue: asyncio.Queue[str | None] = asyncio.Queue()

    async def queue_iter():
        while True:
            token = await queue.get()
            if token is None:
                return
            yield token

    config = TTSConfig(audio_encoding="LINEAR16")

    # Feed tokens in a background task (like receive_tokens in tts_stream.py)
    async def feed_tokens():
        for word in SHORT_TEXT.split():
            await queue.put(word + " ")
            await asyncio.sleep(0.03)
        await queue.put(None)  # sentinel

    feed_task = asyncio.create_task(feed_tokens())

    chunks: list[bytes] = []
    async for audio in client.synthesize(queue_iter(), config):
        chunks.append(audio)

    await feed_task

    assert len(chunks) > 0, "Expected audio chunks from queue-fed synthesis"
    total_bytes = sum(len(c) for c in chunks)
    min_bytes = 48000 * 2 * 1  # 1 second
    assert total_bytes > min_bytes, (
        f"Audio too short: {total_bytes} bytes = {total_bytes / 2 / 48000:.2f}s "
        f"(expected >1s for '{SHORT_TEXT[:30]}...')"
    )


# -- 4. MP3 encoding (the non-LINEAR16 path) --


async def test_mp3_encoding(client: InworldTTSClient):
    """Verify MP3 encoding also works (browser default before LINEAR16 switch)."""

    async def single_chunk():
        yield SHORT_TEXT

    config = TTSConfig(audio_encoding="MP3")
    chunks: list[bytes] = []

    async for audio in client.synthesize(single_chunk(), config):
        chunks.append(audio)

    assert len(chunks) > 0, "Expected at least one MP3 audio chunk"
