"""Speech-to-text transcription using ElevenLabs Scribe."""

import os
from io import BytesIO

from elevenlabs import AsyncElevenLabs


async def transcribe_audio(audio_bytes: bytes, filename: str) -> str:
    """Transcribe audio using ElevenLabs Scribe.

    Args:
        audio_bytes: Raw audio file bytes (webm, mp3, wav, m4a, ogg, etc.)
        filename: Original filename with extension

    Returns:
        Transcribed text string

    Raises:
        ValueError: If ELEVENLABS_API_KEY is not set
    """
    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        raise ValueError("ELEVENLABS_API_KEY environment variable is required")

    client = AsyncElevenLabs(api_key=api_key)
    response = await client.speech_to_text.convert(
        file=BytesIO(audio_bytes),
        model_id="scribe_v2",
    )
    return response.text
