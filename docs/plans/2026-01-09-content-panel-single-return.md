# ContentPanel Single-Return Refactor

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor ContentPanel from multiple early returns to a single return with consistent layout structure.

**Architecture:** Replace 5 conditional early-return branches with computed `contentArea` and `footerContent` variables, then a single return that always renders the same outer structure (flex column with content area + footer).

**Tech Stack:** React, TypeScript, Tailwind CSS

---

## Background

**Current problem:** The component has 5 early returns for different stage types. Each branch independently decides whether to render a footer. This led to a bug where chat-after-video stages had no footer.

**Target structure:**
```
┌─────────────────────────┐
│ Optional Banner         │  ← Conditional
├─────────────────────────┤
│ Content Area            │  ← Varies by stage type
│ (flex-1, scrollable)    │
├─────────────────────────┤
│ Footer                  │  ← Always present, content varies
└─────────────────────────┘
```

**File:** `web_frontend/src/components/unified-lesson/ContentPanel.tsx`

---

## Task 1: Extract BlurredVideoThumbnail Component

**Files:**
- Modify: `web_frontend/src/components/unified-lesson/ContentPanel.tsx:214-231`

**Why:** Extract inline JSX to a named component for clarity before refactoring.

**Step 1: Add BlurredVideoThumbnail component above ContentPanel**

Add this component definition after the imports, before the `ContentPanelProps` type (around line 17):

```tsx
function BlurredVideoThumbnail({ videoId }: { videoId: string }) {
  const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
  return (
    <div className="h-full flex items-center justify-center bg-white overflow-hidden relative">
      <img
        src={thumbnailUrl}
        alt="Video thumbnail"
        className="max-w-full max-h-full object-contain blur-sm"
      />
      <div className="absolute inset-0 flex items-center justify-center z-20">
        <div className="bg-white rounded-lg px-6 py-4 shadow-lg text-center">
          <svg className="w-8 h-8 mx-auto mb-2 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
          </svg>
          <p className="text-gray-600 text-sm">Please chat with the AI tutor</p>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Replace inline JSX with component usage**

Find the block at lines 214-231 that renders the thumbnail and replace with:

```tsx
    const thumbnailUrl = `https://img.youtube.com/vi/${previousStage.videoId}/maxresdefault.jpg`;
    return (
      <div className="h-full flex items-center justify-center bg-white overflow-hidden relative">
        ...
      </div>
    );
```

Replace the entire return statement (lines 215-231) with:

```tsx
    return <BlurredVideoThumbnail videoId={previousStage.videoId} />;
```

**Step 3: Verify visually**

Run: `python main.py --dev`
Navigate to a chat stage after a video stage
Expected: Blurred video thumbnail displays correctly with "Please chat with the AI tutor" overlay

**Step 4: Commit**

```bash
jj commit -m "refactor: extract BlurredVideoThumbnail component"
```

---

## Task 2: Extract ChatFallbackPlaceholder Component

**Files:**
- Modify: `web_frontend/src/components/unified-lesson/ContentPanel.tsx:235-247`

**Step 1: Add ChatFallbackPlaceholder component after BlurredVideoThumbnail**

```tsx
function ChatFallbackPlaceholder() {
  return (
    <div className="h-full flex items-center justify-center bg-gray-50 p-8">
      <div className="text-center max-w-md">
        <div className="text-6xl mb-4">💬</div>
        <h2 className="text-xl font-semibold text-gray-800 mb-2">Discussion Time</h2>
        <p className="text-gray-600">
          Use the chat on the left to discuss what you've learned.
        </p>
      </div>
    </div>
  );
}
```

**Step 2: Replace inline JSX with component**

Find the chat fallback block (lines 235-247) and replace:

```tsx
  // Chat stage fallback (no previous content)
  if (stage.type === "chat") {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50 p-8">
        ...
      </div>
    );
  }
```

With:

```tsx
  // Chat stage fallback (no previous content)
  if (stage.type === "chat") {
    return <ChatFallbackPlaceholder />;
  }
```

**Step 3: Verify visually**

Navigate to a chat stage with no previous content
Expected: "Discussion Time" placeholder displays correctly

**Step 4: Commit**

```bash
jj commit -m "refactor: extract ChatFallbackPlaceholder component"
```

---

## Task 3: Add Content Type Detection Variables

**Files:**
- Modify: `web_frontend/src/components/unified-lesson/ContentPanel.tsx:80-88`

**Step 1: Expand content type detection after existing variables**

Find the existing detection block (lines 80-88):

```tsx
  // Determine what article to show (if any) and how to show it
  const isArticleStage = stage?.type === "article";
  const isChatAfterArticle = stage?.type === "chat" && previousStage?.type === "article" && !!previousArticle;
  const shouldShowArticle = isArticleStage || isChatAfterArticle;

  // Unified article data: current article for article stage, previous for chat stage
  const articleToShow = isArticleStage ? (article ?? { content: "Loading..." }) : previousArticle;
  const isBlurred = isChatAfterArticle && !showUserPreviousContent;
  const showButton = isArticleStage && !isReviewing;
```

Replace with expanded detection:

```tsx
  // Content type detection
  const isArticleStage = stage?.type === "article";
  const isVideoStage = stage?.type === "video";
  const isChatStage = stage?.type === "chat";

  const isChatAfterArticle = isChatStage && previousStage?.type === "article" && !!previousArticle;
  const isChatAfterVideo = isChatStage && previousStage?.type === "video" && !!previousStage?.videoId;
  const isChatFallback = isChatStage && !isChatAfterArticle && !isChatAfterVideo;

  const showArticleContent = isArticleStage || isChatAfterArticle;
  const showVideoContent = isVideoStage || isChatAfterVideo;

  // Current stage = not reviewing past, not previewing future
  const isCurrentStage = !isReviewing && !isPreviewing;

  // Article-specific
  const articleToShow = isArticleStage ? (article ?? { content: "Loading..." }) : previousArticle;
  const articleBlurred = isChatAfterArticle && !showUserPreviousContent;
  const articleShowButton = isArticleStage && isCurrentStage;

  // Video-specific
  const videoId = isVideoStage ? stage.videoId : previousStage?.videoId;
  const videoStart = isVideoStage ? stage.from : (previousStage?.from ?? 0);
  const videoEnd = isVideoStage ? (stage.to || 9999) : (previousStage?.to ?? 9999);
  const videoBlurred = isChatAfterVideo && !showUserPreviousContent;
```

**Step 2: Update existing references**

Find and replace these variable names in the rest of the file:
- `shouldShowArticle` → `showArticleContent`
- `isBlurred` → `articleBlurred`
- `showButton` → `articleShowButton`

**Step 3: Verify no TypeScript errors**

Run: `cd web_frontend && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
jj commit -m "refactor: expand content type detection variables"
```

---

## Task 4: Compute Optional Banner

**Files:**
- Modify: `web_frontend/src/components/unified-lesson/ContentPanel.tsx`

**Step 1: Add unified optional banner computation after content detection**

Add after the video-specific variables:

```tsx
  // Optional banner (only for article/video stages when current)
  const isOptional = stage && 'optional' in stage && stage.optional === true;
  const showOptionalBanner = isOptional && isCurrentStage && onSkipOptional && (isArticleStage || isVideoStage);
  const optionalBannerStageType = isArticleStage ? "article" : "video";
```

**Step 2: Commit**

```bash
jj commit -m "refactor: add unified optional banner computation"
```

---

## Task 5: Extract DoneReadingButton Component

**Files:**
- Modify: `web_frontend/src/components/unified-lesson/ContentPanel.tsx`

**Why:** The done reading button JSX is complex (includes popover logic). Extract it before the main refactor.

**Step 1: Create DoneReadingButton as a local component**

Add after the hook definitions (around line 78), before content detection:

```tsx
  // Done reading button with popover
  const doneReadingButton = (
    <>
      <button
        ref={hasScrolledToBottom ? undefined : refs.setReference}
        onClick={handleReadButtonClick}
        {...(hasScrolledToBottom ? {} : getReferenceProps())}
        className="w-full py-2 rounded-lg bg-gray-300 text-black hover:bg-gray-400"
        data-testid="done-reading-button"
      >
        Done reading
      </button>
      {skipPopoverOpen && !hasScrolledToBottom && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="bg-white border border-gray-200 rounded-lg shadow-lg p-4 z-50 max-w-xs"
          >
            <p className="text-sm text-gray-700 mb-3">
              It looks like you haven't reached the bottom of the article yet. What would you like to do?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setSkipPopoverOpen(false);
                  onNextClick();
                }}
                className="flex-1 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded"
              >
                Skip anyway
              </button>
              <button
                onClick={() => setSkipPopoverOpen(false)}
                className="flex-1 px-3 py-1.5 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded"
              >
                Keep reading
              </button>
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  );
```

**Step 2: Update article branch to use it**

In the article rendering block, replace the `buttonElement` definition with a reference:

Find:
```tsx
    // Button component (reused for inline and sticky)
    const buttonElement = showButton && (
      <>
        <button
          ...
        </button>
        {skipPopoverOpen && ...}
      </>
    );
```

Replace with:
```tsx
    // Button component (reused for inline and sticky)
    const buttonElement = articleShowButton ? doneReadingButton : null;
```

**Step 3: Verify visually**

Navigate to an article stage
Expected: "Done reading" button works with scroll detection and popover

**Step 4: Commit**

```bash
jj commit -m "refactor: extract doneReadingButton JSX variable"
```

---

## Task 6: Compute Footer Content

**Files:**
- Modify: `web_frontend/src/components/unified-lesson/ContentPanel.tsx`

**Step 1: Add done watching button and footer computation**

Add after `doneReadingButton`, before content detection:

```tsx
  // Done watching button
  const doneWatchingButton = (
    <button
      onClick={onNextClick}
      className="w-full py-2 rounded-lg bg-gray-300 text-black hover:bg-gray-400"
    >
      Done watching
    </button>
  );

  // Footer placeholder
  const footerPlaceholder = <div className="py-2 invisible">Placeholder</div>;
```

Add after all content detection variables:

```tsx
  // Footer content decision
  // - Article (current, sticky): done reading button
  // - Video (current): done watching button
  // - Everything else: placeholder
  const useArticleStickyFooter = articleShowButton && contentFits !== true;

  let footerContent: React.ReactNode;
  if (isArticleStage && useArticleStickyFooter) {
    footerContent = doneReadingButton;
  } else if (isVideoStage && isCurrentStage) {
    footerContent = doneWatchingButton;
  } else {
    footerContent = footerPlaceholder;
  }
```

**Step 2: Commit**

```bash
jj commit -m "refactor: add footer content computation"
```

---

## Task 7: Build Content Area JSX

**Files:**
- Modify: `web_frontend/src/components/unified-lesson/ContentPanel.tsx`

**Step 1: Add contentArea computation after footer computation**

```tsx
  // Content area based on stage type
  let contentArea: React.ReactNode = null;

  if (showArticleContent && articleToShow) {
    // Inline button for short articles
    const useInlineButton = articleShowButton && contentFits === true;
    const afterContent = useInlineButton ? (
      <div className="max-w-[620px] mx-auto px-6 pb-6">
        {doneReadingButton}
      </div>
    ) : undefined;

    contentArea = (
      <ArticlePanel
        article={articleToShow}
        blurred={articleBlurred}
        onScrolledToBottom={articleShowButton ? handleScrolledToBottom : undefined}
        onContentFitsChange={articleShowButton ? handleContentFitsChange : undefined}
        afterContent={afterContent}
      />
    );
  } else if (showVideoContent && videoId) {
    if (videoBlurred) {
      contentArea = <BlurredVideoThumbnail videoId={videoId} />;
    } else {
      contentArea = (
        <div className="flex-1 flex flex-col justify-center">
          <VideoPlayer
            videoId={videoId}
            start={videoStart}
            end={videoEnd}
            onEnded={isVideoStage && isCurrentStage ? onVideoEnded : () => {}}
            hideControls={isChatAfterVideo}
          />
        </div>
      );
    }
  } else if (isChatFallback) {
    contentArea = <ChatFallbackPlaceholder />;
  }
```

**Step 2: Commit**

```bash
jj commit -m "refactor: add contentArea computation"
```

---

## Task 8: Replace Early Returns with Single Return

**Files:**
- Modify: `web_frontend/src/components/unified-lesson/ContentPanel.tsx`

**Step 1: Keep only the guard clause**

The `if (!stage)` block (lines 90-96) stays as-is - this is a valid guard clause.

**Step 2: Delete all other early return blocks**

Delete these blocks entirely:
- The `if (showArticleContent && articleToShow)` block (was lines 99-192)
- The `if (stage.type === "chat" && previousStage?.type === "video")` block (was lines 195-232)
- The `if (stage.type === "chat")` block (was lines 235-247)
- The `if (stage.type === "video")` block (was lines 250-288)
- The final `return null;`

**Step 3: Add the single return**

After all the computation (contentArea, footerContent), add:

```tsx
  // Single return with consistent structure
  return (
    <div className="h-full flex flex-col">
      {showOptionalBanner && (
        <div className="px-4 pt-4 max-w-[620px] mx-auto w-full">
          <OptionalBanner stageType={optionalBannerStageType} onSkip={onSkipOptional!} />
        </div>
      )}
      <div className="flex-1 overflow-hidden">
        {contentArea}
      </div>
      <div className="p-4 border-t border-gray-200 bg-white">
        <div className="max-w-[620px] mx-auto">
          {footerContent}
        </div>
      </div>
    </div>
  );
```

**Step 4: Verify TypeScript compiles**

Run: `cd web_frontend && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
jj commit -m "refactor: replace early returns with single return structure"
```

---

## Task 9: Visual Verification

**Step 1: Start dev server**

Run: `python main.py --dev`

**Step 2: Test all content types**

Navigate through the lesson and verify each stage type:

| Stage Type | Expected Behavior |
|------------|-------------------|
| Article (current) | Shows article, "Done reading" button in footer (or inline if short) |
| Article (reviewing) | Shows article, empty footer |
| Video (current) | Shows video player, "Done watching" button in footer |
| Video (reviewing) | Shows video player, empty footer |
| Chat after article | Shows article (blurred or not), empty footer |
| Chat after video | Shows video/thumbnail, **empty footer** (this was the bug!) |
| Chat fallback | Shows "Discussion Time", empty footer |

**Step 3: Test optional banner**

Navigate to an optional article/video stage
Expected: Optional banner shows above content

**Step 4: Test article scroll detection**

On a long article, try clicking "Done reading" without scrolling
Expected: Popover appears asking to confirm skip

**Step 5: Commit final verification**

```bash
jj commit -m "refactor: ContentPanel single-return structure complete"
```

---

## Summary

After completing all tasks, ContentPanel will have:

1. **Two small helper components:** `BlurredVideoThumbnail`, `ChatFallbackPlaceholder`
2. **Clear content type detection:** Variables that determine what to show
3. **Computed JSX variables:** `contentArea`, `footerContent`, button elements
4. **One guard clause:** `if (!stage)` for lesson complete state
5. **Single return:** Consistent layout structure that always includes footer

The footer is now structurally guaranteed to appear for all stage types.
