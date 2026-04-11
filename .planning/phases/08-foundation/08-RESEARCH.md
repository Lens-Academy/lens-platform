# Phase 8: Foundation - Research

**Researched:** 2026-02-24
**Domain:** Content parsing (TypeScript), database schema (SQLAlchemy/Alembic), prompt assembly (Python), frontend types (React/TypeScript)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Content syntax
- `#### Roleplay` is a segment type, not a section type — same H4 level as Chat, Question, Text
- Valid in all Lens section types: page, lens-article, lens-video
- Also valid inside `## Test` sections alongside `#### Question` and `#### Text`
- Parser support for both Lens and Test sections added in this phase (assessment logic in Phase 11)

#### Segment fields
- `content::` — student-facing scenario briefing (what the student sees before/during roleplay)
- `ai-instructions::` — AI character behavior: personality, conversation rules, tone, scenario context (replaces the previously proposed `character::` field)
- `opening-message::` — optional, the AI character's first message to start the conversation
- `assessment-instructions::` — optional, for AI scoring when roleplay is inside a test section (same pattern as questions)

#### Prompt architecture
- No separate `character::` field — everything about the character goes in `ai-instructions::`
- Prompt assembly follows the same pattern as chat (base prompt + instructions + context) but with roleplay-specific framing
- TTS/STT pipeline is a separate transport concern (Phase 9) and does not affect prompt assembly

### Claude's Discretion
- Whether to create separate `roleplay.py` or extend shared prompt assembly machinery (consider that chat and roleplay use the same assembly pattern with different inputs)
- Module viewer rendering for roleplay segments before full conversation UI (Phase 10) — minimal placeholder that proves parsing works
- Opening message behavior — verbatim vs AI-guided generation from the field
- Session isolation implementation (segment_key column design, unique index strategy)
- Error handling for malformed roleplay blocks

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

## Summary

Phase 8 adds `#### Roleplay` as a new segment type across the full stack: content processor (TypeScript), backend (Python), and frontend (React/TypeScript). The work follows well-established patterns -- the codebase already has 5 segment types (text, chat, article-excerpt, video-excerpt, question) and the roleplay segment slots in as a 6th using identical infrastructure at every layer.

The content processor uses a schema-driven approach (`content-schema.ts`) where segment types are declared with required/optional/boolean fields, and all parsing, validation, field-checking, and typo-detection flows derive from that single schema. Adding roleplay means: (1) add an entry to `SEGMENT_SCHEMAS`, (2) add a `ParsedRoleplaySegment` interface in `lens.ts`, (3) add a `convertSegment` case, (4) add a `RoleplaySegment` interface to `index.ts` and include it in the `Segment` union. The same pattern repeats in Python (`types.py`, `flattened_types.py`) and TypeScript frontend (`module.ts`).

For session isolation, the current `chat_sessions` table uses `(user_id, content_id)` as the unique key for active sessions. Roleplay needs per-segment isolation (same user, same content, but different roleplay scenarios must have separate conversations). Adding a nullable `segment_key` column to `chat_sessions` and adjusting the unique partial indexes is the clean approach. The database migration uses Alembic.

**Primary recommendation:** Follow existing patterns exactly. Each layer (schema, parser, converter, flattener, Python types, frontend types) has a clear "add a case for the new type" pattern. The roleplay-specific prompt assembly function should live in a new `core/modules/roleplay.py` to keep concerns separated from tutor chat.

## Standard Stack

### Core (Already in codebase -- no new dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| SQLAlchemy | (existing) | Database schema + queries | Already used for all tables |
| Alembic | (existing) | Database migrations | Already used for all schema changes |
| LiteLLM | (existing) | LLM provider abstraction | Already used via `core/modules/llm.py` |
| Vitest | (existing) | Content processor tests | Already used in `content_processor/` |
| Pytest | (existing) | Python tests | Already used in `core/` |

### No New Dependencies
This phase requires zero new libraries. Every capability needed (markdown parsing, schema validation, DB migrations, prompt assembly, SSE streaming) already exists in the codebase.

## Architecture Patterns

### Pattern 1: Schema-Driven Segment Types (Content Processor)

**What:** All segment type definitions live in `content-schema.ts`. Parsers, validators, and typo detectors derive from this single source of truth.

**When to use:** Adding any new segment type.

**Existing code pattern:**
```typescript
// content_processor/src/content-schema.ts
export const SEGMENT_SCHEMAS: Record<string, SegmentTypeSchema> = {
  'text': segmentSchema(['content'], ['optional'], ['optional']),
  'chat': segmentSchema(
    ['instructions'],
    ['optional', 'hidePreviousContentFromUser', 'hidePreviousContentFromTutor'],
    ['optional', 'hidePreviousContentFromUser', 'hidePreviousContentFromTutor'],
  ),
  'question': segmentSchema(
    ['content'],
    ['assessment-instructions', 'max-time', 'max-chars', 'enforce-voice', 'optional', 'feedback'],
    ['enforce-voice', 'optional', 'feedback'],
  ),
  // Add roleplay here following same pattern
};
```

**For roleplay:**
```typescript
'roleplay': segmentSchema(
  ['content', 'ai-instructions'],  // required
  ['opening-message', 'assessment-instructions', 'optional'],  // optional
  ['optional'],  // boolean fields
),
```

### Pattern 2: Parsed Segment Interface + Convert Function (Lens Parser)

**What:** Each segment type has a `Parsed*Segment` interface in `lens.ts` and a case in the `convertSegment` function that maps raw fields to typed properties.

**Existing code pattern (question segment):**
```typescript
// content_processor/src/parser/lens.ts
export interface ParsedQuestionSegment {
  type: 'question';
  content: string;
  assessmentInstructions?: string;
  maxTime?: string;
  maxChars?: number;
  enforceVoice?: boolean;
  optional?: boolean;
  feedback?: boolean;
}

// In convertSegment():
case 'question': {
  const content = raw.fields['content'];
  if (!content || content.trim() === '') {
    errors.push({...});
    return { segment: null, errors };
  }
  const segment: ParsedQuestionSegment = {
    type: 'question',
    content,
    assessmentInstructions: raw.fields['assessment-instructions'] || undefined,
    // ...
  };
  return { segment, errors };
}
```

### Pattern 3: Flattened Segment Interface (Output Types)

**What:** `index.ts` defines the final output segment interfaces that both the flattener and the frontend consume. Each segment type is in the `Segment` union.

**Existing code pattern:**
```typescript
// content_processor/src/index.ts
export interface QuestionSegment {
  type: 'question';
  content: string;
  assessmentInstructions?: string;
  // ...
}

export type Segment = TextSegment | ChatSegment | ArticleExcerptSegment
  | VideoExcerptSegment | QuestionSegment;
// Add RoleplaySegment to this union
```

### Pattern 4: Section-Segment Compatibility Map

**What:** `lens.ts` has `VALID_SEGMENTS_PER_SECTION` that restricts which segment types can appear in which section types. And `LENS_SEGMENT_TYPES` lists all valid segment type names.

**Existing code:**
```typescript
const LENS_SEGMENT_TYPES = new Set([
  'text', 'chat', 'article-excerpt', 'video-excerpt', 'question'
]);

const VALID_SEGMENTS_PER_SECTION: Record<string, Set<string>> = {
  'page': new Set(['text', 'chat', 'question']),
  'lens-article': new Set(['text', 'chat', 'article-excerpt', 'question']),
  'lens-video': new Set(['text', 'chat', 'video-excerpt', 'question']),
};
```

**For roleplay:** Add `'roleplay'` to `LENS_SEGMENT_TYPES` and to ALL section type sets (page, lens-article, lens-video), matching the user decision that roleplay is valid in all Lens section types.

### Pattern 5: Structural Header Detection

**What:** `sections.ts` has `ALL_STRUCTURAL_TYPES` that includes all section and segment type names for heading detection and disambiguation.

**Existing code:**
```typescript
const ALL_STRUCTURAL_TYPES = new Set([
  // Section types
  'learning outcome', 'page', 'uncategorized', 'lens', 'test', 'module', 'meeting', 'article', 'video',
  // Segment types
  'text', 'chat', 'article-excerpt', 'video-excerpt', 'question',
]);
```

**For roleplay:** Add `'roleplay'` to this set.

### Pattern 6: Chat Precedence Validation

**What:** `chat-precedence.ts` validates that every `#### Chat` segment is preceded by a `#### Text` segment.

**For roleplay:** Roleplay does NOT need this constraint -- roleplay segments have their own `content::` field which serves the same purpose as the preceding text. No change needed to the existing validator, but should verify the validator ignores roleplay segments (it only checks `type === 'chat'`).

### Pattern 7: Python Backend Type Mirroring

**What:** Python `types.py` has dataclasses mirroring TypeScript interfaces. `flattened_types.py` uses dicts for section data. The chat system routes use dict-based section/segment access.

**Existing code:**
```python
# core/modules/types.py
@dataclass
class ChatSegment:
    type: Literal["chat"]
    instructions: str
    hide_previous_content_from_user: bool = False
    hide_previous_content_from_tutor: bool = False
```

The types.py `NarrativeSegment` union and the frontend `ModuleSegment` type must both include the new roleplay segment.

### Pattern 8: Prompt Assembly (Shared Machinery)

**What:** `core/modules/prompts.py` has `assemble_chat_prompt(base, instructions, context)` which is a 3-part assembly: base prompt + instructions + previous content context.

**For roleplay:** The same 3-part pattern works but with different inputs:
- Base: roleplay-specific framing (not tutor framing)
- Instructions: `ai-instructions::` field value
- Context: `content::` field value (the scenario briefing, which IS the context for roleplay)

**Recommendation:** Create `core/modules/roleplay.py` with `build_roleplay_prompt()` that uses the same assembly pattern but with roleplay-specific base prompt text. This keeps roleplay prompt logic separate from tutor chat without duplicating the assembly function.

### Pattern 9: Session Isolation (Database)

**What:** `chat_sessions` table currently uses partial unique indexes on `(user_id, content_id)` and `(anonymous_token, content_id)` where `archived_at IS NULL`.

**Current schema:**
```python
# core/tables.py
Index(
    "idx_chat_sessions_unique_user_active",
    "user_id", "content_id",
    unique=True,
    postgresql_where=text("user_id IS NOT NULL AND archived_at IS NULL"),
),
```

**For roleplay:** Add `segment_key` column (nullable Text). Update unique indexes to include `segment_key`. Existing tutor chat sessions have `segment_key = NULL` (backward compatible). Roleplay sessions use a segment_key like `"roleplay:section-0:segment-2"` to isolate per-segment.

### Pattern 10: Alembic Migration

**What:** Migrations follow add column + drop/recreate index pattern. Recent migration `d5bcaa57dfdc` shows the established pattern including `IF EXISTS` guards for dev DB compatibility.

**For roleplay migration:**
1. Add `segment_key` column (nullable Text)
2. Drop old unique partial indexes
3. Create new unique partial indexes that include `segment_key` using `COALESCE(segment_key, '')` to handle NULL comparison

### Recommended File Changes Summary

```
content_processor/src/
├── content-schema.ts         # Add 'roleplay' to SEGMENT_SCHEMAS
├── index.ts                  # Add RoleplaySegment interface + union
├── parser/
│   ├── lens.ts              # Add ParsedRoleplaySegment, convertSegment case,
│   │                        #   LENS_SEGMENT_TYPES, VALID_SEGMENTS_PER_SECTION
│   └── sections.ts          # Add 'roleplay' to ALL_STRUCTURAL_TYPES
├── validator/
│   └── segment-fields.ts    # No change needed (derives from schema)
└── content-schema.test.ts    # Update count assertions

core/modules/
├── types.py                  # Add RoleplaySegment dataclass
├── flattened_types.py        # (no change - uses dicts)
├── roleplay.py               # NEW: build_roleplay_prompt()
├── prompts.py                # Consider adding ROLEPLAY_BASE_PROMPT constant
├── context.py                # Add roleplay segment to context gathering
├── chat_sessions.py          # Add segment_key parameter
└── tests/
    ├── test_roleplay.py      # NEW: prompt assembly tests
    └── test_chat_sessions.py # Add segment_key tests

core/
└── tables.py                 # Add segment_key column + update indexes

alembic/versions/
└── XXXX_add_segment_key.py   # NEW: migration

web_frontend/src/
└── types/module.ts           # Add RoleplaySegment type + union
```

### Anti-Patterns to Avoid

- **Mixing roleplay into chat.py:** The user decision is that roleplay prompt assembly should be separate from tutor chat. Don't modify `chat.py` or `_build_system_prompt()` -- create `roleplay.py` instead.
- **Hard-coding segment_key format:** The segment_key should be a simple string the API composes, not a format the database enforces. Don't add CHECK constraints on segment_key format.
- **Adding roleplay-specific section types:** Roleplay is a SEGMENT type (H4), not a SECTION type (H3). Don't add new section types.
- **Changing the `character::` field name back:** The user explicitly decided to use `ai-instructions::` instead of `character::`. The success criteria mentions `character::` but the CONTEXT.md decisions override this.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Segment field validation | Custom roleplay field checker | `SEGMENT_SCHEMAS` in content-schema.ts | Schema-driven validation is already comprehensive |
| Field typo detection | Custom roleplay typo logic | Existing `field-typos.ts` derives from `ALL_KNOWN_FIELDS` | Automatic once fields are in schema |
| Segment parsing | Custom roleplay parser | Existing `parseSegments()` + `parseFieldsIntoSegment()` | Already handles any `#### Type` + `field::` syntax |
| Database migration | Raw SQL files | Alembic `op.add_column()`, `op.create_index()` | Alembic handles forward/backward migrations |
| Session uniqueness | Application-level locking | PostgreSQL partial unique indexes | DB-level enforcement is more reliable |

**Key insight:** The codebase is already designed for extensibility via schema-driven patterns. Adding a new segment type is primarily a configuration task, not an engineering task. The machinery already exists.

## Common Pitfalls

### Pitfall 1: Unique Index NULL Semantics
**What goes wrong:** PostgreSQL treats `NULL != NULL` in unique indexes. If `segment_key` is nullable and two tutor chat sessions both have `segment_key = NULL`, the unique index won't prevent duplicates.
**Why it happens:** Existing indexes don't include `segment_key`. Adding it without handling NULLs breaks backward compatibility.
**How to avoid:** Use `COALESCE(segment_key, '')` in the unique index expression, or use separate partial indexes for `segment_key IS NULL` vs `segment_key IS NOT NULL` cases.
**Warning signs:** Duplicate active sessions appearing for tutor chat after migration.

### Pitfall 2: Success Criteria Field Name Mismatch
**What goes wrong:** The success criteria (from roadmap) mentions `character::` and `instructions::` fields, but the CONTEXT.md decisions specify `ai-instructions::` (replacing `character::`). The field named `content::` replaces the briefing that was formerly unnamed.
**Why it happens:** The roadmap was written before the discuss-phase conversation refined the field names.
**How to avoid:** Follow CONTEXT.md decisions, not the raw success criteria field names. The planner should note this discrepancy.
**Warning signs:** Tests checking for `character::` instead of `ai-instructions::`.

### Pitfall 3: Forgetting Test Section Compatibility
**What goes wrong:** Roleplay is valid inside `## Test` sections (alongside Question and Text), but the learning-outcome parser and flattener only process certain segment types for tests.
**Why it happens:** The LO parser's test section handling (`parseLearningOutcome` in `learning-outcome.ts`) uses `parseSegments()` and `convertSegment()` from `lens.ts`. If the roleplay case isn't added to `convertSegment()`, roleplay segments in test sections will be silently dropped.
**How to avoid:** Ensure the `convertSegment()` function handles `'roleplay'` case. The LO parser automatically picks it up since it delegates to `parseSegments()` + `convertSegment()`.
**Warning signs:** Roleplay segments inside `## Test` sections producing no output.

### Pitfall 4: Content Processor Count Assertions in Tests
**What goes wrong:** `content-schema.test.ts` has `expect(Object.keys(SEGMENT_SCHEMAS)).toHaveLength(5)` -- adding roleplay makes this 6.
**Why it happens:** Tests assert exact counts.
**How to avoid:** Update the count assertion when adding the new schema entry.
**Warning signs:** Test failure: "Expected 5, received 6".

### Pitfall 5: chat_sessions Service Not Accepting segment_key
**What goes wrong:** `get_or_create_chat_session()` doesn't have a `segment_key` parameter, so roleplay sessions can't be created with segment isolation.
**Why it happens:** The function signature needs updating along with the WHERE clause and INSERT values.
**How to avoid:** Add `segment_key: str | None = None` parameter to `get_or_create_chat_session()`. Add it to the conditions list and insert values. Ensure the claim function also handles segment_key.
**Warning signs:** All roleplay sessions sharing the same conversation history.

### Pitfall 6: Frontend Type Not in Segment Union
**What goes wrong:** Frontend crashes or shows nothing for roleplay segments because `ModuleSegment` union in `module.ts` doesn't include the roleplay type.
**Why it happens:** Forgot to update the frontend type alongside the content processor type.
**How to avoid:** Update `ModuleSegment` in `web_frontend/src/types/module.ts` to include `RoleplaySegment`.
**Warning signs:** TypeScript errors or segments silently not rendering.

### Pitfall 7: Markdown Content Fields and Heading Disambiguation
**What goes wrong:** `content::` and `ai-instructions::` fields may contain markdown headings. The parser's heading disambiguation logic in `sections.ts` (lines 188-207) checks `MARKDOWN_CONTENT_FIELDS` to allow headings inside certain fields.
**Why it happens:** The `MARKDOWN_CONTENT_FIELDS` set only includes `'content'` and `'instructions'`. The `ai-instructions` field name is different from `instructions`.
**How to avoid:** Add `'ai-instructions'` to the `MARKDOWN_CONTENT_FIELDS` set in `sections.ts`, since course creators may include markdown headings in character behavior descriptions.
**Warning signs:** Warnings about headings inside ai-instructions field, or field values being truncated at headings.

## Code Examples

### Adding Roleplay to Content Schema
```typescript
// content_processor/src/content-schema.ts
export const SEGMENT_SCHEMAS: Record<string, SegmentTypeSchema> = {
  // ... existing schemas ...
  'roleplay': segmentSchema(
    ['content', 'ai-instructions'],
    ['opening-message', 'assessment-instructions', 'optional'],
    ['optional'],
  ),
};
```

### Parsed Roleplay Segment Interface
```typescript
// content_processor/src/parser/lens.ts
export interface ParsedRoleplaySegment {
  type: 'roleplay';
  content: string;              // Student-facing scenario briefing
  aiInstructions: string;       // Character behavior + personality
  openingMessage?: string;      // Optional first message
  assessmentInstructions?: string;  // Optional scoring rubric (for test sections)
  optional?: boolean;
}
```

### Convert Segment Case for Roleplay
```typescript
// content_processor/src/parser/lens.ts - inside convertSegment()
case 'roleplay': {
  const content = raw.fields['content'];
  if (!content || content.trim() === '') {
    errors.push({
      file,
      line: raw.line,
      message: 'Roleplay segment missing content:: field',
      suggestion: "Add 'content:: Your scenario briefing here'",
      severity: 'error',
    });
    return { segment: null, errors };
  }

  const aiInstructions = raw.fields['ai-instructions'];
  if (!aiInstructions || aiInstructions.trim() === '') {
    errors.push({
      file,
      line: raw.line,
      message: 'Roleplay segment missing ai-instructions:: field',
      suggestion: "Add 'ai-instructions:: Character behavior description'",
      severity: 'error',
    });
    return { segment: null, errors };
  }

  const segment: ParsedRoleplaySegment = {
    type: 'roleplay',
    content,
    aiInstructions: aiInstructions,
    openingMessage: raw.fields['opening-message'] || undefined,
    assessmentInstructions: raw.fields['assessment-instructions'] || undefined,
    optional: raw.fields.optional?.toLowerCase() === 'true' ? true : undefined,
  };
  return { segment, errors };
}
```

### Output Roleplay Segment Interface
```typescript
// content_processor/src/index.ts
export interface RoleplaySegment {
  type: 'roleplay';
  content: string;
  aiInstructions: string;
  openingMessage?: string;
  assessmentInstructions?: string;
  optional?: boolean;
}

export type Segment = TextSegment | ChatSegment | ArticleExcerptSegment
  | VideoExcerptSegment | QuestionSegment | RoleplaySegment;
```

### Python Roleplay Segment Type
```python
# core/modules/types.py
@dataclass
class RoleplaySegment:
    """Interactive roleplay scenario with AI character."""
    type: Literal["roleplay"]
    content: str                              # Student-facing scenario briefing
    ai_instructions: str                      # Character behavior
    opening_message: str | None = None        # Optional first message
    assessment_instructions: str | None = None  # Optional scoring rubric
```

### Roleplay Prompt Assembly
```python
# core/modules/roleplay.py
ROLEPLAY_BASE_PROMPT = (
    "You are playing a character in a roleplay scenario for an AI safety "
    "education course. Stay in character at all times. Your behavior, "
    "personality, and responses are defined by the instructions below."
)

def build_roleplay_prompt(
    ai_instructions: str,
    scenario_content: str | None = None,
) -> str:
    """Build system prompt for roleplay from content fields.

    Args:
        ai_instructions: Character behavior, personality, rules from ai-instructions:: field.
        scenario_content: Student-facing scenario briefing from content:: field.

    Returns:
        Assembled system prompt string.
    """
    prompt = ROLEPLAY_BASE_PROMPT
    prompt += f"\n\nCharacter Instructions:\n{ai_instructions}"
    if scenario_content:
        prompt += f"\n\nScenario Context:\n{scenario_content}"
    return prompt
```

### Database Migration for segment_key
```python
# alembic/versions/XXXX_add_segment_key_to_chat_sessions.py
def upgrade() -> None:
    # 1. Add nullable segment_key column
    op.add_column(
        "chat_sessions",
        sa.Column("segment_key", sa.Text(), nullable=True),
    )

    # 2. Drop old unique partial indexes
    op.execute("DROP INDEX IF EXISTS idx_chat_sessions_unique_anon_active")
    op.execute("DROP INDEX IF EXISTS idx_chat_sessions_unique_user_active")

    # 3. Create new unique partial indexes including segment_key
    # Use COALESCE to handle NULL segment_key (tutor chat) vs non-NULL (roleplay)
    op.execute("""
        CREATE UNIQUE INDEX idx_chat_sessions_unique_anon_active
        ON chat_sessions (anonymous_token, content_id, COALESCE(segment_key, ''))
        WHERE anonymous_token IS NOT NULL AND archived_at IS NULL
    """)
    op.execute("""
        CREATE UNIQUE INDEX idx_chat_sessions_unique_user_active
        ON chat_sessions (user_id, content_id, COALESCE(segment_key, ''))
        WHERE user_id IS NOT NULL AND archived_at IS NULL
    """)

    # 4. Add index for segment_key queries
    op.create_index(
        "idx_chat_sessions_segment_key",
        "chat_sessions",
        ["segment_key"],
        postgresql_where=sa.text("segment_key IS NOT NULL"),
    )
```

### Frontend Type Update
```typescript
// web_frontend/src/types/module.ts
export type RoleplaySegment = {
  type: "roleplay";
  content: string;              // Student-facing scenario briefing
  aiInstructions: string;       // Character behavior
  openingMessage?: string;      // Optional first AI message
  assessmentInstructions?: string;  // Optional scoring rubric
  optional?: boolean;
};

export type ModuleSegment =
  | TextSegment
  | ArticleExcerptSegment
  | VideoExcerptSegment
  | ChatSegment
  | QuestionSegment
  | RoleplaySegment;
```

### Flattener Case for Roleplay
```typescript
// content_processor/src/flattener/index.ts - inside convertSegment()
case 'roleplay': {
  const segment: RoleplaySegment = {
    type: 'roleplay',
    content: parsedSegment.content,
    aiInstructions: parsedSegment.aiInstructions,
  };
  if (parsedSegment.openingMessage) segment.openingMessage = parsedSegment.openingMessage;
  if (parsedSegment.assessmentInstructions) segment.assessmentInstructions = parsedSegment.assessmentInstructions;
  if (parsedSegment.optional) segment.optional = true;
  return { segment, errors };
}
```

## Discretion Recommendations

### 1. Separate roleplay.py (RECOMMENDED)
**Recommendation:** Create `core/modules/roleplay.py` with `build_roleplay_prompt()` and `ROLEPLAY_BASE_PROMPT`.
**Reasoning:** Chat and roleplay use the same assembly pattern but have fundamentally different framing. The tutor base prompt says "You are a tutor helping someone learn about AI safety" while roleplay says "You are playing a character." Mixing these in the same file creates confusion. A separate file also makes it easy to find and modify roleplay-specific behavior without risk to tutor chat.
**The shared `assemble_chat_prompt()` in prompts.py can still be called by roleplay.py** if we want to reuse the 3-part assembly pattern. But the base prompt and the framing of instructions/context are different enough to warrant a separate entry point.

### 2. Module Viewer Placeholder (RECOMMENDED: Minimal)
**Recommendation:** Render roleplay segments as a styled card showing the `content::` text (scenario briefing) with a "Roleplay" badge/label and a disabled "Start Conversation" button. No actual conversation UI yet (that's Phase 10).
**Reasoning:** This proves parsing works end-to-end without building any conversation infrastructure. The Module.tsx already has a segment rendering switch -- add a case for `"roleplay"` that renders a static placeholder.

### 3. Opening Message Behavior (RECOMMENDED: Verbatim)
**Recommendation:** If `opening-message::` is provided, use it verbatim as the first assistant message in the conversation. Do NOT pass it through the LLM for "generation."
**Reasoning:** Course creators write the opening message intentionally. Passing it through an LLM adds latency, cost, and unpredictability. If they want the AI to generate an opening, they can leave the field empty and put "start by greeting the student and setting the scene" in `ai-instructions::`.

### 4. Session Isolation (RECOMMENDED: segment_key column)
**Recommendation:** Add `segment_key TEXT` column to `chat_sessions`. Format: `"roleplay:{sectionIndex}:{segmentIndex}"`. Include in unique index via `COALESCE(segment_key, '')`.
**Reasoning:** This is the minimal schema change that achieves isolation. Existing tutor chat sessions have `segment_key = NULL` and are unaffected. The COALESCE approach means the unique index correctly handles both cases. The key format is simple and debuggable.

### 5. Error Handling for Malformed Blocks (RECOMMENDED: Follow existing patterns)
**Recommendation:** Use the same error reporting as question segments -- required fields get `severity: 'error'`, optional fields with bad values get `severity: 'warning'`. Empty required fields produce specific error messages with suggestions.
**Reasoning:** The codebase has a well-established error reporting pattern. Don't invent a new one.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `character::` field | `ai-instructions::` field | Phase 8 discuss (2026-02-24) | Single field for all character behavior |
| Separate character + instructions | Single `ai-instructions::` | Phase 8 discuss | Simpler content authoring |

**Note on success criteria vs decisions:** The roadmap success criteria reference `character::` and `instructions::` fields. The CONTEXT.md decisions refined these to `content::` (scenario briefing) and `ai-instructions::` (character behavior). The CONTEXT.md decisions take precedence.

## Open Questions

1. **Content field vs chat precedence rule**
   - What we know: Chat segments MUST be preceded by a Text segment (enforced by `chat-precedence.ts`). Roleplay has its own `content::` field, so this rule doesn't apply.
   - What's unclear: Should roleplay segments have any precedence requirement? (e.g., must they follow a text segment too?)
   - Recommendation: No precedence requirement for roleplay. The `content::` field serves the same purpose as the preceding text. The existing validator only checks `type === 'chat'` so no change needed.

2. **Context gathering for roleplay**
   - What we know: `context.py` gathers content from preceding segments for chat context. Roleplay segments have their own context via `content::`.
   - What's unclear: Should `gather_section_context()` include roleplay's `content::` as context for subsequent segments? Should it gather preceding segment content for roleplay?
   - Recommendation: For Phase 8, roleplay uses its own `content::` as context and does not feed into `gather_section_context()`. Keep it simple. The prompt already gets scenario context from the `content::` field.

3. **How the API route will dispatch to roleplay vs chat**
   - What we know: Currently `web_api/routes/module.py` creates a `ChatStage` and calls `send_module_message()`. Roleplay needs to detect the segment type and call a different prompt builder.
   - What's unclear: Should this be a separate API endpoint or should the existing endpoint branch on segment type?
   - Recommendation: For Phase 8, add the detection in the existing `event_generator()` -- check if `current_segment.get("type") == "roleplay"` and build prompts accordingly. A separate endpoint can be added in Phase 10 when the full conversation UI exists.

## Sources

### Primary (HIGH confidence)
All findings are from direct codebase inspection:
- `content_processor/src/content-schema.ts` -- schema-driven segment definitions
- `content_processor/src/parser/lens.ts` -- segment parsing and conversion
- `content_processor/src/parser/sections.ts` -- section/heading parsing
- `content_processor/src/parser/learning-outcome.ts` -- test section with inline segments
- `content_processor/src/flattener/index.ts` -- segment conversion to output types
- `content_processor/src/index.ts` -- output type interfaces
- `content_processor/src/validator/segment-fields.ts` -- schema-derived validation
- `content_processor/src/validator/chat-precedence.ts` -- chat ordering rules
- `core/modules/types.py` -- Python segment dataclasses
- `core/modules/chat.py` -- chat prompt building and LLM streaming
- `core/modules/prompts.py` -- shared prompt assembly
- `core/modules/llm.py` -- LiteLLM streaming integration
- `core/modules/chat_sessions.py` -- session CRUD with unique constraint handling
- `core/modules/context.py` -- context gathering for chat
- `core/tables.py` -- SQLAlchemy table definitions including chat_sessions
- `web_api/routes/module.py` -- API route for module chat
- `web_frontend/src/types/module.ts` -- frontend TypeScript types
- `alembic/versions/d5bcaa57dfdc_*.py` -- recent migration pattern reference

### Secondary (MEDIUM confidence)
- PostgreSQL NULL semantics in unique indexes -- well-known behavior, verified against codebase's existing `COALESCE`-style patterns in other indexes

### Tertiary (LOW confidence)
None -- all findings are from direct codebase analysis.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all patterns directly observed in codebase
- Architecture: HIGH -- every pattern documented with exact file paths and code examples from the existing codebase
- Pitfalls: HIGH -- all pitfalls identified from actual code review (NULL semantics, field name mismatches, count assertions, missing union members)

**Research date:** 2026-02-24
**Valid until:** 2026-03-24 (stable -- internal codebase patterns unlikely to change)
