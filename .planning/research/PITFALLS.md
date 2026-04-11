# Domain Pitfalls: Roleplay Conversation Integration

**Domain:** Adding multi-turn AI roleplay conversations to an existing education platform
**Researched:** 2026-02-24
**Overall confidence:** HIGH (grounded in codebase analysis + domain research)

---

## Critical Pitfalls

Mistakes that cause rewrites or significant user-facing issues.

---

### Pitfall 1: Reusing Chat Segment Type Creates Invisible Conflicts

**What goes wrong:** Implementing roleplay as a variant of the existing `ChatSegment` type (e.g., adding an `isRoleplay` flag) or creating an entirely separate system (new tables, new routes, new pages). Both extremes cause problems.

**Why it happens:** The existing `ChatSegment` in `types.py` has `type: Literal["chat"]` with `instructions` and `hidePreviousContent` fields. But roleplay differs fundamentally in session lifecycle, UI treatment, assessment needs, end-of-conversation detection, and session isolation (see Pitfall 4). On the other extreme, building a fully separate system duplicates auth, streaming, progress tracking, and session management unnecessarily.

**The right middle ground:** Roleplay is a new segment type (`type: "roleplay"`) that shares underlying infrastructure (LLM streaming via `stream_chat()`, chat session persistence via `chat_sessions` table, progress tracking via `user_content_progress`) but has its own:
- Segment type definition (Python + TypeScript)
- Prompt assembly function (no tutor base prompt)
- Frontend component (composition over NarrativeChatSection, not a fork)
- API route (separate router, shared LLM layer)
- End-condition logic (backend-enforced)
- Content type in `chat_sessions` (`"roleplay"` vs `"module"`)

**Consequences of getting this wrong:**
- If treated as chat variant: roleplay messages leak into tutor history, `transition_to_next` fires unexpectedly, frontend shows "Tutor" label, progress tracking conflates the two
- If built as separate system: 2-3x code, duplicate bug fixes, two systems to maintain

**Detection:** If you find `if segment.type === "chat" && segment.isRoleplay` anywhere, you chose the variant path. If you are creating new database tables for roleplay, you chose the separate system path. Both are wrong.

**Phase:** Address in Phase 1 (type system design). Must be decided before any implementation begins.

---

### Pitfall 2: Character Persona Drift Over Long Conversations

**What goes wrong:** The LLM gradually loses its roleplay persona, reverting to helpful-assistant behavior. This is especially severe when the system prompt defines the character but the conversation grows and persona instructions become proportionally "diluted." Research shows LLMs exhibit an average 39% performance drop in multi-turn vs single-turn interactions.

**Why it happens:** Two compounding causes:
1. **Tutor prompt contamination:** The existing `_build_system_prompt()` always prepends `DEFAULT_BASE_PROMPT` ("You are a tutor helping someone learn about AI safety"). If roleplay reuses this, the AI plays "tutor pretending to be Dr. Chen" not "Dr. Chen." The existing tutor chat works because "helpful AI safety tutor" is close to the LLM's default behavior. Roleplay characters are far from default.
2. **Context dilution:** Character definition is placed once in the system prompt. As conversation grows to 15-20 turns, the persona gets overwhelmed by the volume of conversation history.

**Consequences:**
- Character breaks immersion around turn 5-8
- Students learn wrong lessons (the character was supposed to push back, but became agreeable)
- Assessment of student performance becomes unreliable if the AI wasn't behaving as specified

**Prevention:**
- Roleplay prompt assembly must NOT include the base tutor prompt. Build prompts from scratch in `core/modules/roleplay.py`.
- Use a structured "character card" format that separates: identity, communication style, knowledge/beliefs, behavioral rules, and what the character will NEVER do
- Reinforce persona periodically: inject a brief character reminder every N turns into the message history
- Use `thinking` (already enabled in `llm.py`) -- reasoning through character helps maintain consistency
- Test character consistency: send 20 turns and verify turn-20 responses match the character card

**Detection:** If `roleplay.py` imports from `chat.py` or `prompts.py`, tutor prompt is likely leaking. If content authors notice the character "becoming ChatGPT" after a few turns, reinforcement is insufficient.

**Phase:** Address in Phase 1 (prompt architecture). This is a design decision, not a bolt-on fix.

---

### Pitfall 3: Shared Session Causing Character Confusion

**What goes wrong:** All chat and roleplay segments in a module share one `chat_sessions` row (keyed by `content_id` = module UUID). A student chats with the tutor, then enters a roleplay. The roleplay character's system prompt includes the tutor conversation history. Additionally, a module with three roleplay scenarios will share a single chat session, mixing all conversations.

**Why it happens:** The current `get_or_create_chat_session` looks up sessions by `(user_id, content_id)`. The unique constraint `idx_chat_sessions_unique_user_active` enforces exactly one active session per `(user_id, content_id)`. The existing `event_generator()` loads `existing_messages` from this shared session and passes them all to `stream_chat()`.

**Consequences:**
- AI breaks character because message history contains tutor-style responses
- Second roleplay retrieves first roleplay's messages
- Assessment of individual scenarios becomes impossible
- Archive-and-recreate workaround would lose previous transcripts

**Prevention:**
- Add a `segment_key` column (nullable Text) to `chat_sessions` distinguishing sessions within the same content. For roleplay: `segment_key = f"{section_index}:{segment_index}"`. For existing tutor chat: `segment_key = NULL` (backward compatible).
- Update unique partial indexes to include `segment_key` (use COALESCE to handle NULL).
- Update `get_or_create_chat_session` to accept optional `segment_key`.
- Roleplay conversations start with clean message history -- they should not inherit tutor context.
- Update `claim_chat_sessions` to include `segment_key` in conflict-detection subquery.
- This requires an Alembic migration. Plan carefully.

**Detection:** Test a module with tutor chat followed by roleplay. If the character references the tutor conversation, contamination is happening. Test two roleplay segments -- if the second shows the first's history, isolation is broken.

**Phase:** Address in Phase 1 (data model). Requires Alembic migration.

---

### Pitfall 4: Client-Side End-Condition Enforcement

**What goes wrong:** The frontend counts messages or tracks time and decides when to end the roleplay. User refreshes, losing the count. Or manipulates client state to continue. Or a race condition between backend streaming and frontend counter produces inconsistent behavior.

**Why it happens:** Seems simpler to handle in React state than add backend logic. The developer thinks "the backend just streams; the frontend decides when to stop."

**Consequences:** End conditions are unreliable. In test sections, scoring triggers at wrong times. Students get different numbers of exchanges for the same roleplay. Data integrity for scoring is compromised.

**Prevention:**
- End conditions are checked and enforced by the **backend** after each exchange.
- Backend counts messages in `chat_sessions.messages` JSONB array, not frontend state.
- Backend checks `started_at` vs current time for time-based conditions.
- For AI-monitored conditions, backend provides `end_conversation` tool to the LLM.
- When end condition is met, backend emits `{"type": "roleplay_end"}` SSE event.
- Frontend reacts to this event by transitioning to completed state. It does NOT independently decide when to end.
- Frontend MAY display turn count indicator for UX, but this is informational only.
- End-condition `messages:N` should count USER messages only (opening AI message does not count).

**Detection:** If frontend has `if (messageCount >= maxMessages) endConversation()`, the end condition is client-side. This is wrong.

**Phase:** Phase 1 (backend end-condition logic).

---

## Moderate Pitfalls

Issues that cause significant rework or degraded quality but not full rewrites.

---

### Pitfall 5: JSONB Messages Array Performance Cliff

**What goes wrong:** The existing `chat_sessions.messages` JSONB array append pattern (`messages = chat_sessions.c.messages + [message]`) requires PostgreSQL to read, decompress, append, recompress, and rewrite the entire TOAST value. Roleplay conversations are 15-40 messages vs 3-6 for tutor chats, hitting the TOAST performance cliff sooner.

**Why it happens:** Pattern was designed for short tutor interactions. A 20-turn roleplay could reach 50-100KB, well past PostgreSQL's 2KB TOAST threshold where updates become 2-10x slower.

**Consequences:** Latency grows linearly with conversation length. Users notice at turn 10+. Concurrent roleplays compound the problem.

**Prevention:**
- Phase 1 (pragmatic): Keep JSONB, set hard cap (e.g., 30 messages = 15 turns). Monitor P95 query time.
- Phase 2 (if needed): Normalize to a `chat_messages` table with `(session_id, sequence_number, role, content, metadata, created_at)`.
- The cap is acceptable because roleplay scenarios should have defined end conditions anyway (see Pitfall 4).

**Detection:** If P95 on `add_chat_message` exceeds 200ms, you've hit the cliff.

**Phase:** Phase 1 sets cap. Phase 2 normalizes if needed.

---

### Pitfall 6: Voice-in-Chat Latency Destroys Conversational Flow

**What goes wrong:** The existing voice pipeline (record -> stop -> upload full blob -> Whisper API -> return text -> user sends -> LLM streams) adds 3-8 seconds of dead time per turn. This works for AnswerBox (one-shot) but breaks conversational roleplay flow.

**Why it happens:** `useVoiceRecording` was designed for single-answer recording. Research shows >800ms delay breaks conversational flow.

**Consequences:** Total turn latency 5-12 seconds. Users abandon voice input.

**Prevention:**
- Phase 1: Reuse `useVoiceRecording` as-is. Add auto-send after transcription (skip manual send step). Display "Transcribing..." prominently. Use UI copy "Voice messages" not "Voice chat." Accept the limitation.
- Phase 2 (if voice adoption is high): Streaming STT (Deepgram/AssemblyAI) with VAD auto-send, cutting perceived latency to ~1-2 seconds.

**Detection:** Time full loop from stop-recording to first LLM token. If >5s consistently, users will abandon voice.

**Phase:** Phase 1 accepts latency. Phase 2 improves if needed.

---

### Pitfall 7: Assessment of Roleplay is Fundamentally Different from Question Assessment

**What goes wrong:** Applying the existing `question_assessments` pattern (single LLM call with rubric to score an answer) to roleplay produces shallow assessments. Roleplay quality depends on progression, adaptation, and consistency across the full dialogue arc.

**Why it happens:** Existing assessment was designed for "Here is a question. Here is the answer. Score it." Roleplay needs "Here is a 15-turn conversation. Did the student demonstrate X, Y, Z across the full dialogue?"

**Consequences:** Assessments miss conversation arc. Standard rubrics don't capture dialogue skills. Content authors write rubrics assuming single-answer format.

**Prevention:**
- Design roleplay-specific assessment receiving FULL conversation transcript
- Use a clean, readable transcript format for scoring:
  ```
  STUDENT: [message]
  DR. CHEN: [message]
  STUDENT: [message]
  ```
- Use character name (not "ASSISTANT") for clarity. Include scenario at top.
- Create roleplay-specific rubric format with dialogue criteria (adapted arguments, asked clarifying questions, etc.)
- Run assessment as separate LLM call after conversation ends, with higher thinking effort
- Store assessments linked to chat session, not question_responses
- **Keep `assessmentInstructions` separate from character `instructions`** -- the former goes to the scorer, the latter to the character. If assessment instructions leak into the character prompt, the AI references the rubric during conversation ("Let me assess your understanding..."), breaking immersion.

**Detection:** If assessment scores don't correlate with human judgment of conversation quality, reassess the framework.

**Phase:** Phase 1 defers assessment (just capture transcripts). Phase 2 adds assessment.

---

### Pitfall 8: Content Authors Write Bad Character Prompts

**What goes wrong:** Content authors (AI safety educators, not prompt engineers) write character definitions that are too vague, too long, or contradictory. The AI produces generic or inconsistent behavior.

**Why it happens:** The existing `instructions` field is free-text. Tutor instructions like "Discuss key concepts" work because the tutor role is simple. Roleplay characters need structured specification.

**Consequences:** Characters feel generic. Different students get wildly different behaviors. Authors blame the platform.

**Prevention:**
- Define structured character card schema in content markdown:
  ```yaml
  character:
    name: "Dr. Sarah Chen"
    role: "AI Safety Researcher at DeepMind"
    personality: "Cautious, methodical, skeptical of rapid deployment"
    knowledge: "Deep alignment research, limited policy knowledge"
    speech-style: "Academic but warm, uses analogies, probing questions"
    never: "Never agrees current AI is safe enough to deploy widely"
  scenario: "Student proposes deploying an AI system"
  objectives:
    - "Challenge safety testing methodology"
    - "Probe whether student considered distributional shift"
  ```
- Provide character testing tool (existing promptlab route)
- Add content validation checking required character card fields
- Ship 2-3 example character cards as templates
- Set token budget for character cards (500-800 tokens max)

**Detection:** If authors consistently ask "why doesn't my character work right?", the spec needs more structure.

**Phase:** Phase 1 (content format design). Must be decided before content authors start writing.

---

### Pitfall 9: End-of-Conversation Detection is Harder Than It Looks

**What goes wrong:** Simple heuristics (fixed count, time limit) create premature cutoffs or endless conversations. The existing `transition_to_next` tool call pattern doesn't translate well to roleplay.

**Why it happens:** Three approaches each have failure modes:
1. **Fixed count:** Cuts off mid-exchange. Student may need 8 turns or 25.
2. **AI-monitored:** AI calls "conversation_complete" tool. But persona drift makes the AI unreliable at judging completion.
3. **User-initiated:** Student clicks "End." But doesn't know when they've covered enough for assessment.

**Prevention:**
- Hybrid approach: set `minTurns` and `maxTurns` in content. After `minTurns`, show "Wrap up" button. At `maxTurns`, AI delivers closing message and conversation locks.
- Default to `messages:6` (user messages) when not specified.
- Display turn progress: "Turn 5 of ~10" for expectations.
- Always have a hard cap. Do NOT rely solely on AI judgment.
- Opening AI message does NOT count toward user message limit.

**Detection:** If >20% of sessions end at exactly `maxTurns`, the max is too low.

**Phase:** Phase 1 implements min/max turns. Phase 2 adds AI-monitored objectives.

---

## Minor Pitfalls

Issues that cause friction or technical debt but are recoverable.

---

### Pitfall 10: RoleplayBox Duplicating NarrativeChatSection

**What goes wrong:** Developer copies 700 lines of NarrativeChatSection.tsx and modifies them. Two near-identical components drift over time.

**Prevention:** RoleplayBox should WRAP NarrativeChatSection, adding roleplay-specific chrome (character header, end-condition indicator, completion footer). If NarrativeChatSection needs modifications (hiding "Tutor" label), add a prop, don't fork. If composition becomes too constrained, extract a shared base component.

**Phase:** Phase 1 (frontend component).

---

### Pitfall 11: Test Section Completion Flow Mismatch

**What goes wrong:** TestSection.tsx assumes all assessable items complete via single submission (AnswerBox pattern). Roleplay completes when end-condition is met (multi-turn). TestSection advances to next item before roleplay finishes.

**Prevention:** Both QuestionSegment and RoleplaySegment expose an `onComplete` callback. TestSection waits for `onComplete` regardless of type. For questions, it fires on Submit. For roleplay, it fires when backend signals `roleplay_end`. TestSection doesn't need to know the difference.

**Phase:** Phase 2. Get standalone roleplay working first.

---

### Pitfall 12: System Prompt Token Budget Explosion

**What goes wrong:** Character card + scenario + objectives + context + reinforcement + 20-turn history approaches context window limits or incurs high LLM costs.

**Prevention:** Token budget for character cards (500-800 tokens). Truncate/summarize early history after 10+ turns. Use `thinking` with `effort: "low"` (already default). Monitor costs.

**Phase:** Phase 2 optimization.

---

### Pitfall 13: Missing End-Condition Default

**What goes wrong:** Content author writes roleplay without `end-condition` field. Conversation runs indefinitely.

**Prevention:** Parser applies default `messages:6`. Document the default.

**Phase:** Phase 1 (content parsing).

---

### Pitfall 14: Roleplay Conversations Not Filterable for Facilitator Review

**What goes wrong:** Facilitators want to review roleplay transcripts but they are stored identically to tutor chats with no way to filter.

**Prevention:** The `content_type = "roleplay"` distinction and `segment_key` (from Pitfall 3) enables filtering. Store character name in session. Build facilitator API endpoint in Phase 2.

**Phase:** Phase 1 data model supports it. Phase 2 builds the UI.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|---|---|---|
| Type system / data model | Pitfall 1 (type conflicts), Pitfall 3 (session isolation) | New segment type, segment_key column, Alembic migration |
| Content format | Pitfall 8 (bad prompts), Pitfall 13 (no default end-condition) | Structured character card schema, parser defaults |
| Backend prompts | Pitfall 2 (persona drift + tutor contamination) | Separate prompt assembly, no chat.py imports, periodic reinforcement |
| Backend end-conditions | Pitfall 4 (client-side enforcement), Pitfall 9 (heuristic failures) | Backend-authoritative, hybrid min/max, user message count only |
| Chat persistence | Pitfall 5 (JSONB perf) | Message cap for Phase 1, normalize in Phase 2 |
| Voice input | Pitfall 6 (latency) | Reuse hook, add auto-send, honest UI labeling |
| Assessment | Pitfall 7 (wrong pattern) | Defer to Phase 2, capture transcripts in Phase 1 |
| Frontend | Pitfall 10 (component duplication) | Compose over NarrativeChatSection, don't fork |
| Test integration | Pitfall 11 (completion flow) | Defer to Phase 2, use onComplete callback pattern |

---

## Sources

- [PostgreSQL JSONB TOAST performance cliffs](https://pganalyze.com/blog/5mins-postgres-jsonb-toast) - MEDIUM confidence
- [PostgreSQL JSONB bottlenecks](https://www.metisdata.io/blog/how-to-avoid-performance-bottlenecks-when-using-jsonb-in-postgresql) - MEDIUM confidence
- [LLM persona drift research](https://github.com/Neph0s/awesome-llm-role-playing-with-persona) - MEDIUM confidence
- [AI character prompts and consistency](https://www.jenova.ai/en/resources/ai-character-prompts) - MEDIUM confidence
- [LLMs get lost in multi-turn conversation (39% drop)](https://arxiv.org/pdf/2505.06120) - HIGH confidence (arxiv)
- [The 300ms rule for voice AI latency](https://www.assemblyai.com/blog/low-latency-voice-ai) - MEDIUM confidence
- [Voice AI latency benchmarks](https://www.retellai.com/resources/ai-voice-agent-latency-face-off-2025) - MEDIUM confidence
- [RUBICON: rubric-based evaluation of AI conversations](https://dl.acm.org/doi/10.1145/3664646.3664778) - HIGH confidence (ACM)
- [Multi-turn dialogue assessment survey](https://arxiv.org/html/2504.04717v1) - HIGH confidence (arxiv)
- [Assessing interaction quality in human-AI dialogue](https://www.mdpi.com/2504-4990/8/2/28) - MEDIUM confidence
- Direct codebase analysis:
  - `core/modules/types.py` -- segment type definitions, ChatStage dataclass
  - `core/modules/chat.py` -- tutor prompt patterns, TRANSITION_TOOL, _build_system_prompt
  - `core/modules/prompts.py` -- prompt assembly with base + instructions
  - `core/modules/chat_sessions.py` -- session persistence, JSONB append pattern, claim logic
  - `core/modules/llm.py` -- LLM streaming, provider abstraction
  - `core/tables.py` -- chat_sessions schema, unique constraints, JSONB messages
  - `web_api/routes/module.py` -- event_generator, SSE streaming, segment type detection
  - `web_frontend/src/components/module/NarrativeChatSection.tsx` -- chat UI (710 lines)
  - `web_frontend/src/components/module/TestSection.tsx` -- test state machine, question completion
  - `web_frontend/src/components/module/AnswerBox.tsx` -- question submission pattern
  - `web_frontend/src/hooks/useVoiceRecording.ts` -- voice pipeline, Whisper API integration
  - `web_frontend/src/types/module.ts` -- TypeScript segment/section type definitions
