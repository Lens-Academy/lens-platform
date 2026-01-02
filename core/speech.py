"""Speech-to-text transcription using OpenAI Whisper API."""

import os

import httpx


async def transcribe_audio(audio_bytes: bytes, filename: str) -> str:
    """Transcribe audio using OpenAI Whisper API.

    Args:
        audio_bytes: Raw audio file bytes (webm, mp3, wav, m4a, etc.)
        filename: Original filename with extension

    Returns:
        Transcribed text string

    Raises:
        httpx.HTTPStatusError: If the API request fails
    """
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY environment variable is required")

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            "https://api.openai.com/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {api_key}"},
            files={"file": (filename, audio_bytes)},
            data={"model": "whisper-1"},
        )
        response.raise_for_status()
        return response.json()["text"]
