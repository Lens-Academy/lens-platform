"""Speech-to-text API endpoints."""

from fastapi import APIRouter, Depends, HTTPException, UploadFile

from core.speech import transcribe_audio
from web_api.auth import get_optional_user

router = APIRouter(prefix="/api", tags=["speech"])

MAX_FILE_SIZE = 25 * 1024 * 1024  # 25MB (Whisper API limit)


@router.post("/transcribe")
async def transcribe(audio: UploadFile, user: dict | None = Depends(get_optional_user)):
    """Transcribe audio to text using Whisper API.
    Accepts audio files in webm, mp3, wav, m4a, flac, ogg formats.
    Returns the transcribed text.
    """
    contents = await audio.read()

    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(413, "File too large (max 25MB)")

    if not contents:
        raise HTTPException(400, "Empty audio file")

    try:
        text = await transcribe_audio(contents, audio.filename or "audio.webm")
        return {"text": text}
    except ValueError as e:
        # Missing API key
        raise HTTPException(500, str(e))
    except Exception as e:
        # API errors
        raise HTTPException(502, f"Transcription failed: {e}")
