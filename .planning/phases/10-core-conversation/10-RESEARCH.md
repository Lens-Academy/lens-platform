# Phase 10: Core Conversation - Research

**Researched:** 2026-02-25
**Domain:** Full-stack conversation UI (React + FastAPI + LLM streaming + TTS integration)
**Confidence:** HIGH

## Summary

Phase 10 builds the complete roleplay conversation experience. The foundation is solid: Phase 8 established content parsing (RoleplaySegment with `id`, `content`, `aiInstructions`, `openingMessage`), session isolation (`chat_sessions` with `roleplay_id` and partial unique indexes), and prompt assembly (`core/modules/roleplay.py`). Phase 9 built the TTS pipeline (Inworld WebSocket client, `useAudioPlayback` hook, `/ws/tts` endpoint).

The primary work is wiring these together: a new backend endpoint for roleplay chat (separate from `/api/chat/module`), a new frontend component (`RoleplaySection`) that reskins the existing chat UI with character identity and voice controls, and a new WebSocket endpoint or modified `/ws/tts` that accepts LLM token streams instead of full text.

The key technical challenge is coordinating three async streams: LLM text tokens -> frontend display AND LLM text tokens -> TTS audio -> browser audio playback, all while handling user input modes (text/voice), toggle states, and session lifecycle (completion, retry, persistence).

**Primary recommendation:** Split into 3 plans: (1) backend roleplay chat endpoint + session lifecycle, (2) frontend RoleplaySection component with text-only mode, (3) voice mode integration (three toggles, push-to-talk, TTS piping).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Briefing & opening flow
- Briefing card sits above the conversation area, always visible -- shows the `content::` field (scenario context for the student)
- If `opening-message::` is set, AI character sends it automatically as the first message when the session is created
- If no `opening-message::`, conversation starts empty and the student speaks first
- No "start" gate -- conversation area is immediately interactive, briefing card is informational context

#### Conversation UI identity
- Character name displayed on AI messages instead of "AI Tutor"
- Different accent color on AI message bubbles to distinguish from tutor chat
- Character avatar/icon area (generic roleplay icon or initials)
- Same chat component under the hood (streaming, message list, input) -- reskinned with roleplay-specific styling, not a separate implementation
- Student messages look the same as in tutor chat

#### Voice/text -- three independent toggles
Three settings, all intercompatible:
1. **Text display** (on/off) -- show/hide message bubbles for both user and AI messages
2. **AI TTS** (on/off) -- speak AI responses via TTS or not
3. **User input mode** (text input / voice input) -- text input shows the text box with optional editable STT; voice input hides text box and shows push-to-talk mic button

- All combinations are valid -- these are independent settings
- Exposed as inline toggle icons in the chat header/toolbar area, always visible
- Toggle states persist via localStorage (remembered across page refresh per session)
- Default: text display ON, TTS OFF, text input mode

#### Push-to-talk mic behavior
- Click mic button to start recording (toggle, NOT hold-to-talk)
- Click mic button again to send -- transcribes and sends immediately, no review step
- Cancel button (X) appears while recording to discard without sending
- No voice activity detection / auto-send

#### Text-display-off state
- When text display is OFF, conversation area shows minimal indicator: who's speaking and a waveform/pulse animation
- Briefing card remains visible regardless of text display setting

#### Text mode voice input
- In text mode, the existing speech-to-text -> text box -> edit -> send workflow from tutor chat is still available

#### Completion & retry
- Manual "Complete" button visible in the conversation UI -- the ONLY trigger for ending
- After completion: input disabled, conversation locked, done state shown
- "Try again" archives the current session (sets `archived_at`) and creates a fresh one
- No confirmation dialog for completion

### Claude's Discretion
- Character name extraction from `ai-instructions::` -- parsing strategy or convention
- Exact accent colors and visual treatment for roleplay vs tutor chat distinction
- Waveform/pulse animation design for text-off state
- Completion button placement (header bar, footer, inline)
- Mic recording visual feedback during push-to-talk
- Loading/connecting states for TTS and STT services

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

## Standard Stack

### Core (Already in project -- no new dependencies)

| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| React | 19 | UI framework | Already installed |
| LiteLLM | Current | LLM provider abstraction (stream_chat) | Already installed |
| SQLAlchemy | Current | DB session management (chat_sessions) | Already installed |
| FastAPI | Current | API endpoints + WebSocket | Already installed |
| Tailwind CSS | v4 | Styling | Already installed |
| Inworld TTS (via WebSocket) | Current | Text-to-speech | Phase 9 complete |
| Web Audio API | Browser native | Audio playback | Phase 9 hook exists |
| MediaRecorder API | Browser native | Voice recording | Existing useVoiceRecording hook |
| Whisper API (OpenAI) | Current | Speech-to-text | Existing core/speech.py |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | Current | Icons (mic, text, speaker toggles) | Toggle bar icons |
| localStorage | Browser native | Toggle state persistence | Voice/text toggle memory |

### No New Dependencies Needed

Zero new npm or pip packages. All building blocks exist from Phases 8-9 plus the existing chat system. This is an integration and UI phase.

## Architecture Patterns

### Recommended File Structure

```
core/modules/
  roleplay.py              # EXISTING: build_roleplay_prompt() - extend with send_roleplay_message()
  chat_sessions.py         # EXISTING: extend with complete_chat_session()

web_api/routes/
  roleplay.py              # NEW: POST /api/chat/roleplay, GET /api/chat/roleplay/{roleplay_id}/history
                           #       POST /api/chat/roleplay/{session_id}/complete
                           #       POST /api/chat/roleplay/{session_id}/retry
  tts_stream.py            # EXISTING: modify /ws/tts to accept LLM token stream (not just full text)

web_frontend/src/
  components/module/
    RoleplaySection.tsx     # NEW: roleplay conversation UI (reskinned NarrativeChatSection)
    RoleplayBriefing.tsx    # NEW: scenario briefing card
    RoleplayToolbar.tsx     # NEW: toggle bar (text display, TTS, input mode)
    VoiceInputBar.tsx       # NEW: push-to-talk mic button with cancel
    SpeakingIndicator.tsx   # NEW: who's-speaking + waveform for text-off mode
  hooks/
    useRoleplaySession.ts   # NEW: session lifecycle (load, send, complete, retry)
    useRoleplayToggles.ts   # NEW: three toggle states with localStorage persistence
    useRoleplayTTS.ts       # NEW: coordinate LLM streaming + TTS WebSocket
  api/
    roleplay.ts             # NEW: API client for roleplay endpoints
```

### Pattern 1: Separate Roleplay Endpoint (Not Reusing /api/chat/module)

**What:** Create a dedicated `/api/chat/roleplay` endpoint rather than adding roleplay logic to the existing `/api/chat/module` endpoint.

**Why:** The existing chat module endpoint (`web_api/routes/module.py`) is tightly coupled to the tutor chat flow: it loads a flattened module by slug, uses section/segment indexes, gathers section context, builds tutor system prompts, and includes the `transition_to_next` tool. Roleplay needs none of this. Roleplay works with `roleplay_id` (UUID), uses `build_roleplay_prompt()`, has no stage transitions, and has different session lifecycle (completion, retry). Adding roleplay branching into the existing endpoint would make it complex and fragile.

**Request body:**
```python
class RoleplayChatRequest(BaseModel):
    module_slug: str       # For module_id lookup
    roleplay_id: str       # UUID from content field
    message: str           # User's message (empty for opening message)
```

**Session creation with opening message:** When `get_or_create_chat_session` returns a new session (empty messages) and the roleplay segment has `opening_message`, the endpoint should:
1. Save the opening message as an assistant message in the session
2. Return it as the first event in the SSE stream (not via LLM)
3. This way the opening message is persisted and appears on page refresh

### Pattern 2: LLM Token Stream -> TTS Integration

**What:** Pipe LLM streaming text tokens directly into the TTS `synthesize()` async iterator.

**Why:** Phase 9's `/ws/tts` endpoint uses `_single_chunk_iter(text)` which yields the full text as one chunk. Phase 10 replaces this with the actual LLM token stream for real-time TTS. The Inworld TTS client already accepts `AsyncIterator[str]` for text chunks.

**Implementation approach:** The roleplay chat endpoint needs to support two response modes:
1. **Text-only mode** (TTS off): Standard SSE stream, identical to existing chat endpoint pattern
2. **TTS mode** (TTS on): The same SSE stream for text, PLUS the client opens a WebSocket to `/ws/tts` that receives audio. The backend needs to somehow pipe the LLM tokens into the TTS client.

**Recommended architecture:**
- The roleplay SSE endpoint streams text tokens to the frontend as usual
- Separately, the frontend connects to `/ws/tts` and re-sends the accumulated text for TTS synthesis
- BUT this means double-sending text and TTS only starts after all text arrives

**Better architecture -- Dual-output streaming:**
- Create a new WebSocket endpoint `/ws/roleplay-tts` that combines both: it receives the user message, runs LLM streaming, sends text tokens as JSON frames, AND simultaneously pipes tokens to TTS which produces binary audio frames interleaved on the same WebSocket
- This eliminates the coordination problem and achieves true streaming TTS

**Simplest viable architecture (recommended):**
- Keep the SSE endpoint for text streaming (POST `/api/chat/roleplay`)
- When TTS is enabled, the frontend accumulates text chunks from SSE into a buffer
- After the "done" event, the frontend opens `/ws/tts` with the full response text
- This is "buffered TTS" not "streaming TTS" -- latency is LLM response time + TTS latency
- For Phase 10 this is acceptable; Phase 10.x could optimize to streaming TTS later

**Even better -- modified /ws/tts with context awareness:**
- The existing `/ws/tts` accepts `{"text": "..."}` and streams audio back
- Modify it to also accept `{"session_id": N}` which triggers: run LLM for latest message, stream text tokens to TTS, stream audio back
- The roleplay SSE endpoint handles text display, the TTS WebSocket handles audio independently
- This keeps the two concerns (text display, audio) on separate transports

**RECOMMENDED: Buffered TTS (simplest, works, shippable):**
- SSE for text streaming (as in tutor chat)
- After LLM response completes, frontend sends full text to `/ws/tts` for audio
- Latency = LLM streaming + TTS synthesis, but TTS is fast for typical roleplay responses
- Upgrade to streaming TTS in a future phase if latency is unacceptable

### Pattern 3: Reskinned Chat Component

**What:** RoleplaySection wraps the same chat logic (message list, input, streaming) but changes the visual layer.

**Differences from NarrativeChatSection:**
- AI message label: character name instead of "Tutor"
- AI message bubble: accent color (e.g., indigo/purple tint vs default gray)
- Avatar area: character initials or generic icon
- Input area: either text box (with optional STT mic) OR push-to-talk button
- Toolbar: three toggle icons above the chat
- Briefing card: above the conversation, always visible
- Completion button: visible in footer/header
- No expand/collapse behavior (roleplay is always full-view)
- No stage transition tool

**Implementation:** Don't fork NarrativeChatSection. Instead, create RoleplaySection as a new component that uses the same building blocks (ChatMarkdown, message rendering, textarea, etc.) but with its own layout and styling. The chat state management (messages, pendingMessage, streamingContent, isLoading) follows the same pattern as Module.tsx's shared chat state, but is scoped to the roleplay session.

### Pattern 4: Session Lifecycle (Complete + Retry)

**What:** Backend endpoints for completing and retrying roleplay sessions.

**Complete:** `POST /api/chat/roleplay/{session_id}/complete`
- Sets a `completed_at` timestamp on the session
- Returns success
- Frontend disables input, shows done state

**Retry:** `POST /api/chat/roleplay/{session_id}/retry`
- Archives the current session (`archived_at = now()`)
- Creates a new empty session for the same (user, module, roleplay_id)
- If opening_message exists, inserts it as the first message
- Returns the new session

**Table change needed:** Add `completed_at` column to `chat_sessions` table. This is distinct from `archived_at`:
- `completed_at` = student finished the roleplay (conversation visible, input disabled)
- `archived_at` = session replaced by retry (hidden from active view)

### Pattern 5: Character Name Extraction

**Claude's Discretion item.** The `ai-instructions::` field contains free-form character instructions. A character name needs to be extracted for display.

**Recommended approach:** Convention-based extraction with fallback.
1. Check if `ai-instructions::` starts with a line like "You are [Name]" or "Character: [Name]"
2. Regex: `^(?:You are|Character:?\s*)\s*([A-Z][a-zA-Z\s]+?)[\.,\n]`
3. Fallback: "Character" (generic)
4. Extraction happens on the backend when creating/returning the session, stored/cached per session

**Simpler alternative:** Add an optional `name::` field to the roleplay segment schema. But this requires a content processor change (Phase 8 territory). For Phase 10, use regex extraction from `ai-instructions`.

**Simplest alternative (recommended):** Extract on the frontend from `aiInstructions` prop. No backend change needed. The character name is a display-only concern.

### Anti-Patterns to Avoid

- **Forking NarrativeChatSection**: Don't copy-paste. Create a new component with shared primitives (ChatMarkdown, message styling utilities).
- **Reusing /api/chat/module for roleplay**: The tutor chat endpoint has deeply embedded assumptions about module slugs, section/segment indexes, and stage transitions. Adding roleplay would create an unmanageable conditional mess.
- **Streaming TTS in Phase 10**: The dual-WebSocket architecture (LLM tokens -> TTS -> browser audio in real time) is complex. Ship buffered TTS first (send full text after LLM done), optimize later.
- **Adding roleplay state to Module.tsx's shared chat state**: Module.tsx has `messages`, `pendingMessage`, `streamingContent`, `isLoading` shared across all chat segments. Roleplay needs its own isolated state per roleplay segment. Don't add more shared state to the already-large Module.tsx.
- **Using segment_snapshot for opening message**: The opening message should be stored as a regular assistant message in the chat session, not in snapshot metadata. This way it shows up in history on refresh naturally.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Audio playback | Custom AudioContext management | `useAudioPlayback` hook (Phase 9) | Gapless scheduling, autoplay policy, memory cleanup already handled |
| Voice recording | Custom MediaRecorder wrapper | `useVoiceRecording` hook (existing) | Volume metering, timer, cleanup, error handling all done |
| Transcription | Custom Whisper API call | `transcribeAudio()` from `@/api/modules` | Error handling, timeout, format handling |
| LLM streaming | Custom API/SDK integration | `stream_chat()` from `core/modules/llm.py` | Provider abstraction, event normalization |
| System prompt | Custom prompt building | `build_roleplay_prompt()` from `core/modules/roleplay.py` | Character framing, scenario context |
| Session management | Custom session table/queries | `chat_sessions` + `get_or_create_chat_session()` | Isolation, race condition handling, archiving |
| Markdown rendering | Custom renderer | `ChatMarkdown` component (existing) | Safe rendering with formatting |
| SSE parsing | Custom stream reader | Same pattern as `sendMessage()` in `api/modules.ts` | Proven stream parsing, error handling |

**Key insight:** Phase 10 is an integration phase. Every building block exists. The work is wiring them together and building the UI layer.

## Common Pitfalls

### Pitfall 1: Opening Message Race Condition
**What goes wrong:** Multiple requests hit `get_or_create_chat_session` simultaneously. Both see empty session, both try to insert the opening message.
**Why it happens:** Page load + SSE stream start could race.
**How to avoid:** Insert opening message atomically during session creation. Use the existing SELECT-then-INSERT pattern in `get_or_create_chat_session`, adding the opening message to the initial `messages` JSON if provided.
**Warning signs:** Duplicate opening messages in conversation history.

### Pitfall 2: Shared Chat State Pollution
**What goes wrong:** Roleplay messages leak into tutor chat or vice versa because Module.tsx uses a single `messages` state for all chat segments.
**Why it happens:** Module.tsx has shared state (`messages`, `pendingMessage`, etc.) used by all NarrativeChatSection instances. Adding roleplay to this shared state would mix conversations.
**How to avoid:** RoleplaySection manages its own state entirely independently. It has its own `messages`, `pendingMessage`, `streamingContent`, `isLoading` -- not connected to Module.tsx's shared state.
**Warning signs:** Messages from tutor chat appearing in roleplay, or roleplay messages appearing in another chat segment.

### Pitfall 3: AudioContext Autoplay Policy
**What goes wrong:** TTS audio doesn't play because the AudioContext is suspended.
**Why it happens:** Browsers require a user gesture to create/resume an AudioContext. If TTS is enabled and a response arrives without a prior user gesture, audio is silent.
**How to avoid:** Call `audioPlayback.resume()` on the user gesture that triggers the message send (button click or mic button click). The useAudioPlayback hook already provides `resume()`.
**Warning signs:** `contextState` stuck at "suspended", chunks received but no sound.

### Pitfall 4: Toggle State Desync on Page Refresh
**What goes wrong:** User sets toggles, refreshes page, toggles reset to defaults but the conversation was mid-stream with voice mode.
**Why it happens:** Toggle state not persisted.
**How to avoid:** Store toggle state in localStorage keyed by roleplay session ID or roleplay_id. Read on mount.
**Warning signs:** User has to re-enable voice mode every page refresh.

### Pitfall 5: TTS Playing After Completion/Retry
**What goes wrong:** User clicks "Complete" or "Try Again" while TTS audio is still playing from a previous response. Audio continues over the done state.
**Why it happens:** TTS playback is asynchronous and doesn't know about session state changes.
**How to avoid:** Call `audioPlayback.stop()` when completing or retrying. Close any active TTS WebSocket connection.
**Warning signs:** Audio playing over the "done" banner or over a fresh session.

### Pitfall 6: Claim Dedup for Roleplay Sessions
**What goes wrong:** Anonymous user starts a roleplay, logs in, `claim_chat_sessions` fails or duplicates because it only deduplicates by `module_id`, not `(module_id, roleplay_id)`.
**Why it happens:** The Phase 10 TODO in `chat_sessions.py` line 162 notes this gap.
**How to avoid:** Update `claim_chat_sessions` to check `(module_id, roleplay_id)` pairs, not just `module_id`. Skip claiming anonymous sessions where the user already has an active session for the same module_id + roleplay_id combination.
**Warning signs:** IntegrityError on unique partial index during login claim.

### Pitfall 7: Push-to-Talk Immediate Send Without Review
**What goes wrong:** User in voice input mode clicks mic, speaks, clicks mic again. Transcription happens but the result is sent immediately without the user seeing it. Transcription errors go directly to the AI.
**Why it happens:** This is by design (CONTEXT.md says "transcribes and sends immediately, no review step") but could surprise users.
**How to avoid:** This is intentional per the locked decision. Ensure the cancel button (X) is prominent during recording. Consider showing a brief flash of the transcribed text as it's sent so the user has visual feedback.
**Warning signs:** Users complaining about garbled messages -- needs clear cancel affordance.

## Code Examples

### Example 1: Roleplay Chat Endpoint (Backend)

```python
# web_api/routes/roleplay.py
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from uuid import UUID

from core.database import get_connection
from core.modules.chat_sessions import get_or_create_chat_session, add_chat_message
from core.modules.roleplay import build_roleplay_prompt
from core.modules.llm import stream_chat
from core.modules.loader import load_flattened_module
from web_api.auth import get_user_or_anonymous

router = APIRouter(prefix="/api/chat", tags=["roleplay"])

class RoleplayChatRequest(BaseModel):
    module_slug: str
    roleplay_id: str       # UUID string from content
    message: str
    # Client sends the segment data so backend doesn't need to re-parse
    ai_instructions: str
    scenario_content: str | None = None
    opening_message: str | None = None

async def roleplay_event_generator(
    user_id, anonymous_token, module_id, request
):
    """SSE generator for roleplay chat."""
    async with get_connection() as conn:
        session = await get_or_create_chat_session(
            conn,
            user_id=user_id,
            anonymous_token=anonymous_token,
            module_id=module_id,
            roleplay_id=UUID(request.roleplay_id),
        )
        session_id = session["session_id"]
        existing_messages = session.get("messages", [])

        # Handle opening message for new sessions
        is_new = len(existing_messages) == 0
        if is_new and request.opening_message:
            await add_chat_message(
                conn, session_id=session_id,
                role="assistant", content=request.opening_message,
            )
            existing_messages = [{"role": "assistant", "content": request.opening_message}]
            # Yield the opening message to the client
            yield f'data: {{"type":"text","content":{json.dumps(request.opening_message)}}}\n\n'
            yield f'data: {{"type":"done"}}\n\n'
            return

        # Save user message
        if request.message:
            await add_chat_message(
                conn, session_id=session_id,
                role="user", content=request.message,
            )

    # Build system prompt
    system = build_roleplay_prompt(
        ai_instructions=request.ai_instructions,
        scenario_content=request.scenario_content,
    )

    # Build message history for LLM
    llm_messages = [
        {"role": m["role"], "content": m["content"]}
        for m in existing_messages
        if m["role"] in ("user", "assistant")
    ]
    if request.message:
        llm_messages.append({"role": "user", "content": request.message})

    # Stream response (no tools -- roleplay has no stage transitions)
    assistant_content = ""
    async for event in stream_chat(
        messages=llm_messages,
        system=system,
        tools=None,  # No transition tool for roleplay
    ):
        if event.get("type") == "text":
            assistant_content += event.get("content", "")
        yield f"data: {json.dumps(event)}\n\n"

    # Save assistant response
    if assistant_content:
        async with get_connection() as conn:
            await add_chat_message(
                conn, session_id=session_id,
                role="assistant", content=assistant_content,
            )
```

### Example 2: RoleplaySection Component (Frontend)

```tsx
// Simplified structure showing key differences from NarrativeChatSection
function RoleplaySection({ segment, moduleSlug }: RoleplaySectionProps) {
  const { messages, isLoading, streamingContent, pendingMessage,
          sendMessage, sessionId, isCompleted } = useRoleplaySession(
    moduleSlug, segment.id, segment.aiInstructions,
    segment.content, segment.openingMessage
  );
  const { textDisplay, ttsEnabled, inputMode, toggleTextDisplay,
          toggleTTS, toggleInputMode } = useRoleplayToggles(segment.id);

  const characterName = extractCharacterName(segment.aiInstructions);

  return (
    <div>
      {/* Briefing card -- always visible */}
      <RoleplayBriefing content={segment.content} />

      {/* Toggle toolbar */}
      <RoleplayToolbar
        textDisplay={textDisplay} ttsEnabled={ttsEnabled}
        inputMode={inputMode}
        onToggleText={toggleTextDisplay}
        onToggleTTS={toggleTTS}
        onToggleInput={toggleInputMode}
      />

      {/* Message area */}
      <div className="space-y-4">
        {textDisplay ? (
          messages.map((msg, i) => (
            msg.role === "assistant" ? (
              <div key={i} className="text-gray-800">
                <div className="text-sm text-indigo-600 mb-1">{characterName}</div>
                <div className="bg-indigo-50 rounded-2xl p-3">
                  <ChatMarkdown>{msg.content}</ChatMarkdown>
                </div>
              </div>
            ) : (
              <div key={i} className="ml-auto max-w-[80%] bg-gray-100 p-3 rounded-2xl">
                {msg.content}
              </div>
            )
          ))
        ) : (
          <SpeakingIndicator speaker={isLoading ? characterName : null} />
        )}
      </div>

      {/* Input area (conditional on inputMode and completion state) */}
      {!isCompleted ? (
        inputMode === "text" ? (
          <TextInput onSend={sendMessage} isLoading={isLoading} />
        ) : (
          <VoiceInputBar onSend={sendMessage} isLoading={isLoading} />
        )
      ) : (
        <div className="text-center py-4 text-gray-500">
          Conversation complete
          <button onClick={handleRetry}>Try again</button>
        </div>
      )}

      {/* Complete button (always visible when not completed) */}
      {!isCompleted && <button onClick={handleComplete}>Complete</button>}
    </div>
  );
}
```

### Example 3: Toggle State Persistence

```typescript
// useRoleplayToggles.ts
const STORAGE_KEY_PREFIX = "roleplay-toggles-";

export function useRoleplayToggles(roleplayId: string) {
  const storageKey = `${STORAGE_KEY_PREFIX}${roleplayId}`;

  const [state, setState] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) return JSON.parse(stored);
    } catch {}
    // Defaults: text ON, TTS OFF, text input
    return { textDisplay: true, ttsEnabled: false, inputMode: "text" as const };
  });

  // Persist on change
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(state));
  }, [state, storageKey]);

  return {
    ...state,
    toggleTextDisplay: () => setState(s => ({ ...s, textDisplay: !s.textDisplay })),
    toggleTTS: () => setState(s => ({ ...s, ttsEnabled: !s.ttsEnabled })),
    toggleInputMode: () => setState(s => ({
      ...s, inputMode: s.inputMode === "text" ? "voice" : "text"
    })),
  };
}
```

### Example 4: Buffered TTS After LLM Response

```typescript
// useRoleplayTTS.ts - Simplified
export function useRoleplayTTS(ttsEnabled: boolean) {
  const audioPlayback = useAudioPlayback();
  const wsRef = useRef<WebSocket | null>(null);

  const speakText = useCallback(async (text: string) => {
    if (!ttsEnabled || !text.trim()) return;

    await audioPlayback.resume();

    const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${wsProtocol}//${location.host}/ws/tts`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ text, voice: "Ashley" }));
    };
    ws.onmessage = async (event) => {
      if (event.data instanceof Blob) {
        const bytes = await event.data.arrayBuffer();
        await audioPlayback.playChunk(bytes);
      }
    };
  }, [ttsEnabled, audioPlayback]);

  const stop = useCallback(() => {
    audioPlayback.stop();
    wsRef.current?.close();
  }, [audioPlayback]);

  return { speakText, stop, isPlaying: audioPlayback.isPlaying };
}
```

### Example 5: Complete/Retry Session Endpoints

```python
# Completion endpoint
@router.post("/roleplay/{session_id}/complete")
async def complete_roleplay(
    session_id: int,
    auth = Depends(get_user_or_anonymous),
):
    async with get_connection() as conn:
        session = await get_chat_session(conn, session_id=session_id)
        if not session:
            raise HTTPException(404, "Session not found")
        # Verify ownership
        # Set completed_at
        await complete_chat_session(conn, session_id=session_id)
    return {"status": "completed"}

# Retry endpoint
@router.post("/roleplay/{session_id}/retry")
async def retry_roleplay(
    session_id: int,
    request: RetryRequest,  # Contains opening_message for re-insert
    auth = Depends(get_user_or_anonymous),
):
    user_id, anonymous_token = auth
    async with get_connection() as conn:
        session = await get_chat_session(conn, session_id=session_id)
        if not session:
            raise HTTPException(404, "Session not found")
        # Archive old session
        await archive_chat_session(conn, session_id=session_id)
        # Create new session (optionally with opening message)
        new_session = await get_or_create_chat_session(
            conn,
            user_id=user_id,
            anonymous_token=anonymous_token,
            module_id=session["module_id"],
            roleplay_id=session["roleplay_id"],
        )
        # Insert opening message if provided
        if request.opening_message:
            await add_chat_message(
                conn, session_id=new_session["session_id"],
                role="assistant", content=request.opening_message,
            )
    return {"session_id": new_session["session_id"]}
```

### Example 6: Character Name Extraction

```typescript
// Extract character name from ai-instructions text
export function extractCharacterName(aiInstructions: string): string {
  // Match "You are [Name]" at start of instructions
  const youAreMatch = aiInstructions.match(
    /^You are\s+([A-Z][a-zA-Z\s]{1,30}?)[\.,\n]/
  );
  if (youAreMatch) return youAreMatch[1].trim();

  // Match "Character: [Name]" or "Name: [Name]"
  const labelMatch = aiInstructions.match(
    /^(?:Character|Name):?\s+([A-Z][a-zA-Z\s]{1,30}?)[\.,\n]/m
  );
  if (labelMatch) return labelMatch[1].trim();

  return "Character"; // Fallback
}
```

## Discretion Recommendations

### Character Name Extraction
**Recommendation:** Frontend-only regex extraction from `aiInstructions` with "Character" fallback. Pattern: `/^You are\s+([A-Z][a-zA-Z\s]{1,30}?)[\.,\n]/`. Simple, no backend change needed, works for the common "You are [Name]" pattern in character instructions.

### Accent Colors for Roleplay Messages
**Recommendation:** Indigo palette for roleplay AI messages. Use `bg-indigo-50` for message bubble background, `text-indigo-600` for the character name label. This is distinct from the tutor chat's plain gray (`text-gray-800`, no colored bubble) while being subtle enough to not clash. Student messages stay `bg-gray-100` (same as tutor chat).

### Waveform/Pulse Animation for Text-Off State
**Recommendation:** Three simple pulsing dots (like a typing indicator) with the character name. When AI is responding: dots animate. When student's turn: static mic icon. CSS-only animation, no JavaScript needed. Reuse the volume bars concept from the recording indicator but in a simplified form.

### Completion Button Placement
**Recommendation:** Fixed position in the input area footer, right-aligned next to the send button. When conversation is active, show as a secondary/outline button "Complete". This keeps it always visible without taking prime real estate. After completion, the footer transforms into the done state with "Try again" option.

### Mic Recording Visual Feedback
**Recommendation:** Reuse the existing `useVoiceRecording` volume bars animation in a larger, centered format for the voice input bar. Show the recording timer below. The cancel (X) button appears as a red circle to the left of the mic button.

### Loading/Connecting States for TTS and STT
**Recommendation:** For TTS: no explicit loading state -- audio simply starts playing when chunks arrive. For STT: the existing "Transcribing..." state in `useVoiceRecording` is sufficient. In voice input mode, show a brief "Sending..." text while transcription happens before the message is sent.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Full text -> TTS (Phase 9) | Still full text -> TTS (Phase 10 v1) | Phase 10 | Buffered TTS is simpler and shippable; streaming TTS is a future optimization |
| Shared chat state in Module.tsx | Isolated state per roleplay | Phase 10 | Each RoleplaySection manages its own messages, prevents cross-contamination |
| Single /api/chat/module endpoint | Separate /api/chat/roleplay | Phase 10 | Clean separation of tutor chat and roleplay concerns |

## Open Questions

1. **Concurrent TTS synthesis**
   - What we know: Phase 9's InworldTTSClient uses `asyncio.Lock` for single-synthesis-at-a-time. Multiple users' roleplay sessions could request TTS simultaneously.
   - What's unclear: Whether single-synthesis is a bottleneck in practice. Inworld supports context IDs for multiplexing, but the current lock prevents it.
   - Recommendation: Ship with the lock for Phase 10. If multiple concurrent users are a problem, add a per-context dispatch layer in Phase 10.x. The lock serializes, not blocks -- responses queue up.

2. **completed_at column migration**
   - What we know: Need a `completed_at` timestamp on `chat_sessions` to distinguish completed from active sessions. Currently only `archived_at` exists.
   - What's unclear: Whether this needs a separate Alembic migration or can piggyback.
   - Recommendation: Create a small Alembic migration adding `completed_at TIMESTAMPTZ NULL` to `chat_sessions`. Simple ALTER TABLE.

3. **Voice selection for TTS**
   - What we know: Inworld has multiple voices (Ashley, etc.). The TTS test page lets users pick one. Content authors might want to specify a voice per character.
   - What's unclear: Whether to use a hardcoded voice, add a `voice::` field to roleplay content, or let users choose.
   - Recommendation: Use default "Ashley" voice for Phase 10. Voice selection is a Phase 11 or later enhancement if content authors request it.

4. **Maximum conversation length**
   - What we know: LLM context windows have limits. Long roleplay conversations could hit token limits.
   - What's unclear: Practical limits for roleplay (most should be 5-20 exchanges).
   - Recommendation: No explicit limit in Phase 10. Monitor in production. If needed, add a sliding window or summary in a future phase.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `core/modules/roleplay.py`, `core/modules/chat_sessions.py`, `core/tts/`, `web_api/routes/module.py`, `web_api/routes/tts_stream.py`
- Codebase analysis: `web_frontend/src/components/module/NarrativeChatSection.tsx`, `web_frontend/src/hooks/useVoiceRecording.ts`, `web_frontend/src/hooks/useAudioPlayback.ts`
- Codebase analysis: `web_frontend/src/types/module.ts` (RoleplaySegment type definition)
- Phase 8 verification report (`.planning/phases/08-foundation/08-VERIFICATION.md`)
- Phase 9 summaries (`.planning/phases/09-tts-pipeline/09-01-SUMMARY.md`)

### Secondary (MEDIUM confidence)
- Web Audio API autoplay policy -- browser documentation on AudioContext requirements
- Inworld TTS bidirectional WebSocket protocol -- based on Phase 9 implementation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all components exist, no new dependencies, verified in codebase
- Architecture: HIGH -- patterns directly derived from existing code patterns in the codebase
- Pitfalls: HIGH -- identified from actual code review (race conditions, state isolation, autoplay policy)
- Discretion recommendations: MEDIUM -- aesthetic choices (colors, placement) need user validation

**Research date:** 2026-02-25
**Valid until:** 2026-03-25 (stable -- no external dependency changes expected)
