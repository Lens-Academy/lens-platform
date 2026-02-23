# Deferred Test Completion Design

## Problem

When a test with feedback enabled completes its last question, `markComplete()` fires immediately, which triggers `handleMarkComplete()` in Module.tsx, which auto-advances to the next section. The user gets navigated away before they can read the AI feedback.

## Approach

Split the test lifecycle into two semantic phases:

- **Test-taking** — answering all questions. Complete when every `assessment_response` has `completed_at`.
- **Test-feedback** — reviewing AI feedback, optional follow-up chat. Complete when user clicks Continue.

The test section is only "complete" in `user_content_progress` (green checkmark, propagation to LO/module) when both phases are done. This is a UI state machine concept — no content model or backend changes.

## Design Decisions

- **Frontend-only change.** Defer when `markComplete()` is called, don't change what it does.
- **Rename `onTestComplete` → `onTestTakingComplete`** to make the semantic clear. This callback fires when all questions are answered and unlocks navigation (`setTestModeActive(false)`).
- **Continue button below feedback chat** triggers `markComplete()` and advances to next section.
- **Navigation unlocked during feedback.** User can click away freely; Continue is the happy path but not mandatory.
- **Resume after tab close:** Not addressed now. If user closes mid-feedback, test shows as incomplete on return since `user_content_progress` was never written. Individual answers are safe in `assessment_responses`.

## State Flows

### Test with `feedback: true`

```
Begin → testState: "in_progress"
  ↓ answer questions
All answered → testState: "completed"
  → onTestTakingComplete() (unlock nav)
  → onFeedbackTrigger() (fetch answers, start chat)
  → markComplete() NOT called
  ↓
Feedback chat renders, user reads/chats
  ↓
Continue clicked
  → markComplete() → handleMarkComplete() → auto-advance
```

### Test without `feedback`

```
All answered → testState: "completed"
  → onTestTakingComplete()
  → markComplete() fires immediately (unchanged behavior)
  → handleMarkComplete() → auto-advance
```

## Changes

### 1. `web_frontend/src/components/module/TestSection.tsx`

Rename `onTestComplete` → `onTestTakingComplete` in props and usage. When `section.feedback` is true and `onFeedbackTrigger` is provided, skip calling `markComplete()` on question completion. Add a new `onSectionComplete` callback prop that the Continue button will trigger.

### 2. `web_frontend/src/views/Module.tsx`

Rename `onTestComplete` → `onTestTakingComplete`. Render a Continue button below the `NarrativeChatSection` when `section.feedback && activeFeedbackKey === feedbackKey`. The Continue button calls `markComplete()` → `handleMarkComplete()`.

## Files NOT Modified

- No backend changes (`web_api/`)
- No DB migrations
- No content processor changes
- AnswerBox, TestQuestionCard unchanged
