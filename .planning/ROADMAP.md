# Roadmap: AI Safety Course Platform

## Milestones

- v1.0 Mobile Responsiveness - Phases 1-5 (shipped 2026-01-22)
- v3.0 Prompt Lab - Phases 6-7 (archived 2026-02-24)
- **v3.1 AI Roleplay** - Phases 8-11 (in progress)

## Phases

<details>
<summary>v1.0 Mobile Responsiveness (Phases 1-5) - SHIPPED 2026-01-22</summary>

See `.planning/milestones/v1.0-ROADMAP.md` for full details.

5 phases, 13 plans, 29 requirements completed.

</details>

<details>
<summary>v3.0 Prompt Lab (Phases 6-7) - ARCHIVED 2026-02-24</summary>

**Milestone Goal:** Facilitator-only evaluation workbench for iterating on AI tutor system prompts and assessment scoring prompts using real student data.

Phase 6 (Chat Evaluation): 4/5 plans completed. Plan 06-05 integration verification deferred.
Phase 7 (Assessment Evaluation): Deferred -- blocked on ws3 merge of `complete()` and `SCORE_SCHEMA`.

</details>

### v3.1 AI Roleplay (In Progress)

**Milestone Goal:** Add roleplay content type where students practice AI safety conversations with AI characters, supporting text and voice interaction with TTS audio responses, with optional AI assessment.

**Phase Numbering:**
- Integer phases (8, 9, 10, 11): Planned milestone work
- Decimal phases (8.1, 9.1): Urgent insertions (marked with INSERTED)

- [x] **Phase 8: Foundation** - Content parsing, session isolation, and prompt architecture
- [x] **Phase 9: TTS Pipeline** - Inworld TTS integration for AI character voice responses
- [x] **Phase 10: Core Conversation** - Full roleplay experience with text and voice modes
- [ ] **Phase 11: Assessment** - AI scoring of roleplay transcripts and test section integration

## Phase Details

### Phase 8: Foundation
**Goal**: Roleplay segments are parseable from content markdown, sessions are isolated per segment, and the prompt architecture is locked down separate from tutor chat
**Depends on**: Nothing (first phase of v3.1)
**Requirements**: INFRA-01, INFRA-02, CONT-01, CONT-02, CONT-03, CONT-04
**Success Criteria** (what must be TRUE):
  1. A `#### Roleplay` block in content markdown with required `id::`, `content::`, `ai-instructions::`, optional `assessment-instructions::`, and optional `opening-message::` fields is parsed into a typed roleplay segment by the content processor
  2. Roleplay segments appear correctly in all section types (page, lens-article, lens-video) without errors
  3. `chat_sessions` table has `roleplay_id` column (renamed from old design's `segment_key`) and proper unique indexes so that roleplay conversations are isolated from tutor chat and from each other
  4. `core/modules/roleplay.py` exists with `build_roleplay_prompt()` that constructs character prompts from content fields without importing anything from `chat.py`
**Plans**: 2 plans

Plans:
- [x] 08-01-PLAN.md -- Roleplay segment type (id::, content::, ai-instructions::) across content processor pipeline and frontend types
- [x] 08-02-PLAN.md -- DB migration (content_id->module_id, roleplay_id, segment_snapshot), session service, and roleplay prompt assembly

### Phase 9: TTS Pipeline
**Goal**: AI character text responses are converted to speech via Inworld TTS and streamed as audio to the browser in real time
**Depends on**: Phase 8 (needs roleplay prompt architecture for integration context)
**Requirements**: VOICE-01, VOICE-02, VOICE-03
**Success Criteria** (what must be TRUE):
  1. Backend connects to Inworld TTS via WebSocket, sends text tokens from LLM streaming, and receives audio chunks back
  2. Backend streams audio chunks to the browser via a transport that allows playback to begin before Inworld finishes generating (no waiting for full audio)
  3. A test harness or minimal endpoint demonstrates the full pipeline: send text, get streaming audio in browser, hear it play -- confirming latency and reliability before full UI integration
**Plans**: 2 plans

Plans:
- [x] 09-01-PLAN.md -- Backend TTS module (Inworld WebSocket client, config) and FastAPI WebSocket endpoint for browser audio streaming
- [x] 09-02-PLAN.md -- Browser audio playback hook (Web Audio API) and /tts-test harness page for end-to-end verification

### Phase 10: Core Conversation
**Goal**: Students can have a complete roleplay conversation with an AI character using voice or text, with manual completion, persistence, and retry
**Depends on**: Phase 8 (content types, session isolation, prompt assembly), Phase 9 (TTS pipeline for voice mode)
**Requirements**: CONV-01, CONV-02, CONV-03, CONV-04, CONV-05, CONV-06, CONV-07, CONV-08, CONV-09, VOICE-04, VOICE-05
**Success Criteria** (what must be TRUE):
  1. Student sees a scenario briefing card above the conversation, then the AI character sends an opening message to start the interaction
  2. Student can have a multi-turn streaming conversation with the AI character, seeing the character name displayed distinctly from tutor chat
  3. Student can switch between voice-only mode (mic input, AI responds with TTS audio, no keyboard) and text mode (keyboard input, AI responds with text only, no TTS)
  4. Student clicks a completion button to end the conversation, after which input is disabled and a done state is shown
  5. Conversation persists across page refresh, and student can retry the roleplay with a fresh conversation using "Try again"
**Plans**: 4 plans

Plans:
- [x] 10-01-PLAN.md -- Backend roleplay routes (SSE chat, history, complete, retry), DB migration (completed_at), claim dedup fix
- [x] 10-02-PLAN.md -- Frontend API client, character name extraction, useRoleplaySession/useRoleplayToggles/useRoleplayTTS hooks
- [x] 10-03-PLAN.md -- RoleplaySection UI (briefing, toolbar, voice input, speaking indicator) and Module.tsx integration
- [x] 10-04-PLAN.md -- Human verification of complete roleplay experience

### Phase 11: Assessment
**Goal**: Course creators can add AI assessment to roleplay segments, and roleplay works inside test sections with post-conversation feedback
**Depends on**: Phase 10 (needs working conversations with transcripts to assess)
**Requirements**: ASMNT-01, ASMNT-02, ASMNT-03
**Success Criteria** (what must be TRUE):
  1. After completing a roleplay with `assessment-instructions`, the full conversation transcript is scored by AI against the author-defined rubric, producing structured output (score, reasoning, dimensions)
  2. Roleplay segments work inside test sections following the same completion flow as question segments
  3. After assessment, student can access a post-conversation feedback chat to reflect on their performance
**Plans**: 4 plans

Plans:
- [ ] 11-01-PLAN.md -- Backend assessment pipeline (roleplay_assessments table, scoring module, trigger on complete, score retrieval endpoint)
- [ ] 11-02-PLAN.md -- TestSection refactor for unified assessable items (questions + roleplays in test sections)
- [ ] 11-03-PLAN.md -- Frontend assessment display (score card, polling, feedback chat wiring)
- [ ] 11-04-PLAN.md -- Human verification of complete assessment experience

## Progress

**Execution Order:**
Phases execute in numeric order: 8 -> 8.x (if any) -> 9 -> 9.x (if any) -> 10 -> 10.x (if any) -> 11

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 8. Foundation | v3.1 | 2/2 | ✓ Complete | 2026-02-25 |
| 9. TTS Pipeline | v3.1 | 2/2 | ✓ Complete | 2026-02-25 |
| 10. Core Conversation | v3.1 | 4/4 | ✓ Complete | 2026-03-02 |
| 11. Assessment | v3.1 | 0/4 | Not started | - |
