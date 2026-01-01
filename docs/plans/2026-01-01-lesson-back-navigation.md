# Lesson Back Navigation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add reference-mode navigation so users can review previous articles/videos without affecting lesson progress.

**Architecture:** Frontend adds `viewingStageIndex` state to track which stage is displayed (can differ from `current_stage_index`). Navigation arrows in header skip chat stages. Small backend change adds `view_stage` query param to session endpoint for fetching past stage content.

**Tech Stack:** React, TypeScript, FastAPI, existing lesson infrastructure

**Design Document:** `docs/plans/2026-01-01-lesson-back-navigation-design.md`

---

## Task 1: Backend - Add view_stage Query Parameter

**Files:**
- Modify: `web_api/routes/lessons.py:185-245` (get_session_state endpoint)

**Step 1: Modify the endpoint to accept optional view_stage param**

In `web_api/routes/lessons.py`, update the `get_session_state` function:

```python
@router.get("/lesson-sessions/{session_id}")
async def get_session_state(
    session_id: int,
    request: Request,
    view_stage: int | None = None,  # Add this parameter
):
    """Get current session state."""
    user_id = await get_user_id_for_lesson(request)

    try:
        session = await get_session(session_id)
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")

    if session["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Not your session")

    # Load lesson to include stage info
    lesson = load_lesson(session["lesson_id"])

    # Determine which stage to get content for
    content_stage_index = view_stage if view_stage is not None else session["current_stage_index"]

    # Validate view_stage is within bounds and not beyond current progress
    if view_stage is not None:
        if view_stage < 0 or view_stage >= len(lesson.stages):
            raise HTTPException(status_code=400, detail="Invalid stage index")
        if view_stage > session["current_stage_index"]:
            raise HTTPException(status_code=400, detail="Cannot view future stages")

    current_stage = (
        lesson.stages[session["current_stage_index"]]
        if session["current_stage_index"] < len(lesson.stages)
        else None
    )

    # Get content for the viewed stage (may differ from current)
    content_stage = (
        lesson.stages[content_stage_index]
        if content_stage_index < len(lesson.stages)
        else None
    )

    # Get content for the viewed stage
    stage_content = None
    if content_stage:
        stage_content = get_stage_content(content_stage)

    return {
        "session_id": session["session_id"],
        "lesson_id": session["lesson_id"],
        "lesson_title": lesson.title,
        "current_stage_index": session["current_stage_index"],
        "total_stages": len(lesson.stages),
        "current_stage": (
            {
                "type": current_stage.type,
                **(
                    {
                        "source_url": current_stage.source_url,
                        "from": current_stage.from_text,
                        "to": current_stage.to_text,
                    }
                    if current_stage and current_stage.type == "article"
                    else {}
                ),
                **(
                    {
                        "videoId": current_stage.video_id,
                        "from": current_stage.from_seconds,
                        "to": current_stage.to_seconds,
                    }
                    if current_stage and current_stage.type == "video"
                    else {}
                ),
            }
            if current_stage
            else None
        ),
        "messages": session["messages"],
        "completed": session["completed_at"] is not None,
        "content": stage_content,
        # Add all stages for frontend navigation
        "stages": [
            {
                "type": s.type,
                **({"source_url": s.source_url} if s.type == "article" else {}),
                **({"videoId": s.video_id, "from": s.from_seconds, "to": s.to_seconds} if s.type == "video" else {}),
            }
            for s in lesson.stages
        ],
    }
```

**Step 2: Verify the server still starts**

Run: `python main.py --dev --no-bot`

Expected: Server starts without errors

**Step 3: Commit**

```bash
jj desc -m "feat(api): add view_stage param to session endpoint for reviewing past stages"
jj new
```

---

## Task 2: Frontend API - Add view_stage Parameter

**Files:**
- Modify: `web_frontend/src/api/lessons.ts:34-40`
- Modify: `web_frontend/src/types/unified-lesson.ts:43-54`

**Step 1: Update SessionState type to include stages array**

In `web_frontend/src/types/unified-lesson.ts`, add `stages` to SessionState:

```typescript
export type SessionState = {
  session_id: number;
  lesson_id: string;
  lesson_title: string;
  current_stage_index: number;
  total_stages: number;
  current_stage: Stage | null;
  messages: ChatMessage[];
  completed: boolean;
  content: string | null;
  stages: Stage[];  // Add this
};
```

**Step 2: Update getSession to accept optional viewStage**

In `web_frontend/src/api/lessons.ts`, modify the function:

```typescript
export async function getSession(
  sessionId: number,
  viewStage?: number
): Promise<SessionState> {
  const url = viewStage !== undefined
    ? `${API_BASE}/api/lesson-sessions/${sessionId}?view_stage=${viewStage}`
    : `${API_BASE}/api/lesson-sessions/${sessionId}`;

  const res = await fetch(url, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch session");
  return res.json();
}
```

**Step 3: Verify TypeScript compiles**

Run: `cd web_frontend && npm run build`

Expected: Build succeeds

**Step 4: Commit**

```bash
jj desc -m "feat(frontend): add viewStage param to getSession API"
jj new
```

---

## Task 3: Frontend State - Add viewingStageIndex

**Files:**
- Modify: `web_frontend/src/pages/UnifiedLesson.tsx`

**Step 1: Add state and derived values**

After line 17 (after the existing state declarations), add:

```typescript
const [viewingStageIndex, setViewingStageIndex] = useState<number | null>(null);
```

Add derived values after the existing ones (around line 116):

```typescript
const isReviewing = viewingStageIndex !== null;
const displayStageIndex = viewingStageIndex ?? (session?.current_stage_index ?? 0);
```

**Step 2: Add navigation helper functions**

After the derived values, add:

```typescript
// Get indices of reviewable stages (article/video only, before current)
const getReviewableStages = useCallback(() => {
  if (!session?.stages) return [];
  return session.stages
    .map((stage, index) => ({ stage, index }))
    .filter(({ stage, index }) =>
      stage.type !== 'chat' && index < session.current_stage_index
    );
}, [session?.stages, session?.current_stage_index]);

const handleGoBack = useCallback(() => {
  const reviewable = getReviewableStages();
  const currentViewing = viewingStageIndex ?? session?.current_stage_index ?? 0;
  const earlier = reviewable.filter(s => s.index < currentViewing);
  if (earlier.length) {
    setViewingStageIndex(earlier[earlier.length - 1].index);
  }
}, [getReviewableStages, viewingStageIndex, session?.current_stage_index]);

const handleGoForward = useCallback(() => {
  const reviewable = getReviewableStages();
  const currentViewing = viewingStageIndex ?? session?.current_stage_index ?? 0;
  const later = reviewable.filter(s => s.index > currentViewing);
  if (later.length) {
    setViewingStageIndex(later[0].index);
  }
}, [getReviewableStages, viewingStageIndex, session?.current_stage_index]);

const handleReturnToCurrent = useCallback(() => {
  setViewingStageIndex(null);
}, []);
```

**Step 3: Add effect to fetch content when viewingStageIndex changes**

Add after the existing useEffect blocks:

```typescript
// Fetch content for viewed stage when reviewing
useEffect(() => {
  if (!sessionId || viewingStageIndex === null) return;

  async function fetchViewedContent() {
    try {
      const state = await getSession(sessionId!, viewingStageIndex!);
      // Only update the content, not the full session
      setSession(prev => prev ? { ...prev, content: state.content } : null);
    } catch (e) {
      console.error("Failed to fetch stage content:", e);
    }
  }

  fetchViewedContent();
}, [sessionId, viewingStageIndex]);

// Reset viewingStageIndex when advancing to new stage
useEffect(() => {
  setViewingStageIndex(null);
}, [session?.current_stage_index]);
```

**Step 4: Verify TypeScript compiles**

Run: `cd web_frontend && npm run build`

Expected: Build succeeds (may have unused variable warnings, that's fine)

**Step 5: Commit**

```bash
jj desc -m "feat(lesson): add viewingStageIndex state and navigation logic"
jj new
```

---

## Task 4: Header Navigation UI

**Files:**
- Modify: `web_frontend/src/pages/UnifiedLesson.tsx` (header section, lines 154-169)

**Step 1: Compute navigation button states**

Add after the navigation handlers:

```typescript
// Compute navigation states
const reviewableStages = getReviewableStages();
const currentViewing = viewingStageIndex ?? (session?.current_stage_index ?? 0);
const canGoBack = reviewableStages.some(s => s.index < currentViewing);
const canGoForward = isReviewing && reviewableStages.some(s => s.index > currentViewing && s.index < (session?.current_stage_index ?? 0));
```

**Step 2: Update the header JSX**

Replace the header section (the `<header>` element) with:

```tsx
{/* Header */}
<header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
  <div className="flex items-center gap-3">
    {/* Navigation arrows */}
    <div className="flex items-center gap-1">
      <button
        onClick={handleGoBack}
        disabled={!canGoBack}
        className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
        title="Review previous content"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      {isReviewing && (
        <button
          onClick={handleGoForward}
          disabled={!canGoForward}
          className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
          title="Next reviewed content"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}
    </div>

    {/* Stage indicator */}
    <div>
      <h1 className="text-lg font-semibold text-gray-900">{session.lesson_title}</h1>
      <p className="text-sm text-gray-500">
        Stage {session.current_stage_index + 1} of {session.total_stages}
      </p>
    </div>
  </div>

  {/* Right side: reviewing indicator or skip button */}
  <div className="flex items-center gap-2">
    {isReviewing ? (
      <>
        <span className="text-sm text-amber-600 bg-amber-50 px-2 py-1 rounded">
          Reviewing previous material
        </span>
        <button
          onClick={handleReturnToCurrent}
          className="text-blue-600 hover:text-blue-700 text-sm font-medium"
        >
          Return to current →
        </button>
      </>
    ) : (
      !isChatStage && (
        <button
          onClick={handleAdvanceStage}
          className="text-gray-500 hover:text-gray-700 text-sm"
        >
          Skip →
        </button>
      )
    )}
  </div>
</header>
```

**Step 3: Verify in browser**

Run: `python main.py --dev --no-bot`

Navigate to `http://localhost:5173/lesson/intro-to-ai-safety`

Expected: Header shows back arrow (disabled on first stage), stage indicator, and skip button

**Step 4: Commit**

```bash
jj desc -m "feat(lesson): add navigation arrows and reviewing indicator to header"
jj new
```

---

## Task 5: ContentPanel - Handle Review Mode

**Files:**
- Modify: `web_frontend/src/pages/UnifiedLesson.tsx` (ContentPanel props)
- Modify: `web_frontend/src/components/unified-lesson/ContentPanel.tsx`

**Step 1: Update ContentPanel props**

In `ContentPanel.tsx`, update the props type:

```typescript
type ContentPanelProps = {
  stage: Stage | null;
  articleContent?: string;
  onVideoEnded: () => void;
  onNextClick: () => void;
  isReviewing?: boolean;  // Add this
};
```

Update the function signature:

```typescript
export default function ContentPanel({
  stage,
  articleContent,
  onVideoEnded,
  onNextClick,
  isReviewing = false,  // Add this
}: ContentPanelProps) {
```

**Step 2: Disable progression when reviewing**

For the article section (around line 47-66), update the button:

```tsx
if (stage.type === "article") {
  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-hidden">
        <ArticlePanel
          content={articleContent || "Loading..."}
          blurred={false}
        />
      </div>
      {!isReviewing && (
        <div className="p-4 border-t bg-white">
          <button
            onClick={onNextClick}
            className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700"
          >
            Continue
          </button>
        </div>
      )}
    </div>
  );
}
```

For the video section (around line 68-80), pass a no-op when reviewing:

```tsx
if (stage.type === "video") {
  return (
    <div className="h-full flex flex-col justify-center">
      <VideoPlayer
        videoId={stage.videoId}
        start={stage.from}
        end={stage.to || 9999}
        onEnded={isReviewing ? () => {} : onVideoEnded}
        onSkip={isReviewing ? undefined : onNextClick}
      />
    </div>
  );
}
```

**Step 3: Update UnifiedLesson to pass reviewed stage and isReviewing**

In `UnifiedLesson.tsx`, compute the displayed stage:

```typescript
// Get the stage to display (reviewed or current)
const displayedStage = useMemo(() => {
  if (!session?.stages) return session?.current_stage ?? null;
  if (viewingStageIndex !== null) {
    return session.stages[viewingStageIndex] ?? null;
  }
  return session.current_stage;
}, [session?.stages, session?.current_stage, viewingStageIndex]);
```

Update the ContentPanel usage:

```tsx
<ContentPanel
  stage={displayedStage}
  articleContent={session.content || undefined}
  onVideoEnded={handleAdvanceStage}
  onNextClick={handleAdvanceStage}
  isReviewing={isReviewing}
/>
```

**Step 4: Verify in browser**

Progress to stage 2+ in lesson, then click back arrow.

Expected: Previous article/video shows, no Continue button, can return to current

**Step 5: Commit**

```bash
jj desc -m "feat(lesson): disable progression in ContentPanel when reviewing"
jj new
```

---

## Task 6: ChatPanel - Always Enable Input

**Files:**
- Modify: `web_frontend/src/components/unified-lesson/ChatPanel.tsx`
- Modify: `web_frontend/src/pages/UnifiedLesson.tsx`

**Step 1: Update ChatPanel props**

Replace `disabled` prop with `showDisclaimer`:

```typescript
type ChatPanelProps = {
  messages: ChatMessage[];
  pendingMessage: PendingMessage | null;
  onSendMessage: (content: string) => void;
  onRetryMessage: () => void;
  isLoading: boolean;
  streamingContent: string;
  currentStage: Stage | null;
  pendingTransition: boolean;
  onConfirmTransition: () => void;
  onContinueChatting: () => void;
  showDisclaimer?: boolean;  // Changed from disabled
};
```

Update function signature:

```typescript
export default function ChatPanel({
  messages,
  pendingMessage,
  onSendMessage,
  onRetryMessage,
  isLoading,
  streamingContent,
  currentStage,
  pendingTransition,
  onConfirmTransition,
  onContinueChatting,
  showDisclaimer = false,  // Changed from disabled
}: ChatPanelProps) {
```

**Step 2: Update handleSubmit - remove disabled check**

```typescript
const handleSubmit = (e: React.FormEvent) => {
  e.preventDefault();
  if (input.trim() && !isLoading) {  // Remove disabled check
    onSendMessage(input.trim());
    setInput("");
  }
};
```

**Step 3: Remove opacity and header indicator, add disclaimer above input**

Remove the opacity class from the container and the isContentStage header. Update the component to:

```tsx
return (
  <div className="flex flex-col h-full">
    {/* Messages */}
    <div className="flex-1 overflow-y-auto space-y-3 p-4">
      {/* ... existing message rendering ... */}
    </div>

    {/* Disclaimer when not in chat stage */}
    {showDisclaimer && (
      <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
        <p className="text-sm text-gray-500">
          Feel free to ask questions. The focus is on the content above.
        </p>
      </div>
    )}

    {/* Input form */}
    <form onSubmit={handleSubmit} className="flex gap-2 p-4 border-t border-gray-200">
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Type a message..."
        disabled={isLoading}  // Only disable when loading
        className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
      />
      <button
        type="submit"
        disabled={isLoading || !input.trim()}  // Remove disabled check
        className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Send
      </button>
    </form>
  </div>
);
```

**Step 4: Update UnifiedLesson to pass showDisclaimer**

Replace the `disabled` prop with `showDisclaimer`:

```tsx
<ChatPanel
  messages={messages}
  pendingMessage={pendingMessage}
  onSendMessage={handleSendMessage}
  onRetryMessage={handleRetryMessage}
  isLoading={isLoading}
  streamingContent={streamingContent}
  currentStage={session.current_stage}
  pendingTransition={pendingTransition}
  onConfirmTransition={handleAdvanceStage}
  onContinueChatting={handleContinueChatting}
  showDisclaimer={!isChatStage || isReviewing}
/>
```

**Step 5: Verify in browser**

On an article stage, verify:
- Chat input is enabled
- Disclaimer shows above input
- Can send messages

**Step 6: Commit**

```bash
jj desc -m "feat(lesson): always enable chat input, add contextual disclaimer"
jj new
```

---

## Task 7: Final Testing and Cleanup

**Step 1: Full flow test**

1. Start lesson at stage 1 (article)
2. Verify back arrow is disabled
3. Chat while reading - verify it works
4. Click Continue to advance to stage 2 (chat)
5. Verify disclaimer disappears
6. Complete chat, advance to stage 3 (video)
7. Click back arrow - should skip chat, show stage 1 article
8. Verify "Reviewing previous material" indicator shows
9. Verify Continue button is hidden
10. Click forward arrow - should still be disabled (no reviewable stages between 1 and current)
11. Click "Return to current" - should go back to stage 3
12. Complete video, advance to stage 4 (chat)
13. Click back twice - should go to stage 3 (video), then stage 1 (article)
14. Click forward - should go to stage 3
15. Verify chat still works while reviewing

**Step 2: Commit final changes if any**

```bash
jj desc -m "chore: lesson back navigation complete"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Backend view_stage param | `web_api/routes/lessons.py` |
| 2 | Frontend API update | `api/lessons.ts`, `types/unified-lesson.ts` |
| 3 | viewingStageIndex state | `UnifiedLesson.tsx` |
| 4 | Header navigation UI | `UnifiedLesson.tsx` |
| 5 | ContentPanel review mode | `ContentPanel.tsx`, `UnifiedLesson.tsx` |
| 6 | ChatPanel always enabled | `ChatPanel.tsx`, `UnifiedLesson.tsx` |
| 7 | Final testing | - |
