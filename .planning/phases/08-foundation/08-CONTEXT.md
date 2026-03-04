# Phase 8: Foundation - Context

**Gathered:** 2026-02-24
**Updated:** 2026-02-25 (DB design discussion)
**Status:** Plans need update

<domain>
## Phase Boundary

Roleplay segments are parseable from content markdown, sessions are isolated per segment, and the prompt architecture supports roleplay alongside existing chat. `#### Roleplay` is a new segment type at the same level as `#### Chat` and `#### Question`, using the same `::` field syntax and parser infrastructure.

</domain>

<decisions>
## Implementation Decisions

### Content syntax
- `#### Roleplay` is a segment type, not a section type — same H4 level as Chat, Question, Text
- Valid in all Lens section types: page, lens-article, lens-video
- Also valid inside `## Test` sections alongside `#### Question` and `#### Text`
- Parser support for both Lens and Test sections added in this phase (assessment logic in Phase 11)

### Segment fields
- `id::` — **required**, UUID, stable identity for session isolation (follows the same UUID pattern used by pages, modules, and LOs in the content system)
- `content::` — student-facing scenario briefing (what the student sees before/during roleplay)
- `ai-instructions::` — AI character behavior: personality, conversation rules, tone, scenario context (replaces the previously proposed `character::` field)
- `opening-message::` — optional, the AI character's first message to start the conversation
- `assessment-instructions::` — optional, for AI scoring when roleplay is inside a test section (same pattern as questions)

### Prompt architecture
- No separate `character::` field — everything about the character goes in `ai-instructions::`
- Prompt assembly follows the same pattern as chat (base prompt + instructions + context) but with roleplay-specific framing
- TTS/STT pipeline is a separate transport concern (Phase 9) and does not affect prompt assembly

### Database design (chat_sessions)

#### Schema changes
- **Rename** `content_id` → `module_id` (it was always a module UUID; make that explicit)
- **Drop** `content_type` column and its CHECK constraint (redundant — chat sessions are always tied to a module)
- **Add** `roleplay_id UUID NULL` — NULL for tutor chat, the roleplay's `id::` UUID for roleplay sessions
- **Add** `segment_snapshot JSONB NULL` — snapshot of roleplay content fields (`content`, `ai_instructions`) at session creation time, for historical lookup ("what did this student actually interact with 6 months ago?")

#### Uniqueness constraints (partial unique indexes)
- Tutor chat: `UNIQUE (user_id, module_id) WHERE roleplay_id IS NULL AND archived_at IS NULL` — one active tutor chat per user per module
- Roleplay: `UNIQUE (user_id, module_id, roleplay_id) WHERE roleplay_id IS NOT NULL AND archived_at IS NULL` — one active roleplay session per user per module per roleplay exercise
- Same pair of indexes for `anonymous_token` variant
- Multiple archived sessions allowed (supports "clear history and restart")

#### Roleplay reuse across modules
- The same roleplay (same `id::` UUID) can appear in multiple modules (e.g., "elevator pitch" exercise repeated throughout the course)
- Each occurrence creates a separate session because `module_id` differs
- Query by `roleplay_id` to see progression across the course
- Query by `module_id` to see what the student did in a specific module
- This is intentionally different from lenses (complete once, tracked globally) — roleplays are meant to be repeated

#### Content versioning strategy
- `segment_snapshot` captures the `content::` and `ai_instructions::` fields at session creation time
- This handles the UUID stability concern: if a course creator rewrites a roleplay but keeps the same UUID, historical sessions still record what the student actually interacted with
- Future enhancement (not Phase 8): hash-based dedup with a `content_versions` lookup table if snapshot storage becomes a concern at scale. For now, inline JSONB is fine.

#### What this phase does NOT do
- Does NOT add a join table for chat sessions — the module + optional roleplay relationship is simple enough for columns
- Does NOT restructure `question_responses` — that table keeps its current schema for now (see Phase 11 context for future plans)
- Does NOT add test grouping / `test_attempts` table — deferred to Phase 11

### Claude's Discretion
- Whether to create separate `roleplay.py` or extend shared prompt assembly machinery (consider that chat and roleplay use the same assembly pattern with different inputs)
- Module viewer rendering for roleplay segments before full conversation UI (Phase 10) — minimal placeholder that proves parsing works
- Opening message behavior — verbatim vs AI-guided generation from the field
- Error handling for malformed roleplay blocks
- Migration strategy for existing `content_id`/`content_type` data (rename column vs add new + migrate + drop old)

</decisions>

<specifics>
## Specific Ideas

- "I want a separate UI page for testing, where I can input text, and then get both AI text and audio streamed to me, so I can see the latency until text and the latency to audio, and the speeds" — this maps to Phase 9's test harness but captures the user's vision for what that looks like
- The audio processing pipeline with STT will be quite different from prompt assembly — keep those concerns separate
- Follow existing patterns: roleplay fields use `::` syntax, segment parsing uses the same `parseSegments()` infrastructure, schema validation uses the same `content-schema.ts` approach
- Roleplay `id::` uses UUIDs following the existing content system pattern (pages, modules, LOs all use UUIDs)

</specifics>

<deferred>
## Deferred Ideas

- **Join table for chat sessions** — considered (`chat_session_content_links` with `content_type`/`content_id` rows) but rejected for now. The module + optional roleplay relationship is only 2 columns, not a many-to-many problem. Can migrate to join table later if more associations are needed.
- **`question_response_content_links` join table** — see Phase 11 context. Question responses need restructuring to track test membership, LO association, etc. Deferred because it touches existing production data and the scoring pipeline.
- **`test_attempts` grouping table** — see Phase 11 context. Groups question responses and roleplay sessions that belong to the same test-taking session. Needed for "retake test" and holistic test scoring. Deferred to Phase 11 (Assessment).
- **Content hash dedup** — `content_versions` table that deduplicates `segment_snapshot` data via content hashing. Not needed at current scale; inline JSONB snapshots are fine for now.

</deferred>

---

*Phase: 08-foundation*
*Context gathered: 2026-02-24*
*Updated: 2026-02-25 — DB design decisions from discussion*
