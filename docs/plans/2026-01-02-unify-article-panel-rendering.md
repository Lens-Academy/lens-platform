# Unify ArticlePanel Rendering Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep ArticlePanel mounted in the same JSX position across article→chat transitions to preserve scroll position.

**Architecture:** Instead of having two separate conditional branches that render ArticlePanel (one for article stage, one for chat-after-article stage), we'll extract article display logic to always render ArticlePanel in the same place when ANY article is available (current or previous). The component will receive unified props that work for both scenarios.

**Tech Stack:** React, TypeScript

---

## Task 1: Refactor ContentPanel to Unify Article Rendering

**Files:**
- Modify: `web_frontend/src/components/unified-lesson/ContentPanel.tsx`

**Step 1: Understand the current branching structure**

Current structure has two separate ArticlePanel render locations:
- Lines 72-82: Chat stage with previous article (blurred)
- Lines 122-176: Article stage (with scroll detection and button)

These need to be unified into a single render location.

**Step 2: Refactor to single ArticlePanel render**

Replace the entire component with this unified structure:

```tsx
// web_frontend/src/components/unified-lesson/ContentPanel.tsx
import { useState, useCallback } from "react";
import {
  useFloating,
  useClick,
  useDismiss,
  useInteractions,
  offset,
  flip,
  shift,
  FloatingPortal,
} from "@floating-ui/react";
import type { Stage, PreviousStageInfo, ArticleData } from "../../types/unified-lesson";
import ArticlePanel from "./ArticlePanel";
import VideoPlayer from "./VideoPlayer";

type ContentPanelProps = {
  stage: Stage | null;
  article?: ArticleData | null;
  onVideoEnded: () => void;
  onNextClick: () => void;
  isReviewing?: boolean;
  // For chat stages: show previous content (blurred or visible)
  previousArticle?: ArticleData | null;
  previousStage?: PreviousStageInfo | null;
  includePreviousContent?: boolean;
};

export default function ContentPanel({
  stage,
  article,
  onVideoEnded,
  onNextClick,
  isReviewing = false,
  previousArticle,
  previousStage,
  includePreviousContent = true,
}: ContentPanelProps) {
  // Track if user has scrolled to bottom of article
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const handleScrolledToBottom = useCallback(() => {
    setHasScrolledToBottom(true);
  }, []);

  // Popover for "haven't scrolled yet" confirmation
  const [skipPopoverOpen, setSkipPopoverOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open: skipPopoverOpen,
    onOpenChange: setSkipPopoverOpen,
    placement: "top",
    middleware: [offset(8), flip(), shift({ padding: 8 })],
  });
  const click = useClick(context);
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss]);

  const handleReadButtonClick = () => {
    if (hasScrolledToBottom) {
      onNextClick();
    }
    // If not scrolled, the popover opens via useClick
  };

  // Determine what article to show (if any) and how to show it
  const isArticleStage = stage?.type === "article";
  const isChatAfterArticle = stage?.type === "chat" && previousStage?.type === "article" && previousArticle;
  const shouldShowArticle = isArticleStage || isChatAfterArticle;

  // Unified article data: current article for article stage, previous for chat stage
  const articleToShow = isArticleStage ? (article ?? { content: "Loading..." }) : previousArticle;
  const isBlurred = isChatAfterArticle && !includePreviousContent;
  const showButton = isArticleStage && !isReviewing;

  if (!stage) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Lesson complete!</p>
      </div>
    );
  }

  // Unified article rendering - same JSX position for both article and chat-after-article
  if (shouldShowArticle && articleToShow) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex-1 overflow-hidden">
          <ArticlePanel
            article={articleToShow}
            blurred={isBlurred}
            onScrolledToBottom={showButton ? handleScrolledToBottom : undefined}
          />
        </div>
        {showButton && (
          <div className="p-4 border-t bg-white">
            <button
              ref={hasScrolledToBottom ? undefined : refs.setReference}
              onClick={handleReadButtonClick}
              {...(hasScrolledToBottom ? {} : getReferenceProps())}
              className="w-full py-2 rounded-lg bg-gray-300 text-black hover:bg-gray-400 cursor-pointer"
            >
              I've read the article
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
          </div>
        )}
      </div>
    );
  }

  // Chat stage with video as previous content
  if (stage.type === "chat" && previousStage?.type === "video" && previousStage.videoId) {
    const blurred = !includePreviousContent;
    const thumbnailUrl = `https://img.youtube.com/vi/${previousStage.videoId}/maxresdefault.jpg`;
    return (
      <div className="h-full flex items-center justify-center bg-white overflow-hidden relative">
        <img
          src={thumbnailUrl}
          alt="Video thumbnail"
          className={`max-w-full max-h-full object-contain ${blurred ? "blur-sm" : ""}`}
        />
        {blurred && (
          <div className="absolute inset-0 flex items-center justify-center z-20">
            <div className="bg-white rounded-lg px-6 py-4 shadow-lg text-center">
              <svg className="w-8 h-8 mx-auto mb-2 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
              </svg>
              <p className="text-gray-600 text-sm">Please chat with the AI tutor</p>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Chat stage fallback (no previous content)
  if (stage.type === "chat") {
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

  // Video stage
  if (stage.type === "video") {
    return (
      <div className="h-full flex flex-col justify-center">
        <VideoPlayer
          videoId={stage.videoId}
          start={stage.from}
          end={stage.to || 9999}
          onEnded={isReviewing ? () => {} : onVideoEnded}
        />
      </div>
    );
  }

  return null;
}
```

**Step 3: Verify the refactor works**

Run: `npm run build --prefix web_frontend`
Expected: Build succeeds with no TypeScript errors

**Step 4: Manual test**

1. Open http://localhost:5175/lesson/intelligence-feedback-loop
2. Scroll to bottom of article
3. Click "I've read the article"
4. Verify: Article should remain at same scroll position (now blurred if chat has includePreviousContent=false)

**Step 5: Commit**

```bash
jj describe -m "refactor: unify ArticlePanel rendering to preserve scroll position

Previously, ContentPanel had two separate branches for rendering ArticlePanel:
- One for article stages (with scroll detection and button)
- One for chat stages showing previous article (blurred)

This caused React to unmount/remount the component when transitioning,
losing scroll position. Now both cases use the same JSX location,
preserving the component instance and scroll position."
```

---

## Summary

This is a single-task refactor that:
1. Computes `shouldShowArticle`, `articleToShow`, `isBlurred`, `showButton` flags
2. Uses one unified ArticlePanel render path for both article and chat-after-article stages
3. Conditionally passes `blurred` and `onScrolledToBottom` props based on current mode
4. Keeps video and fallback chat rendering unchanged
