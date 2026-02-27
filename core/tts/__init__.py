"""Inworld TTS streaming module.

Public API:
    synthesize() - Stateless TTS synthesis (fresh WebSocket per call)
    TTSConfig - Configuration dataclass for synthesis requests
    is_tts_available() - Check if INWORLD_API_KEY is set
    get_api_key() - Read INWORLD_API_KEY from environment
"""

from .config import TTSConfig, get_api_key, is_tts_available
from .inworld_ws import synthesize
from .sentence_buffer import QueueIterator, find_split

__all__ = [
    "QueueIterator",
    "TTSConfig",
    "find_split",
    "get_api_key",
    "is_tts_available",
    "synthesize",
]
