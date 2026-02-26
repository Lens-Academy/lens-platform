"""TTS configuration for Inworld WebSocket integration."""

import os
from dataclasses import dataclass

# Inworld TTS WebSocket endpoint for bidirectional streaming
INWORLD_WS_URL = "wss://api.inworld.ai/tts/v1/voice:streamBidirectional"


@dataclass
class TTSConfig:
    """Configuration for a TTS synthesis request.

    Defaults match Inworld TTS 1.5 Mini with MP3 encoding,
    suitable for browser streaming via Web Audio API.
    """

    voice_id: str = "Ashley"
    model_id: str = "inworld-tts-1.5-mini"
    audio_encoding: str = "MP3"
    sample_rate_hz: int = 48000
    bit_rate: int = 128000
    buffer_char_threshold: int = 250
    max_buffer_delay_ms: int = 3000
    auto_mode: bool = False
    speaking_rate: float | None = None  # 0.5–1.5, None = Inworld default (1.0)


def get_api_key() -> str | None:
    """Read INWORLD_API_KEY from environment.

    Returns None if not set (voice mode should gracefully disable,
    not crash).
    """
    return os.environ.get("INWORLD_API_KEY")


def is_tts_available() -> bool:
    """Return True if INWORLD_API_KEY is set and TTS can be used."""
    return bool(os.environ.get("INWORLD_API_KEY"))
