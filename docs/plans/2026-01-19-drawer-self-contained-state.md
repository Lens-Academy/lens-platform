# Self-Contained Drawer State Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move drawer open/close state into the drawer component itself, so toggling the drawer doesn't re-render the parent Module component.

**Architecture:** Combine `ModuleDrawer` and `ModuleDrawerToggle` into a single self-contained component that manages its own `isOpen` state. The parent (Module.tsx) no longer knows or cares whether the drawer is open - it just renders the component and passes content props.

**Tech Stack:** React, TypeScript

---

## Task 1: Refactor ModuleDrawer to manage its own state

**Files:**
- Modify: `web_frontend_next/src/components/module/ModuleDrawer.tsx`

**Step 1: Update ModuleDrawer to own its state and render its own toggle**

Replace the entire file with:

```tsx
/**
 * Self-contained slide-out drawer with its own toggle.
 * Manages open/close state internally to avoid re-rendering parent.
 */

import { useState, useEffect, useCallback } from "react";
import { PanelLeftOpen, PanelLeftClose } from "lucide-react";
import type { StageInfo } from "../../types/course";
import ModuleOverview from "../course/ModuleOverview";

type ModuleDrawerProps = {
  moduleTitle: string;
  stages: StageInfo[];
  currentStageIndex: number;
  viewedStageIndex?: number;
  onStageClick: (index: number) => void;
};

export default function ModuleDrawer({
  moduleTitle,
  stages,
  currentStageIndex,
  viewedStageIndex,
  onStageClick,
}: ModuleDrawerProps) {
  // State is owned here - not in parent
  const [isOpen, setIsOpen] = useState(false);

  const handleOpen = useCallback(() => setIsOpen(true), []);
  const handleClose = useCallback(() => setIsOpen(false), []);

  // Close on escape
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, handleClose]);

  return (
    <>
      {/* Floating toggle - always mounted, hidden via CSS when drawer is open */}
      <button
        onMouseDown={handleOpen}
        className={`fixed left-0 top-16 z-40 bg-white border border-l-0 border-gray-200 rounded-r-lg shadow-md px-1.5 py-3 hover:bg-gray-50 transition-colors ${
          isOpen ? "opacity-0 pointer-events-none" : ""
        }`}
        title="Module Overview"
      >
        <PanelLeftOpen className="w-5 h-5 text-slate-600" />
      </button>

      {/* Invisible click area to close drawer */}
      {isOpen && (
        <div className="fixed inset-0 z-40" onMouseDown={handleClose} />
      )}

      {/* Drawer panel - slides in from left */}
      <div
        className={`fixed top-0 left-0 h-full w-[40%] max-w-md bg-white z-50 transition-transform duration-200 ${
          isOpen
            ? "translate-x-0 shadow-[8px_0_30px_-5px_rgba(0,0,0,0.2)]"
            : "-translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h3 className="text-lg font-medium text-slate-900">Module Overview</h3>
          <button
            onMouseDown={handleClose}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            title="Close sidebar"
          >
            <PanelLeftClose className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 h-[calc(100%-4rem)] overflow-y-auto">
          <ModuleOverview
            moduleTitle={moduleTitle}
            stages={stages}
            status="in_progress"
            currentStageIndex={currentStageIndex}
            viewedStageIndex={viewedStageIndex}
            onStageClick={onStageClick}
            showActions={false}
          />
        </div>
      </div>
    </>
  );
}
```

**Step 2: Verify TypeScript compiles (will fail - Module.tsx still uses old API)**

Run: `cd web_frontend_next && npx tsc --noEmit 2>&1 | head -20`
Expected: Errors about `ModuleDrawerToggle` not existing and `isOpen`/`onClose` props

---

## Task 2: Update Module.tsx to use simplified drawer API

**Files:**
- Modify: `web_frontend_next/src/views/Module.tsx`

**Step 1: Remove drawer state and toggle import**

Find and remove this line (~line 102):
```tsx
const [drawerOpen, setDrawerOpen] = useState(false);
```

Find and update the import (~line 38):
```tsx
// Change from:
import ModuleDrawer, { ModuleDrawerToggle } from "@/components/module/ModuleDrawer";
// To:
import ModuleDrawer from "@/components/module/ModuleDrawer";
```

**Step 2: Remove the separate toggle render**

Find and remove these lines (~lines 655-659):
```tsx
{/* Floating drawer toggle - always mounted, hidden via CSS when open */}
<ModuleDrawerToggle
  onOpen={() => setDrawerOpen(true)}
  isOpen={drawerOpen}
/>
```

**Step 3: Simplify the ModuleDrawer render**

Find (~lines 661-669):
```tsx
<ModuleDrawer
  isOpen={drawerOpen}
  onClose={() => setDrawerOpen(false)}
  moduleTitle={module.title}
  stages={stagesForDrawer}
  currentStageIndex={furthestCompletedIndex + 1}
  viewedStageIndex={viewingStageIndex ?? currentSectionIndex}
  onStageClick={handleStageClick}
/>
```

Replace with:
```tsx
<ModuleDrawer
  moduleTitle={module.title}
  stages={stagesForDrawer}
  currentStageIndex={furthestCompletedIndex + 1}
  viewedStageIndex={viewingStageIndex ?? currentSectionIndex}
  onStageClick={handleStageClick}
/>
```

**Step 4: Verify TypeScript compiles**

Run: `cd web_frontend_next && npx tsc --noEmit`
Expected: No errors

---

## Task 3: Test the change

**Step 1: Manual test**

1. Open a module in the browser
2. Click the drawer toggle
3. Verify the drawer opens **instantly** (no 300ms delay)
4. Click outside or the close button
5. Verify the drawer closes instantly

**Step 2: Verify no regressions**

1. Verify stage click navigation still works from drawer
2. Verify escape key still closes drawer
3. Verify the toggle hides when drawer is open

---

## Summary

| Before | After |
|--------|-------|
| `drawerOpen` state in Module.tsx | `isOpen` state in ModuleDrawer |
| Toggle and drawer as separate components | Combined into one self-contained component |
| Opening drawer re-renders all of Module.tsx | Opening drawer only re-renders ModuleDrawer |

**Files changed:**
- `web_frontend_next/src/components/module/ModuleDrawer.tsx` - owns state, renders toggle
- `web_frontend_next/src/views/Module.tsx` - removes state, simplified usage
