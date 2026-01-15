# Lesson Complete Modal Active Group Check Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `isInActiveGroup` check alongside `isInSignupsTable` in the lesson completion modal so users who have been assigned to a group (and removed from signups table) don't get prompted to sign up.

**Architecture:** The modal currently only checks `isInSignupsTable` to decide whether to show signup prompts. Since users are removed from the signups table when assigned to a group, we need to check both conditions: user should see signup prompt only if they're NOT in signups AND NOT in an active group.

**Tech Stack:** React, TypeScript

---

### Task 1: Add isInActiveGroup prop to LessonCompleteModal

**Files:**
- Modify: `web_frontend/src/components/unified-lesson/LessonCompleteModal.tsx:12-14`

**Step 1: Add the prop to the interface**

In `LessonCompleteModal.tsx`, add the new prop to the Props interface after `isInSignupsTable`:

```typescript
interface Props {
  isOpen: boolean;
  lessonTitle?: string;
  courseId?: string; // Present when in /course/:courseId/lesson/:lessonId context
  isInSignupsTable?: boolean; // User has signed up for a cohort
  isInActiveGroup?: boolean; // User is in an active cohort group
  nextLesson?: NextLesson | null; // Next lesson in course, null if last lesson
  completedUnit?: number | null; // Unit number if just completed a unit
  onClose?: () => void; // Called when user clicks outside modal
}
```

**Step 2: Add the prop to function parameters**

Update the function destructuring (around line 30) to include the new prop with default value:

```typescript
export default function LessonCompleteModal({
  isOpen,
  lessonTitle,
  courseId,
  isInSignupsTable = false,
  isInActiveGroup = false,
  nextLesson,
  completedUnit,
  onClose,
}: Props) {
```

**Step 3: Verify TypeScript compiles**

Run: `cd web_frontend && npx tsc --noEmit`
Expected: No errors (prop is optional with default)

**Step 4: Commit**

```bash
jj describe -m "feat(modal): add isInActiveGroup prop to LessonCompleteModal"
```

---

### Task 2: Update modal logic to check both conditions

**Files:**
- Modify: `web_frontend/src/components/unified-lesson/LessonCompleteModal.tsx:41-50,61-81`

**Step 1: Create helper variable for "user is enrolled"**

After line 39 (`const hasCompletedUnit = completedUnit != null;`), add:

```typescript
const isEnrolled = isInSignupsTable || isInActiveGroup;
```

**Step 2: Update the comment documentation**

Replace the comment block (lines 41-50) with:

```typescript
  // Determine CTAs based on context
  // Standalone lesson (/lesson/:id):
  //   - Not enrolled: "Join Full Course" → /signup, "View Course" → /course
  //   - Enrolled: "View Course" → /course
  // Course lesson (/course/:id/lesson/:lid):
  //   - Unit complete + not enrolled: "Join Full Course" → /signup, "Return to Course" → /course/:id
  //   - Unit complete + enrolled: "Return to Course" → /course/:id (no secondary CTA)
  //   - Not enrolled: "Join Full Course" → /signup, "Return to Course" → /course/:id
  //   - Enrolled + has next: "Next Lesson" → next lesson URL, "Return to Course" → /course/:id
  //   - Enrolled + no next: "Return to Course" → /course/:id
```

**Step 3: Update standalone lesson logic**

Replace the standalone lesson condition (around line 61):

```typescript
    if (!isEnrolled) {
      primaryCta = { label: "Join the Full Course", to: "/signup" };
      secondaryCta = { label: "View Course", to: "/course" };
    } else {
      primaryCta = { label: "View Course", to: "/course" };
    }
```

**Step 4: Update course lesson logic**

Replace the course lesson conditions (around lines 71-81):

```typescript
    if (hasCompletedUnit && !isEnrolled) {
      // Unit completion + not enrolled - prompt to join
      completionMessage = `This was the last lesson of Unit ${completedUnit}.`;
      primaryCta = { label: "Join the Full Course", to: "/signup" };
      secondaryCta = { label: "Return to Course", to: courseUrl };
    } else if (hasCompletedUnit) {
      // Unit completion + enrolled - just show return
      completionMessage = `This was the last lesson of Unit ${completedUnit}.`;
      primaryCta = { label: "Return to Course", to: courseUrl };
      // No secondary CTA - don't prompt them to go to next unit yet
    } else if (!isEnrolled) {
```

**Step 5: Verify TypeScript compiles**

Run: `cd web_frontend && npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
jj describe -m "feat(modal): use isEnrolled to check both signups and active group"
```

---

### Task 3: Pass isInActiveGroup from UnifiedLesson to modal

**Files:**
- Modify: `web_frontend/src/pages/UnifiedLesson.tsx:73,854`

**Step 1: Destructure isInActiveGroup from useAuth**

Update line 73 to also get `isInActiveGroup`:

```typescript
const { isAuthenticated, isInSignupsTable, isInActiveGroup, login } = useAuth();
```

**Step 2: Pass the prop to LessonCompleteModal**

Update the modal component (around line 854) to include the new prop:

```tsx
<LessonCompleteModal
  isOpen={(session.completed || !session.current_stage) && !completionModalDismissed}
  lessonTitle={session.lesson_title}
  courseId={courseId}
  isInSignupsTable={isInSignupsTable}
  isInActiveGroup={isInActiveGroup}
  nextLesson={nextLesson}
  completedUnit={completedUnit}
  onClose={() => setCompletionModalDismissed(true)}
/>
```

**Step 3: Verify TypeScript compiles**

Run: `cd web_frontend && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
jj describe -m "feat(lesson): pass isInActiveGroup to completion modal"
```

---

### Task 4: Manual verification

**Step 1: Start dev server**

Run: `cd /home/penguin/code-in-WSL/ai-safety-course-platform && python main.py --dev --no-bot`

**Step 2: Test scenarios**

Test each scenario in browser:

1. **Anonymous user completes unit** → Should see "Join the Full Course"
2. **Logged-in user NOT in signups, NOT in group, completes unit** → Should see "Join the Full Course"
3. **Logged-in user IN signups, completes unit** → Should see "Return to Course" only
4. **Logged-in user IN active group, completes unit** → Should see "Return to Course" only

**Step 3: Final commit**

```bash
jj new
jj describe -m "test: verify lesson complete modal enrollment check"
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `LessonCompleteModal.tsx` | Add `isInActiveGroup` prop, create `isEnrolled` helper, update all conditions |
| `UnifiedLesson.tsx` | Destructure and pass `isInActiveGroup` to modal |

**Total changes:** 2 files, ~15 lines modified
