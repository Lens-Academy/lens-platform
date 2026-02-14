# Phase 7: Answer Box - Research

**Researched:** 2026-02-14
**Domain:** React component (auto-saving textarea with voice input), API integration for assessment responses
**Confidence:** HIGH

## Summary

This phase builds a frontend component (`AnswerBox`) that renders inline within module content as a new segment type (`question`). The component needs: an auto-expanding textarea, debounced auto-save to the backend, a "Finish" button to mark completion, voice input reusing existing recording infrastructure, and visual indicators for save state and character count.

The backend infrastructure (Phase 6) already provides the `POST /api/assessments/responses` endpoint for creating records and `GET` endpoints for retrieving them. However, the current schema is insert-only (no `updated_at`, no update endpoint). Auto-save requires either (a) adding a PATCH endpoint + `updated_at` column, or (b) using a "save on finish only" approach with local persistence. Given the explicit decision for "Google Docs style continuous save," option (a) is the correct path -- the schema needs a migration to add `updated_at` and `completed_at` columns, and the API needs a PATCH endpoint to update existing response text.

The frontend question segment type (`QuestionSegment`) does not yet exist in `web_frontend/src/types/module.ts` -- it needs to be added to match the content processor's output type. The voice recording logic (MediaRecorder, AudioContext, volume visualization, transcription API) already exists in `NarrativeChatSection.tsx` and should be extracted into a reusable hook (`useVoiceRecording`) rather than duplicated.

**Primary recommendation:** Use a plain `<textarea>` (not a rich text editor) with auto-expanding behavior, extract voice recording into a shared hook, add `updated_at`/`completed_at` columns to assessment_responses, create PATCH endpoint for auto-save, and build the AnswerBox as a new segment renderer in the existing Module view pattern.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React 19 | 19.x | Component framework | Already in use |
| Tailwind CSS v4 | 4.x | Styling | Already in use, CSS-first config |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none new) | - | - | No new libraries needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Plain textarea | Lexical (rich text editor) | Lexical is overkill for plain text with no formatting. Adds ~50KB+ bundle, complexity, and no value since the decision is "plain text content for now." A textarea with good UX (auto-expand, character count) is sufficient. |
| Custom debounce | lodash.debounce | Lodash is not in the project. A simple `useRef`+`setTimeout` debounce is 10 lines and avoids a dependency. |

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### Recommended Project Structure
```
web_frontend/src/
├── components/module/
│   └── AnswerBox.tsx            # Main answer box component
├── hooks/
│   ├── useVoiceRecording.ts     # Extracted from NarrativeChatSection
│   └── useAutoSave.ts           # Debounced auto-save hook
├── api/
│   └── assessments.ts           # API client for assessment endpoints
└── types/
    └── module.ts                # Add QuestionSegment type
```

### Pattern 1: Segment Renderer Integration
**What:** AnswerBox is added as a new case in the `renderSegment` function in `Module.tsx`, matching the existing pattern for text, article-excerpt, video-excerpt, and chat segments.
**When to use:** When rendering a segment with `type: "question"`
**Example:**
```typescript
// In Module.tsx renderSegment function
case "question":
  return (
    <AnswerBox
      key={`question-${keyPrefix}`}
      questionId={segment.questionId}  // derived from content position
      userInstruction={segment.userInstruction}
      maxChars={segment.maxChars}
      enforceVoice={segment.enforceVoice}
      moduleSlug={module.slug}
      sectionIndex={sectionIndex}
      segmentIndex={segmentIndex}
      contentId={section.contentId}
      learningOutcomeId={
        "learningOutcomeId" in section ? section.learningOutcomeId : null
      }
    />
  );
```

### Pattern 2: Auto-Save with Debounce (useAutoSave hook)
**What:** A custom hook that manages the lifecycle of a response record: lazy creation on first input, debounced updates on subsequent input, and explicit completion marking.
**When to use:** For the AnswerBox component's persistence layer.
**State machine:**
```
idle -> (first keystroke) -> creating -> saving -> saved -> (edit) -> saving -> saved -> (finish) -> completed
                                          |                              |
                                          +--- (error) -> error ---------+
```
**Example:**
```typescript
// Source: Custom hook based on existing patterns in this codebase
function useAutoSave({
  questionId,
  moduleSlug,
  learningOutcomeId,
  contentId,
  debounceMs = 2000,
}: AutoSaveOptions) {
  const [responseId, setResponseId] = useState<number | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [completedAt, setCompletedAt] = useState<string | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const save = useCallback(async (text: string, metadata: Record<string, unknown>) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    timeoutRef.current = window.setTimeout(async () => {
      setSaveStatus("saving");
      try {
        if (responseId === null) {
          // Create new response
          const result = await createResponse({ questionId, moduleSlug, ... , answerText: text, metadata });
          setResponseId(result.response_id);
        } else {
          // Update existing response
          await updateResponse(responseId, { answerText: text, metadata });
        }
        setSaveStatus("saved");
      } catch {
        setSaveStatus("error");
      }
    }, debounceMs);
  }, [responseId, questionId, moduleSlug, ...]);

  const markComplete = useCallback(async () => { ... }, [responseId]);

  return { saveStatus, completedAt, save, markComplete };
}
```

### Pattern 3: Extract Voice Recording Hook
**What:** The ~200 lines of recording logic in `NarrativeChatSection.tsx` (lines 127-417) extracted into a reusable hook.
**When to use:** Both NarrativeChatSection (chat) and AnswerBox (answer input) need voice recording with the same UX.
**Interface:**
```typescript
interface UseVoiceRecordingOptions {
  onTranscription: (text: string) => void;
  onError: (message: string) => void;
  maxRecordingTime?: number;  // default 120s
  warningTime?: number;       // default 60s
}

interface UseVoiceRecordingReturn {
  recordingState: "idle" | "recording" | "transcribing";
  recordingTime: number;
  volumeBars: number[];
  showRecordingWarning: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  handleMicClick: () => void;
}
```

### Pattern 4: Question ID Generation
**What:** Each question needs a stable ID for the database `question_id` field. The content processor does not currently generate IDs -- the question_id must be deterministic and derived from the question's position in the content.
**Approach:** Use `{moduleSlug}:{sectionIndex}:{segmentIndex}` as the question_id. This is stable as long as content structure doesn't change. If a content-author-provided ID field is added to the markdown later (e.g., `id:: q1`), it can override this default.
**Example:**
```typescript
const questionId = `${moduleSlug}:${sectionIndex}:${segmentIndex}`;
```

### Anti-Patterns to Avoid
- **Copying voice recording code:** The NarrativeChatSection has ~200 lines of recording logic. Copying it into AnswerBox would create a maintenance nightmare. Extract into `useVoiceRecording` hook first.
- **Submitting on every keystroke without debounce:** This would overwhelm the API. Always debounce writes.
- **Using `onBlur` for auto-save:** Users may tab away to read content and come back. `onBlur` alone is insufficient -- use debounced `onChange` + `beforeunload` as a safety net.
- **Blocking UI during save:** Auto-save should be invisible. Never show a spinner or disable the textarea during saves.
- **Rich text editor for plain text:** Lexical, Slate, etc. are heavy and unnecessary when the requirement is plain text only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Auto-expanding textarea | CSS-only `field-sizing: content` | CSS `field-sizing: content` with JS fallback | Modern CSS feature, but needs fallback for Safari < 18. Use the same JS approach as NarrativeChatSection (set `textarea.style.height = textarea.scrollHeight`) as primary approach since the codebase already uses it. |
| Voice recording + transcription | Custom recording pipeline | Extract existing code from NarrativeChatSection into `useVoiceRecording` hook | Already battle-tested in the codebase with volume bars, timer, error handling, cleanup. |
| Debounce | Custom timing logic | Simple `useRef`+`setTimeout` pattern | Standard pattern, 10 lines. No library needed. |
| Anonymous token management | Custom token generation | Existing `getAnonymousToken()` from `hooks/useAnonymousToken` | Already handles creation, storage, and retrieval. |

**Key insight:** Nearly everything needed already exists in the codebase -- voice recording, anonymous auth, auto-resize textarea, segment rendering pattern, API client structure. The primary work is composing existing patterns into a new component.

## Common Pitfalls

### Pitfall 1: Race Conditions in Auto-Save
**What goes wrong:** User types fast, multiple save requests fire concurrently, responses arrive out of order. The "create" request returns a response_id, but a concurrent "update" fires before create completes, hitting a null response_id.
**Why it happens:** Debounce timeout fires create, user types more immediately, next debounce fires before create response arrives.
**How to avoid:** Queue saves sequentially. When a save is in-flight, buffer the next save request rather than firing it. Use a ref to track whether a save is currently in progress.
**Warning signs:** Console errors about null response_id, "not found" 404 on PATCH requests.

### Pitfall 2: Lost Input on Unmount
**What goes wrong:** User navigates to next section (paginated mode) while a debounced save is pending. The timeout is cleared on unmount, and the latest text is lost.
**Why it happens:** `useEffect` cleanup clears the debounce timeout, and the component unmounts before the save fires.
**How to avoid:** In the cleanup function, flush any pending save immediately (synchronous or `navigator.sendBeacon`). Also persist to `sessionStorage` as a belt-and-suspenders approach.
**Warning signs:** Users report losing text when navigating quickly between sections.

### Pitfall 3: Textarea Height Not Resetting
**What goes wrong:** Auto-expanding textarea grows but never shrinks when text is deleted.
**Why it happens:** Setting `height = scrollHeight` doesn't shrink below current height because scrollHeight includes the current rendered height.
**How to avoid:** Reset `textarea.style.height = 'auto'` before reading `scrollHeight` (this is already done correctly in NarrativeChatSection line 183-188). Follow the same pattern.
**Warning signs:** Textarea stays tall after deleting content.

### Pitfall 4: Stale Closure in Debounce Callback
**What goes wrong:** The debounce callback captures stale state values (especially `responseId`), leading to creating duplicate records instead of updating.
**Why it happens:** JavaScript closures capture values at the time of function creation, not at call time.
**How to avoid:** Use `useRef` for values that the debounce callback needs to read at call time (e.g., `responseIdRef`), or use `useCallback` with proper dependencies.
**Warning signs:** Multiple response records created for the same question when only one was expected.

### Pitfall 5: Voice Input UX Confusion with AnswerBox vs Chat
**What goes wrong:** User records voice, transcription appears, but they're confused about whether to press "Finish" (answer) or "Send" (chat-style).
**Why it happens:** AnswerBox and Chat have different submission semantics but similar voice input UX.
**How to avoid:** After transcription, text simply appears in the textarea (editable). The user must explicitly press "Finish" to mark complete. Make it clear this is a writing area, not a chat. The "Finish" button should be visually distinct from a "Send" button.

## Code Examples

### Auto-Expanding Textarea (from existing codebase)
```typescript
// Source: NarrativeChatSection.tsx lines 181-189
useEffect(() => {
  const textarea = textareaRef.current;
  if (textarea) {
    textarea.style.height = "auto";
    const maxHeight = 400; // Allow more height than chat (200px)
    const needsScroll = textarea.scrollHeight > maxHeight;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = needsScroll ? "auto" : "hidden";
  }
}, [text]);
```

### API Client for Assessment Auto-Save
```typescript
// Source: Pattern from api/progress.ts and api/modules.ts
import { API_URL } from "../config";
import { getAnonymousToken } from "../hooks/useAnonymousToken";
import { fetchWithRefresh } from "./fetchWithRefresh";

const API_BASE = API_URL;

export interface CreateResponseRequest {
  question_id: string;
  module_slug: string;
  learning_outcome_id?: string | null;
  content_id?: string | null;
  answer_text: string;
  answer_metadata?: Record<string, unknown>;
}

export interface CreateResponseResult {
  response_id: number;
  created_at: string;
}

export async function createAssessmentResponse(
  req: CreateResponseRequest,
): Promise<CreateResponseResult> {
  const res = await fetchWithRefresh(`${API_BASE}/api/assessments/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Anonymous-Token": getAnonymousToken(),
    },
    credentials: "include",
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error("Failed to create response");
  return res.json();
}

export async function updateAssessmentResponse(
  responseId: number,
  answerText: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const res = await fetchWithRefresh(
    `${API_BASE}/api/assessments/responses/${responseId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Anonymous-Token": getAnonymousToken(),
      },
      credentials: "include",
      body: JSON.stringify({
        answer_text: answerText,
        ...(metadata ? { answer_metadata: metadata } : {}),
      }),
    },
  );
  if (!res.ok) throw new Error("Failed to update response");
}

export async function completeAssessmentResponse(
  responseId: number,
): Promise<void> {
  const res = await fetchWithRefresh(
    `${API_BASE}/api/assessments/responses/${responseId}/complete`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Anonymous-Token": getAnonymousToken(),
      },
      credentials: "include",
    },
  );
  if (!res.ok) throw new Error("Failed to complete response");
}

export async function getExistingResponses(
  moduleSlug: string,
  questionId?: string,
): Promise<Array<{
  response_id: number;
  question_id: string;
  answer_text: string;
  answer_metadata: Record<string, unknown>;
  completed_at: string | null;
}>> {
  const params = new URLSearchParams({ module_slug: moduleSlug });
  if (questionId) params.set("question_id", questionId);
  const res = await fetchWithRefresh(
    `${API_BASE}/api/assessments/responses?${params}`,
    {
      headers: { "X-Anonymous-Token": getAnonymousToken() },
      credentials: "include",
    },
  );
  if (!res.ok) throw new Error("Failed to fetch responses");
  const data = await res.json();
  return data.responses;
}
```

### AnswerBox Component Structure
```tsx
// Source: Component design following existing codebase patterns
interface AnswerBoxProps {
  questionId: string;
  userInstruction: string;
  maxChars?: number;
  enforceVoice?: boolean;
  moduleSlug: string;
  sectionIndex: number;
  segmentIndex: number;
  contentId?: string | null;
  learningOutcomeId?: string | null;
}

export default function AnswerBox({
  questionId,
  userInstruction,
  maxChars,
  enforceVoice,
  moduleSlug,
  ...props
}: AnswerBoxProps) {
  const [text, setText] = useState("");
  const [isCompleted, setIsCompleted] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-save hook handles create/update lifecycle
  const { saveStatus, save, markComplete } = useAutoSave({
    questionId,
    moduleSlug,
    learningOutcomeId: props.learningOutcomeId,
    contentId: props.contentId,
  });

  // Voice recording hook (extracted from NarrativeChatSection)
  const {
    recordingState,
    recordingTime,
    volumeBars,
    showRecordingWarning,
    handleMicClick,
  } = useVoiceRecording({
    onTranscription: (transcribed) => {
      const newText = text ? `${text} ${transcribed}` : transcribed;
      setText(newText);
      save(newText, { voice_used: true });
    },
    onError: (msg) => setErrorMessage(msg),
  });

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    if (maxChars && newText.length > maxChars) return; // Enforce maxChars
    setText(newText);
    save(newText, {});
  };

  const handleFinish = async () => {
    await markComplete();
    setIsCompleted(true);
  };

  return (
    <div className="py-4 px-4">
      <div className="max-w-content mx-auto">
        {/* Question prompt */}
        <p className="text-gray-700 mb-3 leading-relaxed">
          {userInstruction}
        </p>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          disabled={isCompleted}
          placeholder="Type your answer..."
          className="w-full border border-gray-200 rounded-lg px-4 py-3
            focus:outline-none focus:ring-2 focus:ring-blue-500
            resize-none leading-relaxed bg-white
            disabled:bg-gray-50 disabled:text-gray-500"
          rows={3}
        />

        {/* Footer: char count, save status, mic, finish */}
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-3 text-sm text-gray-400">
            {maxChars && (
              <span>{text.length}/{maxChars}</span>
            )}
            <SaveIndicator status={saveStatus} />
          </div>

          <div className="flex items-center gap-2">
            <MicButton
              recordingState={recordingState}
              onClick={handleMicClick}
              enforceVoice={enforceVoice}
            />
            {!isCompleted && text.trim() && (
              <button onClick={handleFinish} className="...">
                Finish
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

### SaveIndicator Component
```tsx
// Minimal save status indicator
function SaveIndicator({ status }: { status: "idle" | "saving" | "saved" | "error" }) {
  if (status === "idle") return null;
  if (status === "saving") return <span className="text-gray-400 text-sm">Saving...</span>;
  if (status === "saved") return <span className="text-green-500 text-sm">Saved</span>;
  if (status === "error") return <span className="text-red-500 text-sm">Save failed</span>;
  return null;
}
```

## Schema Changes Required

The current `assessment_responses` table (Phase 6) needs these additions for auto-save support:

### New Columns
```python
# Add to assessment_responses table in core/tables.py
Column("updated_at", TIMESTAMP(timezone=True), server_default=func.now()),
Column("completed_at", TIMESTAMP(timezone=True), nullable=True),
```

### New API Endpoints
```
PATCH /api/assessments/responses/{response_id}    # Update answer_text during auto-save
POST  /api/assessments/responses/{response_id}/complete  # Mark as finished
```

### New Core Functions
```python
# Add to core/assessments.py
async def update_response(conn, *, response_id, answer_text, answer_metadata=None) -> dict
async def complete_response(conn, *, response_id) -> dict  # Sets completed_at
```

### Migration
```
alembic revision --autogenerate -m "add updated_at and completed_at to assessment_responses"
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Submit button sends data | Auto-save with debounce | Standard since Google Docs ~2010 | UX expectation; users expect no data loss |
| Rich text editor for all text input | Plain textarea for plain text | Always been the case | Don't over-engineer; match the requirement |
| `field-sizing: content` CSS | JS-based auto-expand | `field-sizing` is CSS4, Safari 18+ only | Use JS approach (already in codebase) for full browser support |

**Deprecated/outdated:**
- None relevant. The technology choices (React, Tailwind, plain textarea) are stable and current.

## Open Questions

1. **Question ID stability**
   - What we know: The content processor doesn't generate stable IDs for questions. Position-based IDs (`moduleSlug:sectionIndex:segmentIndex`) work but break if content is reordered.
   - What's unclear: Whether content authors will add `id::` fields to their markdown questions.
   - Recommendation: Use position-based IDs for now. If/when content-authored IDs are added to the markdown schema, prefer those. Document this as a known limitation.

2. **Loading existing answers on mount**
   - What we know: `GET /api/assessments/responses?module_slug=X&question_id=Y` returns all responses. For "multiple attempts" (no unique constraint), there may be multiple records.
   - What's unclear: Which record to load on mount -- the most recent? Only uncompleted ones?
   - Recommendation: Load the most recent response for this question. If it's completed (has `completed_at`), show it as read-only. If uncompleted, resume editing. If none exists, start fresh. The `GET` endpoint already returns `created_at DESC` order.

3. **Error recovery during auto-save**
   - What we know: Network failures can happen during debounced saves.
   - What's unclear: How aggressive to retry, whether to show error inline or as a toast.
   - Recommendation: Retry once after 3 seconds. Show inline "Save failed" text (not a toast). Keep the text in local state so nothing is lost. The user can continue typing; next successful save will persist everything.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `web_frontend/src/components/module/NarrativeChatSection.tsx` -- Voice recording implementation (lines 127-417), auto-resize textarea (lines 181-189)
- Codebase analysis: `web_frontend/src/types/module.ts` -- Current segment types (no QuestionSegment yet)
- Codebase analysis: `web_frontend/src/views/Module.tsx` -- `renderSegment` function (lines 808-901) showing segment rendering pattern
- Codebase analysis: `web_api/routes/assessments.py` -- Current API endpoints (POST create, GET list, GET by question)
- Codebase analysis: `core/tables.py` -- `assessment_responses` table schema (lines 434-466, no updated_at/completed_at)
- Codebase analysis: `content_processor/src/index.ts` -- QuestionSegment type definition
- Codebase analysis: `web_frontend/src/api/modules.ts` -- `transcribeAudio` function, `fetchWithTimeout` pattern
- Codebase analysis: `web_frontend/src/hooks/useAnonymousToken.ts` -- Anonymous auth pattern

### Secondary (MEDIUM confidence)
- Phase 6 summary: `.planning/phases/06-data-foundation/06-02-SUMMARY.md` -- What was built, content parsing decisions
- Phase 7 context: `.planning/phases/07-answer-box/07-CONTEXT.md` -- User decisions constraining this phase

### Tertiary (LOW confidence)
- None. All findings are based on direct codebase analysis.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new libraries needed; everything uses existing codebase technology
- Architecture: HIGH - Component structure follows established patterns in Module.tsx, segment rendering, API client structure
- Pitfalls: HIGH - Identified from analyzing existing codebase patterns (auto-resize, voice recording, API error handling)
- Schema changes: HIGH - Direct analysis of current table definition reveals the gap

**Research date:** 2026-02-14
**Valid until:** 2026-03-14 (stable technology, no fast-moving dependencies)
