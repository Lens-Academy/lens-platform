# Phase 8: Test Sections - Context

**Gathered:** 2026-02-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Modules can contain test sections at the end that group assessment questions and enforce test-mode behavior. Test sections render as a distinct section type in the module viewer with a single progress dot. Multiple answer boxes are grouped within a test section, each tied to a learning outcome. Content hiding restricts access to lesson sections during a test.

</domain>

<decisions>
## Implementation Decisions

### Test section flow
- Navigate to test section → simple Begin screen with question count
- Click Begin → enters test mode (lesson section dots dimmed and not clickable)
- Sequential per-question reveal: Q1 reveal button → answer Q1 → Q1 collapses → Q2 reveal button → answer Q2 → ...
- After all questions answered → test complete → lesson sections unlock and become clickable again

### Visual treatment
- Test section should NOT feel like a high-stakes exam — same visual styling as other sections
- Reuse existing module viewer patterns and code — don't invent new layout systems
- Low-pressure, casual feel throughout

### Begin screen
- Show question count only (e.g., "3 questions"), no time estimates
- Simple and low-pressure — minimal copy
- Keep it very simple; UX will evolve in future iterations

### Per-question behavior
- Sequential: must answer Q1 before Q2 reveal button appears
- Previous answered questions collapse (focus stays on current question)
- Timer starts when question is revealed, NOT when voice recording starts
- Auto-save works as existing AnswerBox behavior (debounced PATCH)

### Content hiding (test mode)
- Previous lesson section progress dots are dimmed and not clickable during test
- Lesson sections remain visible in sidebar but greyed out — student sees context but can't navigate back
- After ALL test questions are answered, everything unlocks (full navigation restored)
- This disincentivizes review during test without preventing it entirely (students can still open another tab)

### Progress and completion
- Single progress dot in sidebar for the entire test section (not per-question)
- Dot fills when all questions have answers — same completion pattern as other sections
- No special completion fanfare or summary card

### Resume behavior
- Test state persists if student navigates away (closes tab, goes to dashboard)
- On return: already-answered questions stay answered and collapsed, next unanswered question's reveal button is shown
- Timer for current question does NOT resume — only measures active engagement time

### Claude's Discretion
- Question reveal pattern (explicit button vs click-to-reveal area)
- Timer expiry behavior (should feel low-stakes but limit effort; must handle voice transcription completing before auto-submit)
- Begin screen copy and layout
- Completion signal beyond progress dot
- Loading and error states
- Exact collapse/expand animation

</decisions>

<specifics>
## Specific Ideas

- "Start test" button gates the entire test section — questions don't appear until clicked
- Per-question "start/reveal" button creates granular timing data for each question
- Timer should start when question appears, not when user starts interacting — this was a specific correction from existing voice recording behavior where timer starts on recording
- Students only commit to one question at a time, not the whole test at once (though enforcing whole-test commitment may come in a future iteration)
- "We just want to disincentivize [reviewing material], not prevent it" — the content hiding is a speed bump, not a wall

</specifics>

<deferred>
## Deferred Ideas

- Enforcing whole-test commitment (requiring students to complete all questions in one sitting) — future iteration
- UX refinements to Begin screen and question flow — acknowledged as likely to change

</deferred>

---

*Phase: 08-test-sections*
*Context gathered: 2026-02-16*
