# Phase 8: Test Sections - Research

**Researched:** 2026-02-16
**Domain:** Frontend UI (React component + state management), module viewer integration, content hiding navigation restriction
**Confidence:** HIGH

## Summary

Phase 8 adds test-mode behavior to the module viewer. Test sections already exist as a fully-parsed `type: "test"` section in the content pipeline (content_processor flattener produces them, the `TestSection` TypeScript type exists in `module.ts`, and the `Section` interface in the content processor includes `'test'` as a valid type). The backend already serves test sections in the API response via `serialize_flattened_module()` which passes section dicts through unchanged. However, the Module.tsx view currently **does not render test sections at all** -- there is no `case "test"` in the section rendering logic and no test-specific component exists.

The implementation is primarily a frontend feature: (1) a new `TestSection` component that wraps multiple AnswerBox instances with sequential reveal and test-mode state, (2) modifications to Module.tsx to render test sections and enforce content hiding (dimming/disabling navigation to previous lesson sections during a test), and (3) a single progress dot per test section. No new backend endpoints are needed -- the existing assessment response API (POST/PATCH/GET) and progress API (mark complete) already handle everything.

**Primary recommendation:** Build two components: a `TestSection` container component (manages test state machine: begin -> sequential questions -> complete) and integrate it into Module.tsx with content-hiding navigation restrictions via state lifted to Module.tsx.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Navigate to test section shows a simple Begin screen with question count
- Click Begin enters test mode (lesson section dots dimmed and not clickable)
- Sequential per-question reveal: Q1 reveal button -> answer Q1 -> Q1 collapses -> Q2 reveal button -> answer Q2 -> ...
- After all questions answered -> test complete -> lesson sections unlock and become clickable again
- Test section should NOT feel like a high-stakes exam -- same visual styling as other sections
- Reuse existing module viewer patterns and code -- don't invent new layout systems
- Low-pressure, casual feel throughout
- Begin screen shows question count only (e.g., "3 questions"), no time estimates
- Simple and low-pressure, minimal copy
- Sequential: must answer Q1 before Q2 reveal button appears
- Previous answered questions collapse (focus stays on current question)
- Timer starts when question is revealed, NOT when voice recording starts
- Auto-save works as existing AnswerBox behavior (debounced PATCH)
- Previous lesson section progress dots are dimmed and not clickable during test
- Lesson sections remain visible in sidebar but greyed out -- student sees context but can't navigate back
- After ALL test questions are answered, everything unlocks (full navigation restored)
- Single progress dot in sidebar for the entire test section (not per-question)
- Dot fills when all questions have answers -- same completion pattern as other sections
- No special completion fanfare or summary card
- Test state persists if student navigates away (closes tab, goes to dashboard)
- On return: already-answered questions stay answered and collapsed, next unanswered question's reveal button is shown
- Timer for current question does NOT resume -- only measures active engagement time

### Claude's Discretion
- Question reveal pattern (explicit button vs click-to-reveal area)
- Timer expiry behavior (should feel low-stakes but limit effort; must handle voice transcription completing before auto-submit)
- Begin screen copy and layout
- Completion signal beyond progress dot
- Loading and error states
- Exact collapse/expand animation

### Deferred Ideas (OUT OF SCOPE)
- Enforcing whole-test commitment (requiring students to complete all questions in one sitting) -- future iteration
- UX refinements to Begin screen and question flow -- acknowledged as likely to change
</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React 19 | 19.x | UI framework | Already in use across entire frontend |
| Tailwind CSS v4 | 4.x | Styling | Already in use across entire frontend, CSS-first config |
| Vike | 0.4 | Routing/SSR | Already in use, page-based routing |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | (existing) | Icons | Already used in ModuleDrawer, consistent icon style |

### Alternatives Considered
None -- this phase uses entirely existing stack. No new libraries needed.

## Architecture Patterns

### Existing Patterns to Reuse

**The codebase already has all the building blocks. This phase composes them, not invents new ones.**

#### 1. Section Rendering Pattern (Module.tsx)
Each section type has a rendering branch in the main `sections.map()` in Module.tsx (lines 1005-1289). Test sections need a new branch here:
```tsx
// Current pattern in Module.tsx:
section.type === "page" ? ( <> ... </> )
: section.type === "lens-video" ? ( <> ... </> )
// Add:
: section.type === "test" ? ( <TestSectionComponent ... /> )
```

#### 2. AnswerBox Component (Phase 7)
The existing `AnswerBox` component at `web_frontend/src/components/module/AnswerBox.tsx` handles:
- Question display via `segment.userInstruction`
- Auto-save via `useAutoSave` hook (POST create, debounced PATCH update)
- Completion via `markComplete()` (sets `completed_at`)
- Loading existing answers on mount via `getResponses` API
- Voice input via `useVoiceRecording` hook
- Completed state display (read-only text with checkmark)

**The test section component wraps multiple AnswerBox instances**, adding sequential reveal and collapse behavior on top.

#### 3. Progress Dot Pattern (StageProgressBar + ModuleDrawer)
Each section gets one progress dot. The progress bar maps `module.sections` 1:1 to dots. The test section needs to appear as a single dot (it already IS a single section in the sections array). The `Stage` type currently maps section types to one of `article | video | chat`. The `StageInfo` type maps to `article | video | chat | lens-video | lens-article | page`. Neither type currently includes `"test"`. Both need updating.

#### 4. Content Completion Pattern (MarkCompleteButton)
The `MarkCompleteButton` component at line 1238 of Module.tsx calls the progress API to mark a section complete. For test sections, completion should be automatic when all questions have answers (not a manual button click). The `MarkCompleteButton` can still be used but its trigger logic differs.

#### 5. Section Navigation Pattern
Module.tsx manages `currentSectionIndex` state and `handleStageClick(index)`. Content hiding means intercepting stage clicks when test mode is active. The `handleStageClick` callback is passed to both `ModuleHeader` (horizontal progress bar) and `ModuleDrawer` (sidebar). Both need to respect test mode restrictions.

### Recommended Component Structure

```
web_frontend/src/
  components/module/
    TestSection.tsx            # NEW - Test section container component
    TestQuestionCard.tsx       # NEW - Individual question with reveal/collapse
    AnswerBox.tsx              # EXISTING - Reused as-is inside TestQuestionCard
  views/
    Module.tsx                 # MODIFIED - Add test section rendering + content hiding
  types/
    module.ts                  # EXISTING - TestSection type already exists
    course.ts                  # MODIFIED - StageInfo.type needs "test" added
```

### Pattern 1: Test State Machine
**What:** The test section manages a linear state machine: `not_started -> in_progress -> completed`
**When to use:** When rendering a test section

State is derived from existing answer data (loaded via `getResponses` API on mount):
- `not_started`: No answers exist for any question in this test section
- `in_progress`: Some questions have answers, but not all have `completed_at`
- `completed`: All questions have `completed_at` set

The current question index is derived from the answer data:
- Find the first question whose response either doesn't exist or has no `completed_at`
- That's the "active" question (show its reveal button)
- All questions before it are "answered" (show collapsed)

**Resume behavior:** Because `useAutoSave` already loads existing answers on mount and the test state is derived from that data, resume is automatic. When the student returns:
1. Each AnswerBox loads its existing answer via `getResponses`
2. The test section component checks which answers exist and which are completed
3. It renders accordingly: completed questions collapsed, next question's reveal button shown

### Pattern 2: Content Hiding via Lifted State
**What:** Test mode restricts navigation to lesson sections
**When to use:** When a test section is in `in_progress` state

Implementation approach: Module.tsx already manages `currentSectionIndex` and `handleStageClick`. Add a `testModeActive` state to Module.tsx. When active:
- `handleStageClick` ignores clicks on non-test sections (or only allows clicking the test section itself)
- The progress bar dots for lesson sections get dimmed styling
- The drawer sidebar greys out lesson sections
- Navigation arrows (prev/next) are disabled if they would leave the test section

The test section component communicates its state to Module.tsx via callbacks:
```tsx
<TestSectionComponent
  onTestStart={() => setTestModeActive(true)}
  onTestComplete={() => setTestModeActive(false)}
/>
```

### Pattern 3: Sequential Question Reveal
**What:** Questions are revealed one at a time, each with a reveal button
**When to use:** Within the test section after "Begin" is clicked

Recommendation for reveal pattern (Claude's Discretion): **Use an explicit button** rather than click-to-reveal area. An explicit button is:
- More accessible (clear click target)
- More consistent with existing patterns (AnswerBox has an explicit "Finish" button)
- Less likely to cause accidental reveals

Button copy suggestion: "Show next question" or simply "Next question"

### Pattern 4: Per-Question Timer
**What:** Timer starts when question is revealed, records elapsed time in answer metadata
**When to use:** For each question in the test section

The existing `useAutoSave` hook accepts metadata via `setMetadata({ time_taken_s: elapsed })`. The timer:
1. Starts when the reveal button is clicked (question becomes visible)
2. Records elapsed time on each auto-save (via `setMetadata`)
3. Stops when the student clicks "Finish" on that question
4. Does NOT resume if the student navigates away and returns

Timer expiry recommendation (Claude's Discretion): If `maxTime` is set on the QuestionSegment:
- Show a subtle countdown or elapsed time indicator
- When time expires, auto-submit the current text (flush save + mark complete)
- If voice transcription is in progress when timer expires, wait for transcription to complete before auto-submitting (give a brief grace period of ~5 seconds)
- Style the timer subtly (not a red countdown clock) -- consistent with "low-stakes" feel

### Anti-Patterns to Avoid
- **Don't create a separate test page/route**: The test section is rendered inline within the Module.tsx view, just like every other section type
- **Don't store test state in separate backend table**: Test state is fully derived from existing assessment response data (which answers exist, which are completed)
- **Don't duplicate AnswerBox logic**: The TestQuestionCard wraps the existing AnswerBox component, it doesn't rebuild answer input/save/voice from scratch
- **Don't create a new progress tracking mechanism**: Test section completion uses the same `markComplete` API with `content_type: "test"` (already supported in the `MarkCompleteRequest` type)
- **Don't use `cursor-not-allowed`**: Per project guidelines, dimmed sections should use `cursor-default`

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Answer persistence | Custom test answer storage | Existing `useAutoSave` hook + assessment API | Already handles create, update, debounce, completion, resume |
| Progress tracking | Custom test progress | Existing `markComplete` progress API | Already supports `content_type: "test"` |
| Voice input | Custom audio handling | Existing `useVoiceRecording` hook | Already handles recording, transcription, volume bars |
| Section navigation | Custom router | Existing Module.tsx section navigation | `currentSectionIndex`, `handleStageClick`, URL hash sync |

**Key insight:** The test section is fundamentally a UI composition layer. All persistence (answers, progress, time tracking) uses existing infrastructure. The new code is React state management and conditional rendering.

## Common Pitfalls

### Pitfall 1: Race Condition on Test Completion Check
**What goes wrong:** The test section checks if all questions are completed, but `useAutoSave` hooks in child AnswerBox components load asynchronously. If the parent checks before all children have loaded, it might incorrectly show "Begin" screen even when all questions are already answered.
**Why it happens:** Each AnswerBox independently calls `getResponses` on mount. The parent TestSection doesn't know when all children have finished loading.
**How to avoid:** Either (a) have the TestSection component itself fetch all responses for the section's questions in a single batch call, then pass initial state down to AnswerBox instances, or (b) use a callback pattern where each AnswerBox reports its loaded state back to the parent.
**Recommendation:** Approach (a) is cleaner. The TestSection fetches all responses for its questionIds on mount, determines test state, then passes `initialText` and `initialResponseId` props to AnswerBox instances. This requires a small extension to useAutoSave (accepting initial values as props instead of always fetching).
**Warning signs:** Test section flickers between "Begin" and "in progress" state on page load.

### Pitfall 2: MarkCompleteButton Interference
**What goes wrong:** Module.tsx currently renders a `MarkCompleteButton` after every section (line 1238). For test sections, the MarkCompleteButton would appear below the test content, creating a confusing dual-completion path (Finish button on last question AND Mark section complete button).
**Why it happens:** The MarkCompleteButton is rendered unconditionally for all sections in the main loop.
**How to avoid:** Skip rendering `MarkCompleteButton` for test sections. Instead, automatically mark the test section complete when all questions are answered. The TestSection component calls the progress API itself when the last question is completed.
**Warning signs:** Two completion buttons visible for test sections.

### Pitfall 3: Content Hiding Leaks Through URL
**What goes wrong:** Student could navigate to a lesson section by editing the URL hash directly (e.g., `#article-name`), bypassing the content hiding.
**Why it happens:** Module.tsx parses URL hashes in `handleHashChange` and sets `currentSectionIndex`.
**How to avoid:** The hash parsing logic should also check `testModeActive` and ignore hash changes that would navigate to non-test sections during test mode. However, per the user's explicit decision: "We just want to disincentivize [reviewing material], not prevent it" -- so this is actually acceptable. The content hiding is a speed bump, not a wall. Just dim the dots and block click handlers; don't worry about URL manipulation.
**Warning signs:** None (acceptable by design).

### Pitfall 4: Stage Type Mismatch
**What goes wrong:** The `Stage` type union (`ArticleStage | VideoStage | ChatStage`) doesn't include a test stage type. The progress bar mapping in Module.tsx (line 390-454) would fall through to `chat` type for test sections, showing the wrong icon.
**Why it happens:** Stage types were designed before test sections existed.
**How to avoid:** Add "test" to `StageInfo.type` union in `course.ts`. Update the `stagesForDrawer` and `stages` useMemo in Module.tsx to handle `section.type === "test"`. Add a test icon to `StageIcon` component.
**Warning signs:** Test sections show a chat bubble icon instead of a test-appropriate icon.

### Pitfall 5: Timer vs Voice Recording Interaction
**What goes wrong:** If timer expires while voice recording is in progress, auto-submitting immediately would lose the in-progress recording's transcription.
**Why it happens:** Voice recording and timer are independent state machines.
**How to avoid:** When timer expires, check if `recordingState` is "recording" or "transcribing". If so, wait for transcription to complete (add a brief grace period). The `useVoiceRecording` hook exposes `recordingState` which can be checked.
**Warning signs:** Student loses a voice answer because timer expired mid-transcription.

## Code Examples

### Example 1: Test Section Component Skeleton
```tsx
// web_frontend/src/components/module/TestSection.tsx

interface TestSectionProps {
  section: TestSectionType;
  moduleSlug: string;
  sectionIndex: number;
  isAuthenticated: boolean;
  onTestStart: () => void;
  onTestComplete: () => void;
  onMarkComplete: (response?: MarkCompleteResponse) => void;
}

// State machine: not_started -> in_progress -> completed
type TestState = "not_started" | "in_progress" | "completed";

export default function TestSection({
  section, moduleSlug, sectionIndex, isAuthenticated,
  onTestStart, onTestComplete, onMarkComplete,
}: TestSectionProps) {
  const [testState, setTestState] = useState<TestState>("not_started");
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [completedQuestions, setCompletedQuestions] = useState<Set<number>>(new Set());

  // Questions are the question segments within the test section
  const questions = section.segments.filter(s => s.type === "question");

  const handleBegin = () => {
    setTestState("in_progress");
    onTestStart();
  };

  const handleQuestionComplete = (questionIndex: number) => {
    const newCompleted = new Set(completedQuestions);
    newCompleted.add(questionIndex);
    setCompletedQuestions(newCompleted);

    if (newCompleted.size === questions.length) {
      // All questions answered
      setTestState("completed");
      onTestComplete();
      // Mark test section as complete via progress API
      // ...
    } else {
      // Advance to next question
      setCurrentQuestionIndex(questionIndex + 1);
    }
  };

  if (testState === "not_started") {
    return <BeginScreen questionCount={questions.length} onBegin={handleBegin} />;
  }

  // Render questions with sequential reveal + collapse
  return (
    <div>
      {questions.map((question, qi) => (
        <TestQuestionCard
          key={qi}
          question={question}
          questionIndex={qi}
          isActive={qi === currentQuestionIndex}
          isCompleted={completedQuestions.has(qi)}
          isRevealed={qi <= currentQuestionIndex}
          moduleSlug={moduleSlug}
          sectionIndex={sectionIndex}
          segmentIndex={/* find actual segment index */}
          isAuthenticated={isAuthenticated}
          onComplete={() => handleQuestionComplete(qi)}
        />
      ))}
    </div>
  );
}
```

### Example 2: Content Hiding in Module.tsx
```tsx
// In Module.tsx - modified handleStageClick:
const handleStageClick = useCallback(
  (index: number) => {
    // Content hiding: block navigation to non-test sections during test
    if (testModeActive && module) {
      const targetSection = module.sections[index];
      if (targetSection?.type !== "test") {
        return; // Block navigation
      }
    }
    // ... existing logic
  },
  [viewMode, testModeActive, module],
);
```

### Example 3: Progress Dot Dimming
```tsx
// In StageProgressBar.tsx or via prop:
// When testModeActive is true, non-test dots get dimmed styling
const isDimmed = testModeActive && stages[index].type !== "test";

// Apply dimming:
className={`... ${isDimmed ? "opacity-30 pointer-events-none" : ""}`}
```

### Example 4: Batch Loading Responses for Resume
```tsx
// In TestSection, load all responses at once for resume behavior
useEffect(() => {
  async function loadTestState() {
    const questionIds = questions.map((_, qi) =>
      `${moduleSlug}:${sectionIndex}:${findSegmentIndex(qi)}`
    );

    // Load all responses in parallel
    const results = await Promise.all(
      questionIds.map(qid =>
        getResponses({ moduleSlug, questionId: qid }, isAuthenticated)
      )
    );

    // Determine test state from responses
    const completedSet = new Set<number>();
    results.forEach((result, qi) => {
      if (result.responses.length > 0 && result.responses[0].completed_at) {
        completedSet.add(qi);
      }
    });

    if (completedSet.size === questions.length) {
      setTestState("completed");
    } else if (completedSet.size > 0 || results.some(r => r.responses.length > 0)) {
      setTestState("in_progress");
      setCurrentQuestionIndex(
        // First question without completed response
        questions.findIndex((_, qi) => !completedSet.has(qi))
      );
      onTestStart(); // Re-enter test mode on resume
    }
    setCompletedQuestions(completedSet);
  }
  loadTestState();
}, [moduleSlug, sectionIndex, isAuthenticated]);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| N/A (new feature) | N/A | N/A | N/A |

This is a new feature with no prior implementation. The codebase patterns are stable and well-established.

**Already ready in the codebase:**
- `TestSection` type in `web_frontend/src/types/module.ts` (added in Phase 7)
- `type: "test"` in content_processor `Section` interface
- Content processor flattener produces test sections from LO `## Test:` sections
- Backend serves test sections in API response (passthrough dicts)
- `content_type: "test"` already in `MarkCompleteRequest` type
- AnswerBox component with full auto-save, completion, voice support
- Assessment response CRUD API (POST/PATCH/GET)
- Progress API (mark complete, module progress)

**Not yet in codebase:**
- No rendering branch for `section.type === "test"` in Module.tsx
- No TestSection container component
- No "test" in `StageInfo.type` union
- No test icon in `StageIcon` component
- No test-mode state in Module.tsx
- No content hiding logic
- `sectionSlug.ts` doesn't handle test section type

## Integration Points

### Files That Need Modification

1. **`web_frontend/src/views/Module.tsx`** - The main integration point:
   - Add test section rendering branch
   - Add `testModeActive` state
   - Modify `handleStageClick` for content hiding
   - Modify `handlePrevious`/`handleNext` for content hiding
   - Modify `stages` and `stagesForDrawer` useMemo to handle test type
   - Skip `MarkCompleteButton` for test sections

2. **`web_frontend/src/types/course.ts`** - Add "test" to `StageInfo.type` union

3. **`web_frontend/src/components/module/StageProgressBar.tsx`** - Add test icon to `StageIcon`, handle dimming

4. **`web_frontend/src/components/module/SectionDivider.tsx`** - Add "test" to type union (or skip divider for test sections since they have a Begin screen)

5. **`web_frontend/src/components/module/ModuleDrawer.tsx`** - Pass through test mode state for drawer dimming

6. **`web_frontend/src/components/course/ModuleOverview.tsx`** - Handle "test" type display text, dimming during test mode

7. **`web_frontend/src/utils/sectionSlug.ts`** - Add case for "test" section type in `getSectionSlug`

8. **`web_frontend/src/utils/completionButtonText.ts`** - Handle test section type (return empty/skip since test uses auto-completion)

### Files To Create

1. **`web_frontend/src/components/module/TestSection.tsx`** - Container component
2. **`web_frontend/src/components/module/TestQuestionCard.tsx`** - Per-question reveal/collapse wrapper

### Key Data Flow

```
Module.tsx (section.type === "test")
  -> TestSection component
    -> loads all responses (batch) to determine state
    -> renders Begin screen OR question list
      -> TestQuestionCard (per question)
        -> AnswerBox (existing, reused as-is)
        -> Timer display
        -> Collapse/expand behavior
    -> on last question complete:
      -> calls markComplete progress API (content_type: "test")
      -> calls onTestComplete callback
  -> Module.tsx receives onTestComplete
    -> sets testModeActive = false
    -> unlocks navigation
```

## Open Questions

1. **Question segment index calculation**
   - What we know: Test sections contain mixed segment types (text + question segments). The `questionId` is `moduleSlug:sectionIndex:segmentIndex` where segmentIndex is the position in the segments array, not the question-only array.
   - What's unclear: When rendering "question 2 of 3" we need the question index (0, 1, 2) but when creating the questionId we need the segment index (which may be 0, 2, 4 if text segments are interspersed).
   - Recommendation: Map from question index to segment index when passing props to AnswerBox. The TestSection should build this mapping on mount.

2. **Test section contentId for progress tracking**
   - What we know: Test sections in the flattener set `contentId: null` (see flattener line 475). The progress API requires a `content_id` UUID to track completion.
   - What's unclear: Without a contentId, the test section progress dot can't be tracked via the existing progress API.
   - Recommendation: This may need a contentId generated for test sections. Options: (a) use the learningOutcomeId as the contentId for the test section, (b) generate a deterministic UUID from `moduleSlug + "test" + sectionIndex`, (c) change the flattener to assign a UUID. Option (b) is safest since it doesn't require content processor changes.

3. **Begin screen behavior on resume with all questions answered**
   - What we know: If a student has answered all questions, the test should show as completed
   - What's unclear: Should "completed" show the Begin screen with a "Review answers" option, or show all questions expanded in read-only mode?
   - Recommendation: Show all questions in their completed/collapsed state (matching the existing AnswerBox completed behavior). No Begin screen on fully completed tests.

## Sources

### Primary (HIGH confidence)
- **Codebase analysis** - Direct reading of all relevant source files listed above
- `web_frontend/src/views/Module.tsx` - Module viewer architecture (1336 lines)
- `web_frontend/src/components/module/AnswerBox.tsx` - Answer box component (306 lines)
- `web_frontend/src/hooks/useAutoSave.ts` - Auto-save hook (338 lines)
- `web_frontend/src/api/assessments.ts` - Assessment API client (163 lines)
- `web_frontend/src/api/progress.ts` - Progress API client (87 lines)
- `web_frontend/src/types/module.ts` - Module type definitions including TestSection
- `content_processor/src/flattener/index.ts` - Test section flattening logic
- `content_processor/src/parser/learning-outcome.ts` - Test section parsing
- `content_processor/src/index.ts` - Section type definition includes "test"

### Secondary (MEDIUM confidence)
- `.planning/phases/07-answer-box/07-VERIFICATION.md` - Phase 7 verification confirming AnswerBox works
- `.planning/phases/07-answer-box/07-01-PLAN.md` - Phase 7 plan showing patterns to follow

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Using only existing libraries, no new dependencies
- Architecture: HIGH - All integration points identified from direct code reading, patterns well-established
- Pitfalls: HIGH - Race conditions and edge cases identified from understanding existing async patterns
- Content hiding: MEDIUM - Implementation approach is clear but interaction with URL hash navigation and drawer needs careful testing

**Research date:** 2026-02-16
**Valid until:** 2026-03-16 (stable patterns, no external dependency changes expected)
