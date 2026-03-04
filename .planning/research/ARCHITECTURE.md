# Architecture Patterns: Roleplay Conversation Integration

**Domain:** AI roleplay conversations in AI Safety education platform
**Researched:** 2026-02-24
**Confidence:** HIGH (based on direct codebase analysis, not external sources)

## Recommended Architecture

Roleplay integrates as a new **segment type** (`roleplay`) following the exact same pattern as `question` and `chat` segments. The key insight from studying the codebase: segments are the unit of interactivity, sections are the unit of progress. Roleplay is an interactive segment, like `question`, that can appear in any section type (page, lens-article, lens-video) and in test sections.

### Architecture Overview

```
Content Markdown (lens files)
  |
  v
content_processor/ -- parses #### Roleplay segments with fields
  |                   (instructions::, character::, end-condition::, etc.)
  v
FlattenedModule.sections[].segments[] -- roleplay segment dict in cache
  |
  v
web_api/routes/module.py -- POST /api/chat/module handles roleplay via
  |                          segment type detection (same endpoint as chat)
  v
core/modules/roleplay.py -- NEW: roleplay-specific prompt assembly,
  |                          end-condition detection
  v
core/modules/llm.py -- existing stream_chat() (reused)
  |
  v
web_frontend -- RoleplayBox component renders conversation UI,
               uses existing useVoiceRecording, existing SSE streaming
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `content_processor/src/parser/lens.ts` (MODIFY) | Parse `#### Roleplay` segments from markdown | Content cache |
| `content_processor/src/content-schema.ts` (MODIFY) | Define valid fields for roleplay segment type | Parser validators |
| `core/modules/roleplay.py` (NEW) | Roleplay prompt assembly, character instructions, end-condition tools | `core/modules/llm.py`, `core/modules/chat_sessions.py` |
| `core/modules/types.py` (MODIFY) | Add `RoleplaySegment` dataclass | Type system |
| `core/scoring.py` (MODIFY) | Support roleplay assessment (conversation transcript scoring) | `core/modules/llm.py`, DB |
| `web_api/routes/module.py` (MODIFY) | Detect roleplay segments, route to `roleplay.py` | `core/modules/roleplay.py` |
| `web_frontend/src/types/module.ts` (MODIFY) | Add `RoleplaySegment` type to `ModuleSegment` union | Frontend type system |
| `web_frontend/src/components/module/RoleplayBox.tsx` (NEW) | Roleplay conversation UI component | `useVoiceRecording`, SSE API |
| `web_frontend/src/views/Module.tsx` (MODIFY) | Add `case "roleplay"` to `renderSegment()` | `RoleplayBox` |
| `web_frontend/src/components/module/TestSection.tsx` (MODIFY) | Support roleplay segments alongside question segments | `RoleplayBox` |

### Data Flow

**Content authoring flow:**
```
Markdown file:
  #### Roleplay: Ethics Board Meeting
  instructions:: You are Dr. Chen, an AI ethics researcher...
  character:: Dr. Chen
  end-condition:: messages:6
  assessment-instructions:: Evaluate whether the student...

    --> content_processor parses to:
    { type: "roleplay", character: "Dr. Chen",
      instructions: "...", endCondition: "messages:6",
      assessmentInstructions: "..." }

    --> Flattened into module section segments[]
```

**Runtime conversation flow:**
```
1. User sees RoleplayBox with character intro + "Begin" button
2. User clicks Begin -> roleplay starts (or auto-starts with AI greeting)
3. User types/speaks message
4. Frontend calls POST /api/chat/module with { slug, sectionIndex, segmentIndex, message }
   (same endpoint as existing chat)
5. Backend detects segment type == "roleplay" in event_generator()
6. Backend calls core/modules/roleplay.py:build_roleplay_prompt() instead of
   the existing _build_system_prompt()
7. Prompt includes character persona, scenario instructions, end-condition awareness
8. Backend streams response via SSE (existing stream_chat)
9. Backend checks end-condition after each exchange:
   - Message count: count user messages in session
   - Time-based: check elapsed time since session start
   - AI-monitored: include end-condition tool for AI to call
10. When end-condition met: yield special SSE event { type: "roleplay_end" }
11. Frontend transitions to completed state
12. If assessment_instructions present: trigger background scoring
```

**Assessment flow (when in test section):**
```
1. Roleplay completes (end-condition met)
2. Backend sends full conversation transcript to scoring pipeline
3. core/scoring.py scores the transcript against assessment_instructions
4. Score written to question_assessments table (reuses existing table)
5. Question ID format: "moduleSlug:sectionIndex:segmentIndex" (same as questions)
```

## Integration Points with Existing Systems

### 1. Content Parsing (content_processor)

**What exists:** `lens.ts` parses `#### Question` segments via `parseSegments()` and `convertSegment()`. The `LENS_SEGMENT_TYPES` set and `VALID_SEGMENTS_PER_SECTION` map control which segment types are valid.

**What to add:**
- Add `'roleplay'` to `LENS_SEGMENT_TYPES` set
- Add `'roleplay'` to all entries in `VALID_SEGMENTS_PER_SECTION` (valid in page, lens-article, lens-video)
- Add `case 'roleplay'` to `convertSegment()` switch statement
- Add `ParsedRoleplaySegment` interface
- Add `'roleplay'` entry to `SEGMENT_SCHEMAS` in `content-schema.ts`

**Fields for roleplay segment:**
```typescript
// Required
instructions: string;    // Character persona + scenario setup
character: string;       // Character display name

// Optional
'end-condition': string; // "messages:6" | "time:300" | "ai-monitored" (default: "messages:6")
'assessment-instructions': string; // Rubric for scoring (enables assessment)
'max-time': string;      // Max conversation time (safety limit)
'opening-message': string; // AI's first message (optional auto-start)
optional: boolean;
```

### 2. Backend Chat Route (web_api/routes/module.py)

**What exists:** `event_generator()` builds prompts differently based on segment type:
- `segment.type == "question"` -> feedback prompt
- `section.type == "test"` -> holistic feedback prompt
- Default -> uses `segment.instructions` directly

**What to modify:** Add roleplay detection before the existing question checks:

```python
# In event_generator(), after loading segment:
if current_segment.get("type") == "roleplay":
    # Delegate to roleplay module
    from core.modules.roleplay import build_roleplay_stage, check_end_condition

    stage = build_roleplay_stage(current_segment)
    # ... rest of streaming logic
```

**Critical:** The existing SSE endpoint (`POST /api/chat/module`) is reused. No new API endpoint needed. The backend distinguishes behavior by segment type, which the frontend already sends via `sectionIndex` and `segmentIndex`.

### 3. Chat Sessions (core/modules/chat_sessions.py)

**What exists:** `chat_sessions` table stores messages as JSONB array, keyed by `user_id/anonymous_token + content_id`. One active session per user per content_id.

**Roleplay reuse decision:** Roleplay conversations use the **same chat_sessions table** but with a roleplay-specific `content_type`. This is because:
- The chat_sessions table already has the right structure (JSONB messages, user identification)
- Active session uniqueness constraint works correctly
- The existing `get_or_create_chat_session()` and `add_chat_message()` functions work as-is

**Content ID strategy:** Use `content_id` from the module (same as chat), so roleplay shares the session with other chat segments in the module. This matches existing behavior where all chat segments in a module share one session.

**Alternative considered:** Separate roleplay_sessions table. Rejected because it duplicates structure for no benefit, and sharing the session means the AI has context from earlier conversations (which is pedagogically valuable).

### 4. Scoring (core/scoring.py)

**What exists:** `enqueue_scoring()` fires background task, `_build_scoring_prompt()` builds prompt from question_text + answer_text, `_resolve_question_details()` looks up segment by index.

**What to modify:**
- `_resolve_question_details()`: Handle `segment.type == "roleplay"` alongside `"question"`
- `_build_scoring_prompt()`: For roleplay, the "answer" is the full conversation transcript, not a single text response
- `SCORE_SCHEMA`: Works as-is (overall_score, reasoning, dimensions, key_observations)

**Transcript format for scoring:**
```python
# Instead of single answer_text, build from conversation messages
transcript = "\n".join(
    f"{msg['role'].upper()}: {msg['content']}"
    for msg in conversation_messages
)
```

### 5. Question Responses Table (core/tables.py)

**What exists:** `question_responses` table stores question_id, answer_text, answer_metadata, etc.

**Roleplay storage:** Roleplay completed conversations are stored in the **same question_responses table**:
- `question_id`: `"moduleSlug:sectionIndex:segmentIndex"` (same format)
- `question_text`: The roleplay instructions (snapshot)
- `answer_text`: Full conversation transcript (serialized)
- `answer_metadata`: `{ "type": "roleplay", "message_count": 6, "duration_s": 180, "voice_used": true }`
- `assessment_instructions`: From the segment field

This means the existing scoring pipeline picks up roleplay completions automatically.

### 6. Frontend Type System (types/module.ts)

**What exists:** `ModuleSegment` is a union: `TextSegment | ArticleExcerptSegment | VideoExcerptSegment | ChatSegment | QuestionSegment`

**What to add:**
```typescript
export type RoleplaySegment = {
  type: "roleplay";
  instructions: string;
  character: string;
  endCondition?: string;       // "messages:6" | "time:300" | "ai-monitored"
  assessmentInstructions?: string;
  maxTime?: string;
  openingMessage?: string;
  optional?: boolean;
};

export type ModuleSegment =
  | TextSegment
  | ArticleExcerptSegment
  | VideoExcerptSegment
  | ChatSegment
  | QuestionSegment
  | RoleplaySegment;            // Add to union
```

### 7. Frontend Rendering (views/Module.tsx)

**What exists:** `renderSegment()` switch statement dispatches by `segment.type`.

**What to add:**
```typescript
case "roleplay":
  return (
    <RoleplayBox
      key={`roleplay-${keyPrefix}`}
      segment={segment}
      moduleSlug={module.slug}
      sectionIndex={sectionIndex}
      segmentIndex={segmentIndex}
      isAuthenticated={isAuthenticated}
      messages={messages}
      pendingMessage={pendingMessage}
      streamingContent={streamingContent}
      isLoading={isLoading}
      onSendMessage={(content) =>
        handleSendMessage(content, sectionIndex, segmentIndex)
      }
      onRetryMessage={handleRetryMessage}
      onComplete={onComplete}        // For test section integration
    />
  );
```

### 8. TestSection Integration

**What exists:** `TestSection.tsx` extracts question segments, manages sequential reveal, tracks completion via API.

**What to modify:** TestSection currently filters `seg.type === "question"` to build its question list. For roleplay support:
- Rename concept from "questions" to "assessable items" internally
- Filter `seg.type === "question" || seg.type === "roleplay"`
- Render `RoleplayBox` instead of `TestQuestionCard` for roleplay segments
- RoleplayBox calls `onComplete()` when end-condition met, matching the TestQuestionCard interface

### 9. Voice Input

**What exists:** `useVoiceRecording` hook handles mic access, MediaRecorder, transcription via `POST /api/transcribe`. Used by both `NarrativeChatSection` and `AnswerBox`.

**Reuse:** RoleplayBox imports `useVoiceRecording` directly. The hook is already designed for reuse with the `onTranscription` callback pattern. No modifications needed.

## Patterns to Follow

### Pattern 1: Segment Type Extension
**What:** Adding new segment types follows a well-established pattern in this codebase.
**When:** Any new interactive element in course content.
**How (checklist):**
1. Add to `content_processor/src/content-schema.ts` SEGMENT_SCHEMAS
2. Add to `content_processor/src/parser/lens.ts` LENS_SEGMENT_TYPES, VALID_SEGMENTS_PER_SECTION, convertSegment()
3. Add TypeScript type to `web_frontend/src/types/module.ts` ModuleSegment union
4. Add Python dataclass to `core/modules/types.py`
5. Add rendering case to `web_frontend/src/views/Module.tsx` renderSegment()
6. Handle in backend route `web_api/routes/module.py` event_generator()

### Pattern 2: Backend Segment Type Detection
**What:** The chat endpoint (`POST /api/chat/module`) determines behavior by inspecting the segment at the given position.
**When:** Adding new conversational segment types.
**Example from existing code:**
```python
# Existing pattern in event_generator():
if section.get("type") == "test":
    instructions = "You are a supportive tutor providing feedback..."
elif current_segment.get("type") == "question":
    instructions = "You are a supportive tutor providing feedback..."
else:
    instructions = current_segment.get("instructions", "Help the user...")
```
**Roleplay follows this pattern:**
```python
elif current_segment.get("type") == "roleplay":
    # Use roleplay-specific prompt assembly
    from core.modules.roleplay import build_roleplay_prompt
    instructions = build_roleplay_prompt(current_segment)
```

### Pattern 3: SSE Event Extension
**What:** The SSE stream already supports multiple event types (`text`, `tool_use`, `thinking`, `done`, `error`). Adding `roleplay_end` follows the same pattern.
**When:** End-of-conversation signaling.
**Example:**
```python
# After streaming, check end condition
if should_end:
    yield f'data: {json.dumps({"type": "roleplay_end", "reason": "message_limit"})}\n\n'
```

### Pattern 4: Shared Chat Session
**What:** All conversational segments in a module share one chat session (keyed by content_id).
**When:** Roleplay conversations are module-scoped.
**Why this matters:** If a student has a chat segment before a roleplay segment, the tutor's context from the chat is available to the roleplay (they share the session). This is a feature, not a bug -- it means the AI character can reference earlier learning.

**However:** This means roleplay messages appear in the shared chat history. The frontend already handles this by showing different segments independently (NarrativeChatSection only shows messages from after it was activated via the `recentMessagesStartIdx` in `chatViewReducer`). RoleplayBox should use the same activation pattern.

### Pattern 5: Component Reuse via Props Interface
**What:** RoleplayBox shares props interface patterns with both NarrativeChatSection (chat UI) and AnswerBox (voice input, completion).
**When:** Building the RoleplayBox component.
**Key shared props:**
```typescript
// From NarrativeChatSection (chat rendering):
messages, pendingMessage, streamingContent, isLoading, onSendMessage, onRetryMessage

// From AnswerBox/TestSection (completion tracking):
onComplete, segment, moduleSlug, sectionIndex, segmentIndex, isAuthenticated
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Separate API Endpoint for Roleplay
**What:** Creating a new `POST /api/chat/roleplay` endpoint.
**Why bad:** Duplicates auth handling, session management, SSE streaming logic. The existing `/api/chat/module` endpoint already accepts `sectionIndex` and `segmentIndex` to locate the segment, and the backend can determine behavior from the segment type.
**Instead:** Add roleplay handling to the existing `event_generator()` function in `module.py`.

### Anti-Pattern 2: Separate Database Table for Roleplay Sessions
**What:** Creating a `roleplay_sessions` table.
**Why bad:** The `chat_sessions` table already has the right structure. Creating a parallel table means duplicating session management code, claim logic (anonymous -> authenticated), and archive logic.
**Instead:** Use `chat_sessions` with the existing `content_type` field (could add 'roleplay' as valid content_type).

### Anti-Pattern 3: Separate Database Table for Roleplay Assessments
**What:** Creating `roleplay_responses` + `roleplay_assessments` tables.
**Why bad:** The question_responses/question_assessments tables are designed for flexible content. The `answer_metadata` JSONB field can hold roleplay-specific data. The scoring pipeline already handles `segment.type != "question"` gracefully.
**Instead:** Reuse `question_responses` (answer_text = transcript, answer_metadata = roleplay details).

### Anti-Pattern 4: Building RoleplayBox from Scratch
**What:** Writing a new conversation UI component without reusing existing chat patterns.
**Why bad:** NarrativeChatSection already has: message rendering, SSE consumption, scroll management, voice input integration, expand/collapse, pending message display. Duplicating this is wasteful and creates divergent UX.
**Instead:** RoleplayBox should compose existing patterns. It can either:
- (a) Wrap NarrativeChatSection with roleplay-specific chrome (character header, end-condition indicator, completion button), OR
- (b) Extract shared chat rendering logic into a base component used by both

Option (a) is simpler and recommended for initial implementation.

### Anti-Pattern 5: Client-Side End-Condition Checking
**What:** Having the frontend count messages or check timers to determine when roleplay ends.
**Why bad:** The user can refresh, have stale state, or manipulate the client. End conditions should be authoritative from the backend.
**Instead:** Backend checks end conditions after each exchange and signals via SSE. Frontend displays the end state but doesn't determine it.

## New Files to Create

| File | Purpose | Complexity |
|------|---------|------------|
| `core/modules/roleplay.py` | Roleplay prompt assembly, end-condition logic, character persona building | Medium |
| `web_frontend/src/components/module/RoleplayBox.tsx` | Roleplay conversation UI component | Medium-High |

## Existing Files to Modify

| File | Change | Complexity |
|------|--------|------------|
| `content_processor/src/content-schema.ts` | Add `'roleplay'` to SEGMENT_SCHEMAS | Low |
| `content_processor/src/parser/lens.ts` | Add roleplay to segment types, parse fields, convertSegment case | Low |
| `web_frontend/src/types/module.ts` | Add `RoleplaySegment` type | Low |
| `web_frontend/src/views/Module.tsx` | Add `case "roleplay"` to renderSegment | Low |
| `web_api/routes/module.py` | Detect roleplay segments in event_generator | Medium |
| `core/modules/types.py` | Add RoleplaySegment dataclass (optional, for Python type hints) | Low |
| `core/scoring.py` | Handle roleplay transcript scoring | Medium |
| `web_frontend/src/components/module/TestSection.tsx` | Support roleplay segments alongside questions | Medium |
| `core/tables.py` | Possibly add 'roleplay' to chat_sessions content_type constraint | Low |

## Suggested Build Order

Based on dependency analysis of the existing pipeline:

```
Phase 1: Content Parsing (no runtime dependencies)
  1. content-schema.ts -- define fields
  2. lens.ts -- parse #### Roleplay
  3. types/module.ts -- frontend types
  4. core/modules/types.py -- backend types

Phase 2: Backend Core (depends on Phase 1)
  5. core/modules/roleplay.py -- prompt assembly + end-condition
  6. web_api/routes/module.py -- route roleplay segments

Phase 3: Frontend Component (depends on Phases 1-2)
  7. RoleplayBox.tsx -- conversation UI
  8. Module.tsx -- renderSegment case

Phase 4: Assessment & Test Integration (depends on Phase 3)
  9. core/scoring.py -- transcript scoring
  10. TestSection.tsx -- roleplay in tests
  11. question routes -- roleplay completion recording

Phase 5: Polish
  12. End-condition UI indicators
  13. Character avatar/styling
  14. Session resume (partially handled by existing chat session)
```

**Rationale:** Content parsing is independent and unblocks both backend and frontend. Backend prompt logic must exist before the frontend can test. Assessment is layered on top of working conversations.

## Scalability Considerations

| Concern | At 100 users | At 10K users | At 1M users |
|---------|--------------|--------------|-------------|
| Chat session JSONB size | No issue (< 50 messages typical) | No issue | Consider archiving long conversations |
| SSE connections | Negligible | Standard SSE scaling | Need connection pooling or switch to WebSockets |
| LLM API calls | Direct calls fine | Rate limiting per user | Queue system, provider fallback |
| Scoring backlog | Background tasks fine | Monitor queue depth | Dedicated scoring worker |
| Transcript storage | JSONB in question_responses | Index by module_slug | Consider separate transcript storage |

## Sources

All analysis based on direct codebase examination:
- `core/modules/chat.py` -- existing chat prompt assembly
- `core/modules/llm.py` -- LLM provider abstraction
- `core/modules/chat_sessions.py` -- session management
- `core/scoring.py` -- assessment pipeline
- `core/tables.py` -- database schema
- `web_api/routes/module.py` -- SSE streaming route
- `web_api/routes/questions.py` -- question response API
- `content_processor/src/parser/lens.ts` -- content parsing
- `content_processor/src/content-schema.ts` -- field definitions
- `web_frontend/src/types/module.ts` -- frontend types
- `web_frontend/src/views/Module.tsx` -- segment rendering
- `web_frontend/src/components/module/NarrativeChatSection.tsx` -- chat UI
- `web_frontend/src/components/module/AnswerBox.tsx` -- question UI
- `web_frontend/src/components/module/TestSection.tsx` -- test management
- `web_frontend/src/hooks/useVoiceRecording.ts` -- voice input
- `web_frontend/src/api/modules.ts` -- API client
