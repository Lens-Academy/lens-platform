# Code Review: `web_frontend/` Directory

**Date:** 2026-01-09
**Reviewer:** Claude Code (superpowers:code-reviewer)

## Summary

Overall, the codebase demonstrates solid React patterns with TypeScript and follows reasonable conventions. However, there are several areas for improvement across code organization, potential bugs, and refactoring opportunities.

---

## Critical Issues

### Issue 1: Unused State Variable in SignupWizard.tsx

**File:** `web_frontend/src/components/signup/SignupWizard.tsx`
**Line:** 29

**Issue:** The state variable `_isSubmitting` is declared but the underscore prefix suggests it was intentionally marked as unused, yet the state setter `setIsSubmitting` IS used. This creates dead code.

```typescript
const [_isSubmitting, setIsSubmitting] = useState(false);
```

**Suggested Fix:** Either use `isSubmitting` in the UI (e.g., to disable buttons during submission) or remove the state entirely if not needed:

```typescript
const [isSubmitting, setIsSubmitting] = useState(false);
// Then use it in the submit button: disabled={isSubmitting}
```

---

## Important Issues

### Issue 2: Missing React Fragment Key in ScheduleSelector.tsx

**File:** `web_frontend/src/components/schedule/ScheduleSelector.tsx`
**Lines:** 136-164

**Issue:** The map callback renders multiple elements wrapped in a React Fragment (`<>...</>`) but the fragment lacks a `key` prop. This generates React warnings and can cause rendering bugs.

```typescript
{slots.map((slot) => (
  <>
    {/* ... */}
  </>
))}
```

**Suggested Fix:**
```typescript
{slots.map((slot) => (
  <React.Fragment key={slot}>
    {/* ... */}
  </React.Fragment>
))}
```

---

### Issue 3: Variable Shadowing in UnifiedLesson.tsx

**File:** `web_frontend/src/pages/UnifiedLesson.tsx`
**Lines:** 230-233

**Issue:** The variable `currentStageIndex` is redeclared inside `handleGoForward`, shadowing the outer scope variable of the same name (line 204).

```typescript
const handleGoForward = useCallback(() => {
  // ...
  const currentStageIndex = session?.current_stage_index ?? 0;  // Shadows line 204
```

**Suggested Fix:**
```typescript
const handleGoForward = useCallback(() => {
  const reviewable = getReviewableStages();
  const currentViewing = viewingStageIndex ?? session?.current_stage_index ?? 0;
  const sessionCurrentStageIndex = session?.current_stage_index ?? 0;

  const later = reviewable.filter(s => s.index > currentViewing && s.index < sessionCurrentStageIndex);
  // ...
}, [getReviewableStages, viewingStageIndex, session?.current_stage_index]);
```

---

### Issue 4: Duplicate Discord SVG Icon

**Files:**
- `web_frontend/src/pages/Auth.tsx` (lines 104-106)
- `web_frontend/src/components/signup/PersonalInfoStep.tsx` (lines 44-46)
- `web_frontend/src/components/signup/SuccessMessage.tsx` (lines 37-38)
- `web_frontend/src/components/unified-lesson/AuthPromptModal.tsx` (lines 25-26)

**Issue:** The Discord SVG icon is duplicated across multiple files. This violates DRY principles and makes maintenance difficult.

**Suggested Fix:** Create a shared icon component:

```typescript
// src/components/icons/DiscordIcon.tsx
type DiscordIconProps = {
  className?: string;
};

export function DiscordIcon({ className = "w-5 h-5" }: DiscordIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791..." />
    </svg>
  );
}
```

---

### Issue 5: Duplicate API_URL Definition

**Files:**
- `web_frontend/src/hooks/useAuth.ts` (line 5)
- `web_frontend/src/pages/Auth.tsx` (line 4)
- `web_frontend/src/pages/Availability.tsx` (line 12)
- `web_frontend/src/components/signup/SignupWizard.tsx` (line 12)

**Issue:** `const API_URL = import.meta.env.VITE_API_URL ?? "";` is duplicated in multiple files.

**Suggested Fix:** Centralize in a config file:

```typescript
// src/config.ts
export const API_URL = import.meta.env.VITE_API_URL ?? "";
```

---

### Issue 6: Duplicate DISCORD_INVITE_URL Definition

**Files:**
- `web_frontend/src/components/Layout.tsx` (lines 3-4)
- `web_frontend/src/components/signup/SuccessMessage.tsx` (lines 1-2)

**Issue:** The Discord invite URL constant is duplicated.

**Suggested Fix:** Centralize in config file:
```typescript
// src/config.ts
export const DISCORD_INVITE_URL = import.meta.env.VITE_DISCORD_INVITE_URL || "https://discord.gg/YOUR_INVITE";
```

---

### Issue 7: Unused Variables in ContentPanel.tsx

**File:** `web_frontend/src/components/unified-lesson/ContentPanel.tsx`
**Lines:** 136-144

**Issue:** Multiple variables are declared but never used:
- `videoId`
- `videoStart`
- `videoEnd`
- `videoBlurred`
- `showOptionalBanner`
- `optionalBannerStageType`

```typescript
const videoId = isVideoStage ? stage.videoId : previousStage?.videoId;
const videoStart = isVideoStage ? stage.from : (previousStage?.from ?? 0);
const videoEnd = isVideoStage ? (stage.to || 9999) : (previousStage?.to ?? 9999);
const videoBlurred = isChatAfterVideo && !showUserPreviousContent;
const isOptional = stage && 'optional' in stage && stage.optional === true;
const showOptionalBanner = isOptional && isCurrentStage && onSkipOptional && (isArticleStage || isVideoStage);
const optionalBannerStageType = isArticleStage ? "article" : "video";
```

**Suggested Fix:** Remove unused variables or implement the intended functionality. Also note that `isOptional` is redeclared multiple times in the same function (lines 142, 156, 280).

---

### Issue 8: Missing Error Handling in Auth.tsx API Call

**File:** `web_frontend/src/pages/Auth.tsx`
**Lines:** 31-36

**Issue:** The fetch call assumes the response will always be valid JSON. If the server returns an error page (non-JSON), this will throw.

```typescript
fetch(`${API_URL}/auth/code?...`)
  .then((res) => res.json())  // Throws if response is not JSON
```

**Suggested Fix:**
```typescript
.then((res) => {
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
})
```

---

### Issue 9: Inconsistent Import Paths for react-router

**Files:**
- `web_frontend/src/App.tsx` (line 2): `from "react-router"`
- `web_frontend/src/pages/Home.tsx` (line 1): `from "react-router-dom"`
- `web_frontend/src/pages/UnifiedLesson.tsx` (line 3): `from "react-router-dom"`

**Issue:** Mixing `react-router` and `react-router-dom` imports. While they may work due to re-exports, it creates inconsistency.

**Suggested Fix:** Standardize on `react-router-dom` throughout:
```typescript
import { Routes, Route, Link } from "react-router-dom";
```

---

### Issue 10: Dead Code: Unused Type Export

**File:** `web_frontend/src/types/lesson.ts`

**Issue:** The entire `lesson.ts` file defines types (`ConversationItem`, `VideoItem`, `LessonItem`, `ChatMessage`, `LessonState`) that are only used in `sampleLesson.ts`. This appears to be legacy code from an older implementation since `unified-lesson.ts` is the current type system.

**Suggested Fix:** Verify if `lesson.ts` and `sampleLesson.ts` are still needed. If not, remove them.

---

### Issue 11: Dead Code: Unused sampleArticle.ts

**File:** `web_frontend/src/data/sampleArticle.ts`

**Issue:** This file exports `sampleArticle` but grepping the codebase shows it is not imported anywhere.

**Suggested Fix:** Remove if no longer needed.

---

## Minor Issues / Suggestions

### Issue 12: Unused onMouseUp Handler

**File:** `web_frontend/src/components/schedule/useScheduleSelection.ts`
**Line:** 272

**Issue:** The `handlers` object includes `onMouseUp` but this is never used by the consuming component (`ScheduleSelector.tsx`). The global mouseup listener handles this case.

```typescript
handlers: {
  onMouseDown: handleMouseDown,
  onMouseEnter: handleMouseEnter,
  onMouseLeave: handleMouseLeave,
  onMouseUp: handleMouseUp,  // Never used
  onTouchStart: handleTouchStart,
},
```

**Suggested Fix:** Remove if not needed, or document why it is exported.

---

### Issue 13: Inline CSS Animation in ChatPanel.tsx

**File:** `web_frontend/src/components/unified-lesson/ChatPanel.tsx`
**Lines:** 543-548

**Issue:** CSS keyframes animation is defined inline via a `<style>` tag. This could be moved to the global CSS file for better organization.

```typescript
<style>{`
  @keyframes mic-pulse {
    0%, 100% { stroke: #4b5563; }
    50% { stroke: #000000; }
  }
`}</style>
```

**Suggested Fix:** Move to `index.css`:
```css
@keyframes mic-pulse {
  0%, 100% { stroke: #4b5563; }
  50% { stroke: #000000; }
}
```

---

### Issue 14: Inline CSS Animation in VideoPlayer.tsx

**File:** `web_frontend/src/components/unified-lesson/VideoPlayer.tsx`
**Lines:** 258-262

**Issue:** Same pattern as above - inline CSS keyframes.

**Suggested Fix:** Move to `index.css`.

---

### Issue 15: Missing Accessibility: Avatar Image Alt Text

**File:** `web_frontend/src/components/unified-lesson/HeaderAuthStatus.tsx`
**Line:** 40-43

**Issue:** When `discordAvatarUrl` is null, the img src is `undefined` which is invalid. Should provide a fallback or conditionally render.

```typescript
<img
  src={discordAvatarUrl || undefined}  // undefined is not valid
  alt={discordUsername || "User avatar"}
  className="w-6 h-6 rounded-full"
/>
```

**Suggested Fix:**
```typescript
{discordAvatarUrl ? (
  <img
    src={discordAvatarUrl}
    alt={`${discordUsername}'s avatar`}
    className="w-6 h-6 rounded-full"
  />
) : (
  <div className="w-6 h-6 rounded-full bg-gray-300" />
)}
```

---

### Issue 16: StepIndicator Component Never Used

**File:** `web_frontend/src/components/signup/StepIndicator.tsx`

**Issue:** This component is defined but never imported or used anywhere in the codebase.

**Suggested Fix:** Either integrate it into the signup wizard or remove if not needed.

---

### Issue 17: Complex useEffect Dependencies in UnifiedLesson.tsx

**File:** `web_frontend/src/pages/UnifiedLesson.tsx`
**Lines:** 39-94

**Issue:** The session initialization useEffect has many dependencies which could lead to subtle re-initialization bugs. Consider using a more explicit initialization pattern.

---

### Issue 18: Potential Memory Leak in ChatPanel.tsx Recording Cleanup

**File:** `web_frontend/src/components/unified-lesson/ChatPanel.tsx`

**Issue:** While cleanup is attempted on unmount, if a user navigates away mid-recording, the MediaRecorder might still be active since `stopRecording` is async and cleanup may not complete before component unmounts.

**Suggested Fix:** Consider adding an abort mechanism or ensuring recording cleanup happens synchronously on unmount.

---

### Issue 19: Hardcoded Tailwind Classes Could Be Extracted

**General:** Throughout the codebase, there are repeated Tailwind class patterns like:
- `"bg-blue-500 hover:bg-blue-600 text-white"`
- `"disabled:cursor-default"`
- Button styling patterns

**Suggested Fix:** Consider extracting common patterns into CSS classes using `@apply` or component abstractions.

---

### Issue 20: Lesson Type Import Not Used

**File:** `web_frontend/src/api/lessons.ts`
**Line:** 5

**Issue:** `Lesson` is imported but never used in the file.

```typescript
import type { Lesson, SessionState } from "../types/unified-lesson";
```

**Suggested Fix:** Remove unused import:
```typescript
import type { SessionState } from "../types/unified-lesson";
```

---

## Summary Table

| Severity | Count | Description |
|----------|-------|-------------|
| Critical | 1 | Unused isSubmitting state (dead code pattern) |
| Important | 10 | Missing keys, shadowing, duplications, unused code |
| Minor | 9 | Style issues, potential improvements |

---

## Recommendations

1. **Immediate:** Address the missing React Fragment key in ScheduleSelector.tsx as it generates runtime warnings.

2. **Short-term:** Create shared configuration and icon components to reduce duplication.

3. **Medium-term:** Audit and remove dead code (lesson.ts, sampleArticle.ts, StepIndicator.tsx).

4. **Best Practice:** Standardize imports (react-router-dom everywhere) and consider extracting inline CSS animations to the global stylesheet.
