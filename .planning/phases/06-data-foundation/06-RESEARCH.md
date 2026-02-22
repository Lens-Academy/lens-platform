# Phase 6: Data Foundation - Research

**Researched:** 2026-02-14
**Domain:** Database schema design, API endpoints, Obsidian markdown content parsing for assessment data
**Confidence:** HIGH

## Summary

Phase 6 adds the data layer for assessments: database tables to store student responses and AI scores, API endpoints to submit/query that data, and content parsing to extract `## Test:` sections and `#### Question` / `#### Chat` blocks from Obsidian markdown. This is purely backend -- no frontend components.

The existing codebase provides clear patterns for every aspect of this work. The database uses SQLAlchemy Core (not ORM) with asyncpg and Alembic migrations. Content parsing is split between a TypeScript processor (structural parsing, flattening, validation) and a Python layer (serving cached data via FastAPI). API routes follow FastAPI conventions with JWT/anonymous-token dual auth. All of these patterns are well-established and should be followed directly.

The two plans split naturally: Plan 06-01 is the database schema and Alembic migration (tables, indexes, JSONB columns). Plan 06-02 is the API endpoints and TypeScript content processor changes to parse Question/Chat blocks within `## Test:` sections and include them in the flattened module output.

**Primary recommendation:** Follow existing codebase patterns exactly. No new dependencies. Extend the TypeScript content processor to parse new block types. Add two new tables to PostgreSQL. Add 2-3 new API routes.

---

## 1. Database Schema Design

### Existing Patterns (from `core/tables.py`)

The codebase uses SQLAlchemy Core `Table` objects (not ORM mappers) on a shared `MetaData` with naming conventions. Key patterns:

- **Primary keys:** `Integer, primary_key=True, autoincrement=True`
- **Foreign keys:** `ForeignKey("table.column", ondelete="CASCADE")`
- **Timestamps:** `TIMESTAMP(timezone=True)` with `server_default=func.now()`
- **Soft deletes:** `deleted_at` or `archived_at` nullable timestamp columns
- **JSONB:** Already used in `chat_sessions.messages` (JSONB with `server_default="[]"`)
- **UUID:** Used in `user_content_progress.content_id` as `UUID(as_uuid=True)`
- **Dual identity:** Both `user_id` and `anonymous_token` supported throughout, with partial unique indexes
- **Naming convention:** Snake_case table and column names, `idx_` prefix for indexes, `uq_` for unique constraints

### Recommended Schema: `assessment_responses`

This table stores each student answer (one row per response attempt).

```python
assessment_responses = Table(
    "assessment_responses",
    metadata,
    Column("response_id", Integer, primary_key=True, autoincrement=True),
    Column("anonymous_token", UUID(as_uuid=True), nullable=True),
    Column(
        "user_id",
        Integer,
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=True,
    ),
    # What was answered
    Column("question_id", Text, nullable=False),     # Content-derived ID (from markdown)
    Column("module_slug", Text, nullable=False),      # Which module
    Column("learning_outcome_id", Text, nullable=True), # LO UUID if available
    Column("content_id", UUID(as_uuid=True), nullable=True), # Lens UUID if available
    # The answer
    Column("answer_text", Text, nullable=False),
    Column("answer_metadata", JSONB, server_default="{}", nullable=False),  # voice_used, time_taken_s, etc.
    # Timestamps
    Column("created_at", TIMESTAMP(timezone=True), server_default=func.now()),
    # Indexes
    Index("idx_assessment_responses_user_id", "user_id"),
    Index("idx_assessment_responses_anon", "anonymous_token"),
    Index("idx_assessment_responses_question", "question_id"),
    Index("idx_assessment_responses_module", "module_slug"),
)
```

**Design rationale:**

- **`question_id` as Text, not UUID:** Questions are identified by a string derived from content. The CONTEXT.md defers the exact identification mechanism (UUID in markdown vs structural derivation). Using `Text` keeps this flexible. When the team decides the format, no schema change is needed.
- **`module_slug` as Text:** Modules are identified by slug throughout the codebase (not by database ID). Storing the slug directly avoids a join and matches how the API works.
- **`learning_outcome_id` as Text:** LO IDs are UUIDs stored as strings in the content processor output. Nullable because inline questions in lenses may not have a direct LO link yet (open design question).
- **`answer_metadata` as JSONB:** Follows the decision to keep the schema flexible. Can hold `voice_used`, `time_taken_s`, `enforce_voice`, etc. without migrations.
- **No unique constraint on (user, question):** Multiple responses per question are expected (the context says "each response is a separate record" supporting "multiple attempts over days/weeks/months").
- **No `assessment_score` column here:** Scores are in a separate table per DS-02.

### Recommended Schema: `assessment_scores`

This table stores AI-generated scores, linked 1:1 to responses.

```python
assessment_scores = Table(
    "assessment_scores",
    metadata,
    Column("score_id", Integer, primary_key=True, autoincrement=True),
    Column(
        "response_id",
        Integer,
        ForeignKey("assessment_responses.response_id", ondelete="CASCADE"),
        nullable=False,
    ),
    # Score data
    Column("score_data", JSONB, nullable=False),  # Flexible: dimensions, rubric results, etc.
    Column("model_id", Text, nullable=True),      # Which LLM model scored this
    Column("prompt_version", Text, nullable=True), # Version tracking for the scoring prompt
    # Timestamps
    Column("created_at", TIMESTAMP(timezone=True), server_default=func.now()),
    # Indexes
    Index("idx_assessment_scores_response_id", "response_id"),
)
```

**Design rationale:**

- **Separate table:** Keeps responses and scores decoupled. Responses are created synchronously on submission. Scores are created asynchronously by AI (Phase 9). Having them separate means a response can exist without a score, and re-scoring doesn't require updating the response row.
- **`score_data` as JSONB:** Per the decision. Schema will evolve as Phases 7-9 reveal what dimensions/rubrics look like. JSONB allows iteration without migrations.
- **`model_id` and `prompt_version`:** Useful for tracking which model/prompt produced a score. When scoring prompts change, you can distinguish old scores from new ones. Cheap to add now.
- **No `user_id` on scores:** The score links to a response which links to a user. No need for denormalization yet.
- **1:1 with response (not unique constraint):** Initially one score per response, but no unique constraint in case re-scoring is needed later. The query pattern (get latest score for a response) works fine with an index on `response_id`.

### Migration Strategy

Follow the established workflow from `CLAUDE.md`:

1. Add tables to `core/tables.py`
2. Run `alembic revision --autogenerate -m "add assessment_responses and assessment_scores tables"`
3. Review generated migration, verify SQL
4. Walk through with user before running

The migration should be a single revision creating both tables. No data migration needed (new tables with no existing data).

### Claim Pattern for Anonymous-to-Authenticated Transition

The existing `claim_progress_records` and `claim_chat_sessions` functions transfer anonymous data to authenticated users. Assessment responses will need the same pattern:

```python
async def claim_assessment_responses(conn, *, anonymous_token, user_id) -> int:
    """Claim anonymous assessment responses for authenticated user."""
    # Same pattern as claim_progress_records
```

This should be added to the auth flow where the other claim functions are called.

---

## 2. API Endpoint Design

### Existing Patterns (from `web_api/routes/`)

- **Route prefix:** `/api/[resource]` with `APIRouter(prefix=..., tags=[...])`
- **Auth:** `Depends(get_user_or_anonymous)` returns `(user_id | None, anonymous_token | None)`
- **Request models:** Pydantic `BaseModel` classes
- **Error handling:** `raise HTTPException(status_code=..., detail=...)`
- **Database:** `async with get_transaction() as conn:` for writes, `async with get_connection() as conn:` for reads
- **Registration in main.py:** `app.include_router(my_route.router)`

### Recommended Endpoints

**Route file:** `web_api/routes/assessments.py`
**Prefix:** `/api/assessments`

#### POST /api/assessments/responses

Submit a student answer. Called when student submits an answer box.

```python
class SubmitResponseRequest(BaseModel):
    question_id: str           # Identifies the question in content
    module_slug: str           # Which module
    learning_outcome_id: str | None = None
    content_id: str | None = None  # Lens UUID
    answer_text: str
    metadata: dict | None = None  # voice_used, time_taken_s, etc.

class SubmitResponseResponse(BaseModel):
    response_id: int
    created_at: str
```

**Auth:** `Depends(get_user_or_anonymous)` -- supports both authenticated and anonymous users, same as progress tracking.

#### GET /api/assessments/responses

Query responses for the current user. Used by future phases for displaying past answers.

```python
# Query params: module_slug (optional), question_id (optional), limit (default 50)
class ResponseItem(BaseModel):
    response_id: int
    question_id: str
    module_slug: str
    answer_text: str
    created_at: str
    score: dict | None  # Joined from assessment_scores if available
```

**Auth:** `Depends(get_user_or_anonymous)`

#### GET /api/assessments/responses/{question_id}

Get all responses for a specific question by the current user. Useful for Phase 7 (showing previous answers).

These three endpoints satisfy DS-03. The assessment_scores write endpoint is not needed yet (Phase 9 writes scores asynchronously from the backend, not via API), but the read endpoints join scores with responses.

### Where to Place Business Logic

Following the 3-layer architecture:

- **`core/assessments.py`** - Business logic for creating/querying responses and scores
- **`web_api/routes/assessments.py`** - API endpoint definitions, request/response models
- **No discord_bot integration needed** for Phase 6

---

## 3. Content Parsing for Test Sections

### Current Content Architecture

The content processing pipeline works like this:

1. **GitHub content repo** contains Obsidian markdown files organized in directories: `modules/`, `Learning Outcomes/`, `Lenses/`, `articles/`, `video_transcripts/`, `courses/`
2. **TypeScript processor** (`content_processor/src/`) parses all files, resolves references, flattens modules into sections/segments
3. **Python wrapper** (`core/content/typescript_processor.py`) calls the TS processor via subprocess, gets JSON back
4. **Content cache** (`core/content/cache.py`) stores the flattened results in memory
5. **FastAPI** serves cached content via `/api/modules/{slug}`

### Current Parsing Hierarchy

```
Module (.md file with H1 sections)
  # Learning Outcome: title
    -> resolves to LO file
      ## Lens: title -> resolves to Lens file
        ### Article/Video/Page: title (H3 sections)
          #### Text/Chat/Article-excerpt/Video-excerpt (H4 segments)
      ## Test: title  <-- currently parsed but NOT processed
  # Page: title
  # Uncategorized: title
```

The **Learning Outcome parser** (`src/parser/learning-outcome.ts`) already recognizes `## Test:` sections at the LO level. Currently it extracts a `ParsedTestRef` with `source` and `resolvedPath`, but the test content is not parsed further or included in the flattened module output.

### What Needs to Change in the TypeScript Processor

#### A. New Segment Types

The `#### Question` and `#### Chat` blocks inside test sections need to be recognized. The Chat block already exists as a segment type. The Question block is new.

Add to `content-schema.ts`:
```typescript
// In SEGMENT_SCHEMAS:
'question': segmentSchema(
    ['user-instruction'],
    ['assessment-prompt', 'max-time', 'max-chars', 'enforce-voice'],
    ['enforce-voice']
),
```

The naming uses the `key:: value` field pattern already established. Note: Obsidian `%% comment %%` syntax is NOT currently handled by the TypeScript processor -- a preprocessing step to strip these comments will need to be added (see Pitfalls section).

#### B. Test Section Content Files

Currently, LO files have `## Test:` sections with a `source::` pointing to a test file. The test file itself needs to be parsed. Based on the CONTEXT.md decisions, test files contain:

```markdown
#### Question
max-time:: 3:00
max-chars:: 1000
enforce-voice:: true
user-instruction::
What's the difference between x and y?

assessment-prompt::
Give the user a score based on dimensions j and k.

#### Chat: Discussion on X-Risk
instructions::
[System instructions for the chat AI]

#### Text
content::
Some static instructional text before a question.
```

This follows the same H4 segment pattern already used in Lens files. The parser for these blocks can reuse `parseSegments` from `src/parser/lens.ts` with an extended set of valid segment types.

#### C. Flattener Changes

The flattener (`src/flattener/index.ts`) currently processes Learning Outcome sections by resolving lens references and creating sections. It needs to also:

1. Resolve the `## Test:` reference in LO files
2. Parse the test file's H4 segments (Question, Chat, Text)
3. Create a new section type (`"test"`) in the flattened output

The test section in the flattened module output would look like:

```json
{
  "type": "test",
  "meta": { "title": "Test: Understanding X-Risk" },
  "segments": [
    {
      "type": "question",
      "userInstruction": "What's the difference between x and y?",
      "assessmentPrompt": "Give the user a score based on dimensions j and k.",
      "maxTime": "3:00",
      "maxChars": 1000,
      "enforceVoice": false
    },
    {
      "type": "chat",
      "instructions": "System instructions for discussion..."
    },
    {
      "type": "text",
      "content": "Some static instructional text."
    }
  ],
  "optional": false,
  "contentId": null,
  "learningOutcomeId": "uuid-of-the-lo",
  "learningOutcomeName": "Understanding X-Risk",
  "videoId": null
}
```

#### D. Where Test Sections Appear in Module Output

Test sections inherit their LO context. In the flattened module, they appear after the lens sections for the same LO. The module API already returns sections in order, so test sections will naturally appear at the end of each LO's content.

The `Section` type in `index.ts` needs a new type value:
```typescript
type: 'page' | 'lens-video' | 'lens-article' | 'test';
```

And a new `QuestionSegment` type:
```typescript
interface QuestionSegment {
    type: 'question';
    questionId: string;        // Structural ID for API submissions
    userInstruction: string;
    assessmentPrompt?: string;
    maxTime?: string;
    maxChars?: number;
    enforceVoice?: boolean;
    optional?: boolean;
}
```

The `Segment` union becomes:
```typescript
type Segment = TextSegment | ChatSegment | ArticleExcerptSegment | VideoExcerptSegment | QuestionSegment;
```

### Ensuring Backward Compatibility (Success Criterion 4)

The existing module content (lessons, articles, videos, chat) must continue to work unchanged. This is naturally satisfied because:

- The new `question` segment type only appears inside `test` sections
- The existing `text`, `chat`, `article-excerpt`, `video-excerpt` segment types are unmodified
- The existing `page`, `lens-video`, `lens-article` section types are unmodified
- The new `test` section type is additive -- frontends that don't know about it will ignore it
- The TypeScript parser changes are additive (new segment type registered, new section handling)

The content processor already has comprehensive tests. Adding test cases for the new types follows the existing pattern.

### Python-Side Changes

The Python side needs minimal changes:

1. **`core/content/cache.py`:** The `ContentCache` dataclass stores `flattened_modules` as `dict[str, FlattenedModule]`. The `FlattenedModule.sections` field is `list[dict]` (already generic dicts from the TypeScript processor JSON). No change needed -- the new section type flows through automatically.

2. **`user_content_progress` table check constraint:** Currently `content_type IN ('module', 'lo', 'lens', 'test')`. Already includes `'test'`. No change needed.

3. **`chat_sessions` table check constraint:** Currently `content_type IN ('module', 'lo', 'lens', 'test')`. Already includes `'test'`. No change needed.

4. **Module API response (`web_api/routes/modules.py`):** The `serialize_flattened_module` function passes sections through as dicts. No change needed -- test sections will appear in the response automatically.

---

## 4. Question Identification

The CONTEXT.md notes this as an open design question (UUID in markdown vs derived from structure). For Phase 6, the recommendation is:

**Use a structural derivation for now, with a path to UUIDs later.**

A structural ID could be: `{module_slug}:{lo_id}:{section_index}:{segment_index}` or `{lo_id}:q{n}` (nth question in the LO's test section). This is deterministic, human-readable, and doesn't require content authors to manage UUIDs.

The `question_id` column in `assessment_responses` is `Text`, so it works with any identification scheme. If the team later decides to add explicit UUIDs to question blocks (like lenses have `id:` in frontmatter), the column accommodates that without migration.

For the TypeScript processor output, each question segment should include a `questionId` field that the frontend can use when submitting responses:

```json
{
  "type": "question",
  "questionId": "lo-uuid:q0",
  "userInstruction": "...",
  ...
}
```

---

## 5. Handling Malformed/Missing Test Content

The CONTEXT.md gives discretion on error handling. Recommended approach:

- **Missing test file:** The LO parser already handles missing `source::` references with content errors. A missing test file should produce a warning (not crash the module). The LO's lens sections still render normally.
- **Malformed test blocks:** Follow the existing pattern -- parse what you can, report errors via `ContentError[]`. A malformed Question block (e.g., missing `user-instruction::`) produces an error but doesn't prevent the rest of the test from parsing.
- **Empty test sections:** Warning-level error, same as empty lens sections.
- **Test content in production tier but referenced from WIP:** Follow the existing tier violation system (`validator/tier.ts`).

---

## 6. Plan Structure Recommendations

### Plan 06-01: Database Schema and Migrations

**Scope:**
- Add `assessment_responses` and `assessment_scores` tables to `core/tables.py`
- Generate Alembic migration
- Add `core/assessments.py` with basic CRUD functions (create_response, get_responses_for_user, get_responses_for_question)
- Add claim function for anonymous-to-authenticated transition
- Add tests for the new module

**Files touched:**
- `core/tables.py` (add 2 tables)
- `core/assessments.py` (new file)
- `alembic/versions/` (new migration)
- `core/tests/` (new test file)

**Estimated complexity:** Low. Follows established patterns closely.

### Plan 06-02: API Endpoints and Content Parsing

**Scope:**
- TypeScript content processor: Add `question` segment type to schema, parse Question blocks in test sections, include test sections in flattened output
- Add Obsidian `%% comment %%` stripping to the preprocessing pipeline
- API: Add `web_api/routes/assessments.py` with submit/query endpoints
- Register route in `main.py`
- Tests for both TS parser changes and API endpoints

**Files touched:**
- `content_processor/src/content-schema.ts` (add question segment schema)
- `content_processor/src/index.ts` (add QuestionSegment type)
- `content_processor/src/parser/learning-outcome.ts` (extend test section parsing)
- `content_processor/src/flattener/index.ts` (flatten test sections into module output)
- `content_processor/src/parser/lens.ts` (may extend segment types for inline questions)
- `content_processor/src/validator/segment-fields.ts` (validate question fields)
- `web_api/routes/assessments.py` (new file)
- `main.py` (register router)
- Various test files

**Estimated complexity:** Medium. The TypeScript changes are the most work -- extending the parser and flattener requires understanding the content processing pipeline. The API endpoints follow established patterns.

**Dependency:** Plan 06-02 depends on Plan 06-01 (API endpoints write to the assessment tables).

---

## 7. Risks and Pitfalls

### Critical: Don't Over-Engineer the Schema

The CONTEXT.md explicitly says "keep it flexible with JSONB, don't over-engineer." The temptation is to add normalized tables for rubric dimensions, learning outcome linkages, test contexts, etc. Resist this. The minimal schema (responses + scores with JSONB) is correct for Phase 6. Phases 7-9 will reveal what structure is actually needed.

### Critical: TypeScript Processor Changes Must Not Break Existing Content

The content processor is the single source of truth for all module content. Changes must be additive. Run the full test suite after changes. Add test fixtures for the new block types that mirror real content formatting.

### Moderate: Question ID Stability

If using structural derivation (e.g., index-based), reordering questions in the markdown will change their IDs, orphaning existing response data. Mitigation: document this risk, and when the team decides on the permanent ID strategy, add a migration plan. For Phase 6 with zero existing assessment data, this is not a problem.

### Moderate: Obsidian Comment Syntax

The `%% comment %%` syntax used in the CONTEXT.md question block examples is NOT currently handled by the TypeScript content processor. Searched `content_processor/src/` and found no `%%` handling. The existing content in the vault may not use `%%` comments (or they are ignored because they appear as plain text in field values), but the new question blocks explicitly include them in the CONTEXT.md examples (e.g., `max-time:: 3:00  %% time limit %%`). The parser will treat `%% ... %%` as part of the field value unless stripped. **Action needed:** Add a preprocessing step to strip Obsidian comments before field parsing, or strip them during field value extraction. This is a small change but must be done to match the content authoring format.

### Minor: JSONB Query Performance

JSONB columns are flexible but harder to query efficiently. For Phase 6, simple inserts and lookups by `response_id` or `user_id` don't need JSONB indexing. If Phase 9 needs to query by score dimensions, add GIN indexes at that point.

### Minor: Anonymous Token Flow

The anonymous-to-authenticated claim pattern must be added for assessment responses (following the existing pattern in progress.py and chat_sessions.py). Forgetting this means anonymous users' answers are lost when they log in.

---

## 8. Confidence Assessment

| Area | Confidence | Reason |
|------|------------|--------|
| Database schema | HIGH | Follows exact patterns from 11 existing tables; JSONB usage matches chat_sessions |
| API endpoints | HIGH | Follows exact patterns from progress.py, modules.py routes |
| TypeScript parser changes | HIGH | Extends well-understood patterns (segments, sections, flattener) |
| Content format | HIGH | Detailed examples in CONTEXT.md; follows existing Obsidian conventions |
| Question identification | MEDIUM | Open design question; structural derivation is pragmatic but provisional |
| Obsidian comment handling | HIGH | Verified: not currently handled; needs explicit implementation |
| Error handling | HIGH | Existing error patterns (ContentError[], warnings vs errors) apply directly |

---

## 9. Open Questions for Planning

These don't block Phase 6 execution but should be noted:

1. **Inline questions in Lenses:** The CONTEXT.md says "even practice questions inline in Lenses get AI assessment internally." Should the TypeScript processor support `#### Question` blocks inside lens files (not just test files)? The parser can handle this (same H4 segment pattern), but the flattener would need to know how to include them in lens-type sections. Recommend: support it in the parser, defer the flattener integration to Phase 7 when the answer box component needs inline questions.

2. **Test section positioning:** The CONTEXT.md says "test sections appear at the end of modules." Currently, LOs are processed in the order they appear in the module file. If a test section is part of an LO, it will appear right after that LO's lens sections, not necessarily at the end of the module. Clarify: should all test sections be collected and moved to the end, or do they stay in LO order? Recommend: stay in LO order for Phase 6 (natural output of the flattener), address explicit reordering in Phase 8 if needed.

3. **Assessment prompt visibility:** The `assessment-prompt::` field is for AI scoring (Phase 9). Should it be included in the API response (visible to frontend) or stripped? Recommend: include it in Phase 6 (simpler), strip it in Phase 9 when scoring is implemented (the frontend never needs it, but having it available during development is useful for debugging).
