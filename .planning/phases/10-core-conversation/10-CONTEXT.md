# Phase 10: Core Conversation - Context

**Gathered:** 2026-02-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Students can have a complete roleplay conversation with an AI character using voice or text, with manual completion, persistence, and retry. This phase builds the full interactive experience on top of Phase 8 (content parsing, sessions, prompts) and Phase 9 (TTS pipeline). Assessment scoring is Phase 11.

</domain>

<decisions>
## Implementation Decisions

### Briefing & opening flow
- Briefing card sits above the conversation area, always visible — shows the `content::` field (scenario context for the student)
- If `opening-message::` is set, AI character sends it automatically as the first message when the session is created
- If no `opening-message::`, conversation starts empty and the student speaks first
- No "start" gate — conversation area is immediately interactive, briefing card is informational context

### Conversation UI identity
- Character name displayed on AI messages instead of "AI Tutor"
- Different accent color on AI message bubbles to distinguish from tutor chat
- Character avatar/icon area (generic roleplay icon or initials)
- Same chat component under the hood (streaming, message list, input) — reskinned with roleplay-specific styling, not a separate implementation
- Student messages look the same as in tutor chat

### Voice/text — three independent toggles
Three settings, all intercompatible:
1. **Text display** (on/off) — show/hide message bubbles for both user and AI messages
2. **AI TTS** (on/off) — speak AI responses via TTS or not
3. **User input mode** (text input / voice input) — text input shows the text box with optional editable STT; voice input hides text box and shows push-to-talk mic button

- All combinations are valid — these are independent settings
- Exposed as inline toggle icons in the chat header/toolbar area, always visible
- Toggle states persist via localStorage (remembered across page refresh per session)
- Default: text display ON, TTS OFF, text input mode

### Push-to-talk mic behavior
- Click mic button to start recording (toggle, NOT hold-to-talk — holding is annoying)
- Click mic button again to send — transcribes and sends immediately, no review step
- Cancel button (X) appears while recording to discard without sending
- No voice activity detection / auto-send — avoids the "AI interrupts you" problem

### Text-display-off state
- When text display is OFF, conversation area shows minimal indicator: who's speaking and a waveform/pulse animation
- Briefing card remains visible regardless of text display setting

### Text mode voice input
- In text mode (text input selected), the existing speech-to-text → text box → edit → send workflow from tutor chat is still available
- This is the "optional editable STT" in the text input mode — mic fills the text box, student can review/edit, then send

### Completion & retry
- Manual "Complete" button visible in the conversation UI — the ONLY trigger for ending (no message count, time, or AI-monitored auto-triggers per CONV-05 decision)
- After completion: input disabled, conversation locked, done state shown (banner or visual indicator). Student can still scroll and read
- "Try again" archives the current session (sets `archived_at`) and creates a fresh one
- No confirmation dialog for completion — deliberate action, and retry is always available

### Claude's Discretion
- Character name extraction from `ai-instructions::` — parsing strategy or convention
- Exact accent colors and visual treatment for roleplay vs tutor chat distinction
- Waveform/pulse animation design for text-off state
- Completion button placement (header bar, footer, inline)
- Mic recording visual feedback during push-to-talk
- Loading/connecting states for TTS and STT services

</decisions>

<specifics>
## Specific Ideas

- Three toggles model keeps voice mode flexible — a student who wants audio but also wants to read along can have TTS ON + text display ON
- Push-to-talk with click-to-start/click-to-send (not hold) avoids fatigue and allows the student to think mid-recording
- The same chat component is reskinned, not rebuilt — roleplay is a visual variant of the existing chat, not a parallel system

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 10-core-conversation*
*Context gathered: 2026-02-25*
