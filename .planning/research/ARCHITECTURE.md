# Architecture Patterns: Prompt Lab Evaluation Workbench

**Domain:** Prompt engineering evaluation tool integrated into existing AI Safety Course Platform
**Researched:** 2026-02-20
**Confidence:** HIGH (based on direct codebase analysis of ws2 and ws3 branches)

## Recommended Architecture

The Prompt Lab integrates as a **new facilitator-only feature area** within the existing 3-layer architecture. It does NOT require new database tables, new services, or architectural changes. It reuses the existing LLM abstraction, content cache, and auth system, adding only new API routes and frontend pages.

### Architecture Decision: New Module, Not Extension

**Decision:** Create `core/promptlab/` as a new core subdirectory, NOT extend `core/modules/chat.py`.

**Rationale:**
- `chat.py` is tightly coupled to the student learning flow: it builds prompts from `Stage` objects, includes the `transition_to_next` tool, and assumes a module/section/segment context. Prompt Lab needs none of this -- it takes arbitrary system prompts and message histories.
- `scoring.py` (in ws3) is tightly coupled to the `assessment_responses`/`assessment_scores` tables and fire-and-forget background scoring. Prompt Lab needs synchronous, non-persisted scoring with chain-of-thought visible to the facilitator.
- The shared primitive is `core/modules/llm.py` (`stream_chat()` and `complete()`). Both chat eval and assessment eval should call these directly.

```
core/
  promptlab/             # NEW - Prompt Lab business logic
    __init__.py
    chat_eval.py         # Chat regeneration logic
    assessment_eval.py   # Assessment scoring logic (when ws3 merges)
    fixtures.py          # Fixture loading from JSON files

web_api/routes/
  promptlab.py           # NEW - API endpoints for Prompt Lab

web_frontend/src/
  pages/promptlab/       # NEW - Vike route page
    +Page.tsx
    +title.ts
    +config.ts
  views/PromptLab/       # NEW - Main view components
    PromptLab.tsx         # Top-level view (mode switcher)
    ChatEval.tsx          # Chat evaluation mode
    AssessmentEval.tsx    # Assessment evaluation mode (Phase 2)
  components/promptlab/   # NEW - Shared components
    PromptEditor.tsx      # System prompt textarea with base/instructions split
    MessageList.tsx       # Scrollable message history (reuses ChatMarkdown)
    FixtureSelector.tsx   # Dropdown/picker for loading fixtures
    StreamingResponse.tsx # Shows streaming AI response
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `core/promptlab/chat_eval.py` | Build custom system prompt, call `stream_chat()` with truncated history | `core/modules/llm.py`, `core/modules/content.py` |
| `core/promptlab/assessment_eval.py` | Build custom scoring prompt, call `complete()`, return structured score | `core/modules/llm.py` |
| `core/promptlab/fixtures.py` | Load fixture JSON files from `fixtures/` directory | Filesystem |
| `web_api/routes/promptlab.py` | Facilitator-authed API endpoints, SSE streaming | `core/promptlab/*`, `web_api/auth.py` |
| `web_frontend/.../PromptLab.tsx` | Orchestrate UI state, mode switching | API client |
| `web_frontend/.../ChatEval.tsx` | Fixture loading, prompt editing, regeneration, follow-up chat | `/api/promptlab/chat/*` |
| `web_frontend/.../AssessmentEval.tsx` | Fixture loading, scoring prompt editing, score display | `/api/promptlab/assessment/*` |

### Data Flow: Chat Eval Mode

```
1. LOAD FIXTURE
   Frontend: GET /api/promptlab/fixtures/chat
   -> core/promptlab/fixtures.py reads fixtures/chat/*.json
   -> Returns list of fixture metadata (name, module_slug, description)

   Frontend: GET /api/promptlab/fixtures/chat/{fixture_id}
   -> Returns full fixture: {messages, module_slug, section_context, original_system_prompt}

2. DISPLAY & EDIT
   Frontend renders:
   - Left panel: Message history (read-only up to regeneration point)
   - Right panel: System prompt editor (base prompt + instructions, editable)
   - Controls: "Regenerate from here" button, truncation point selector

3. REGENERATE
   Frontend: POST /api/promptlab/chat/regenerate (SSE streaming)
   Body: {
     messages: [...truncated history up to selected point...],
     system_prompt: "...edited prompt...",
     previous_content: "...context string (optional)..."
   }
   -> core/promptlab/chat_eval.py:
      - Accepts raw system prompt (no _build_system_prompt() -- facilitator controls it)
      - Calls stream_chat(messages, system=custom_prompt)
      - Streams back {"type": "text", "content": "..."} / {"type": "done"}
   -> Frontend accumulates streaming response, displays in real-time

4. FOLLOW-UP (interactive student mode)
   Frontend: POST /api/promptlab/chat/regenerate
   Body: {
     messages: [...truncated + AI response + new user message...],
     system_prompt: "...same edited prompt...",
     previous_content: "..."
   }
   -> Same endpoint, just longer message history
   -> Frontend appends to conversation

5. NO PERSISTENCE
   Nothing is saved to database. Prompt Lab is ephemeral by design.
   Facilitators copy prompts they like into the content YAML manually.
```

### Data Flow: Assessment Eval Mode

```
1. LOAD FIXTURE
   Frontend: GET /api/promptlab/fixtures/assessment
   -> Returns list of assessment fixtures (student answers with ground-truth scores)

   Frontend: GET /api/promptlab/fixtures/assessment/{fixture_id}
   -> Returns: {
        question_text, student_answer, ground_truth_score,
        ground_truth_reasoning, module_slug, learning_outcome_name, mode
      }

2. DISPLAY & EDIT
   Frontend renders:
   - Left panel: Question + student answer (read-only)
   - Right panel: Scoring prompt editor (editable)
   - Ground truth panel: Expected score + reasoning (read-only, for comparison)

3. RUN SCORING
   Frontend: POST /api/promptlab/assessment/score
   Body: {
     question_text, student_answer, scoring_prompt,
     mode: "socratic" | "assessment"
   }
   -> core/promptlab/assessment_eval.py:
      - Builds messages from question + answer
      - Calls complete(messages, system=custom_scoring_prompt, response_format=SCORE_SCHEMA)
      - Returns full score_data JSON (NOT background task -- synchronous)
   -> Frontend displays: overall_score, reasoning, dimensions, key_observations
   -> Side-by-side with ground truth for comparison

4. NO PERSISTENCE
   Same as chat eval -- ephemeral. Results are visual comparison only.
```

## Patterns to Follow

### Pattern 1: Facilitator Auth Guard (existing pattern)
**What:** Reuse the `get_db_user_or_403()` pattern from `facilitator.py` routes.
**When:** All Prompt Lab endpoints.
**Example:**
```python
# web_api/routes/promptlab.py
from web_api.auth import get_current_user

async def require_facilitator(user: dict = Depends(get_current_user)) -> dict:
    """Require facilitator or admin role."""
    discord_id = user["sub"]
    async with get_connection() as conn:
        db_user = await get_user_by_discord_id(conn, discord_id)
        if not db_user:
            raise HTTPException(403, "User not found")
        admin = await is_admin(conn, db_user["user_id"])
        facilitator_groups = await get_facilitator_group_ids(conn, db_user["user_id"])
        if not admin and not facilitator_groups:
            raise HTTPException(403, "Facilitator access required")
        return db_user

@router.post("/chat/regenerate")
async def regenerate_chat(
    request: RegenerateRequest,
    user: dict = Depends(require_facilitator),
) -> StreamingResponse:
    ...
```

### Pattern 2: SSE Streaming (existing pattern)
**What:** Reuse the exact SSE streaming pattern from `web_api/routes/module.py`.
**When:** Chat eval regeneration endpoint.
**Example:**
```python
# Identical to module.py's event_generator pattern
async def eval_stream_generator(system_prompt: str, messages: list[dict]):
    """Stream LLM response for evaluation."""
    try:
        async for chunk in stream_chat(
            messages=messages,
            system=system_prompt,
            max_tokens=2048,  # Longer for eval
        ):
            yield f"data: {json.dumps(chunk)}\n\n"
    except Exception as e:
        yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        yield f"data: {json.dumps({'type': 'done'})}\n\n"

@router.post("/chat/regenerate")
async def regenerate_chat(request: RegenerateRequest, ...):
    return StreamingResponse(
        eval_stream_generator(request.system_prompt, request.messages),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )
```

### Pattern 3: Frontend SSE Consumer (existing pattern)
**What:** Reuse the `sendMessage()` async generator pattern from `web_frontend/src/api/modules.ts`.
**When:** Chat eval streaming in frontend.
**Example:**
```typescript
// web_frontend/src/api/promptlab.ts
export async function* regenerateChat(
  messages: Array<{role: string; content: string}>,
  systemPrompt: string,
  previousContent?: string,
): AsyncGenerator<{type: string; content?: string}> {
  const res = await fetchWithRefresh(`${API_URL}/api/promptlab/chat/regenerate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ messages, system_prompt: systemPrompt, previous_content: previousContent }),
  });
  if (!res.ok) throw new Error("Failed to regenerate");
  // ... same SSE reader as sendMessage() in modules.ts
}
```

### Pattern 4: Fixture Files as JSON in Repo
**What:** Store fixtures as JSON files in a `fixtures/` directory at repo root, loaded by `core/promptlab/fixtures.py`.
**When:** Both chat and assessment eval modes.
**Why:** Fixtures are developer/facilitator authored test data, NOT user data. They belong in the repo, not the database. They change with code, reviewed in PRs.

```
fixtures/
  chat/
    intro-module-good-conversation.json
    challenging-student-response.json
    off-topic-student.json
  assessment/
    strong-answer-alignment-module.json
    weak-answer-needs-improvement.json
    edge-case-partial-understanding.json
```

**Chat fixture format:**
```json
{
  "name": "Good conversation about alignment basics",
  "description": "Student engages well, asks follow-up questions",
  "module_slug": "cognitive-superpowers",
  "section_index": 0,
  "segment_index": 1,
  "original_system_prompt": {
    "base": "You are a tutor helping someone learn about AI safety...",
    "instructions": "Discuss the key takeaways from the article..."
  },
  "previous_content": "The article text that was shown to the student...",
  "messages": [
    {"role": "user", "content": "I found the concept of..."},
    {"role": "assistant", "content": "Great observation! ..."},
    {"role": "user", "content": "But what about..."},
    {"role": "assistant", "content": "That's an important nuance..."}
  ]
}
```

**Assessment fixture format:**
```json
{
  "name": "Strong answer on alignment",
  "description": "Student demonstrates solid understanding",
  "module_slug": "intro-to-alignment",
  "question_id": "intro-to-alignment:2:0",
  "question_text": "Explain the alignment problem in your own words.",
  "learning_outcome_name": "Understanding AI Alignment",
  "mode": "assessment",
  "student_answer": "The alignment problem is about ensuring...",
  "ground_truth": {
    "overall_score": 4,
    "reasoning": "Student shows good conceptual understanding...",
    "dimensions": {
      "accuracy": {"score": 4, "note": "Correct core concept"},
      "depth": {"score": 3, "note": "Could elaborate more"}
    }
  }
}
```

### Pattern 5: Vike Page with Facilitator Guard (existing pattern)
**What:** New page at `/promptlab` with facilitator auth check, following the same structure as `/facilitator`.
**When:** Frontend route setup.
**Example:**
```tsx
// web_frontend/src/pages/promptlab/+Page.tsx
import Layout from "@/components/Layout";
import PromptLab from "@/views/PromptLab/PromptLab";

export default function PromptLabPage() {
  return (
    <Layout>
      <PromptLab />
    </Layout>
  );
}

// web_frontend/src/pages/promptlab/+config.ts
export default { ssr: false };
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Extending chat.py's _build_system_prompt()
**What:** Adding a "custom prompt mode" or "eval mode" parameter to the existing `_build_system_prompt()` function.
**Why bad:** This function's job is to build prompts from Stage objects for the student learning flow. Adding a bypass for Prompt Lab would create a god-function with two completely different code paths. The Prompt Lab doesn't use Stages at all -- it takes raw prompt text.
**Instead:** Call `stream_chat()` directly from `core/promptlab/chat_eval.py` with the facilitator's custom system prompt.

### Anti-Pattern 2: Storing eval results in the database
**What:** Creating new tables for Prompt Lab sessions, results, or prompt versions.
**Why bad:** Premature persistence. Prompt Lab is an internal development tool. The output is "which prompt text do we want to use?" -- that goes into content YAML, not a database. Adding tables creates migration burden and schema coupling for what is essentially a scratch pad.
**Instead:** Keep it ephemeral. If persistence is needed later (e.g., A/B testing prompts at scale), that's a separate feature with different requirements.

### Anti-Pattern 3: Reusing NarrativeChatSection component directly
**What:** Importing the student-facing `NarrativeChatSection.tsx` into the Prompt Lab.
**Why bad:** That component has student-specific UX (voice recording, mobile-first layout, scroll-to-message behavior, "Tutor"/"You" labels). Prompt Lab needs a developer-tool UX: side-by-side panels, prompt editor, "regenerate from here" controls, message truncation UI.
**Instead:** Build new components in `web_frontend/src/components/promptlab/`. Extract only the `ChatMarkdown` renderer to a shared component if needed.

### Anti-Pattern 4: Making assessment eval depend on ws3 being merged
**What:** Blocking the entire Prompt Lab feature on ws3's assessment tables and scoring.py being available.
**Why bad:** Chat eval is independently useful and has no ws3 dependency. Blocking it wastes time.
**Instead:** Build chat eval first (Phase 1). Build assessment eval as Phase 2, which can start as soon as ws3's `core/scoring.py` and `core/modules/llm.py:complete()` are available in the working branch.

### Anti-Pattern 5: Streaming assessment scoring
**What:** Using SSE streaming for the assessment eval endpoint.
**Why bad:** The scoring call uses `complete()` (non-streaming) with `response_format=SCORE_SCHEMA` for structured JSON output. Streaming structured output adds complexity for no UX benefit -- the response is a single JSON blob, not a long text.
**Instead:** Use a normal POST endpoint that returns JSON. Show a loading spinner in the frontend while waiting (typically 2-5 seconds).

## Integration Points with Existing Code

### Direct Reuse (no modification needed)

| Existing Code | How Prompt Lab Uses It |
|---------------|----------------------|
| `core/modules/llm.py:stream_chat()` | Chat eval regeneration |
| `core/modules/llm.py:complete()` | Assessment eval scoring (from ws3) |
| `web_api/auth.py:get_current_user` | Facilitator auth dependency |
| `core/queries/facilitator.py:is_admin`, `get_facilitator_group_ids` | Role check |
| `core/content/cache.py:get_cache()` | Loading module data for fixture context |
| SSE streaming pattern (module.py) | Chat eval streaming |
| `fetchWithRefresh` (frontend) | API calls |

### Needs Extraction/Refactoring

| What | Current Location | Action |
|------|-----------------|--------|
| `ChatMarkdown` component | Inline in `NarrativeChatSection.tsx` | Extract to `components/shared/ChatMarkdown.tsx` for reuse |
| `_build_system_prompt()` base text | Inline in `chat.py` | NOT extracted -- Prompt Lab takes raw text, doesn't reuse the builder |
| `SCORE_SCHEMA` | `core/scoring.py` (ws3) | Import directly when ws3 merges; no extraction needed |

### ws3 Dependencies (Assessment Eval Only)

| ws3 Code | What Prompt Lab Needs | Status |
|----------|----------------------|--------|
| `core/modules/llm.py:complete()` | Non-streaming LLM call for scoring | Must be in ws2's llm.py (currently only in ws3) |
| `core/scoring.py:SCORE_SCHEMA` | Structured output format for scores | Import from ws3's scoring.py |
| `core/scoring.py:_build_scoring_prompt()` | Reference implementation (Prompt Lab replaces this with custom prompt) | Read-only reference |
| `assessment_responses` / `assessment_scores` tables | NOT needed -- Prompt Lab doesn't persist | No dependency |

**Critical:** The `complete()` function in `llm.py` only exists in ws3. Chat eval (Phase 1) doesn't need it -- it uses `stream_chat()`. Assessment eval (Phase 2) needs `complete()` merged into ws2's `llm.py` first.

## New Files Summary

### Backend (Python)

```
core/promptlab/
  __init__.py                    # Exports: regenerate_chat_stream, run_assessment_scoring, load_fixtures
  chat_eval.py                   # ~40 lines: wraps stream_chat() with custom system prompt
  assessment_eval.py             # ~60 lines: wraps complete() with custom scoring prompt + SCORE_SCHEMA
  fixtures.py                    # ~80 lines: load/list JSON fixtures from fixtures/ directory

web_api/routes/promptlab.py      # ~120 lines: 5 endpoints (list fixtures x2, get fixture x2, regenerate chat, score assessment)

fixtures/
  chat/                          # 3-5 JSON fixture files
  assessment/                    # 3-5 JSON fixture files
```

### Frontend (TypeScript/React)

```
web_frontend/src/
  pages/promptlab/
    +Page.tsx                    # Route entry point
    +title.ts                    # "Prompt Lab"
    +config.ts                   # ssr: false

  views/PromptLab/
    PromptLab.tsx                # ~80 lines: tab switcher (Chat Eval | Assessment Eval), auth guard
    ChatEval.tsx                 # ~250 lines: fixture picker, prompt editor, message list, regenerate button, streaming display
    AssessmentEval.tsx           # ~200 lines: fixture picker, scoring prompt editor, score display, ground truth comparison

  components/promptlab/
    PromptEditor.tsx             # ~60 lines: textarea with "Base Prompt" / "Instructions" sections
    MessageList.tsx              # ~80 lines: scrollable message list with truncation point selector
    FixtureSelector.tsx          # ~40 lines: dropdown of available fixtures
    ScoreDisplay.tsx             # ~60 lines: renders score_data (overall, dimensions, observations)

  api/promptlab.ts               # ~80 lines: API client (fixture loading, regenerate stream, score)
```

## Scalability Considerations

| Concern | Current (facilitators only) | If opened to students | Notes |
|---------|----------------------------|----------------------|-------|
| LLM API costs | Negligible (3-5 facilitators) | Would need rate limiting | Not a concern for eval tool |
| Concurrent streams | 1-2 simultaneous | N/A | SSE handles this fine |
| Fixture storage | 10-20 JSON files in repo | Would need DB storage | Stay with files for now |
| Auth overhead | Facilitator check per request | N/A | Existing pattern, fast |

## Build Order Recommendation

### Phase 1: Chat Eval (no ws3 dependency)
1. Create `core/promptlab/` with `fixtures.py` and `chat_eval.py`
2. Create `fixtures/chat/` with 2-3 sample fixtures (manually extracted from real chat sessions)
3. Create `web_api/routes/promptlab.py` with fixture listing + chat regeneration endpoints
4. Register route in `main.py`
5. Extract `ChatMarkdown` to shared component
6. Build frontend: page, view, components for chat eval mode
7. Test end-to-end: load fixture, edit prompt, regenerate, follow up

### Phase 2: Assessment Eval (after ws3 merges)
1. Ensure `complete()` is available in ws2's `llm.py`
2. Create `core/promptlab/assessment_eval.py`
3. Create `fixtures/assessment/` with sample fixtures
4. Add assessment endpoints to `web_api/routes/promptlab.py`
5. Build `AssessmentEval.tsx` and `ScoreDisplay.tsx`
6. Test end-to-end: load fixture, edit scoring prompt, run scoring, compare with ground truth

## Sources

- Direct codebase analysis of ws2 and ws3 branches (HIGH confidence)
- All architecture decisions based on existing patterns observed in the codebase
- No external research needed -- this is an integration architecture document
