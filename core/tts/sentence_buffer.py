"""Sentence splitting and queue-backed async iterator for TTS streaming.

Used to buffer LLM tokens into sentence-sized chunks before sending to TTS.
"""

import asyncio
import re

# Sentence end: .!? followed by whitespace
_SENTENCE_END = re.compile(r"[.!?]\s")
# Clause end: ,;:— followed by whitespace (aggressive mode only)
_CLAUSE_END = re.compile(r"[,;:\u2014]\s")


def find_split(buffer: str, *, aggressive: bool) -> int:
    """Find the best position to split buffered text.

    Returns the index AFTER the split point (i.e., start of remainder),
    or -1 if no split found.

    Aggressive mode (first chunk): split at first clause or sentence boundary.
    Conservative mode: split only at sentence boundaries.
    """
    # Always check for sentence boundaries first
    m = _SENTENCE_END.search(buffer)
    if m:
        return m.end()  # After the space following .!?

    if aggressive:
        # Also split at clause boundaries
        m = _CLAUSE_END.search(buffer)
        if m:
            return m.end()
        # Fallback: if buffer is getting long, split at last space
        if len(buffer) > 80:
            last_space = buffer.rfind(" ", 0, 80)
            if last_space > 0:
                return last_space + 1

    return -1


class QueueIterator:
    """Async iterator backed by an asyncio.Queue.

    Push text tokens via put(). Push None to signal end-of-stream.
    """

    def __init__(self) -> None:
        self._queue: asyncio.Queue[str | None] = asyncio.Queue()

    async def put(self, token: str | None) -> None:
        await self._queue.put(token)

    def __aiter__(self) -> "QueueIterator":
        return self

    async def __anext__(self) -> str:
        token = await self._queue.get()
        if token is None:
            raise StopAsyncIteration
        return token
