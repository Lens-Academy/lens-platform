# Technology Stack: Roleplay Conversation Segment Type

**Project:** Roleplay Conversation Integration
**Researched:** 2026-02-24

## Verdict: Zero New Dependencies Required

The existing stack handles every capability needed for multi-turn roleplay conversations with voice input, configurable end-of-conversation triggers, and optional assessment scoring. This milestone is a feature build, not an infrastructure build.

## Existing Stack (Reused Unchanged)

| Capability | Existing Solution | Location | Confidence |
|------------|-------------------|----------|------------|
| LLM streaming | `stream_chat()` via LiteLLM | `core/modules/llm.py` | HIGH |
| LLM non-streaming (scoring) | `complete()` via LiteLLM | `core/modules/llm.py` | HIGH |
| Structured output (assessment) | `response_format` with JSON schema | `core/scoring.py` | HIGH |
| SSE streaming to frontend | `StreamingResponse` + `text/event-stream` | `web_api/routes/module.py` | HIGH |
| Frontend SSE consumption | `sendMessage()` async generator | `web_frontend/src/api/modules.ts` | HIGH |
| Chat UI with voice | `NarrativeChatSection` + `useVoiceRecording` | `web_frontend/src/components/module/` | HIGH |
| Voice recording (mic) | `getUserMedia` + `MediaRecorder` | `web_frontend/src/hooks/useVoiceRecording.ts` | HIGH |
| Speech-to-text | OpenAI Whisper API via direct httpx call | `core/speech.py` | HIGH |
| Transcription endpoint | `POST /api/transcribe` | `web_api/routes/speech.py` | HIGH |
| Chat session persistence | `chat_sessions` table with JSONB | `core/modules/chat_sessions.py` | HIGH |
| Tool-based end detection | `TRANSITION_TOOL` + `tool_use` SSE event | `core/modules/chat.py` | HIGH |
| Prompt assembly | `assemble_chat_prompt(base, instructions, context)` | `core/modules/prompts.py` | HIGH |
| Background scoring | `enqueue_scoring()` fire-and-forget tasks | `core/scoring.py` | HIGH |
| Content segment schema | `SEGMENT_SCHEMAS` with field validation | `content_processor/src/content-schema.ts` | HIGH |
| Frontend segment types | `ModuleSegment` union type | `web_frontend/src/types/module.ts` | HIGH |
| Default LLM | `anthropic/claude-sonnet-4-6` | `core/modules/llm.py` env var | HIGH |

## Recommended Stack (Changes Only)

### No New Backend Dependencies

**Rationale:** Roleplay conversations are architecturally identical to existing chat segments. They use the same `stream_chat()` for LLM interaction, the same tool-calling pattern for AI-initiated conversation ending (`TRANSITION_TOOL` pattern), the same `complete()` + structured output for assessment scoring, the same `chat_sessions` table for message persistence, and the same `transcribe_audio()` for voice-to-text.

### No New Frontend Dependencies

**Rationale:** The roleplay UI is a variant of `NarrativeChatSection`. It reuses the same `useVoiceRecording` hook, the same `sendMessage()` SSE streaming API client, the same `ChatMarkdown` for message rendering, and the same Tailwind CSS utility classes.

## What Needs to Be BUILT (Not Installed)

| New Code | What It Does | Why It Cannot Be Reused |
|----------|-------------|------------------------|
| `core/modules/roleplay.py` | Assemble roleplay-specific system prompt from character instructions; define end-conversation tool; check end conditions | Existing `_build_system_prompt()` in chat.py prepends "You are a tutor" which is wrong for roleplay characters. Roleplay needs a clean prompt without tutor framing. |
| `RoleplayBox.tsx` | Render conversation UI with character name, end-condition indicators, completion state | Existing NarrativeChatSection has no character identity, no end-condition awareness, no completion flow. RoleplayBox wraps it with roleplay-specific chrome. |

## Key Design Decisions

### End-of-Conversation Detection

Three strategies supported, all implementable with existing infrastructure:

| Strategy | Implementation | Existing Pattern |
|----------|---------------|------------------|
| Message count | Backend counts user messages in session, emits `roleplay_end` SSE event | New: simple counter check |
| Time limit | Backend checks session `started_at` vs current time | New: timestamp comparison |
| AI-monitored | Provide `end_conversation` tool to LLM (same as `TRANSITION_TOOL`) | YES: `TRANSITION_TOOL` in `chat.py` already does this |

### Prompt Architecture

Roleplay prompts do NOT use the existing `DEFAULT_BASE_PROMPT` ("You are a tutor helping someone learn about AI safety"). Instead, the `instructions` field IS the complete system prompt for the character. This means `core/modules/roleplay.py` builds prompts differently than `core/modules/chat.py`:

```python
# chat.py pattern (NOT used for roleplay):
prompt = DEFAULT_BASE_PROMPT + f"\n\nInstructions:\n{instructions}"

# roleplay.py pattern:
prompt = instructions  # Character definition IS the prompt
# Append end-condition awareness and conversation guidelines
```

### Session Sharing

Roleplay segments share the same `chat_sessions` row as other chat segments in the module. The frontend handles this correctly already -- `NarrativeChatSection` uses `chatViewReducer` with `recentMessagesStartIdx` to show only messages from the current interaction. RoleplayBox follows the same pattern.

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Conversation state | Reuse `chat_sessions` table | New `roleplay_sessions` table | Duplicates session management code; existing table already fits |
| End detection (AI) | Tool calling (TRANSITION_TOOL pattern) | Regex/keyword in response | Unreliable; tool calling is deterministic and proven |
| End detection (count) | Backend validation after each exchange | Client-side counter only | Client state is unreliable; backend is authoritative |
| Voice input | Existing `useVoiceRecording` hook | WebSocket real-time streaming | Overkill for turn-based conversation |
| Assessment | Extend `scoring.py` pattern | Separate assessment module | Single process; no service boundary needed |
| Frontend UI | Wrap NarrativeChatSection | Build from scratch | 90%+ of chat UI already exists |
| Prompt approach | Dedicated roleplay prompt (no tutor base) | Extend existing tutor prompt | "You are a tutor" is wrong for "You are a skeptical tech CEO" |
| API endpoint | Reuse `/api/chat/module` | New `/api/chat/roleplay` | Duplicates auth, session management, SSE streaming |
| Completion storage | Reuse `question_responses` table | New table | Existing table has right structure, plugs into scoring pipeline |

## Installation

```bash
# No new packages to install.
# Zero new backend dependencies.
# Zero new frontend dependencies.
```

## Sources

- Direct codebase analysis (HIGH confidence):
  - `core/modules/llm.py` -- LiteLLM with `stream_chat()` and `complete()`
  - `core/modules/chat.py` -- `TRANSITION_TOOL` pattern, `send_module_message()`
  - `core/scoring.py` -- `enqueue_scoring()`, `SCORE_SCHEMA`, background task pattern
  - `core/speech.py` -- Direct OpenAI Whisper API
  - `web_api/routes/module.py` -- SSE streaming, segment type detection
  - `web_frontend/src/hooks/useVoiceRecording.ts` -- Reusable voice recording
  - `web_frontend/src/components/module/NarrativeChatSection.tsx` -- Chat UI
  - `content_processor/src/content-schema.ts` -- Segment schema definitions
