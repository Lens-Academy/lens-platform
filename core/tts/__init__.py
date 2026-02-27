"""Inworld TTS streaming module.

Public API:
    InworldTTSClient - Persistent WebSocket client for Inworld TTS
    TTSConfig - Configuration dataclass for synthesis requests
    is_tts_available() - Check if INWORLD_API_KEY is set
    get_api_key() - Read INWORLD_API_KEY from environment
    get_tts_client() - Lazy-init singleton client
    close_tts_client() - Close singleton client (for shutdown cleanup)
"""

from .config import TTSConfig, get_api_key, is_tts_available
from .inworld_ws import InworldTTSClient
from .sentence_buffer import QueueIterator, find_split

__all__ = [
    "InworldTTSClient",
    "QueueIterator",
    "TTSConfig",
    "find_split",
    "get_api_key",
    "is_tts_available",
    "get_tts_client",
    "close_tts_client",
]

# Module-level singleton
_client: InworldTTSClient | None = None


def get_tts_client() -> InworldTTSClient:
    """Get or create the singleton InworldTTSClient.

    Returns the existing client if one exists, or creates a new one.
    The client manages its own WebSocket connection lifecycle.
    """
    global _client
    if _client is None:
        _client = InworldTTSClient()
    return _client


async def close_tts_client() -> None:
    """Close the singleton TTS client if it exists.

    Call during application shutdown to clean up the WebSocket connection.
    """
    global _client
    if _client is not None:
        await _client.close()
        _client = None
