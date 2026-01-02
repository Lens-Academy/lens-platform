# Speech-to-Text Design

Add voice input to chat, allowing users to click a microphone button, speak, and have their speech transcribed into the message input field.

## Decisions

- **STT Service:** OpenAI Whisper API (via direct HTTP, no SDK)
- **Recording UX:** Toggle (click to start, click to stop)
- **After transcription:** Populate text field for user review before sending
- **Error display:** Inline feedback near mic button (no toast system)
- **Audio feedback:** Pulsing circle that responds to volume level

## Architecture

```
User clicks mic → Browser records audio (MediaRecorder) →
Click stop → Audio POST to backend →
Backend calls Whisper API → Returns text →
Text populates input field → User reviews/sends
```

## Frontend Changes

### File: `web_frontend/src/components/unified-lesson/ChatPanel.tsx`

**Add mic button next to Send button:**
```
[Text input field         ] [🎤] [Send]
```

**When recording:**
```
[🔴 Recording... 0:05     ] [⏹] [Send disabled]
```

**Button states:**

| State | Icon | Visual |
|-------|------|--------|
| Idle | Microphone | Default gray |
| Recording | Stop square | Red, pulsing indicator, timer |
| Transcribing | Spinner | Disabled |
| Error | Microphone | Inline error message, returns to idle |

**Behaviors:**
- Use `MediaRecorder` API to capture audio as WebM
- Request microphone permission on first click
- Max recording: 60 seconds (auto-stop)
- Min recording: 0.5 seconds (ignore accidental taps)
- Mic disabled while AI is streaming
- Transcription appends to existing input text

**Audio level visualization:**

While recording, show a pulsing circle around the stop button that responds to microphone volume:
- Use `AudioContext` + `AnalyserNode` to sample volume ~30fps
- Circle scales from 1.0x (silence) to ~1.3x (loud) based on volume
- Provides immediate feedback that mic is picking up audio
- If circle never pulses → user knows something is wrong (muted mic, wrong device)

```typescript
// Simplified approach:
const audioContext = new AudioContext();
const analyser = audioContext.createAnalyser();
const source = audioContext.createMediaStreamSource(stream);
source.connect(analyser);

// In animation loop:
const dataArray = new Uint8Array(analyser.frequencyBinCount);
analyser.getByteFrequencyData(dataArray);
const volume = average(dataArray) / 255; // 0-1
const scale = 1 + volume * 0.3; // 1.0 to 1.3
```

### File: `web_frontend/src/api/lessons.ts`

**Add transcription API call:**
```typescript
export async function transcribeAudio(audioBlob: Blob): Promise<string>
```

## Backend Changes

### File: `core/speech.py` (new)

```python
import httpx
import os

async def transcribe_audio(audio_bytes: bytes, filename: str) -> str:
    """Transcribe audio using OpenAI Whisper API."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            "https://api.openai.com/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"},
            files={"file": (filename, audio_bytes)},
            data={"model": "whisper-1"},
        )
        response.raise_for_status()
        return response.json()["text"]
```

### File: `web_api/routes/speech.py` (new)

```python
from fastapi import APIRouter, UploadFile, HTTPException
from core.speech import transcribe_audio

router = APIRouter(prefix="/api", tags=["speech"])

@router.post("/transcribe")
async def transcribe(audio: UploadFile):
    """Transcribe audio to text using Whisper API."""
    contents = await audio.read()

    if len(contents) > 25 * 1024 * 1024:  # 25MB limit
        raise HTTPException(413, "File too large")

    text = await transcribe_audio(contents, audio.filename)
    return {"text": text}
```

### File: `main.py`

Register new router:
```python
from web_api.routes.speech import router as speech_router
app.include_router(speech_router)
```

## Error Handling

| Error | Frontend | Backend |
|-------|----------|---------|
| Mic permission denied | Inline "Microphone access required" | N/A |
| No speech detected | Inline "No speech detected" | Return `{"text": ""}` |
| Network timeout | Inline "Transcription failed" | 30s timeout |
| API rate limit | Inline "Try again shortly" | Return 429 |
| Invalid audio | N/A | Return 400 |
| File too large | Prevent upload | Return 413 |

## Environment

Requires `OPENAI_API_KEY` environment variable.

No new Python dependencies (uses existing `httpx`).

## Not Included

- No audio storage/persistence
- No new database tables
- No toast notification system
- No fallback to Web Speech API
