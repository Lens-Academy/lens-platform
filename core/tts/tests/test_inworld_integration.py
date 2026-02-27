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

from core.tts import synthesize, TTSConfig, is_tts_available

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


# -- 1. Basic single-chunk synthesis --


async def test_single_chunk_synthesize():
    """Send full text as one chunk, expect at least one audio chunk back."""

    async def single_chunk():
        yield SHORT_TEXT

    config = TTSConfig(audio_encoding="LINEAR16")
    chunks: list[bytes] = []

    async for audio in synthesize(single_chunk(), config):
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


async def test_multi_chunk_synthesize():
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

    async for audio in synthesize(word_tokens(), config):
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


async def test_queue_iterator_synthesis():
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
    async for audio in synthesize(queue_iter(), config):
        chunks.append(audio)

    await feed_task

    assert len(chunks) > 0, "Expected audio chunks from queue-fed synthesis"
    total_bytes = sum(len(c) for c in chunks)
    min_bytes = 48000 * 2 * 1  # 1 second
    assert total_bytes > min_bytes, (
        f"Audio too short: {total_bytes} bytes = {total_bytes / 2 / 48000:.2f}s "
        f"(expected >1s for '{SHORT_TEXT[:30]}...')"
    )


# -- 4. Multi-sentence synthesis (8 sentences, ~800 chars) --


async def test_multi_sentence_synthesis_complete_audio():
    """8 sentence-sized chunks through Inworld — must produce full audio.

    This is the exact scenario that fails in production: ~800 chars of text
    split into 8 sentence-sized chunks, fed via QueueIterator. With
    bufferCharThreshold=250, Inworld auto-flushes ~3 times.

    Expected: ≥15s of audio at 48kHz/16-bit (8 sentences × ~2s each).
    """
    from core.tts.sentence_buffer import QueueIterator

    sentences = [
        "AI safety is the study of ensuring that artificial intelligence systems behave in beneficial ways. ",
        "Alignment research focuses on making AI systems that reliably do what humans actually want. ",
        "Reward hacking occurs when AI finds unexpected shortcuts that satisfy its objective function. ",
        "Interpretability research helps us understand what is happening inside neural networks. ",
        "Scalable oversight addresses how humans can supervise AI systems smarter than themselves. ",
        "Constitutional AI trains models to be helpful, harmless, and honest through self-critique. ",
        "Reinforcement learning from human feedback is widely used but has known limitations. ",
        "The field of AI safety is evolving rapidly as capabilities continue to advance.",
    ]
    total_chars = sum(len(s) for s in sentences)

    queue_iter = QueueIterator()

    async def feed_sentences():
        for sentence in sentences:
            await queue_iter.put(sentence)
            await asyncio.sleep(0.05)  # Simulate LLM pacing
        await queue_iter.put(None)

    feed_task = asyncio.create_task(feed_sentences())

    config = TTSConfig(audio_encoding="LINEAR16")
    chunks: list[bytes] = []

    async for audio in synthesize(queue_iter, config):
        chunks.append(audio)

    await feed_task

    assert len(chunks) > 0, "Expected audio chunks from 8-sentence synthesis"
    total_bytes = sum(len(c) for c in chunks)
    total_seconds = total_bytes / 2 / 48000

    # 8 sentences × ~2s each = ~16s minimum; require ≥15s
    min_seconds = 15
    min_bytes = 48000 * 2 * min_seconds
    assert total_bytes > min_bytes, (
        f"Audio too short: {total_bytes} bytes = {total_seconds:.2f}s "
        f"(expected >{min_seconds}s for {total_chars} chars across 8 sentences)"
    )

    # Log for debugging
    print(f"\n  Chars sent: {total_chars}")
    print(f"  Audio chunks: {len(chunks)}")
    print(f"  Total audio: {total_seconds:.2f}s ({total_bytes} bytes)")


# -- 5. MP3 encoding (the non-LINEAR16 path) --


async def test_mp3_encoding():
    """Verify MP3 encoding also works (browser default before LINEAR16 switch)."""

    async def single_chunk():
        yield SHORT_TEXT

    config = TTSConfig(audio_encoding="MP3")
    chunks: list[bytes] = []

    async for audio in synthesize(single_chunk(), config):
        chunks.append(audio)

    assert len(chunks) > 0, "Expected at least one MP3 audio chunk"
