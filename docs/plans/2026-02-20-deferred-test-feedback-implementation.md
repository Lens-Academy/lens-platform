# Deferred Test Feedback Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** After all test questions are answered, fetch answers from the API and trigger a consolidated AI feedback chat below the test.

**Architecture:** TestSection gets a new `onFeedbackTrigger` callback. On completion it fetches all answers via `getResponses`, then calls the callback. Module.tsx handles it identically to standalone question feedback — sets `activeFeedbackKey`, sends a consolidated message, renders `NarrativeChatSection`. The backend detects test sections and builds a holistic system prompt.

**Tech Stack:** React 19, TypeScript, FastAPI, SSE streaming

**Design doc:** `docs/plans/2026-02-20-deferred-test-feedback-design.md`

---

### Task 1: Add `feedback` to TestSection type

**Files:**
- Modify: `web_frontend/src/types/module.ts:152-160`

**Step 1: Add the field**

In the `TestSection` type, add `feedback?: boolean` after `optional`:

```typescript
export type TestSection = {
  type: "test";
  contentId: string | null;
  learningOutcomeId: string | null;
  learningOutcomeName: string | null;
  meta: { title: string | null };
  segments: ModuleSegment[];
  optional: boolean;
  feedback?: boolean;
};
```

**Step 2: Verify build**

Run: `cd web_frontend && npx tsc --noEmit`
Expected: No errors (additive type change).

**Step 3: Commit**

```
feat: add feedback field to TestSection type
```

---

### Task 2: TestSection — fetch answers and call onFeedbackTrigger

**Files:**
- Modify: `web_frontend/src/components/module/TestSection.tsx`

**Step 1: Add `onFeedbackTrigger` to props interface (line 25-33)**

```typescript
interface TestSectionProps {
  section: TestSectionType;
  moduleSlug: string;
  sectionIndex: number;
  isAuthenticated: boolean;
  onTestStart: () => void;
  onTestComplete: () => void;
  onMarkComplete: (response?: MarkCompleteResponse) => void;
  onFeedbackTrigger?: (
    questionsAndAnswers: Array<{ question: string; answer: string }>,
  ) => void;
}
```

**Step 2: Destructure the new prop in the component function (line 40)**

Add `onFeedbackTrigger` to the destructuring alongside existing props.

**Step 3: Add feedback fetch logic in `handleQuestionComplete` (line 143-193)**

Inside the `if (newCompleted.size === questions.length)` block (line 149), after the existing `onTestComplete()` call and the `markComplete(...)` chain, add the feedback trigger:

```typescript
// Trigger feedback if enabled
if (onFeedbackTrigger) {
  // Fetch all answers from API
  Promise.all(
    questions.map((q) => {
      const questionId = `${moduleSlug}:${sectionIndex}:${q.segmentIndex}`;
      return getResponses(
        { moduleSlug, questionId },
        isAuthenticated,
      );
    }),
  )
    .then((results) => {
      const pairs = questions.map((q, idx) => {
        // API returns newest-first; find the completed response
        const completed = results[idx].responses.find(
          (r) => r.completed_at !== null,
        );
        return {
          question: q.segment.userInstruction,
          answer: completed?.answer_text || "",
        };
      });
      onFeedbackTrigger(pairs);
    })
    .catch(() => {
      // Still trigger feedback with whatever we have
      const pairs = questions.map((q) => ({
        question: q.segment.userInstruction,
        answer: "(could not load answer)",
      }));
      onFeedbackTrigger(pairs);
    });
}
```

Place this right after `onTestComplete();` (line 152), before the `markComplete(...)` call. The feedback fetch and the progress mark can happen in parallel — they're independent.

**Step 4: Add `onFeedbackTrigger` to the `handleQuestionComplete` dependency array (line 183-192)**

Add `onFeedbackTrigger` to the deps array.

**Step 5: Verify build**

Run: `cd web_frontend && npx tsc --noEmit`
Expected: No errors. `onFeedbackTrigger` is optional, so existing callsites don't need updating.

**Step 6: Commit**

```
feat: TestSection fetches answers and triggers feedback on completion
```

---

### Task 3: Module.tsx — wire up test feedback trigger and chat

**Files:**
- Modify: `web_frontend/src/views/Module.tsx:1276-1286`

**Step 1: Update the TestSection render block (line 1276-1286)**

Replace:
```tsx
) : section.type === "test" ? (
  // v2 Test section: grouped assessment questions
  <TestSection
    section={section}
    moduleSlug={moduleId}
    sectionIndex={sectionIndex}
    isAuthenticated={isAuthenticated}
    onTestStart={() => setTestModeActive(true)}
    onTestComplete={() => setTestModeActive(false)}
    onMarkComplete={(response) => handleMarkComplete(sectionIndex, response)}
  />
) : (
```

With:
```tsx
) : section.type === "test" ? (
  // v2 Test section: grouped assessment questions
  (() => {
    const feedbackKey = `test-${sectionIndex}`;
    return (
      <>
        <TestSection
          section={section}
          moduleSlug={moduleId}
          sectionIndex={sectionIndex}
          isAuthenticated={isAuthenticated}
          onTestStart={() => setTestModeActive(true)}
          onTestComplete={() => setTestModeActive(false)}
          onMarkComplete={(response) => handleMarkComplete(sectionIndex, response)}
          onFeedbackTrigger={
            section.feedback
              ? (questionsAndAnswers) => {
                  setActiveFeedbackKey(feedbackKey);
                  const lines = questionsAndAnswers.map(
                    (qa, i) =>
                      `Question ${i + 1}: "${qa.question}"\nMy answer: "${qa.answer}"`,
                  );
                  handleSendMessage(
                    `I just completed a test. Here are the questions and my answers:\n\n${lines.join("\n\n")}\n\nCan you give me feedback on my answers?`,
                    sectionIndex,
                    0,
                  );
                }
              : undefined
          }
        />
        {section.feedback && activeFeedbackKey === feedbackKey && (
          <NarrativeChatSection
            messages={messages}
            pendingMessage={pendingMessage}
            streamingContent={streamingContent}
            isLoading={isLoading}
            onSendMessage={(content) =>
              handleSendMessage(content, sectionIndex, 0)
            }
            onRetryMessage={handleRetryMessage}
          />
        )}
      </>
    );
  })()
) : (
```

**Step 2: Verify build**

Run: `cd web_frontend && npm run build`
Expected: Build succeeds. Lint passes.

**Step 3: Commit**

```
feat: wire up test feedback chat in Module.tsx
```

---

### Task 4: Backend — test section system prompt

**Files:**
- Modify: `web_api/routes/module.py:84-108`

**Step 1: Add test section detection before the question segment check**

Replace lines 84-108:
```python
    # Get chat instructions from segment
    segments = section.get("segments", [])
    current_segment = segments[segment_index] if segment_index < len(segments) else {}

    # Question segments: build feedback-aware system prompt
    if current_segment.get("type") == "question":
        user_instruction = current_segment.get("userInstruction", "")
        assessment_prompt = current_segment.get("assessmentPrompt")
        learning_outcome_name = section.get("learningOutcomeName")

        instructions = (
            "You are a supportive tutor providing feedback on a student's response. "
            "Focus on what the student understood well, gently point out gaps, and "
            "ask Socratic questions to deepen their understanding. "
            "Be encouraging and constructive."
        )
        instructions += f"\n\nQuestion: {user_instruction}"
        if learning_outcome_name:
            instructions += f"\nLearning Outcome: {learning_outcome_name}"
        if assessment_prompt:
            instructions += f"\nRubric:\n{assessment_prompt}"
    else:
        instructions = current_segment.get(
            "instructions", "Help the user learn about AI safety."
        )
```

With:
```python
    # Get chat instructions from segment
    segments = section.get("segments", [])
    current_segment = segments[segment_index] if segment_index < len(segments) else {}

    # Test sections: holistic feedback prompt covering all questions
    if section.get("type") == "test":
        instructions = (
            "You are a supportive tutor providing feedback on a student's test responses. "
            "Evaluate the answers holistically — note patterns, connections between answers, "
            "and overall understanding. Point out strengths, gently identify gaps, and "
            "ask Socratic questions to deepen understanding. Be encouraging and constructive."
        )
        learning_outcome_name = section.get("learningOutcomeName")
        if learning_outcome_name:
            instructions += f"\n\nLearning Outcome: {learning_outcome_name}"
        for seg in segments:
            if seg.get("type") == "question":
                instructions += f"\n\nQuestion: {seg.get('userInstruction', '')}"
                if seg.get("assessmentPrompt"):
                    instructions += f"\nRubric:\n{seg['assessmentPrompt']}"
    # Standalone question segments: single-question feedback prompt
    elif current_segment.get("type") == "question":
        user_instruction = current_segment.get("userInstruction", "")
        assessment_prompt = current_segment.get("assessmentPrompt")
        learning_outcome_name = section.get("learningOutcomeName")

        instructions = (
            "You are a supportive tutor providing feedback on a student's response. "
            "Focus on what the student understood well, gently point out gaps, and "
            "ask Socratic questions to deepen their understanding. "
            "Be encouraging and constructive."
        )
        instructions += f"\n\nQuestion: {user_instruction}"
        if learning_outcome_name:
            instructions += f"\nLearning Outcome: {learning_outcome_name}"
        if assessment_prompt:
            instructions += f"\nRubric:\n{assessment_prompt}"
    else:
        instructions = current_segment.get(
            "instructions", "Help the user learn about AI safety."
        )
```

**Step 2: Run backend tests**

Run: `cd /home/penguin/code/lens-platform/ws3 && .venv/bin/pytest web_api/tests/ -v`
Expected: All tests pass.

**Step 3: Commit**

```
feat: holistic feedback system prompt for test sections
```

---

### Task 5: Verify end-to-end

**Step 1: Run full checks**

```bash
cd web_frontend && npm run lint && npm run build
cd .. && .venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/pytest
```

Expected: All pass.

**Step 2: Manual test via Chrome DevTools MCP**

Navigate to a module with a test section that has `feedback: true`. Complete all questions. Verify:
- Chat appears below test after last question
- Consolidated message includes all questions and answers
- AI streams a holistic response
- On page reload, chat is hidden

**Step 3: Final commit (if any fixups needed)**

```
fix: test feedback adjustments from manual testing
```
