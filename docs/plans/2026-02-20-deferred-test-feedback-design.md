# Deferred Test Feedback Design

## Problem

Tests contain multiple questions answered sequentially. When `feedback` is enabled, the AI should give feedback only after all questions are completed — not after each individual question.

## Approach

When a test section has `feedback: true` and all questions are completed, TestSection fetches all answers from the API, then calls a callback to Module.tsx. Module.tsx sends a consolidated message through the shared module chat and renders a NarrativeChatSection below the test.

Answers are always fetched from the API at completion time (not accumulated locally) so that resumed tests (where some questions were answered in a previous session) work correctly.

## Design Decisions

- **Feedback flag is per-test-section**, not per-question. A new `feedback?: boolean` field on `TestSection`.
- **One chat below the entire test**, not per-question.
- **Hidden on resume** — `activeFeedbackKey` starts null, only set by the completion trigger.
- **Mutually exclusive** with standalone question feedback — same `activeFeedbackKey` mechanism.
- **Fetch answers from API** at completion time instead of accumulating locally, so partial-resume scenarios work.

## Changes

### 1. `web_frontend/src/types/module.ts`

Add `feedback?: boolean` to the `TestSection` type.

### 2. `web_frontend/src/components/module/TestSection.tsx`

New prop:
```typescript
onFeedbackTrigger?: (questionsAndAnswers: Array<{question: string, answer: string}>) => void
```

In `handleQuestionComplete`, when all questions are done and `onFeedbackTrigger` is provided:
1. Fetch `getResponses` for each question (parallel)
2. Extract the latest `answer_text` from each response
3. Build array of `{question, answer}` pairs
4. Call `onFeedbackTrigger(pairs)`

### 3. `web_frontend/src/views/Module.tsx`

In the `section.type === "test"` render branch:
- Compute `feedbackKey = "test-" + sectionIndex`
- Pass `onFeedbackTrigger` to TestSection (only if `section.feedback`)
- Handler: set `activeFeedbackKey`, call `handleSendMessage` with consolidated message and `segmentIndex: 0`
- Render `NarrativeChatSection` below `<TestSection>` when `activeFeedbackKey === feedbackKey`

Auto-message format:
```
I just completed a test. Here are the questions and my answers:

Question 1: "{q1}"
My answer: "{a1}"

Question 2: "{q2}"
My answer: "{a2}"

Can you give me feedback on my answers?
```

### 4. `web_api/routes/module.py`

Before the existing `current_segment.get("type") == "question"` check, add: if `section.get("type") == "test"`, build a holistic feedback prompt that iterates all question segments in the section and includes each question's `userInstruction` and `assessmentPrompt`, plus the section's `learningOutcomeName`.

## Files Modified

1. `web_frontend/src/types/module.ts` — add `feedback` to TestSection
2. `web_frontend/src/components/module/TestSection.tsx` — fetch answers + callback
3. `web_frontend/src/views/Module.tsx` — wire up trigger + render chat
4. `web_api/routes/module.py` — test-section system prompt

## Files NOT Modified

- `AnswerBox.tsx` — no changes needed
- `TestQuestionCard.tsx` — no changes needed
- No new API endpoints or database changes
