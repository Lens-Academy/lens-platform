# Requirements: AI Safety Course Platform -- v3.1 AI Roleplay

**Defined:** 2026-02-24
**Core Value:** Students can engage with course content and demonstrate understanding while the platform collects data to improve both teaching and measurement.

## v3.1 Requirements

Requirements for the AI Roleplay milestone. Each maps to roadmap phases.

### Content System

- [ ] **CONT-01**: Course creators can define `## Roleplay` segments in content markdown with `character::` and `instructions::` fields
- [ ] **CONT-02**: Roleplay segments support optional `assessment-instructions::` field for AI scoring
- [ ] **CONT-03**: Roleplay segments support optional `opening-message::` field for AI greeting
- [ ] **CONT-04**: Roleplay segments work in all section types (page, lens-article, lens-video)

### Voice & TTS

- [ ] **VOICE-01**: AI roleplay responses are converted to speech via Inworld TTS-1/TTS-1.5 mini
- [ ] **VOICE-02**: Backend streams LLM text tokens to Inworld via WebSocket, receives audio chunks back
- [ ] **VOICE-03**: Backend streams audio chunks to the browser for playback while Inworld is still generating
- [ ] **VOICE-04**: Voice-only mode: student uses mic input, AI responds with audio (no keyboard)
- [ ] **VOICE-05**: Text mode: student uses keyboard, AI responds with text only (no TTS)

### Conversation

- [ ] **CONV-01**: Student has multi-turn streaming conversation with AI character
- [ ] **CONV-02**: Character name displayed distinctly from tutor chat
- [ ] **CONV-03**: Student can use voice input via existing mic/speech-to-text
- [ ] **CONV-04**: Conversation persists across page refresh
- [ ] **CONV-05**: Student clicks a completion button to end the conversation
- [ ] **CONV-06**: After completion, conversation shows done state with input disabled
- [ ] **CONV-07**: Scenario briefing card displayed above conversation before first message
- [ ] **CONV-08**: AI character sends opening message to start the conversation
- [ ] **CONV-09**: Student can retry roleplay with a fresh conversation ("Try again")

### Assessment

- [ ] **ASMNT-01**: AI scores full conversation transcript against author-defined rubric after completion
- [ ] **ASMNT-02**: Roleplay segments work inside test sections (like question segments)
- [ ] **ASMNT-03**: Post-conversation feedback chat available after assessment (reuses feedback pattern)

### Infrastructure

- [ ] **INFRA-01**: Roleplay sessions isolated via `segment_key` column on `chat_sessions` (DB migration)
- [ ] **INFRA-02**: Roleplay prompt assembly in `core/modules/roleplay.py`, separate from tutor `chat.py`

## v3.0 Requirements (Archived)

Previous milestone requirements archived. See `.planning/milestones/` for details.

### Prompt Lab -- Chat Evaluation (Phase 6, mostly shipped)

- [x] **FIX-01**: Facilitator can load curated chat conversation fixtures
- [x] **FIX-03**: Facilitator can browse available fixtures with name, module, and description
- [x] **FIX-04**: Chat fixtures include full context
- [x] **CHAT-01** through **CHAT-07**: Chat tutor evaluation workflow
- [x] **INFRA-01** through **INFRA-04**: Prompt Lab infrastructure

### Prompt Lab -- Assessment Evaluation (Phase 7, deferred)

- **FIX-02**: Assessment fixture loading (deferred -- blocked on ws3 merge)
- **FIX-05**: Assessment fixtures with ground-truth scores (deferred)
- **ASMNT-01** through **ASMNT-05**: Assessment evaluation workflow (deferred)

## Future Requirements

Deferred to future release. Tracked but not in current roadmap.

### End Triggers

- **TRIG-01**: Message count end trigger (`end-trigger:: messages:N`)
- **TRIG-02**: AI-monitored end trigger via tool calling (`end-trigger:: ai-monitored`)
- **TRIG-03**: Time-based end trigger (`end-trigger:: time:Nm`)

### Roleplay Enhancements

- **ENH-01**: End-trigger UI indicators ("3 messages remaining", countdown timer)
- **ENH-02**: Speech-to-speech real-time voice conversation (WebRTC)

### Prompt Lab Enhancements

- **DIFF-01**: Facilitator can save prompt versions and switch between them
- **DIFF-02**: Facilitator can run all fixtures through a prompt as a curated test suite
- **DIFF-03**: Facilitator can add annotations/notes to specific conversations
- **DIFF-04**: Facilitator can compare responses from different models side-by-side
- **DIFF-05**: Facilitator can fork a conversation at any point (branching)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Multiple AI characters in one conversation | Order-of-magnitude complexity (turn management, multi-persona state) |
| Branching narrative trees | LLM-driven adaptive conversation is superior to pre-authored branches |
| Student persona/role assignment | Student is always themselves; scenario describes situation, not a student role |
| Gamification / scoring leaderboards | Competitive scoring of subjective conversation skills creates anxiety |
| Direct browser-to-Inworld connection | Backend mediates all TTS traffic for API key security and control |
| Real-time typing indicators for AI | Streaming text already shows AI is responding |
| Roleplay-specific analytics dashboards | Existing progress tracking covers completion |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CONT-01 | Phase 8 | Pending |
| CONT-02 | Phase 8 | Pending |
| CONT-03 | Phase 8 | Pending |
| CONT-04 | Phase 8 | Pending |
| VOICE-01 | Phase 9 | Pending |
| VOICE-02 | Phase 9 | Pending |
| VOICE-03 | Phase 9 | Pending |
| VOICE-04 | Phase 10 | Pending |
| VOICE-05 | Phase 10 | Pending |
| CONV-01 | Phase 10 | Pending |
| CONV-02 | Phase 10 | Pending |
| CONV-03 | Phase 10 | Pending |
| CONV-04 | Phase 10 | Pending |
| CONV-05 | Phase 10 | Pending |
| CONV-06 | Phase 10 | Pending |
| CONV-07 | Phase 10 | Pending |
| CONV-08 | Phase 10 | Pending |
| CONV-09 | Phase 10 | Pending |
| ASMNT-01 | Phase 11 | Pending |
| ASMNT-02 | Phase 11 | Pending |
| ASMNT-03 | Phase 11 | Pending |
| INFRA-01 | Phase 8 | Pending |
| INFRA-02 | Phase 8 | Pending |

**Coverage:**
- v3.1 requirements: 23 total
- Mapped to phases: 23
- Unmapped: 0

---
*Requirements defined: 2026-02-24*
*Last updated: 2026-02-24 after roadmap creation*
