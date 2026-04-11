# Phase 11: Assessment - Research

**Researched:** 2026-03-02
**Domain:** AI scoring of roleplay transcripts, test section integration, post-conversation feedback
**Confidence:** HIGH

## Summary

Phase 11 adds AI assessment to completed roleplay conversations and makes roleplay work inside test sections. The codebase already has a complete, production-proven assessment pipeline for questions (`core/assessment.py`) that follows the pattern: background task enqueues scoring -> builds prompt from rubric + student content -> calls LiteLLM with structured JSON output -> writes to assessment table. The roleplay assessment follows this same architecture almost exactly, with the key difference being that the "student content" is a multi-turn conversation transcript rather than a single answer text.

The frontend already supports test sections with sequential question reveal, completion detection, and a feedback chat pattern using the existing tutor chat (`NarrativeChatSection`). Roleplay segments already render via `RoleplaySection` in non-test contexts. The core work is: (1) a new `roleplay_assessments` table mirroring `question_assessments`, (2) a scoring function that builds a prompt from the transcript + rubric, (3) triggering scoring when `completed_at` is set, (4) making `TestSection` aware of roleplay segments alongside question segments, and (5) wiring a feedback chat that uses the assessment results.

**Primary recommendation:** Mirror the existing `assessment.py` pattern exactly for roleplay scoring. Reuse `TestSection`'s state machine by extending it to track roleplay segment completion alongside question completion. Use the existing `NarrativeChatSection` feedback chat pattern from test sections, but seed it with the assessment results instead of question/answer pairs.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Separate `roleplay_assessments` table** with FK to `chat_sessions` -- does NOT extend or unify with `question_assessments`
- Mirrors `question_assessments` column pattern: `score_data` (JSONB), `model_id`, `prompt_version`, `created_at`
- Multiple assessments per session allowed (no unique constraint on `session_id`) -- supports re-scoring if rubrics change
- Assessment triggered after `completed_at` is set on the chat_session
- Transcript source: `messages` JSONB column already on chat_sessions
- Rubric source: `assessment-instructions` from `segment_snapshot` on the chat_session

### Claude's Discretion
- Test attempts grouping (`test_attempts` table design) -- evaluate during planning whether this is needed for Phase 11 or can be simpler
- `question_responses` restructuring (join table vs columns for content hierarchy) -- evaluate during planning
- Feedback chat session linking -- how post-conversation feedback chat connects to the assessment and original session
- Exact `score_data` JSONB schema (score, reasoning, dimensions structure)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| LiteLLM | Current (via `core/modules/llm.py`) | LLM provider abstraction | Already used for both chat streaming and question scoring |
| SQLAlchemy Core | Current (via `core/tables.py`) | Database schema + queries | All tables use SQLAlchemy Core (not ORM), consistent pattern |
| Alembic | Current (via `alembic/`) | Database migrations | Standard migration tool, already configured |
| FastAPI | Current | REST endpoints | All routes follow established patterns |
| Pydantic | Current | Request/response validation | Used in all route files |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| asyncio | stdlib | Background task management | Fire-and-forget scoring (same as `enqueue_scoring`) |
| sentry_sdk | Current | Error tracking | Wrap scoring failures |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Background asyncio task | Celery/RQ | Overkill -- existing `enqueue_scoring` pattern works fine for this fire-and-forget use case |
| Structured output via `response_format` | Free-form text + regex parsing | Structured output is already proven in `SCORE_SCHEMA`, no reason to change |

**Installation:** No new dependencies needed. Everything required is already in the stack.

## Architecture Patterns

### Recommended Structure
```
core/
├── assessment.py              # EXISTING -- question scoring (pattern to mirror)
├── roleplay_assessment.py     # NEW -- roleplay transcript scoring
├── tables.py                  # MODIFY -- add roleplay_assessments table
└── modules/
    └── chat_sessions.py       # EXISTING -- complete_chat_session() is the trigger point

web_api/routes/
├── roleplay.py               # MODIFY -- trigger scoring on complete, add score retrieval
└── questions.py               # EXISTING -- reference pattern for score endpoints

web_frontend/src/
├── components/module/
│   ├── TestSection.tsx        # MODIFY -- handle roleplay segments in test flow
│   └── RoleplaySection.tsx    # MODIFY -- show assessment results after completion
├── api/
│   └── roleplay.ts           # MODIFY -- add score retrieval endpoint
└── hooks/
    └── useUnifiedRoleplay.ts  # POSSIBLY MODIFY -- assessment result awareness
```

### Pattern 1: Fire-and-Forget Background Scoring (Existing Pattern)
**What:** Scoring runs as a background asyncio task, not blocking the HTTP response
**When to use:** Always, for roleplay assessment -- same as question assessment
**Example (from `core/assessment.py`):**
```python
# core/assessment.py lines 80-93
def enqueue_scoring(response_id: int, question_context: dict) -> None:
    task = asyncio.create_task(
        _score_response(response_id, question_context),
        name=f"score-{response_id}",
    )
    _running_tasks.add(task)
    task.add_done_callback(_task_done)
```

The roleplay equivalent follows the same pattern but passes `session_id` and transcript data instead of `response_id` and answer text.

### Pattern 2: Structured LLM Output via JSON Schema (Existing Pattern)
**What:** LiteLLM's `response_format` parameter forces JSON output matching a schema
**When to use:** All scoring calls
**Example (from `core/assessment.py` lines 39-77):**
```python
SCORE_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "assessment_score",
        "schema": {
            "type": "object",
            "properties": {
                "overall_score": {"type": "integer", "description": "1-5 scale"},
                "reasoning": {"type": "string", "description": "2-3 sentence explanation"},
                "dimensions": {"type": "array", "items": {...}},
                "key_observations": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["overall_score", "reasoning"],
            "additionalProperties": False,
        },
    },
}
```

### Pattern 3: Trigger Scoring on Completion (Existing Pattern)
**What:** Scoring is triggered when a response is marked complete, not on every save
**When to use:** In the `complete_roleplay` endpoint after `complete_chat_session()` succeeds
**Example (from `web_api/routes/questions.py` lines 259-270):**
```python
# Trigger AI scoring when response is completed
if body.completed_at and body.completed_at not in ("", "null"):
    enqueue_scoring(
        response_id=row["response_id"],
        question_context={...},
    )
```

For roleplay, the trigger point is `POST /api/chat/roleplay/{session_id}/complete`.

### Pattern 4: Test Section State Machine (Existing Pattern)
**What:** `TestSection.tsx` manages `not_started -> in_progress -> completed` states with sequential segment reveal
**When to use:** Extend to handle roleplay segments alongside question segments
**Current limitation:** Only tracks `QuestionSegment` types. Needs to also track `RoleplaySegment` completion.
**Key code (from `TestSection.tsx` lines 61-69):**
```tsx
const questions: QuestionInfo[] = useMemo(() => {
  const result: QuestionInfo[] = [];
  section.segments.forEach((seg, idx) => {
    if (seg.type === "question") {
      result.push({ segment: seg as QuestionSegment, segmentIndex: idx });
    }
  });
  return result;
}, [section.segments]);
```

This needs to become a unified list of "assessable segments" (questions + roleplays).

### Pattern 5: Feedback Chat After Test Completion (Existing Pattern)
**What:** When a test section has `feedback: true`, completing all questions triggers a `NarrativeChatSection` with the questions and answers seeded as the first message
**When to use:** ASMNT-03 extends this to roleplay assessments
**Key code (from `Module.tsx` lines 1308-1323):**
```tsx
onFeedbackTrigger={
  section.feedback
    ? (questionsAndAnswers) => {
        setActiveFeedbackKey(feedbackKey);
        handleSendMessage(
          `I just completed a test. Here are the questions...\n\n${lines.join("\n\n")}`,
          sectionIndex,
          0,
        );
      }
    : undefined
}
```

For roleplay, the seeded message would include the assessment score + reasoning instead of question/answer pairs.

### Anti-Patterns to Avoid
- **Unified polymorphic assessment table:** The user explicitly decided against this. Keep `roleplay_assessments` separate from `question_assessments`.
- **Blocking scoring in the complete endpoint:** Scoring takes seconds. The endpoint must return immediately and score in background.
- **Storing transcript separately:** The transcript is already in `chat_sessions.messages`. Do NOT duplicate it into the assessment table.
- **Complex test_attempts tracking:** For Phase 11, test completion is already tracked via `user_content_progress` with `content_type="test"`. Adding `test_attempts` creates complexity without clear benefit at this stage.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| LLM structured output | Custom JSON parsing/validation | LiteLLM `response_format` with `json_schema` | Already proven, handles retries and format enforcement |
| Background task management | Custom task queue | `asyncio.create_task` with `_running_tasks` set | Existing pattern in `assessment.py`, works reliably |
| Transcript formatting | Custom serializer | Simple message iteration (`"\n".join(...)`) | Transcripts are already structured as `[{"role": "user", "content": "..."}, ...]` |
| Token counting for long transcripts | Manual counting | LiteLLM handles context window limits | Provider handles truncation; if needed later, `tiktoken` is available |

**Key insight:** The entire assessment pipeline already exists for questions. The roleplay variant is a prompt change + data source change, not an architecture change.

## Common Pitfalls

### Pitfall 1: segment_snapshot Not Being Populated
**What goes wrong:** The `segment_snapshot` column on `chat_sessions` exists but is currently NOT populated by either the SSE roleplay endpoint or the WebSocket endpoint. The assessment needs `assessment-instructions` from this snapshot.
**Why it happens:** Phase 10 focused on conversation, not assessment. The `segment_snapshot` parameter is accepted by `get_or_create_chat_session()` but the callers don't pass it.
**How to avoid:** Before assessment can work, the roleplay endpoints (both REST and WebSocket) must populate `segment_snapshot` with the roleplay segment data when creating a session. This includes `assessment-instructions`, `content`, `ai-instructions`, and `opening-message`.
**Warning signs:** Assessment scoring fails silently because rubric is None.

### Pitfall 2: Long Transcripts Exceeding Context Windows
**What goes wrong:** A roleplay conversation could be 50+ turns. With verbose model responses, this could exceed the scoring model's context window.
**Why it happens:** Question assessment works with short single-answer texts. Roleplay transcripts are much longer.
**How to avoid:** Use a model with sufficient context (Claude Sonnet at 200K context is fine). Consider a max_tokens limit or transcript truncation as a safety valve if transcripts get extremely long. Log token counts for monitoring.
**Warning signs:** LiteLLM errors with context length exceeded.

### Pitfall 3: TestSection Only Tracking Questions
**What goes wrong:** `TestSection.tsx` uses `questions: QuestionInfo[]` which filters to `seg.type === "question"` only. Roleplay segments in a test section would be invisible.
**Why it happens:** TestSection was built before roleplay existed in test sections.
**How to avoid:** Refactor TestSection to track a unified list of "assessable items" (questions + roleplays), each with their own completion tracking mechanism.
**Warning signs:** Roleplay segments in test sections don't appear or don't block test completion.

### Pitfall 4: Feedback Chat Confusion Between Tutor and Assessment
**What goes wrong:** The test feedback chat uses the shared tutor chat state (`messages`, `sendMessage` from Module.tsx). Adding roleplay assessment feedback that uses a different chat mechanism could conflict.
**Why it happens:** Module.tsx has one shared chat state for all tutor/feedback interactions.
**How to avoid:** The roleplay feedback chat should either: (a) reuse the same NarrativeChatSection pattern, seeding the conversation with assessment results, or (b) be a separate read-only display (simpler). The ASMNT-03 requirement says "post-conversation feedback chat to reflect on their performance" -- this implies interactive chat, not just display.
**Warning signs:** Feedback chat messages from question tests and roleplay tests mix together.

### Pitfall 5: Race Condition Between Completion and Scoring
**What goes wrong:** Student clicks "End Conversation", assessment is triggered, but then immediately opens feedback chat which needs the assessment results that haven't finished yet.
**Why it happens:** Assessment scoring is async (takes 2-5 seconds). Feedback chat triggers immediately after completion.
**How to avoid:** The feedback chat should either: (a) poll for assessment results before seeding the conversation, or (b) start the feedback conversation without the score and append it when available, or (c) show a brief "Assessing your conversation..." loading state.
**Warning signs:** Feedback chat starts without any assessment context.

## Code Examples

### Roleplay Assessment Table Definition
```python
# core/tables.py -- mirrors question_assessments pattern
roleplay_assessments = Table(
    "roleplay_assessments",
    metadata,
    Column("assessment_id", Integer, primary_key=True, autoincrement=True),
    Column(
        "session_id",
        Integer,
        ForeignKey("chat_sessions.session_id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("score_data", JSONB, nullable=False),
    Column("model_id", Text, nullable=True),
    Column("prompt_version", Text, nullable=True),
    Column("created_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Index("idx_roleplay_assessments_session_id", "session_id"),
)
```

### Transcript Formatting for Scoring Prompt
```python
def format_transcript(messages: list[dict]) -> str:
    """Format chat_sessions.messages for the scoring prompt."""
    lines = []
    for msg in messages:
        role = msg.get("role", "unknown")
        content = msg.get("content", "")
        if role == "user":
            lines.append(f"Student: {content}")
        elif role == "assistant":
            lines.append(f"Character: {content}")
    return "\n\n".join(lines)
```

### Roleplay Scoring Prompt Assembly
```python
ROLEPLAY_ASSESSMENT_SYSTEM_PROMPT = (
    "You are a rigorous educational assessor evaluating a student's "
    "performance in a roleplay scenario. Score the student's responses "
    "against the rubric based on the full conversation transcript. "
    "Measure actual understanding and skill demonstrated, not effort."
)

def build_roleplay_scoring_prompt(
    *,
    transcript: str,
    assessment_instructions: str,
    scenario_context: str | None = None,
) -> tuple[str, list[dict]]:
    system = ROLEPLAY_ASSESSMENT_SYSTEM_PROMPT
    if assessment_instructions:
        system += f"\n\nScoring Rubric:\n{assessment_instructions}"
    if scenario_context:
        system += f"\n\nScenario Context:\n{scenario_context}"

    messages = [
        {
            "role": "user",
            "content": (
                f"Full conversation transcript:\n\n{transcript}\n\n"
                "Score this student's performance according to the rubric."
            ),
        }
    ]
    return system, messages
```

### Triggering Assessment on Completion
```python
# In web_api/routes/roleplay.py complete_roleplay endpoint:
async def complete_roleplay(session_id: int, ...):
    async with get_connection() as conn:
        session = await get_chat_session(conn, session_id=session_id)
        # ... ownership check ...
        await complete_chat_session(conn, session_id=session_id)

    # Trigger assessment if rubric exists
    snapshot = session.get("segment_snapshot") or {}
    if snapshot.get("assessmentInstructions") or snapshot.get("assessment-instructions"):
        enqueue_roleplay_scoring(
            session_id=session_id,
            messages=session.get("messages", []),
            segment_snapshot=snapshot,
        )

    return {"status": "completed"}
```

## Discretion Area Analysis

### test_attempts Table: NOT Needed for Phase 11

**Recommendation:** Skip `test_attempts` for Phase 11. Here is the reasoning:

Current state:
- Test completion is tracked in `user_content_progress` with `content_type="test"` and a synthetic `content_id` (`test:{moduleSlug}:{sectionIndex}`)
- Individual question responses are tracked in `question_responses` with their own `created_at` timestamps
- Roleplay sessions are tracked in `chat_sessions` with `completed_at`

What `test_attempts` would add:
- Grouping multiple responses into a single "attempt"
- Distinguishing "attempt 1" vs "attempt 2"
- A holistic score across all items in an attempt

Why skip for Phase 11:
- The current `user_content_progress` already tracks whether the test is complete
- Retaking is already handled by creating new responses/sessions
- Holistic cross-item scoring is not a Phase 11 requirement
- Adding `test_attempts` would require significant refactoring of both `TestSection.tsx` and the question response flow

**Future work:** If "attempt 1 vs attempt 2" becomes a product need, add `test_attempts` in a later phase. The data exists to reconstruct attempts retroactively from timestamps.

### question_responses Restructuring: NOT Needed for Phase 11

**Recommendation:** Skip restructuring for Phase 11.

The `question_responses` table works as-is for questions in test sections. The missing context (which LO, whether it's a test question) can be derived from the `question_id` format (`moduleSlug:sectionIndex:segmentIndex`) at query time by resolving against the content cache.

Roleplay assessment goes into a completely separate table (`roleplay_assessments` -> `chat_sessions`), so the question_responses structure is irrelevant to the roleplay assessment path.

### Feedback Chat Linking

**Recommendation:** Reuse the existing tutor chat feedback pattern.

The current test feedback works by:
1. Test completes -> `onFeedbackTrigger` fires
2. A message is sent to the tutor chat with questions and answers
3. `NarrativeChatSection` renders below the test with the AI's feedback

For roleplay assessment feedback:
1. Roleplay completes -> assessment runs in background
2. After assessment, student sees results + a "Discuss your performance" button
3. Clicking opens a feedback chat (using `NarrativeChatSection`) seeded with the assessment score, reasoning, and key observations
4. The tutor chat (not the roleplay character) provides the feedback

This is the simplest approach that meets ASMNT-03. The feedback chat is NOT a new roleplay session -- it's a standard tutor chat interaction where the student can ask questions about their score.

**Implementation detail:** The feedback message could be seeded like:
```
"I just completed a roleplay exercise. Here are my results:
Score: 4/5
Reasoning: [from assessment]
Key observations: [from assessment]

Can you help me understand how to improve?"
```

### score_data JSONB Schema

**Recommendation:** Reuse the existing `SCORE_SCHEMA` from `core/assessment.py`.

The schema already supports:
- `overall_score` (integer, 1-5) -- required
- `reasoning` (string, 2-3 sentences) -- required
- `dimensions` (array of {name, score, note}) -- optional
- `key_observations` (array of strings) -- optional

This works well for roleplay assessment too. The `dimensions` field naturally accommodates roleplay-specific criteria like "stayed in character", "demonstrated understanding of alignment concepts", "asked probing questions", etc.

No changes to the schema needed. The rubric author controls what dimensions appear via their `assessment-instructions` text.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No roleplay assessment | Separate `roleplay_assessments` table | Phase 11 (new) | Clean separation from question assessment |
| Test sections: questions only | Test sections: questions + roleplay | Phase 11 (new) | TestSection needs refactoring |
| Feedback chat: questions only | Feedback chat: questions + roleplay assessment | Phase 11 (new) | Feedback seeding message changes |

**Not changing:**
- `SCORE_SCHEMA` structure
- LiteLLM calling pattern
- Background task pattern
- `segment_snapshot` column (exists, just needs to be populated)

## Open Questions

1. **What happens when a roleplay in a test section has no `assessment-instructions`?**
   - What we know: Roleplay segments can exist without `assessment-instructions` (it's optional per the content schema)
   - What's unclear: Should a roleplay without a rubric still count as "completed" in a test section? Probably yes -- completion is separate from assessment
   - Recommendation: Track completion via `completed_at` on the session regardless. Only trigger scoring if `assessment-instructions` exists.

2. **How does the student see their assessment results in the UI?**
   - What we know: ASMNT-03 says "post-conversation feedback chat available after assessment"
   - What's unclear: Is there also a static score display (like a card showing "4/5")? Or only the feedback chat?
   - Recommendation: Show a brief score summary card (score + reasoning) after completion, with a "Discuss" button that opens the feedback chat. The card is visible even without clicking to chat.

3. **Timing of assessment in test sections with multiple items**
   - What we know: A test section might have 3 questions + 1 roleplay. The test is "complete" when all items are complete.
   - What's unclear: Should the roleplay assessment finish before the test feedback triggers? Or does the test feedback only cover questions (and roleplay has its own feedback)?
   - Recommendation: Roleplay assessment is independent from question assessment. In a test section, the overall test feedback covers questions only (existing pattern). Roleplay gets its own inline assessment display + optional feedback chat. This keeps the patterns clean and avoids blocking on async scoring.

## Sources

### Primary (HIGH confidence)
- `core/assessment.py` -- Complete question scoring pipeline (pattern to mirror)
- `core/tables.py` -- Database schema, `chat_sessions`, `question_assessments` tables
- `core/modules/llm.py` -- LiteLLM integration with `complete()` and `stream_chat()`
- `core/modules/chat_sessions.py` -- Session lifecycle (get_or_create, complete, archive)
- `web_api/routes/roleplay.py` -- REST endpoints for roleplay
- `web_api/routes/roleplay_ws.py` -- WebSocket endpoint for roleplay
- `web_api/routes/questions.py` -- Question scoring trigger pattern
- `web_frontend/src/components/module/TestSection.tsx` -- Test state machine
- `web_frontend/src/components/module/RoleplaySection.tsx` -- Current roleplay UI
- `web_frontend/src/views/Module.tsx` -- Test feedback integration
- `content_processor/src/content-schema.ts` -- Content field definitions
- `content_processor/src/flattener/index.ts` -- Test section construction (lines 447-489)

### Secondary (MEDIUM confidence)
- `.planning/phases/11-assessment/11-CONTEXT.md` -- User decisions and early design context
- `.planning/phases/10-core-conversation/10-CONTEXT.md` -- Phase 10 decisions (predecessor)
- `.planning/ROADMAP.md` -- Requirements ASMNT-01, ASMNT-02, ASMNT-03
- `.planning/STATE.md` -- Current project state and accumulated decisions

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All libraries already in use, no new dependencies
- Architecture: HIGH -- Mirrors existing question assessment pattern exactly
- Pitfalls: HIGH -- Identified from direct code analysis of existing implementations
- Discretion areas: HIGH -- Recommendations based on concrete codebase understanding

**Research date:** 2026-03-02
**Valid until:** 2026-04-01 (stable domain -- no external library changes expected)
