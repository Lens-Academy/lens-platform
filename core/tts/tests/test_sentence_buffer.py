"""Unit tests for sentence_buffer module: find_split() and QueueIterator."""

import pytest

from core.tts.sentence_buffer import QueueIterator, find_split


# ── find_split tests ──────────────────────────────────────────────────────


class TestFindSplit:
    def test_sentence_end(self):
        """Period followed by space triggers split at conservative level."""
        assert find_split("Hello world. More", aggressive=False) == 13

    def test_no_boundary(self):
        """No punctuation → no split."""
        assert find_split("hello world", aggressive=False) == -1

    def test_aggressive_clause(self):
        """Comma triggers split only in aggressive mode."""
        assert find_split("Hello, more", aggressive=True) == 7

    def test_aggressive_long(self):
        """Long text with no punctuation splits at space boundary before 80 chars."""
        text = "a " * 50  # 100 chars
        pos = find_split(text, aggressive=True)
        assert 0 < pos <= 80

    def test_conservative_no_clause(self):
        """Comma does NOT trigger split in conservative mode."""
        assert find_split("Hello, more", aggressive=False) == -1

    def test_question_mark(self):
        """Question mark followed by space triggers split."""
        assert find_split("Really? Yes", aggressive=False) == 8

    def test_exclamation(self):
        """Exclamation mark followed by space triggers split."""
        assert find_split("Wow! Great", aggressive=False) == 5


# ── QueueIterator tests ──────────────────────────────────────────────────


class TestQueueIterator:
    @pytest.mark.asyncio
    async def test_yields_and_stops(self):
        """put items then None → yields items then stops."""
        q = QueueIterator()
        await q.put("a")
        await q.put("b")
        await q.put(None)

        result = [item async for item in q]
        assert result == ["a", "b"]

    @pytest.mark.asyncio
    async def test_empty(self):
        """put(None) immediately → empty iteration."""
        q = QueueIterator()
        await q.put(None)

        result = [item async for item in q]
        assert result == []


# ── Buffering pipeline tests ─────────────────────────────────────────────


class TestBufferingPipeline:
    """Test the find_split + QueueIterator pattern used in streaming TTS."""

    @pytest.mark.asyncio
    async def test_token_stream_buffers_into_sentences(self):
        """Feed tokens through find_split loop → queue receives sentence chunks."""
        tokens = ["Hello", " world", ".", " More", " text", "."]
        q = QueueIterator()

        buffer = ""
        for token in tokens:
            buffer += token
            while True:
                split_pos = find_split(buffer, aggressive=False)
                if split_pos < 0:
                    break
                chunk = buffer[:split_pos]
                buffer = buffer[split_pos:]
                if chunk.strip():
                    await q.put(chunk)
        if buffer.strip():
            await q.put(buffer)
        await q.put(None)

        result = [item async for item in q]
        assert result == ["Hello world. ", "More text."]

    @pytest.mark.asyncio
    async def test_eight_sentences_all_queued(self):
        """Feed 8 sentences as word-level tokens — all 8 must reach the queue.

        Replicates the simplified llm_task buffering (no held_sentence):
        split on sentence boundaries, queue each immediately, flush remainder.
        """
        sentences = [
            "AI safety is important. ",
            "We need alignment research. ",
            "Reward hacking is a real risk. ",
            "Interpretability helps us understand models. ",
            "Scalable oversight is a key challenge. ",
            "Constitutional AI offers one approach. ",
            "RLHF has known limitations. ",
            "The field is evolving rapidly.",
        ]
        full_text = "".join(sentences)

        # Simulate word-level LLM tokens
        tokens = []
        for word in full_text.split():
            tokens.append(word + " ")
        # Fix trailing space: last token shouldn't have trailing space
        tokens[-1] = tokens[-1].rstrip() + "."
        # Actually, just split the full text into word tokens faithfully
        tokens = []
        for char_idx, word in enumerate(full_text.split()):
            tokens.append(word + " ")

        q = QueueIterator()
        buffer = ""
        first_sent = False

        for token in tokens:
            buffer += token
            while True:
                split_pos = find_split(buffer, aggressive=not first_sent)
                if split_pos < 0:
                    break
                sentence = buffer[:split_pos]
                buffer = buffer[split_pos:]
                if sentence.strip():
                    await q.put(sentence)
                    first_sent = True

        # Flush remaining buffer (same path as above)
        if buffer.strip():
            await q.put(buffer)
        await q.put(None)

        result = [item async for item in q]

        # All 8 sentences must be queued (7 from find_split + 1 final flush)
        assert len(result) == 8, (
            f"Expected 8 queued chunks, got {len(result)}: {result}"
        )
        # Total queued text must equal total input text
        reassembled = "".join(result)
        # Normalize: strip trailing whitespace from both
        assert reassembled.strip() == full_text.strip(), (
            f"Text mismatch:\n  sent: {full_text!r}\n  got:  {reassembled!r}"
        )

    @pytest.mark.asyncio
    async def test_first_chunk_aggressive_then_conservative(self):
        """First split is aggressive (comma), subsequent are conservative (period)."""
        tokens = ["Hi", ",", " let me", ".", " Then more", "."]
        q = QueueIterator()

        buffer = ""
        first_sent = False
        for token in tokens:
            buffer += token
            while True:
                split_pos = find_split(buffer, aggressive=not first_sent)
                if split_pos < 0:
                    break
                chunk = buffer[:split_pos]
                buffer = buffer[split_pos:]
                if chunk.strip():
                    await q.put(chunk)
                    first_sent = True
        if buffer.strip():
            await q.put(buffer)
        await q.put(None)

        result = [item async for item in q]
        assert result == ["Hi, ", "let me. ", "Then more."]
