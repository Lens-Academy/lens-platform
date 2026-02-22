# Deferred Test Completion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Defer marking a test section complete until the user clicks Continue after reading AI feedback, so auto-advance doesn't happen before they see it.

**Architecture:** Rename `onTestComplete` → `onTestTakingComplete` throughout. When `section.feedback` is true, skip `markComplete()` on question completion. Module.tsx renders a Continue button below the feedback chat that calls `markComplete()` and triggers auto-advance. No backend changes.

**Tech Stack:** React 19, TypeScript

**Design doc:** `docs/plans/2026-02-22-deferred-test-completion-design.md`

---

### Task 1: Rename `onTestComplete` → `onTestTakingComplete`

**Files:**
- Modify: `web_frontend/src/components/module/TestSection.tsx:25-52`
- Modify: `web_frontend/src/views/Module.tsx:1287-1288`

**Step 1: Rename in TestSection props interface (line 31)**

Change:
```typescript
onTestComplete: () => void;
```
To:
```typescript
onTestTakingComplete: () => void;
```

**Step 2: Rename in TestSection destructuring (line 49)**

Change `onTestComplete` to `onTestTakingComplete`.

**Step 3: Rename the call site in handleQuestionComplete (line 156)**

Change:
```typescript
onTestComplete();
```
To:
```typescript
onTestTakingComplete();
```

**Step 4: Rename in Module.tsx (line 1288)**

Change:
```tsx
onTestComplete={() => setTestModeActive(false)}
```
To:
```tsx
onTestTakingComplete={() => setTestModeActive(false)}
```

**Step 5: Update the dependency array in TestSection (around line 224)**

Replace `onTestComplete` with `onTestTakingComplete` in the `handleQuestionComplete` useCallback deps.

**Step 6: Verify build**

Run: `cd web_frontend && npx tsc --noEmit`
Expected: No new errors.

**Step 7: Commit**

```
refactor: rename onTestComplete to onTestTakingComplete
```

---

### Task 2: Defer `markComplete` when feedback is enabled

**Files:**
- Modify: `web_frontend/src/components/module/TestSection.tsx:153-210`

**Step 1: Wrap `markComplete` call in a feedback check**

In `handleQuestionComplete`, inside the `if (newCompleted.size === questions.length)` block (line 153), the `markComplete(...)` call (lines 193-210) should only run when feedback is NOT enabled. Wrap it:

Replace lines 193-210:
```typescript
        // Mark test section as complete via progress API
        const contentId = `test:${moduleSlug}:${sectionIndex}`;
        markComplete(
          {
            content_id: contentId,
            content_type: "test",
            content_title: section.meta?.title || "Test",
            module_slug: moduleSlug,
          },
          isAuthenticated,
        )
          .then((response) => {
            onMarkComplete(response);
          })
          .catch(() => {
            // Still mark locally complete even if API fails
            onMarkComplete();
          });
```

With:
```typescript
        // Mark test section as complete via progress API
        // When feedback is enabled, defer this until user clicks Continue
        if (!onFeedbackTrigger) {
          const contentId = `test:${moduleSlug}:${sectionIndex}`;
          markComplete(
            {
              content_id: contentId,
              content_type: "test",
              content_title: section.meta?.title || "Test",
              module_slug: moduleSlug,
            },
            isAuthenticated,
          )
            .then((response) => {
              onMarkComplete(response);
            })
            .catch(() => {
              // Still mark locally complete even if API fails
              onMarkComplete();
            });
        }
```

The guard uses `onFeedbackTrigger` (not `section.feedback`) because `onFeedbackTrigger` is only provided when `section.feedback` is true (Module.tsx passes `undefined` otherwise). This keeps the logic self-consistent within TestSection.

**Step 2: Verify build**

Run: `cd web_frontend && npx tsc --noEmit`
Expected: No new errors.

**Step 3: Commit**

```
feat: defer markComplete when test feedback is enabled
```

---

### Task 3: Add Continue button below feedback chat

**Files:**
- Modify: `web_frontend/src/views/Module.tsx:1307-1318`

**Step 1: Add Continue button after NarrativeChatSection**

Replace lines 1307-1318:
```tsx
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
```

With:
```tsx
                      {section.feedback && activeFeedbackKey === feedbackKey && (
                        <>
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
                          <div className="flex items-center justify-center py-6">
                            <button
                              onClick={() => {
                                const contentId = `test:${moduleId}:${sectionIndex}`;
                                markComplete(
                                  {
                                    content_id: contentId,
                                    content_type: "test",
                                    content_title: section.meta?.title || "Test",
                                    module_slug: moduleId,
                                  },
                                  isAuthenticated,
                                )
                                  .then((response) => handleMarkComplete(sectionIndex, response))
                                  .catch(() => handleMarkComplete(sectionIndex));
                              }}
                              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-all active:scale-95 font-medium"
                            >
                              Continue
                              <svg
                                className="w-4 h-4"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M9 5l7 7-7 7"
                                />
                              </svg>
                            </button>
                          </div>
                        </>
                      )}
```

The Continue button uses the same emerald styling as the "Next section" button in `MarkCompleteButton.tsx`. The `markComplete` import is already available in Module.tsx (used by AnswerBox via the same API module).

**Step 2: Verify `markComplete` is importable in Module.tsx**

Check if `markComplete` from `@/api/assessments` is already imported. If not, add:
```typescript
import { markComplete } from "@/api/assessments";
```

**Step 3: Verify build**

Run: `cd web_frontend && npm run build`
Expected: Build succeeds, lint passes.

**Step 4: Commit**

```
feat: add Continue button below test feedback chat
```

---

### Task 4: Verify end-to-end

**Step 1: Run full checks**

```bash
cd web_frontend && npm run lint && npm run build
```

Expected: All pass.

**Step 2: Manual test via Chrome DevTools MCP**

Navigate to a module with a test section that has `feedback: true`. Complete all questions. Verify:
- Feedback chat appears below test after last question
- Page does NOT auto-advance to next section
- Continue button appears below the feedback chat
- Clicking Continue marks the test complete and advances to next section
- On page reload after completing without clicking Continue, test shows as incomplete

**Step 3: Final commit (if any fixups needed)**

```
fix: test completion adjustments from manual testing
```
