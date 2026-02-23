# Phase 7: Answer Box - Research

**Researched:** 2026-02-14
**Domain:** React inline answer component with auto-save, voice input, and assessment API integration
**Confidence:** HIGH

## Summary

Phase 7 introduces a free-text answer box component (`AnswerBox`) that renders inline within module content as a new segment type (`question`). The content processor already parses `question` segments with fields (`userInstruction`, `maxChars`, `enforceVoice`, `assessmentPrompt`, `maxTime`), and the flattener already passes them through to the API response. The frontend needs to: (1) add the `question` segment type to TypeScript types and the `renderSegment` switch in `Module.tsx`, (2) build the `AnswerBox` component with auto-expanding textarea and debounced auto-save, (3) add a PATCH endpoint for updating existing answers (the current API only has POST for creating new records), (4) extract the voice recording logic from `NarrativeChatSection.tsx` into a reusable `useVoiceRecording` hook.

The auto-save model requires a "lazy create then update" pattern: POST on first keystroke to create the record, then PATCH with debounced updates. A `completed_at` timestamp field needs to be added to the `assessment_responses` table to distinguish finished answers from in-progress drafts. The database schema already has `answer_metadata` JSONB for storing `voice_used`, `time_taken_s`, etc.

**Primary recommendation:** Use a plain `<textarea>` with auto-expand (no rich text library needed since content is plain text), combined with a custom `useAutoSave` hook for debounced persistence, and extract voice recording into `useVoiceRecording` hook from the existing 400+ line implementation in `NarrativeChatSection.tsx`.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React 19 | 19.2.3 | Component framework | Already in use |
| Tailwind CSS v4 | ^4 | Styling | Already in use, CSS-first config |
| FastAPI | (current) | PATCH endpoint | Already in use for assessment routes |
| SQLAlchemy | (current) | Database operations | Already in use in `core/assessments.py` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| uuid | ^13.0.0 | Generate question IDs client-side if needed | Already installed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Plain textarea | Lexical editor | Lexical adds 40KB+ bundle, React integration complexity, and rich formatting we explicitly don't need. Plain textarea with auto-expand is sufficient for plain text. |
| Custom debounce | lodash.debounce | Adding lodash for one function is wasteful; a 10-line custom debounce or `useRef`+`setTimeout` is standard React practice |
| Custom auto-expand | react-textarea-autosize | Library is tiny but unnecessary - auto-expand via `scrollHeight` is 5 lines and already done in `NarrativeChatSection.tsx` |

**No new npm packages needed.** Everything required is already in the project.

## Architecture Patterns

### Recommended Component Structure
```
web_frontend/src/
├── components/module/
│   └── AnswerBox.tsx          # New: answer box component
├── hooks/
│   ├── useAutoSave.ts         # New: debounced auto-save hook
│   └── useVoiceRecording.ts   # New: extracted from NarrativeChatSection
├── api/
│   └── assessments.ts         # New: assessment API client
└── types/
    └── module.ts              # Modified: add QuestionSegment type
```

### Pattern 1: Auto-Expanding Textarea
**What:** Textarea that grows with content, already implemented in `NarrativeChatSection.tsx`
**When to use:** For the answer box text input
**Existing code reference** (`NarrativeChatSection.tsx` lines 181-190):
```typescript
// Auto-resize textarea
useEffect(() => {
  const textarea = textareaRef.current;
  if (textarea) {
    textarea.style.height = "auto";
    const maxHeight = 200;
    const needsScroll = textarea.scrollHeight > maxHeight;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = needsScroll ? "auto" : "hidden";
  }
}, [input]);
```
For the answer box, remove the maxHeight cap (or set it much higher) since students may write long answers.

### Pattern 2: Lazy Create + Debounced Update (Auto-Save)
**What:** Create DB record on first keystroke, then debounce PATCH updates
**When to use:** For the auto-save model (Google Docs style)
**Example:**
```typescript
// useAutoSave hook pattern
function useAutoSave(questionId: string, moduleSlug: string, debounceMs = 2000) {
  const [responseId, setResponseId] = useState<number | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const timerRef = useRef<number | null>(null);
  const latestTextRef = useRef('');

  // On first change: POST to create record
  // On subsequent changes: debounced PATCH to update
  const save = useCallback(async (text: string) => {
    latestTextRef.current = text;
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = window.setTimeout(async () => {
      setSaveStatus('saving');
      try {
        if (!responseId) {
          // First save: create
          const result = await createResponse({ questionId, moduleSlug, answerText: text });
          setResponseId(result.response_id);
        } else {
          // Subsequent: update
          await updateResponse(responseId, { answerText: text });
        }
        setSaveStatus('saved');
      } catch {
        setSaveStatus('error');
      }
    }, debounceMs);
  }, [responseId, questionId, moduleSlug, debounceMs]);

  return { save, saveStatus, responseId };
}
```

### Pattern 3: Segment Rendering Integration
**What:** Adding a new segment type to the Module.tsx `renderSegment` switch
**When to use:** When the module content includes `question` segments
**Existing pattern** (from `Module.tsx` lines 808-900):
```typescript
const renderSegment = (segment, section, sectionIndex, segmentIndex) => {
  const keyPrefix = `${sectionIndex}-${segmentIndex}`;
  switch (segment.type) {
    case "text": return <AuthoredText key={...} content={segment.content} />;
    case "article-excerpt": return <ArticleEmbed key={...} ... />;
    case "video-excerpt": return <VideoEmbed key={...} ... />;
    case "chat": return <NarrativeChatSection key={...} ... />;
    // NEW:
    case "question": return <AnswerBox key={...} segment={segment} ... />;
    default: return null;
  }
};
```

### Pattern 4: Auth Header Pattern for API Calls
**What:** Using `getAnonymousToken()` and `credentials: 'include'` for auth
**When to use:** All assessment API calls (supports both authenticated and anonymous users)
**Existing pattern** (from `api/progress.ts`):
```typescript
function getAuthHeaders(isAuthenticated: boolean): AuthHeaders {
  if (isAuthenticated) return {};
  return { "X-Anonymous-Token": getAnonymousToken() };
}
```

### Anti-Patterns to Avoid
- **Submitting on every keystroke:** Use debounce (2-3s). Network calls per character would be excessive.
- **Losing text on unmount:** The textarea content must be saved before component unmounts. Use `useEffect` cleanup with `flush` to send any pending changes.
- **Unique constraint on user+question:** The existing schema deliberately allows multiple attempts. Don't add unique constraints.
- **Rich text editor for plain text:** The decisions explicitly say plain text only. A textarea is correct.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Voice recording | Custom MediaRecorder setup | Extract `useVoiceRecording` from `NarrativeChatSection.tsx` | 200+ lines of MediaRecorder, AudioContext, volume analysis, timer logic already exists and works |
| Audio transcription | Custom Whisper integration | Existing `transcribeAudio()` in `api/modules.ts` | Already handles FormData, error codes, 30s timeout |
| Auto-expanding textarea | npm package | Copy 5-line pattern from `NarrativeChatSection.tsx` | Already proven in codebase |
| Auth header management | Manual token handling | `getAnonymousToken()` + `get_user_or_anonymous` dependency | Established pattern used by assessments and progress APIs |

**Key insight:** The voice recording code in `NarrativeChatSection.tsx` is ~200 lines of stateful logic (refs for MediaRecorder, AudioContext, AnalyserNode, timers, volume bars). It must be extracted into a hook, not duplicated. The hook should return `{ recordingState, recordingTime, volumeBars, startRecording, stopRecording, errorMessage, showWarning }`.

## Common Pitfalls

### Pitfall 1: Lost Edits on Navigation
**What goes wrong:** Student types answer, navigates to next section, comes back, answer is gone.
**Why it happens:** Component unmounts and state is lost; auto-save debounce may not have fired yet.
**How to avoid:** (1) Flush pending saves on unmount via `useEffect` cleanup. (2) Load existing answer from API on mount (GET responses for this question_id). (3) Use `responseId` in state to know whether to POST or PATCH.
**Warning signs:** Answer text disappears when paginating between sections.

### Pitfall 2: Question ID Generation
**What goes wrong:** No unique `question_id` to link answers to questions across content updates.
**Why it happens:** The content processor doesn't currently generate a `question_id` for question segments.
**How to avoid:** Generate a deterministic question ID based on position: `{moduleSlug}:{sectionIndex}:{segmentIndex}`. This is stable across content refreshes as long as the question's position doesn't change. Alternatively, hash the `userInstruction` text, but this breaks if the question wording is edited.
**Warning signs:** Answers not loading for the correct question after content update.

### Pitfall 3: Race Conditions in Auto-Save
**What goes wrong:** POST (create) and PATCH (update) race if user types quickly, or multiple PATCHes overlap.
**Why it happens:** Debounced saves fire asynchronously; the first POST may not complete before a PATCH is attempted.
**How to avoid:** (1) Queue saves: don't start a new save while one is in flight. (2) Track `responseId` — if null, always POST; if set, always PATCH. (3) Use a ref for latest text so the debounced callback always sends current content.
**Warning signs:** 404 on PATCH (responseId not yet available) or duplicate records from concurrent POSTs.

### Pitfall 4: Textarea Height Jumping
**What goes wrong:** Textarea visually jumps as height recalculates during typing.
**Why it happens:** Setting `height: auto` then `scrollHeight` causes a brief collapse.
**How to avoid:** Use `requestAnimationFrame` or check if height actually changed before setting.
**Warning signs:** Visual flicker on each keystroke.

### Pitfall 5: Save Indicator Flashing
**What goes wrong:** "Saving..." flashes rapidly as the debounce fires frequently.
**Why it happens:** Each debounced save cycles through idle -> saving -> saved.
**How to avoid:** Only show "Saving..." if the save takes >300ms (use a delay). Show "Saved" with a short fade-out (1-2s).
**Warning signs:** Distracting flicker in save status.

## Code Examples

### Question Segment Type (TypeScript - frontend)
```typescript
// Add to web_frontend/src/types/module.ts
export type QuestionSegment = {
  type: "question";
  userInstruction: string;
  assessmentPrompt?: string;
  maxTime?: string;
  maxChars?: number;
  enforceVoice?: boolean;
  optional?: boolean;
};

// Update ModuleSegment union:
export type ModuleSegment =
  | TextSegment
  | ArticleExcerptSegment
  | VideoExcerptSegment
  | ChatSegment
  | QuestionSegment;
```

### PATCH Endpoint (Python - backend)
```python
# Add to web_api/routes/assessments.py
class UpdateResponseRequest(BaseModel):
    answer_text: str | None = None
    answer_metadata: dict | None = None
    completed_at: str | None = None  # ISO format, set when "Finish" clicked

@router.patch("/responses/{response_id}", response_model=SubmitResponseResponse)
async def update_assessment_response(
    response_id: int,
    body: UpdateResponseRequest,
    auth: tuple = Depends(get_user_or_anonymous),
):
    user_id, anonymous_token = auth
    async with get_transaction() as conn:
        row = await update_response(
            conn,
            response_id=response_id,
            user_id=user_id,
            anonymous_token=anonymous_token,
            answer_text=body.answer_text,
            answer_metadata=body.answer_metadata,
            completed_at=body.completed_at,
        )
    if not row:
        raise HTTPException(404, "Response not found")
    return SubmitResponseResponse(
        response_id=row["response_id"],
        created_at=row["created_at"],
    )
```

### Database Migration: Add completed_at
```python
# New Alembic migration
# Add completed_at column to assessment_responses
op.add_column('assessment_responses',
    sa.Column('completed_at', sa.TIMESTAMP(timezone=True), nullable=True)
)
```

### AnswerBox Component Skeleton
```tsx
// web_frontend/src/components/module/AnswerBox.tsx
export default function AnswerBox({
  segment,
  moduleSlug,
  sectionIndex,
  segmentIndex,
}: AnswerBoxProps) {
  const questionId = `${moduleSlug}:${sectionIndex}:${segmentIndex}`;
  const { text, setText, saveStatus, isCompleted, markComplete } = useAutoSave({
    questionId,
    moduleSlug,
    // ... other identifiers
  });

  return (
    <div className="py-6 px-4">
      <div className="max-w-content mx-auto">
        {/* Question prompt */}
        <p className="text-gray-700 mb-3">{segment.userInstruction}</p>

        {/* Text input */}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 leading-relaxed"
          placeholder="Type your answer..."
          disabled={isCompleted}
        />

        {/* Footer: save status + char count + finish button */}
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-gray-400">
            {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : ''}
          </span>
          {segment.maxChars && (
            <span className="text-xs text-gray-400">
              {text.length}/{segment.maxChars}
            </span>
          )}
          <button onClick={markComplete} disabled={!text.trim() || isCompleted}>
            {isCompleted ? 'Completed' : 'Finish'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

### Voice Recording Hook Extraction Pattern
```typescript
// web_frontend/src/hooks/useVoiceRecording.ts
// Extract from NarrativeChatSection.tsx lines 127-417
export function useVoiceRecording(options?: { onTranscription?: (text: string) => void }) {
  // All the state: recordingState, recordingTime, volumeBars, errorMessage, showRecordingWarning
  // All the refs: mediaRecorderRef, audioChunksRef, audioContextRef, etc.
  // All the functions: startRecording, stopRecording, cleanupRecording, updateAudioLevel
  // Return: { recordingState, recordingTime, volumeBars, errorMessage, showRecordingWarning,
  //           startRecording, stopRecording, handleMicClick, formatTime }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Submit button saves | Auto-save with debounce | Standard since Google Docs | No data loss on navigation/crash |
| Rich text editors (Draft.js) | Lexical (Meta) or plain textarea | 2022+ (Draft.js deprecated) | For plain text, textarea is correct |
| File upload for audio | MediaRecorder API + WebM | Widely supported 2020+ | Direct browser recording, no plugins |

**Deprecated/outdated:**
- Draft.js: Deprecated by Meta, replaced by Lexical. Not relevant here since we use plain text.
- `navigator.mediaDevices.getUserMedia` without `isTypeSupported` check: Must check codec support (already done in existing code).

## Open Questions

1. **Question ID stability across content edits**
   - What we know: Position-based IDs (`moduleSlug:sectionIndex:segmentIndex`) work if content structure doesn't change. Content processor doesn't generate IDs.
   - What's unclear: If a content author inserts a new section before an existing question, all subsequent question IDs shift, breaking links to existing answers.
   - Recommendation: Use position-based IDs for Phase 7 (simplest, works now). Consider adding explicit `id::` fields to question segments in the content processor later if content is frequently restructured. This is a content authoring concern, not an immediate code problem.

2. **Multiple attempts model**
   - What we know: The DB schema allows multiple responses per user per question (no unique constraint). The decision says "new records per the existing decision."
   - What's unclear: For auto-save, does "first keystroke creates a record" mean one record per editing session? Or one record per "Finish" click?
   - Recommendation: One record per editing session. On mount, check if an existing in-progress response exists (no `completed_at`). If so, resume editing it (PATCH). If the previous one was completed, create a new one (POST). This naturally handles "reopen in lesson mode" and "new attempt" semantics.

3. **Answer loading on mount**
   - What we know: GET `/api/assessments/responses?question_id=X&module_slug=Y` returns all responses for a question.
   - What's unclear: How to efficiently determine "most recent in-progress" vs "most recent completed" response.
   - Recommendation: The GET endpoint already returns `created_at DESC`. Once `completed_at` is added, filter client-side for the latest response where `completed_at IS NULL` (resume draft) or the latest overall (show completed state).

## Sources

### Primary (HIGH confidence)
- Codebase inspection: `content_processor/src/content-schema.ts` - QuestionSegment schema with fields
- Codebase inspection: `content_processor/src/index.ts` lines 97-107 - QuestionSegment TypeScript type
- Codebase inspection: `content_processor/src/flattener/index.ts` lines 1057-1068 - Question segment flattening
- Codebase inspection: `content_processor/src/parser/lens.ts` lines 42-57, 381-401 - Question segment parsing
- Codebase inspection: `web_frontend/src/components/module/NarrativeChatSection.tsx` - Full voice recording implementation (lines 127-417)
- Codebase inspection: `web_api/routes/assessments.py` - Existing POST/GET endpoints
- Codebase inspection: `core/assessments.py` - Database operations (submit, query, claim)
- Codebase inspection: `core/tables.py` lines 434-466 - assessment_responses table schema
- Codebase inspection: `web_frontend/src/views/Module.tsx` - renderSegment switch, section rendering
- Codebase inspection: `web_frontend/src/types/module.ts` - ModuleSegment union type (missing QuestionSegment)
- Codebase inspection: `web_frontend/src/api/modules.ts` - transcribeAudio function
- Codebase inspection: `web_frontend/src/api/progress.ts` - Auth header pattern

### Secondary (MEDIUM confidence)
- React auto-expanding textarea pattern - well-established, already used in codebase
- Debounce pattern for auto-save - standard React pattern

### Tertiary (LOW confidence)
- None - all findings verified against codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - everything is already in the project, no new dependencies needed
- Architecture: HIGH - patterns are clear from existing code (segment rendering, API client, auth)
- Pitfalls: HIGH - identified from actual code analysis (race conditions, ID stability, navigation loss)

**Research date:** 2026-02-14
**Valid until:** 2026-03-14 (stable - no external dependency changes expected)
