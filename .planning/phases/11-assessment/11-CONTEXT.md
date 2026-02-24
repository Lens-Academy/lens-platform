# Phase 11: Assessment - Context

**Gathered:** 2026-02-25 (early — from Phase 8 DB design discussion)
**Status:** Not yet planned

<domain>
## Phase Boundary

AI scoring of roleplay transcripts and test section integration. This phase makes roleplay work inside `## Test` sections with post-conversation feedback.

This context was written early during Phase 8 planning to capture DB design decisions that were intentionally deferred to this phase.

</domain>

<decisions>
## Implementation Decisions

(No locked decisions yet — this phase hasn't been through /gsd:discuss-phase)

## Early Design Context (from Phase 8 DB discussion)

The following design thinking emerged during Phase 8's DB schema discussion. These are NOT locked decisions — they're starting points for when this phase is planned.

### question_responses needs restructuring

**Current state (as of Phase 8):**
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

A join table that associates question responses with content entities, mirroring the pattern considered (but not needed) for chat sessions:

```
question_response_content_links
  response_id    FK → question_responses (CASCADE)
  content_type   TEXT    ('module', 'lo', 'lens', 'question', 'test', 'roleplay')
  content_id     TEXT    (UUID)
  PK (response_id, content_type, content_id)
```

This would allow:
- "Was this question part of a test?" → check for a row with `content_type = 'test'` or `content_type = 'lo'`
- "All responses for this LO" → query by `content_type = 'lo'` and the LO UUID
- "All responses in this module" → query by `content_type = 'module'`

**Why it was deferred from Phase 8:**
- `question_responses` has existing production data that would need migration
- The scoring pipeline reads from this table and would need updating
- Phase 8 only touches `chat_sessions`, and the module + optional roleplay relationship was simple enough for columns (no join table needed)

**Why a join table for questions but not for chats:**
Chat sessions have a simple, fixed relationship: always one module, optionally one roleplay. Two columns.
Question responses have a variable relationship: they might be tied to a module + LO + test, or module + lens, or module + page. The number of associations varies, making a join table the cleaner pattern.

Alternatively, questions might also be simple enough for columns — `module_id`, `lo_id` (nullable), `is_test BOOLEAN`. Evaluate when planning this phase.

### Test grouping / test_attempts

**The problem:**
When a student takes a test (a `## Test` section under an LO), they answer multiple questions and potentially do one or more roleplay exercises. Currently there's no concept of a "test attempt" that groups these together.

**Why it matters:**
- Retaking a test: student retakes the same test weeks later. You want "attempt 1" and "attempt 2" as distinct groups.
- Holistic scoring: a test's overall score might consider all questions + roleplay performance together.
- Progress tracking: "this student completed test X on date Y" requires knowing which responses belong to the same sitting.

**Proposed: `test_attempts` table**

```
test_attempts
  attempt_id     PK
  user_id        FK → users
  lo_id          UUID    (which LO/test — the LO UUID identifies the test)
  started_at     TIMESTAMP
  completed_at   TIMESTAMP NULL
```

Then both `question_responses` and `chat_sessions` (roleplay) link to `attempt_id`:
- Via the join table: `content_type = 'test_attempt'`, `content_id = attempt_id`
- Or via a direct FK column on each table: `test_attempt_id FK → test_attempts`

**Open questions:**
- Can a student retake individual questions within a test, or only the whole test?
- If partial retakes are allowed, does each retaken question get a new attempt_id or join the existing one?
- How does this interact with the existing `archived_at` pattern on chat_sessions?

**Why deferred:**
- Requires working roleplay (Phase 10) and test integration to validate the design
- The grouping only matters once scoring is implemented
- Building it speculatively before the conversation and assessment flows exist risks getting the design wrong

### Content tracking philosophy

The platform tracks content completion at multiple granularity levels with different semantics:

**Lenses: complete once, track globally**
- A lens has a UUID, defined as a separate content file, referenced from multiple modules
- Completion is per-lens — once done, it's done everywhere it appears
- "You already completed this lens" even when encountering it in a new module

**Roleplays: intentionally repeated, track each attempt in context**
- The same roleplay exercise (same `id::` UUID) may appear in multiple modules (e.g., "elevator pitch" practiced throughout the course)
- Each occurrence should be done again — it's deliberate practice, not redundant work
- Track both the exercise identity (roleplay UUID) and the module context (module UUID)
- Query by roleplay UUID for progression view ("how did their pitch improve?")
- Query by module UUID for module completion view ("what did they do in Module 5?")

**Questions: may vary by context**
- Same question in a regular section vs a test section has different stakes
- Need to track whether it was a test question (affects scoring, grading, retake rules)

This phase should ensure the data model supports all three patterns cleanly.

### Polymorphic associations vs separate join tables

**Decision from Phase 8 discussion:** Use separate join tables per entity type rather than one unified polymorphic table.

**Rejected: unified `content_associations` table**
```
content_associations
  entity_type   TEXT    ('chat_session', 'question_response')
  entity_id     INTEGER
  content_type  TEXT
  content_id    TEXT
```

**Reason for rejection:** Cannot enforce real foreign key constraints on `entity_id` because Postgres doesn't know which table to check. Referential integrity falls to application code.

**Chosen: separate tables with real FKs**
```
chat_session_content_links     → session_id FK → chat_sessions
question_response_content_links → response_id FK → question_responses
```

Each table has a real FK with CASCADE delete on the entity side. The content side (`content_type`/`content_id`) is unavoidably polymorphic (content lives in markdown, not DB), but at least the entity side is DB-enforced.

Note: Phase 8 ended up not needing the chat_session join table at all (columns were sufficient). But if chat sessions ever need more associations, the `chat_session_content_links` pattern is ready.

</decisions>

<specifics>
## Specific Ideas

(None yet — this phase hasn't been discussed)

</specifics>

<deferred>
## Deferred Ideas

(None yet)

</deferred>

---

*Phase: 11-assessment*
*Context gathered: 2026-02-25 (early, from Phase 8 DB design discussion)*
*Full context gathering via /gsd:discuss-phase still needed before planning*
