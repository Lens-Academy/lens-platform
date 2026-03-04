# Phase 11: Assessment - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

AI scoring of roleplay transcripts and test section integration. This phase makes roleplay work inside `## Test` sections with post-conversation feedback.

</domain>

<decisions>
## Implementation Decisions

### Roleplay assessment storage
- **Separate `roleplay_assessments` table** with FK to `chat_sessions` — does NOT extend or unify with `question_assessments`
- Mirrors `question_assessments` column pattern: `score_data` (JSONB), `model_id`, `prompt_version`, `created_at`
- Multiple assessments per session allowed (no unique constraint on `session_id`) — supports re-scoring if rubrics change
- Assessment triggered after `completed_at` is set on the chat_session
- Transcript source: `messages` JSONB column already on chat_sessions
- Rubric source: `assessment-instructions` from `segment_snapshot` on the chat_session

### Claude's Discretion
- Test attempts grouping (`test_attempts` table design) — evaluate during planning whether this is needed for Phase 11 or can be simpler
- `question_responses` restructuring (join table vs columns for content hierarchy) — evaluate during planning
- Feedback chat session linking — how post-conversation feedback chat connects to the assessment and original session
- Exact `score_data` JSONB schema (score, reasoning, dimensions structure)

</decisions>

## Early Design Context (from Phase 8 DB discussion)

The following design thinking emerged during Phase 8's DB schema discussion. These are starting points — not locked decisions unless listed above.

### question_responses needs restructuring

**Current state:**
The `question_responses` table has:
- `question_id TEXT` — content-derived ID from markdown
- `module_slug TEXT` — which module
- `question_text TEXT` — snapshot of question shown to student
- `assessment_instructions TEXT` — scoring rubric snapshot
- `question_hash TEXT` — SHA-256 for analysis

**What's missing:**
- Whether the question was part of a `## Test` section or a regular `## Lens`/`## Page` section
- Which learning outcome (LO) it belongs to
- Which specific page/lens it was in
- Clean separation between "what was answered" (the question identity) and "where was it answered" (the content hierarchy context)

**Proposed: `question_response_content_links` join table**

```
question_response_content_links
  response_id    FK → question_responses (CASCADE)
  content_type   TEXT    ('module', 'lo', 'lens', 'question', 'test', 'roleplay')
  content_id     TEXT    (UUID)
  PK (response_id, content_type, content_id)
```

Alternatively, questions might be simple enough for columns — `module_id`, `lo_id` (nullable), `is_test BOOLEAN`. Evaluate when planning.

### Test grouping / test_attempts

**The problem:**
When a student takes a test (a `## Test` section under an LO), they answer multiple questions and potentially do one or more roleplay exercises. Currently there's no concept of a "test attempt" that groups these together.

**Why it matters:**
- Retaking a test: "attempt 1" and "attempt 2" as distinct groups
- Holistic scoring: overall score considers all questions + roleplay together
- Progress tracking: "this student completed test X on date Y"

**Proposed: `test_attempts` table**

```
test_attempts
  attempt_id     PK
  user_id        FK → users
  lo_id          UUID    (which LO/test — the LO UUID identifies the test)
  started_at     TIMESTAMP
  completed_at   TIMESTAMP NULL
```

**Open questions:**
- Can a student retake individual questions within a test, or only the whole test?
- If partial retakes are allowed, does each retaken question get a new attempt_id or join the existing one?
- How does this interact with the existing `archived_at` pattern on chat_sessions?

### Content tracking philosophy

**Lenses: complete once, track globally**
- Completion is per-lens — once done, it's done everywhere it appears

**Roleplays: intentionally repeated, track each attempt in context**
- Each occurrence should be done again — deliberate practice
- Track both exercise identity (roleplay UUID) and module context (module UUID)

**Questions: may vary by context**
- Same question in a regular section vs a test section has different stakes
- Need to track whether it was a test question

### Polymorphic associations vs separate join tables

**Decision from Phase 8 discussion:** Use separate join tables per entity type rather than one unified polymorphic table. Real FK constraints on the entity side; content side is unavoidably polymorphic (content lives in markdown, not DB).

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 11-assessment*
*Context gathered: 2026-03-02*
