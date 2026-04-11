# Video Continuation UX Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make subsequent video clips feel like "continuing" rather than "starting a new video" by showing a compact button instead of repeated thumbnails.

**Architecture:** Add `isFirstInSection` prop to VideoEmbed. First clip shows current thumbnail behavior; subsequent clips show a blue "Continue video" button that expands and scrolls into view on click.

**Tech Stack:** React, TypeScript, Tailwind CSS

---

## Task 1: Duration Formatter Utility

Create a utility function to format seconds as human-readable duration.

**Files:**
- Create: `web_frontend_next/src/utils/formatDuration.ts`

**Step 1: Create the utils directory and utility file**

```bash
mkdir -p web_frontend_next/src/utils
```

```typescript
// web_frontend_next/src/utils/formatDuration.ts

/**
 * Format seconds as human-readable duration.
 *
 * Under 5 minutes: shows seconds (e.g., "2 min 15 sec")
 * 5 minutes or above: rounds to whole minutes (e.g., "7 min")
 *
 * Examples:
 *   45 → "45 sec"
 *   135 → "2 min 15 sec"
 *   299 → "4 min 59 sec"
 *   300 → "5 min"
 *   423 → "7 min"
 *   3665 → "1 hr 1 min"
 */
export function formatDuration(seconds: number): string {
  // Guard against invalid input
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0 sec";
  }

  const totalSeconds = Math.floor(seconds);

  // Under 1 minute: show seconds only
  if (totalSeconds < 60) {
    return `${totalSeconds} sec`;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  // 1 hour or more
  if (hours > 0) {
    if (minutes > 0) {
      return `${hours} hr ${minutes} min`;
    }
    return `${hours} hr`;
  }

  // 5 minutes or above: round to whole minutes
  if (totalSeconds >= 300) {
    const roundedMinutes = Math.round(totalSeconds / 60);
    return `${roundedMinutes} min`;
  }

  // Under 5 minutes: show minutes and seconds
  if (secs > 0) {
    return `${minutes} min ${secs} sec`;
  }
  return `${minutes} min`;
}
```

**Step 2: Verify it compiles**

Run: `cd web_frontend_next && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
jj desc -m "feat: add formatDuration utility for human-readable video duration"
```

---

## Task 2: Add ContinueVideoButton Component

Create the compact button shown for subsequent video clips.

**Files:**
- Create: `web_frontend_next/src/components/module/ContinueVideoButton.tsx`

**Step 1: Create the component**

```typescript
// web_frontend_next/src/components/module/ContinueVideoButton.tsx
"use client";

import { formatDuration } from "@/utils/formatDuration";

type ContinueVideoButtonProps = {
  durationSeconds: number;
  onClick: () => void;
};

/**
 * Compact button for subsequent video clips within a section.
 * Styled similar to MarkCompleteButton but blue.
 */
export default function ContinueVideoButton({
  durationSeconds,
  onClick,
}: ContinueVideoButtonProps) {
  return (
    <div className="flex items-center justify-center py-6">
      <button
        onClick={onClick}
        className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors font-medium"
        aria-label={`Continue video, ${formatDuration(durationSeconds)}`}
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
        Continue video ({formatDuration(durationSeconds)})
      </button>
    </div>
  );
}
```

**Step 2: Verify it compiles**

Run: `cd web_frontend_next && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
jj desc -m "feat: add ContinueVideoButton component for subsequent video clips"
```

---

## Task 3: Update VideoEmbed to Support Both Modes

Modify VideoEmbed to render either thumbnail (first clip) or compact button (subsequent clips).

**Files:**
- Modify: `web_frontend_next/src/components/module/VideoEmbed.tsx`

**Step 1: Fix the misleading file path comment at line 1**

Change:
```typescript
// web_frontend_next/src/components/narrative-lesson/VideoEmbed.tsx
```

To:
```typescript
// web_frontend_next/src/components/module/VideoEmbed.tsx
```

**Step 2: Add isFirstInSection prop**

Update the props type:

```typescript
type VideoEmbedProps = {
  videoId: string;
  start: number;
  end: number;
  isFirstInSection?: boolean; // defaults to true for backward compat
  onEnded?: () => void;
  onPlay?: () => void;
  onPause?: () => void;
  onTimeUpdate?: (currentTime: number) => void;
};
```

**Step 3: Update imports and add ref**

Replace imports with:

```typescript
import { useState, useRef, useEffect } from "react";
import VideoPlayer from "@/components/module/VideoPlayer";
import ContinueVideoButton from "@/components/module/ContinueVideoButton";
import { formatDuration } from "@/utils/formatDuration";
```

Add to component body (after useState):

```typescript
const containerRef = useRef<HTMLDivElement>(null);
const isFirst = isFirstInSection ?? true;
```

**Step 4: Remove the old formatTime function**

Delete the `formatTime` function (lines 35-39) - we're replacing it with `formatDuration`.

**Step 5: Add scroll-into-view effect**

After the isFirst declaration:

```typescript
// Scroll into view when video is activated (for continue button clicks)
// VideoPlayer manages its own dimensions, so scroll position is correct immediately
useEffect(() => {
  if (isActivated && !isFirst && containerRef.current) {
    containerRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}, [isActivated, isFirst]);
```

**Step 6: Update render logic**

Replace the return statement with:

```typescript
return (
  <div ref={containerRef} className="w-[80%] max-w-[900px] mx-auto py-4 scroll-mt-20">
    <div className="bg-stone-100 rounded-lg overflow-hidden shadow-sm">
      {isActivated ? (
        <VideoPlayer
          videoId={videoId}
          start={start}
          end={end}
          autoplay
          onEnded={onEnded ?? (() => {})}
          onPlay={onPlay}
          onPause={onPause}
          onTimeUpdate={onTimeUpdate}
        />
      ) : isFirst ? (
        <button
          onClick={() => setIsActivated(true)}
          className="relative w-full aspect-video group cursor-pointer"
          aria-label="Play video"
        >
          {/* Thumbnail */}
          <img
            src={thumbnailUrl}
            alt="Video thumbnail"
            className="w-full h-full object-cover"
          />

          {/* Dark overlay on hover */}
          <div className="absolute inset-0 bg-black/20 group-hover:bg-black/40 transition-colors" />

          {/* Play button */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-16 h-16 bg-red-600 rounded-full flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
              <svg
                className="w-8 h-8 text-white ml-1"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>

          {/* Duration badge */}
          <div className="absolute bottom-3 right-3 bg-black/80 text-white text-sm px-2 py-1 rounded">
            {formatDuration(end - start)}
          </div>
        </button>
      ) : (
        <ContinueVideoButton
          durationSeconds={end - start}
          onClick={() => setIsActivated(true)}
        />
      )}
    </div>
  </div>
);
```

Note: Changed `scroll-mt-6` to `scroll-mt-20` (5rem) to better account for the sticky header.

**Step 7: Verify it compiles**

Run: `cd web_frontend_next && npx tsc --noEmit`
Expected: No errors

**Step 8: Commit**

```bash
jj desc -m "feat: VideoEmbed supports compact continue button for subsequent clips"
```

---

## Task 4: Update Module.tsx to Track Video Excerpt Index

Pass `isFirstInSection` to VideoEmbed based on whether this is the first video-excerpt in the current section.

**Files:**
- Modify: `web_frontend_next/src/views/Module.tsx`

**Step 1: Update the video-excerpt case in renderSegment**

Find the `case "video-excerpt":` block (around line 535) and replace with:

```typescript
case "video-excerpt": {
  if (section.type !== "video") return null;

  // Count how many video-excerpt segments came before this one in this section
  // Note: All video-excerpts in a video section share the same videoId,
  // so "Continue video" makes sense for subsequent clips.
  const videoExcerptsBefore = section.segments
    .slice(0, segmentIndex)
    .filter((s) => s.type === "video-excerpt").length;
  const isFirstVideoExcerpt = videoExcerptsBefore === 0;

  return (
    <VideoEmbed
      key={`video-${keyPrefix}`}
      videoId={section.videoId}
      start={segment.from}
      end={segment.to}
      isFirstInSection={isFirstVideoExcerpt}
      onPlay={videoTracker.onPlay}
      onPause={videoTracker.onPause}
      onTimeUpdate={videoTracker.onTimeUpdate}
    />
  );
}
```

**Step 2: Verify it compiles**

Run: `cd web_frontend_next && npx tsc --noEmit`
Expected: No errors

**Step 3: Run lint**

Run: `cd web_frontend_next && npm run lint`
Expected: No errors (or only pre-existing ones)

**Step 4: Commit**

```bash
jj desc -m "feat: pass isFirstInSection to VideoEmbed for continuation UX"
```

---

## Task 5: Manual Testing

**Files:** None (testing only)

**Step 1: Start the dev server**

Run: `python main.py --dev --no-bot`
In another terminal: `cd web_frontend_next && npm run dev`

**Step 2: Navigate to a module with multiple video clips**

Find or create a test module that has a video section with multiple video-excerpt segments.

**Step 3: Verify behavior**

- [ ] First video clip shows full thumbnail with red play button
- [ ] First video thumbnail shows duration in new format (e.g., "2 min 15 sec")
- [ ] Subsequent video clips show blue "Continue video (X min Y sec)" button
- [ ] Durations 5+ min show rounded format (e.g., "7 min" not "7 min 23 sec")
- [ ] Clicking continue button expands to full player
- [ ] Video auto-plays on click
- [ ] Page scrolls to position video nicely in viewport
- [ ] Continue button has visible focus ring when tabbed to

**Step 4: Final commit**

```bash
jj desc -m "feat: video continuation UX - show compact button for subsequent clips

- First video clip in a section shows full thumbnail (unchanged)
- Subsequent clips show 'Continue video (duration)' button
- Clicking expands to full player, auto-plays, and scrolls into view
- Duration shown in human-readable format (e.g., '2 min 15 sec')
- Durations 5+ minutes rounded to whole minutes (e.g., '7 min')"
```

---

## TDD Note

The `formatDuration` utility is a good candidate for TDD (pure function, clear edge cases). However, the frontend currently has no test framework. To add TDD:

1. Install vitest: `npm install -D vitest`
2. Add test script to package.json: `"test": "vitest"`
3. Create `web_frontend_next/src/utils/formatDuration.test.ts`

Test cases to cover:
- 0 seconds → "0 sec"
- -5 seconds → "0 sec" (guarded)
- NaN → "0 sec" (guarded)
- 45 seconds → "45 sec"
- 60 seconds → "1 min"
- 135 seconds → "2 min 15 sec"
- 299 seconds → "4 min 59 sec"
- 300 seconds → "5 min" (threshold for rounding)
- 423 seconds → "7 min" (rounded from 7:03)
- 3600 seconds → "1 hr"
- 3665 seconds → "1 hr 1 min"

If you want TDD, do Task 0 (set up vitest) before Task 1.
