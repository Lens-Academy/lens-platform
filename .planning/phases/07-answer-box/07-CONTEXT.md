# Phase 7: Answer Box - Context

**Gathered:** 2026-02-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Free-text answer box component that renders inline within module content. Students type or speak answers that are continuously auto-saved and eventually marked complete. Works in both lesson sections (inline with teaching content) and test sections. AI discussion of answers is Phase 9; test-mode locking behavior is Phase 8.

</domain>

<decisions>
## Implementation Decisions

### Input model — auto-save, not submit-and-send
- Answer record created in database on first keystroke (lazy creation)
- Auto-save with debounce every few seconds (Google Docs style) — answer is continuously persisted
- "Finish" / "Complete" button marks the answer as done (e.g., completion timestamp) — data is already saved
- No draft loss on refresh — the whole point of continuous save

### Text editor
- Needs to play nicely with React — research whether a rich text editor (Lexical, etc.) is warranted or if a plain textarea with good UX is sufficient
- Plain text content for now — no rich formatting (bold, lists, etc.)
- Auto-expanding textarea behavior

### Visual presentation — minimal and inline
- Light, inline style — not a heavy card or panel
- Just a text box that blends with surrounding content, minimal visual boundary
- Question prompt (from `userInstruction`) displayed above the input
- Subtle "Saved" / "Saving..." indicator (small text or checkmark after auto-save)
- Character count shown if `maxChars` is set
- Modern, minimal aesthetic

### Voice input
- Microphone button alongside the text input
- Reuses existing recording UX from chat (volume bars, timer, 120s max, 60s warning)
- After transcription, text appears in the editor for review before marking complete
- Student can edit transcription before finishing
- When `enforceVoice` is true: mic button is primary/prominent

### Submission and completion
- "Finish" button marks answer as complete — does not trigger AI (that's Phase 9)
- Completed state depends on context:
  - In lesson sections: editable after completion (can reopen)
  - In test sections: locked after completion (Phase 8 enforces this)
- Phase 7 builds the component; Phase 8 adds locking behavior
- Multiple attempts: new records per the existing decision (no unique constraint on user+question)

### Claude's Discretion
- Exact debounce interval (2-3 seconds as starting point)
- Textarea vs lightweight editor library decision (after research)
- Save indicator placement and animation
- Error state design (network failures during auto-save)
- Optional question visual treatment and skip button design

</decisions>

<specifics>
## Specific Ideas

- "Our competitor realized that sometimes you ask questions that have long answers — you want the answer continuously stored so it's not lost on refresh"
- Auto-save model inspired by Google Docs — saving is invisible, just a subtle indicator
- The answer box should feel like a natural writing area, not a form submission

</specifics>

<deferred>
## Deferred Ideas

- AI discussion triggered on answer completion — Phase 9
- Time limit enforcement (maxTime countdown, auto-submit) — Phase 8 (test mode)
- Locking answers after completion in test context — Phase 8

</deferred>

---

*Phase: 07-answer-box*
*Context gathered: 2026-02-14*
