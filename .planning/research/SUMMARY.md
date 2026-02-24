# Project Research Summary

**Project:** v3.1 AI Roleplay — Multi-turn Roleplay Conversation Segments
**Domain:** Interactive conversational segment type for AI Safety education platform
**Researched:** 2026-02-24
**Confidence:** HIGH

## Executive Summary

Roleplay conversations are best implemented as a new segment type that shares underlying infrastructure with the existing chat/question system, rather than forking the chat segment or building an entirely separate system. The existing platform already has every required capability: LLM streaming via `stream_chat()`, session persistence in `chat_sessions`, SSE delivery, voice recording via `useVoiceRecording`, and assessment scoring via `scoring.py`. Zero new dependencies are needed. The work is pure feature construction: two new files (`core/modules/roleplay.py`, `RoleplayBox.tsx`), schema additions to the content processor, and focused modifications to routing and type definitions.

The recommended approach is to implement roleplay in dependency order: content parsing first (unblocks all downstream work), then backend prompt assembly and end-condition logic, then the frontend component, and finally assessment and test integration. Message count (`messages:N`) should be the first end trigger implemented as it is the simplest and most predictable. AI-monitored ending (via the existing `TRANSITION_TOOL` pattern) follows as a higher-value option. Assessment scoring is deferred to a second phase since it does not block the core experience and requires more careful design.

The two most critical risks are session isolation and persona contamination, and both must be resolved in Phase 1. Roleplay conversations must be scoped to individual segments rather than sharing the module-wide tutor chat session — this requires a `segment_key` column in `chat_sessions` and an Alembic migration. Character prompts must be built from scratch in `core/modules/roleplay.py` without importing the tutor `DEFAULT_BASE_PROMPT` from `chat.py`. Both are load-bearing architectural decisions that are expensive to reverse later.

## Key Findings

### Recommended Stack

The existing stack handles 100% of what roleplay requires. See `STACK.md` for the full capability matrix.

**Core technologies (all existing, zero new dependencies):**
- `LiteLLM` via `core/modules/llm.py` — LLM streaming and non-streaming — reused for roleplay character responses and optional assessment scoring
- `SSE / StreamingResponse` — token streaming to frontend — reused unchanged via existing `/api/chat/module` endpoint
- `chat_sessions` table (PostgreSQL JSONB) — conversation persistence — reused with `segment_key` discriminator column added via migration
- `useVoiceRecording` hook — browser mic capture + Whisper transcription — reused directly in `RoleplayBox.tsx`
- `NarrativeChatSection.tsx` — chat UI rendering — composed (not forked) as the inner UI layer of `RoleplayBox`
- `scoring.py` with structured LLM output — conversation assessment — extended to accept full transcript instead of single answer

**New code to build (not install):**
- `core/modules/roleplay.py` — character prompt assembly (no tutor base prompt), end-condition checking, `roleplay_end` SSE event emission
- `web_frontend/src/components/module/RoleplayBox.tsx` — roleplay UI with character header, end-condition indicator, completion state — wraps `NarrativeChatSection`

### Expected Features

**Must have (table stakes):**
- Multi-turn streaming conversation with character persona — core interaction, reuses `stream_chat()` + SSE
- Character name display and visual identity — users must know who they're talking to; distinct from "Tutor"
- Voice input — already in chat/questions; absence from roleplay would feel inconsistent; high pedagogical value
- Text input — always required for accessibility
- Message count end trigger — simplest mechanism, most predictable for content authors, proven pattern
- Conversation persistence across page refresh — reuses `chat_sessions` with `segment_key`
- Content parsing (`## Roleplay` segment type) — prerequisite for everything else
- End-of-conversation state — clear completion UI, input disabled, "Conversation complete" banner

**Should have (differentiators):**
- AI assessment of dialogue quality — full transcript evaluated against author-defined rubric (`assessment-instructions::` field)
- AI-monitored end trigger via tool calling — most natural ending, reuses `TRANSITION_TOOL` pattern from `chat.py`
- Opening message (AI greeting) — reduces blank-page anxiety, sets scenario context
- Scenario briefing above conversation — authored context displayed before first message
- Post-conversation feedback chat — reflective mode using existing `feedback.py` pattern
- Multiple attempts ("Try again") — same pattern as question "Answer again"
- End-trigger UI indicators — "3 messages remaining" informational display (frontend only, not authoritative)

**Defer (v2+):**
- Time-based end trigger — lower value than AI-monitored; add after message count and AI-monitored work
- TestSection integration — depends on working assessment; build after standalone roleplay is stable
- Real-time voice conversation (speech-to-speech) — massive complexity, wrong for turn-based practice
- Multiple AI characters in one conversation — order-of-magnitude complexity increase
- Conversation replay/review feature — separate work; transcripts already persisted for future use
- Roleplay-specific analytics — existing progress tracking covers completion

### Architecture Approach

Roleplay integrates as segment type `"roleplay"` following the established pattern used by `"question"` and `"chat"` segments. The content processor parses `## Roleplay` blocks from markdown into typed segment dicts. The backend route (`POST /api/chat/module`) detects `segment.type == "roleplay"` and delegates to `core/modules/roleplay.py` for prompt assembly and end-condition checking, then streams via the existing `stream_chat()` path. A new `roleplay_end` SSE event type signals conversation completion. The frontend `RoleplayBox.tsx` wraps `NarrativeChatSection` with roleplay-specific chrome (character header, progress indicator, completion state) and handles the `roleplay_end` event to transition state.

**Major components:**
1. `content_processor` (MODIFY) — parse `## Roleplay` segments with character/instructions/end-condition/assessment fields; add to SEGMENT_SCHEMAS, LENS_SEGMENT_TYPES, convertSegment()
2. `core/modules/roleplay.py` (NEW) — character prompt assembly with no tutor base, end-condition detection, `roleplay_end` signaling; `build_roleplay_prompt()` and `check_end_condition()`
3. `web_api/routes/module.py` (MODIFY) — detect roleplay in `event_generator()`, route to roleplay module
4. `chat_sessions` table (MODIFY via migration) — add `segment_key` column, update unique partial index
5. `core/scoring.py` (MODIFY, Phase 2) — extend to score full conversation transcripts with character-labeled format
6. `web_frontend/src/components/module/RoleplayBox.tsx` (NEW) — roleplay conversation UI wrapping `NarrativeChatSection`
7. `web_frontend/src/views/Module.tsx` (MODIFY) — add `case "roleplay"` to `renderSegment()`
8. `web_frontend/src/components/module/TestSection.tsx` (MODIFY, Phase 2) — extend to handle roleplay alongside question segments

### Critical Pitfalls

1. **Wrong segment type boundary** — Roleplay must be `type: "roleplay"`, not an `isRoleplay` flag on `ChatSegment` and not a separate system with new tables/routes. Treating it as a chat variant causes tutor history contamination; building a separate system triples code and maintenance surface. Address in Phase 1 type system design.

2. **Missing session isolation (`segment_key`)** — All chat segments in a module currently share one `chat_sessions` row. Without a `segment_key` discriminator, roleplay messages contaminate the tutor's history and multiple roleplay segments mix their conversations. Requires `ALTER TABLE chat_sessions ADD COLUMN segment_key TEXT`, an updated unique index using `COALESCE` for null compatibility, and updates to `get_or_create_chat_session()`. Requires Alembic migration in Phase 1.

3. **Tutor prompt contamination and persona drift** — `core/modules/roleplay.py` must NOT import `DEFAULT_BASE_PROMPT` or call `_build_system_prompt()` from `chat.py`. The roleplay character's `instructions` field is the complete system prompt. Research shows LLMs drop 39% in multi-turn persona consistency; mitigate with structured character card format and periodic reinforcement injected into message history every 5 turns.

4. **Client-side end-condition enforcement** — End conditions must be checked by the backend after each exchange (counting messages in the DB, not React state). Backend emits `roleplay_end` SSE event; frontend reacts to it. `if (messageCount >= maxMessages) endConversation()` in React is incorrect and unreliable across refreshes.

5. **Assessment uses wrong input pattern** — Roleplay assessment must receive the full formatted conversation transcript, not a single answer string. Assessment instructions must be strictly separated from character instructions — they serve different LLM calls (scorer vs character). Leaking assessment instructions into the character prompt causes the character to reference the rubric mid-conversation ("Let me evaluate your understanding..."), breaking immersion. Defer assessment to Phase 2 to get the design right.

## Implications for Roadmap

The dependency graph is unambiguous: content types unblock everything, backend prompts unblock the frontend, working conversations unblock assessment. This is a 4-phase feature build with no infrastructure investment required.

### Phase 1: Foundation — Types, Schema, and Data Model

**Rationale:** Content parsing is the single prerequisite for all other work. The `segment_key` DB migration is load-bearing for session correctness and is more painful to add retroactively after data exists. The character prompt architecture decision (no tutor base prompt) must be locked before any backend code is written, as reversing it means rewriting roleplay.py.

**Delivers:** Parseable `## Roleplay` content segments, typed Python/TypeScript interfaces, session isolation via `segment_key`, confirmed prompt architecture.

**Addresses:** Content parsing (table stakes), character name display infrastructure, session isolation, structured character card format for content authors, parser default for missing `end-condition` (applies `messages:6`).

**Avoids:** Pitfall 1 (type boundary decided here), Pitfall 2 (prompt architecture locked here), Pitfall 3 (segment_key migration done here), Pitfall 8 (character card schema defined here), Pitfall 13 (default end-condition set in parser).

**Files:** `content-schema.ts`, `lens.ts`, `types/module.ts`, `core/modules/types.py`, `core/tables.py` + Alembic migration, `core/modules/chat_sessions.py`.

### Phase 2: Core Conversation Loop

**Rationale:** With types and data model in place, backend and frontend can be built and integrated. Message count end trigger is implemented first — simplest, proves the full pipeline. Voice input is a direct hook reuse with high pedagogical value and negligible implementation effort. Opening message and scenario briefing are low-complexity UX improvements included here.

**Delivers:** Fully working roleplay conversation. Student speaks/types, character responds with streaming, conversation ends after N messages, session persists across refresh.

**Addresses:** Multi-turn streaming conversation, voice input, message count end trigger, conversation persistence, end-of-conversation state, scenario briefing, opening message, character display.

**Avoids:** Pitfall 4 (backend emits `roleplay_end`; frontend reacts), Pitfall 10 (RoleplayBox wraps NarrativeChatSection; no fork), Pitfall 9 (hard cap default prevents runaway conversations), Pitfall 6 (voice latency accepted with honest UI copy; auto-send after transcription added).

**Files:** `core/modules/roleplay.py` (new), `web_api/routes/module.py` (modify), `RoleplayBox.tsx` (new), `Module.tsx` (modify).

### Phase 3: AI-Monitored End Trigger

**Rationale:** The `TRANSITION_TOOL` pattern already exists in `chat.py` and is directly reusable. AI-monitored ending is the highest-value end trigger — it produces the most natural conversation endings and adapts to student performance. Must include a hard cap safety valve (20 message maximum) because AI judgment can be unreliable.

**Delivers:** Conversations that end naturally when scenario goals are met. Multiple attempts ("Try again") button.

**Addresses:** `end-trigger:: ai-monitored`, safety valve hard cap, "Try again" for repeat practice.

**Avoids:** Pitfall 9 (AI-monitored without safety valve causes infinite conversations — hard cap is non-negotiable).

**Files:** `core/modules/roleplay.py` (extend with end_conversation tool), content schema (add `ai-monitored` as valid trigger type).

### Phase 4: Assessment and Test Integration

**Rationale:** Assessment requires working conversations to test against and quality-tune the scoring prompt. Deliberately deferred because roleplay assessment is architecturally different from question assessment (full transcript vs single answer, dialogue arc vs point-in-time scoring). TestSection integration depends on assessment. Both benefit from validated conversation patterns.

**Delivers:** AI scoring of roleplay dialogue quality against author-defined rubrics. Roleplay segments usable in test sections. Post-conversation feedback chat.

**Addresses:** AI assessment of dialogue quality, post-conversation feedback chat (using `feedback.py` pattern), TestSection integration, assessment in test context.

**Avoids:** Pitfall 7 (full transcript with character-labeled format; rubric separate from character prompt), Pitfall 11 (TestSection uses `onComplete` callback interface same as questions, no type-specific logic in TestSection).

**Files:** `core/scoring.py` (extend), `TestSection.tsx` (extend), `question_responses` table usage for transcript storage.

### Phase Ordering Rationale

- Phase 1 before all: type system and `segment_key` migration are load-bearing prerequisites; prompt architecture is too expensive to reverse later.
- Phase 2 before Phase 3: prove the full conversation loop with the simple end trigger before adding AI-driven complexity.
- Phase 2 before Phase 4: working conversations with captured transcripts are required before assessment can be built or tuned.
- Phases 3 and 4 are independent: if test integration is a higher business priority than AI-monitored end triggers, Phase 4 can move to Phase 3. No dependency between them.
- Time-based end trigger omitted from phases: lower value than AI-monitored; can be a sub-task within Phase 3 if content authors request it.

### Research Flags

Phases with well-documented patterns (standard implementation, skip additional research):

- **Phase 1:** Segment type extension is a well-established codebase pattern. Character card schema follows existing content markdown conventions. Migration pattern is standard Alembic.
- **Phase 2:** SSE streaming, voice hook reuse, and RoleplayBox composition all follow patterns proven in `NarrativeChatSection` and `AnswerBox`. No novel patterns.
- **Phase 3:** `TRANSITION_TOOL` pattern is documented and working in `chat.py`. Extension is mechanical.

Phases that warrant implementation-time research:

- **Phase 4 (assessment):** Roleplay dialogue assessment quality is domain-dependent. Recommend prototyping the scoring prompt against real conversation transcripts before finalizing the schema. The transcript format (role labels, character name vs ASSISTANT, scenario context header) should be iterated. The RUBICON framework (ACM) and multi-turn dialogue assessment survey (arxiv) provide starting points. Content author guidance for writing good `assessment-instructions` rubrics is an open design question.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All capabilities verified by direct codebase analysis with specific file references. Zero ambiguity about what exists and what reuses. |
| Features | HIGH | Table stakes derived from direct analysis of existing segment types. Differentiators cross-referenced against production roleplay platforms (Duolingo, Yoodli, Noodle) and EDUCAUSE research. |
| Architecture | HIGH | All integration points verified against actual source code. Data flow, component boundaries, and modification list based on reading real files, not assumptions. |
| Pitfalls | HIGH | Critical pitfalls grounded in codebase analysis (session contamination, prompt contamination confirmed by reading source). Persona drift backed by arxiv paper with quantified impact. JSONB performance cliff backed by PostgreSQL documentation. |

**Overall confidence:** HIGH

### Gaps to Address

- **Assessment rubric quality:** The quality of roleplay assessment depends on content authors writing good `assessment-instructions`. No current tooling or guidance exists. Phase 4 should include 2-3 example rubrics and content author documentation alongside the technical implementation.

- **Persona reinforcement cadence:** Research recommends periodic character reinforcement every N turns to prevent context dilution. Optimal N for this domain is not established. Implement with a configurable constant (default every 5 turns) and adjust based on observed drift in real content testing.

- **`segment_key` uniqueness constraint:** The existing `idx_chat_sessions_unique_user_active` partial index must be updated to handle the new `segment_key` column while remaining backward compatible with existing sessions where `segment_key IS NULL`. Migration SQL requires careful `COALESCE` handling. Must be reviewed with the user before execution.

- **Shared session cross-contamination direction:** When a module has both chat and roleplay segments that share a `chat_sessions` row (differentiated by `segment_key`), the sessions are isolated from each other. The roleplay character will NOT see the tutor conversation history and vice versa. This is the correct behavior but should be explicitly validated with a real module containing both segment types.

- **Voice latency tolerance:** The record-then-transcribe pipeline adds 3-8 seconds per turn. Acceptable for Phase 2 with honest UI copy ("Voice messages" not "Voice chat") and auto-send after transcription. If voice adoption is observed to be low in practice, this is irrelevant. If high, a Phase 5 could add streaming STT (Deepgram/AssemblyAI) reducing perceived latency to ~1-2 seconds.

## Sources

### Primary — HIGH confidence (direct codebase analysis)
- `core/modules/chat.py` — TRANSITION_TOOL pattern, `_build_system_prompt()`, `send_module_message()`
- `core/modules/llm.py` — `stream_chat()`, `complete()`, LiteLLM abstraction
- `core/modules/chat_sessions.py` — session persistence, JSONB append pattern, unique constraints, claim logic
- `core/scoring.py` — `enqueue_scoring()`, SCORE_SCHEMA, background task pattern
- `core/speech.py` — Whisper API integration
- `core/tables.py` — `chat_sessions` schema, `question_responses` schema, JSONB structure
- `web_api/routes/module.py` — `event_generator()`, SSE streaming, segment type detection
- `content_processor/src/content-schema.ts` — SEGMENT_SCHEMAS, field validation patterns
- `content_processor/src/parser/lens.ts` — LENS_SEGMENT_TYPES, VALID_SEGMENTS_PER_SECTION, convertSegment()
- `web_frontend/src/types/module.ts` — ModuleSegment union type, existing segment type definitions
- `web_frontend/src/views/Module.tsx` — `renderSegment()` dispatch switch
- `web_frontend/src/components/module/NarrativeChatSection.tsx` — chat UI (710 lines), voice integration
- `web_frontend/src/components/module/AnswerBox.tsx` — question submission, completion state pattern
- `web_frontend/src/components/module/TestSection.tsx` — test state machine, question completion flow
- `web_frontend/src/hooks/useVoiceRecording.ts` — voice pipeline, Whisper API integration
- `web_frontend/src/api/modules.ts` — SSE client, `sendMessage()` async generator

### Secondary — MEDIUM/HIGH confidence (academic and industry research)
- [LLMs get lost in multi-turn conversations — arxiv 2505.06120](https://arxiv.org/pdf/2505.06120) — 39% performance drop in multi-turn; HIGH
- [RUBICON: rubric-based AI conversation evaluation — ACM DL](https://dl.acm.org/doi/10.1145/3664646.3664778) — transcript assessment design; HIGH
- [Multi-turn dialogue assessment survey — arxiv 2504.04717](https://arxiv.org/html/2504.04717v1) — assessment frameworks; HIGH
- [CAIS - How to Talk About AI Safety](https://safe.ai/act/talk) — domain-specific communication guidance; HIGH
- [Duolingo Max](https://blog.duolingo.com/duolingo-max/) — scenario roleplay production patterns; MEDIUM
- [EDUCAUSE - Dialogue at Scale](https://er.educause.edu/articles/2025/10/dialogue-at-scale-ai-soft-skills-and-the-future-of-assessment) — educational AI dialogue assessment; MEDIUM
- [Jenova AI Roleplay](https://www.jenova.ai/en/resources/ai-persona-roleplay) — 80-90% completion rates vs 15-20% traditional eLearning; MEDIUM
- [PostgreSQL JSONB TOAST performance (pganalyze)](https://pganalyze.com/blog/5mins-postgres-jsonb-toast) — JSONB performance cliff at scale; MEDIUM
- [AssemblyAI voice AI latency](https://www.assemblyai.com/blog/low-latency-voice-ai) — 800ms threshold for conversational flow; MEDIUM
- [AI-driven vs human evaluation — ScienceDirect](https://www.sciencedirect.com/science/article/pii/S2451958825003252) — AI assessment reliability vs human; MEDIUM

---
*Research completed: 2026-02-24*
*Ready for roadmap: yes*
