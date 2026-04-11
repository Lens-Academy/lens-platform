# Breadcrumb Navigation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a breadcrumb to the module header that shows the user's position within the course unit hierarchy, with a hover dropdown showing all sibling modules/submodules and their sections.

**Architecture:** New `BreadcrumbNav` component replaces the module title in `ModuleHeader`. It shows "Unit Name › Module Name" and opens a grouped dropdown on hover/tap. Data is derived from existing `courseProgress` state in `Module.tsx` — no new API calls. A shared `getUnitLabel()` utility is extracted from `CourseTimeline.tsx`.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, lucide-react icons

**Spec:** `docs/superpowers/specs/2026-03-18-breadcrumb-navigation-design.md`

---

## Chunk 1: Shared utility + data plumbing

### Task 1: Extract `getUnitLabel` utility

**Files:**
- Create: `src/utils/unitLabel.ts`
- Modify: `src/components/course/CourseTimeline.tsx:276-280`

- [ ] **Step 1: Create `src/utils/unitLabel.ts`**

```typescript
import type { UnitInfo } from "@/types/course";

export function getUnitLabel(unit: UnitInfo, unitIndex: number): string {
  if (unit.meetingName) return `${unit.meetingNumber}. ${unit.meetingName}`;
  if (unit.meetingNumber !== null) return `Week ${unit.meetingNumber}`;
  return `Week ${unitIndex + 1}`;
}
```

- [ ] **Step 2: Update `CourseTimeline.tsx` to use the shared utility**

Replace lines 276–280 in `src/components/course/CourseTimeline.tsx`:

```typescript
// Before:
const weekLabel = unit.meetingName
  ? `${unit.meetingNumber}. ${unit.meetingName}`
  : unit.meetingNumber !== null
    ? `Week ${unit.meetingNumber}`
    : `Week ${unitIdx + 1}`;

// After:
import { getUnitLabel } from "@/utils/unitLabel";
// ... (import at top of file)
const weekLabel = getUnitLabel(unit, unitIdx);
```

- [ ] **Step 3: Verify no regressions**

Run: `cd /home/penguin/code/lens-platform/ws1/web_frontend && npm run lint && npm run build`
Expected: Clean build, no errors.

- [ ] **Step 4: Commit**

```
feat: extract getUnitLabel utility from CourseTimeline
```

---

### Task 2: Add `unitContext` memo and pass props through `ModuleHeader`

**Files:**
- Modify: `src/views/Module.tsx:643-674` (near `submoduleContext` memo)
- Modify: `src/views/Module.tsx:1752-1766` (ModuleHeader usage)
- Modify: `src/components/ModuleHeader.tsx:16-28` (props interface)
- Modify: `src/components/ModuleHeader.tsx:237-243` (title rendering)

- [ ] **Step 1: Add `unitContext` memo in `Module.tsx`**

Add after the existing `submoduleContext` memo (around line 674):

```typescript
import { getUnitLabel } from "@/utils/unitLabel";

// Compute unit context for breadcrumb navigation
const unitContext = useMemo((): {
  unitName: string;
  unitModules: ModuleInfo[];
} | null => {
  if (!courseProgress || !module) return null;
  for (let i = 0; i < courseProgress.units.length; i++) {
    const unit = courseProgress.units[i];
    if (unit.modules.some((m) => m.slug === module.slug)) {
      return {
        unitName: getUnitLabel(unit, i),
        unitModules: unit.modules,
      };
    }
  }
  return null;
}, [courseProgress, module]);
```

Also add `ModuleInfo` to the imports from `@/types/course` if not already imported.

- [ ] **Step 2: Pass new props to `ModuleHeader`**

Update the `<ModuleHeader>` usage (~line 1752) to include the new props:

```tsx
<ModuleHeader
  moduleTitle={module.title}
  stages={stages}
  completedStages={completedSections}
  currentSectionIndex={currentSectionIndex}
  canGoPrevious={!testModeActive && currentSectionIndex > 0}
  canGoNext={
    !testModeActive && currentSectionIndex < module.sections.length - 1
  }
  onStageClick={handleStageClick}
  onPrevious={handlePrevious}
  onNext={handleNext}
  onMenuToggle={() => drawerRef.current?.toggle()}
  testModeActive={testModeActive}
  // Breadcrumb context
  unitName={unitContext?.unitName}
  unitModules={unitContext?.unitModules}
  currentModuleSlug={module.slug}
  currentModuleSections={stagesForDrawer}
  courseId={courseId}
/>
```

- [ ] **Step 3: Extend `ModuleHeaderProps` interface and fix ref type**

In `src/components/ModuleHeader.tsx`:

1. Change `titleRef` type to accept both `<h1>` and `<div>` (line 54):

```typescript
// Before:
const titleRef = useRef<HTMLHeadingElement>(null);
// After:
const titleRef = useRef<HTMLElement>(null);
```

2. Add the new optional props to the interface:

```typescript
import type { ModuleInfo, StageInfo } from "../types/course";

interface ModuleHeaderProps {
  moduleTitle: string;
  stages: Stage[];
  completedStages: Set<number>;
  currentSectionIndex: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onStageClick: (index: number) => void;
  onPrevious: () => void;
  onNext: () => void;
  onMenuToggle: () => void;
  testModeActive?: boolean;
  // Breadcrumb context (optional — falls back to plain title when absent)
  unitName?: string;
  unitModules?: ModuleInfo[];
  currentModuleSlug?: string;
  currentModuleSections?: StageInfo[];
  courseId?: string;
}
```

Update the destructuring to include these new props.

- [ ] **Step 4: Conditionally render breadcrumb or plain title**

Replace the `<h1>` block (lines 237–243) with:

```tsx
{unitName ? (
  <BreadcrumbNav
    ref={titleRef}
    unitName={unitName}
    currentModuleSlug={currentModuleSlug!}
    currentSectionIndex={currentSectionIndex}
    completedSections={completedStages}
    unitModules={unitModules!}
    currentModuleSections={currentModuleSections!}
    courseId={courseId!}
    onSectionClick={onStageClick}
    priority={priority}
  />
) : (
  <h1
    ref={titleRef}
    className="text-base font-semibold text-gray-900 truncate max-w-[200px] font-display"
    style={priority >= 4 ? hiddenStyle : undefined}
  >
    {moduleTitle}
  </h1>
)}
```

Note: `BreadcrumbNav` needs to accept a `ref` for the `titleRef` used in layout measurement, and a `priority` prop so it can hide the unit name portion at priority >= 3 and hide entirely at priority >= 4.

For now, create a placeholder `BreadcrumbNav` so the build passes:

```tsx
// Temporary placeholder — will be implemented in Task 3
import { forwardRef } from "react";

const BreadcrumbNav = forwardRef<HTMLElement, any>(function BreadcrumbNav(props, ref) {
  return (
    <div ref={ref} className="text-base font-semibold text-gray-900 truncate max-w-[200px] font-display">
      {props.unitName}
    </div>
  );
});
```

Put this in `src/components/module/BreadcrumbNav.tsx`.

- [ ] **Step 5: Verify build**

Run: `cd /home/penguin/code/lens-platform/ws1/web_frontend && npm run lint && npm run build`
Expected: Clean build. The header now shows the unit name instead of the module title when course context is available.

- [ ] **Step 6: Commit**

```
feat: add unit context plumbing from Module.tsx through ModuleHeader
```

---

## Chunk 2: BreadcrumbNav component — breadcrumb text

### Task 3: Implement breadcrumb text display

**Files:**
- Modify: `src/components/module/BreadcrumbNav.tsx` (replace placeholder)

The breadcrumb shows:
- Single module in unit: just `unitName`
- Multiple modules or submodules: `unitName › moduleName`

The unit name hides at priority >= 3 (leaving just module name). Entire breadcrumb hides at priority >= 4.

- [ ] **Step 1: Implement BreadcrumbNav with breadcrumb text**

Replace the placeholder in `src/components/module/BreadcrumbNav.tsx`:

```tsx
import { useState, useRef, forwardRef, useCallback } from "react";
import type { ModuleInfo, StageInfo } from "@/types/course";

// CSS styles for hiding elements while keeping them measurable
const hiddenStyle: React.CSSProperties = {
  visibility: "hidden",
  position: "absolute",
  pointerEvents: "none",
};

interface BreadcrumbNavProps {
  unitName: string;
  currentModuleSlug: string;
  currentSectionIndex: number;
  completedSections: Set<number>;
  unitModules: ModuleInfo[];
  currentModuleSections: StageInfo[];
  courseId: string;
  onSectionClick: (index: number) => void;
  priority: number; // from ModuleHeader's responsive system
}

const BreadcrumbNav = forwardRef<HTMLElement, BreadcrumbNavProps>(
  function BreadcrumbNav(
    {
      unitName,
      currentModuleSlug,
      currentSectionIndex,
      completedSections,
      unitModules,
      currentModuleSections,
      courseId,
      onSectionClick,
      priority,
    },
    ref,
  ) {
    const hasMultipleModules = unitModules.length > 1;
    const currentModule = unitModules.find((m) => m.slug === currentModuleSlug);
    const moduleName = currentModule?.title ?? currentModuleSlug;

    return (
      <div
        ref={ref}
        className="flex items-baseline gap-0 min-w-0 font-display"
        style={priority >= 4 ? hiddenStyle : undefined}
      >
        {/* Unit name + separator wrapped together — hides as a unit at priority >= 3 */}
        {hasMultipleModules ? (
          <>
            <span
              className="flex items-baseline gap-0"
              style={priority >= 3 ? hiddenStyle : undefined}
            >
              <span className="text-sm text-[#9a5c10] whitespace-nowrap truncate max-w-[140px]">
                {unitName}
              </span>
              <span className="text-sm text-gray-300 mx-1.5 flex-shrink-0">
                ›
              </span>
            </span>
            <span className="text-base font-semibold text-gray-900 whitespace-nowrap truncate max-w-[200px]">
              {moduleName}
            </span>
          </>
        ) : (
          <span className="text-base font-semibold text-gray-900 whitespace-nowrap truncate max-w-[200px]">
            {unitName}
          </span>
        )}
      </div>
    );
  },
);

export default BreadcrumbNav;
```

- [ ] **Step 2: Update `ModuleHeader.tsx` import**

Replace the temporary import with:

```typescript
import BreadcrumbNav from "./module/BreadcrumbNav";
```

Remove the inline placeholder if it was defined in ModuleHeader.

- [ ] **Step 3: Verify build and visually check**

Run: `cd /home/penguin/code/lens-platform/ws1/web_frontend && npm run lint && npm run build`

Then visually verify in Chrome DevTools:
- Navigate to `http://dev.vps:3100/course/default/module/existing-approaches/automating-alignment`
- Header should show "Unit Name › Automating Alignment" instead of just "Automating Alignment"
- Resize browser to check responsive behavior (unit name hides at narrow widths)

- [ ] **Step 4: Commit**

```
feat: implement breadcrumb text display in BreadcrumbNav
```

---

## Chunk 3: Dropdown panel

### Task 4: Implement the dropdown panel with module list

**Files:**
- Modify: `src/components/module/BreadcrumbNav.tsx`

This is the main visual feature. The dropdown shows all modules in the unit grouped by parent, with the current module expanded to show its sections.

- [ ] **Step 1: Add hover/tap state management**

Add to `BreadcrumbNav` inside the component function:

```tsx
const [isOpen, setIsOpen] = useState(false);
const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

const handleMouseEnter = useCallback(() => {
  if (leaveTimer.current) {
    clearTimeout(leaveTimer.current);
    leaveTimer.current = null;
  }
  enterTimer.current = setTimeout(() => setIsOpen(true), 150);
}, []);

const handleMouseLeave = useCallback(() => {
  if (enterTimer.current) {
    clearTimeout(enterTimer.current);
    enterTimer.current = null;
  }
  leaveTimer.current = setTimeout(() => setIsOpen(false), 300);
}, []);

// Escape key closes
const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
  if (e.key === "Escape") setIsOpen(false);
}, []);

// Clean up timers on unmount
useEffect(() => {
  return () => {
    if (enterTimer.current) clearTimeout(enterTimer.current);
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
  };
}, []);
```

Wrap the existing breadcrumb `<div>` in a container that handles mouse events:

```tsx
<div
  onMouseEnter={handleMouseEnter}
  onMouseLeave={handleMouseLeave}
  onKeyDown={handleKeyDown}
  className="relative"
>
  {/* breadcrumb text div (existing) */}
  {/* dropdown panel (new, rendered when isOpen) */}
</div>
```

- [ ] **Step 2: Build the module grouping logic**

Add a helper function above the component (or inside it as a memo):

```tsx
type ModuleGroup =
  | { kind: "parent"; parentSlug: string; parentTitle: string; children: ModuleInfo[] }
  | { kind: "standalone"; module: ModuleInfo };

function groupModules(modules: ModuleInfo[]): ModuleGroup[] {
  const groups: ModuleGroup[] = [];
  let i = 0;
  while (i < modules.length) {
    const mod = modules[i];
    if (mod.parentSlug) {
      const parentSlug = mod.parentSlug;
      const parentTitle = mod.parentTitle || parentSlug;
      const children: ModuleInfo[] = [];
      while (i < modules.length && modules[i].parentSlug === parentSlug) {
        children.push(modules[i]);
        i++;
      }
      groups.push({ kind: "parent", parentSlug, parentTitle, children });
    } else {
      groups.push({ kind: "standalone", module: mod });
      i++;
    }
  }
  return groups;
}
```

- [ ] **Step 3: Implement the dropdown panel rendering**

Add a `DropdownPanel` subcomponent within `BreadcrumbNav.tsx`:

```tsx
import { formatDurationMinutes } from "@/utils/duration";

function ProgressCircle({ status, size = 12 }: { status: "completed" | "in_progress" | "not_started" | "current"; size?: number }) {
  if (status === "completed") {
    return (
      <svg className="flex-shrink-0" width={size} height={size} viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="9" fill="#b87018" />
        <path d="M6 10.5l2.5 2.5 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    );
  }
  if (status === "current" || status === "in_progress") {
    return (
      <svg className="flex-shrink-0" width={size} height={size} viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="8" stroke="#d08838" strokeWidth="2" fill="#fde8c8" />
      </svg>
    );
  }
  return (
    <svg className="flex-shrink-0" width={size} height={size} viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="8" stroke="#ccc" strokeWidth="2" fill="white" />
    </svg>
  );
}

function SectionDot({ completed, isCurrent }: { completed: boolean; isCurrent: boolean }) {
  const color = completed ? "bg-[#d08838]" : isCurrent ? "border-2 border-[#d08838] bg-white" : "border-[1.5px] border-gray-300 bg-white";
  return <div className={`w-[7px] h-[7px] rounded-full flex-shrink-0 ${color}`} />;
}
```

Then the main dropdown panel, rendered conditionally when `isOpen`:

```tsx
{isOpen && (
  <div className="absolute top-full left-0 mt-1 bg-white border border-[#e8e4dc] rounded-xl shadow-lg z-50 w-[300px] max-w-[calc(100vw-2rem)] max-h-[400px] overflow-y-auto py-2 px-2">
    {groupModules(unitModules).map((group) => {
      if (group.kind === "parent") {
        const completedCount = group.children.filter((c) => c.status === "completed").length;
        return (
          <div key={group.parentSlug} className="mb-1">
            {/* Parent header */}
            <div className="flex items-center gap-1.5 px-2 py-1">
              <ProgressCircle
                status={completedCount === group.children.length ? "completed" : completedCount > 0 ? "in_progress" : "not_started"}
                size={12}
              />
              <span className="text-xs font-semibold text-[#7a470c]">{group.parentTitle}</span>
              <span className="text-[10px] text-[#9a5c10] bg-[#fdf3e3] px-1.5 rounded ml-auto">
                {completedCount}/{group.children.length}
              </span>
            </div>
            {/* Children tree */}
            <div className="ml-3 border-l-2 border-[#f0e8d8]">
              {group.children.map((child) => (
                <ModuleRow
                  key={child.slug}
                  module={child}
                  isCurrent={child.slug === currentModuleSlug}
                  currentSectionIndex={currentSectionIndex}
                  completedSections={completedSections}
                  currentModuleSections={currentModuleSections}
                  courseId={courseId}
                  onSectionClick={onSectionClick}
                  onClose={() => setIsOpen(false)}
                />
              ))}
            </div>
          </div>
        );
      }
      // Standalone module
      return (
        <ModuleRow
          key={group.module.slug}
          module={group.module}
          isCurrent={group.module.slug === currentModuleSlug}
          currentSectionIndex={currentSectionIndex}
          completedSections={completedSections}
          currentModuleSections={currentModuleSections}
          courseId={courseId}
          onSectionClick={onSectionClick}
          onClose={() => setIsOpen(false)}
        />
      );
    })}
  </div>
)}
```

- [ ] **Step 4: Implement `ModuleRow` subcomponent**

This renders a single module row. When it's the current module, it expands to show sections.

```tsx
function ModuleRow({
  module: mod,
  isCurrent,
  currentSectionIndex,
  completedSections,
  currentModuleSections,
  courseId,
  onSectionClick,
  onClose,
}: {
  module: ModuleInfo;
  isCurrent: boolean;
  currentSectionIndex: number;
  completedSections: Set<number>;
  currentModuleSections: StageInfo[];
  courseId: string;
  onSectionClick: (index: number) => void;
  onClose: () => void;
}) {
  const status = isCurrent ? "current" : mod.status;
  const stageCount = mod.stages.length;
  const duration = mod.duration;

  return (
    <div>
      {isCurrent ? (
        <div className="flex items-center gap-1.5 px-2 py-1 ml-1 rounded-md bg-[#fdf3e3]">
          <ProgressCircle status="current" size={12} />
          <span className="text-xs font-semibold text-[#7a470c] truncate">{mod.title}</span>
        </div>
      ) : (
        <a
          href={`/course/${courseId}/module/${mod.slug}`}
          className="flex items-center gap-1.5 px-2 py-1 ml-1 rounded-md hover:bg-[#faf8f5] transition-colors"
          onClick={onClose}
        >
          <ProgressCircle status={status} size={12} />
          <span className={`text-xs truncate ${status === "completed" ? "text-gray-500" : "text-gray-700"}`}>
            {mod.title}
          </span>
          {!isCurrent && (
            <span className="text-[10px] text-gray-400 ml-auto whitespace-nowrap">
              {stageCount > 0 && `${stageCount} sections`}
              {stageCount > 0 && duration ? " · " : ""}
              {duration ? formatDurationMinutes(duration) : ""}
            </span>
          )}
        </a>
      )}

      {/* Expanded sections for current module */}
      {isCurrent && currentModuleSections.length > 0 && (
        <div className="ml-5 border-l-2 border-[#e8e4dc] mt-0.5 mb-1">
          {currentModuleSections.map((section, idx) => {
            const isCompleted = completedSections.has(idx);
            const isCurrentSection = idx === currentSectionIndex;
            return (
              <button
                key={idx}
                onClick={() => {
                  onSectionClick(idx);
                  onClose();
                }}
                className={`flex items-center gap-1.5 px-2 py-0.5 ml-1 rounded text-left w-full transition-colors ${
                  isCurrentSection
                    ? "text-[#d08838] font-medium"
                    : "text-gray-500 hover:text-gray-700 hover:bg-[#faf8f5]"
                }`}
              >
                <SectionDot completed={isCompleted} isCurrent={isCurrentSection} />
                <span className="text-[11px] truncate">{section.title}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Verify build**

Run: `cd /home/penguin/code/lens-platform/ws1/web_frontend && npm run lint && npm run build`
Expected: Clean build.

- [ ] **Step 6: Visual verification in browser**

Navigate to `http://dev.vps:3100/course/default/module/existing-approaches/automating-alignment`

Verify:
- Hovering breadcrumb opens dropdown after ~150ms
- Dropdown shows parent module group with submodules
- Current submodule is highlighted and expanded with section dots
- Clicking a section navigates to it and closes dropdown
- Moving mouse away closes dropdown after ~300ms
- Escape key closes dropdown

- [ ] **Step 7: Commit**

```
feat: implement breadcrumb dropdown panel with module hierarchy and section navigation
```

---

## Chunk 4: Header scroll-lock and polish

### Task 5: Lock header visible while dropdown is open

**Files:**
- Modify: `src/components/ModuleHeader.tsx:168-181`
- Modify: `src/components/module/BreadcrumbNav.tsx`

- [ ] **Step 1: Expose `isOpen` state from BreadcrumbNav**

Add an `onOpenChange` callback prop to `BreadcrumbNavProps`:

```typescript
onOpenChange?: (isOpen: boolean) => void;
```

Call it whenever `isOpen` changes:

```tsx
// In BreadcrumbNav, after setIsOpen calls:
useEffect(() => {
  onOpenChange?.(isOpen);
}, [isOpen, onOpenChange]);
```

- [ ] **Step 2: Use it in ModuleHeader to suppress scroll-hide**

In `ModuleHeader.tsx`, add state:

```tsx
const [breadcrumbOpen, setBreadcrumbOpen] = useState(false);
```

Pass to BreadcrumbNav:

```tsx
<BreadcrumbNav
  // ... existing props
  onOpenChange={setBreadcrumbOpen}
/>
```

Modify the `shouldHideHeader` logic (line 173):

```tsx
const shouldHideHeader = isCompactViewport && scrollDirection === "down" && !breadcrumbOpen;
```

- [ ] **Step 3: Verify**

Run: `cd /home/penguin/code/lens-platform/ws1/web_frontend && npm run lint && npm run build`

Visual check: Open dropdown, scroll down — header should stay visible. Close dropdown, scroll down — header hides.

- [ ] **Step 4: Commit**

```
feat: lock header visible while breadcrumb dropdown is open
```

---

### Task 6: Mobile tap support

**Files:**
- Modify: `src/components/module/BreadcrumbNav.tsx`

- [ ] **Step 1: Add touch handling**

Detect touch device and use click instead of hover:

```tsx
import { useMedia } from "react-use";

// Inside BreadcrumbNav:
const isTouchDevice = useMedia("(pointer: coarse)", false);

const handleClick = useCallback(() => {
  if (isTouchDevice) {
    setIsOpen((prev) => !prev);
  }
}, [isTouchDevice]);

// Close on outside click (mobile)
useEffect(() => {
  if (!isOpen || !isTouchDevice) return;
  const handleOutsideClick = (e: MouseEvent) => {
    const target = e.target as Node;
    // containerRef wraps the breadcrumb + dropdown
    if (containerRef.current && !containerRef.current.contains(target)) {
      setIsOpen(false);
    }
  };
  document.addEventListener("mousedown", handleOutsideClick);
  return () => document.removeEventListener("mousedown", handleOutsideClick);
}, [isOpen, isTouchDevice]);
```

Add a `containerRef` to the outermost wrapper div. On touch devices, disable the `onMouseEnter`/`onMouseLeave` handlers and use `onClick` on the breadcrumb text instead.

```tsx
<div
  ref={containerRef}
  onMouseEnter={isTouchDevice ? undefined : handleMouseEnter}
  onMouseLeave={isTouchDevice ? undefined : handleMouseLeave}
  onKeyDown={handleKeyDown}
  className="relative"
>
  <div
    ref={ref}
    onClick={handleClick}
    className={`flex items-baseline gap-0 min-w-0 font-display ${isTouchDevice ? "cursor-pointer" : ""}`}
    style={priority >= 4 ? hiddenStyle : undefined}
  >
    {/* ... breadcrumb text */}
  </div>
  {/* ... dropdown panel */}
</div>
```

- [ ] **Step 2: Verify build**

Run: `cd /home/penguin/code/lens-platform/ws1/web_frontend && npm run lint && npm run build`

- [ ] **Step 3: Commit**

```
feat: add mobile tap support for breadcrumb dropdown
```

---

### Task 7: Final integration test

- [ ] **Step 1: Full visual verification**

Navigate to several module pages in Chrome DevTools and verify:

1. **Submodule page** (`http://dev.vps:3100/course/default/module/existing-approaches/automating-alignment`):
   - Breadcrumb shows "Unit Name › Automating Alignment"
   - Hover dropdown shows parent group "Existing Approaches" with all submodules
   - Current submodule expanded with sections
   - Clicking sibling navigates to it

2. **Standalone module** (find one via course overview):
   - Breadcrumb shows "Unit Name › Module Name" if unit has multiple modules, or just "Unit Name" if single
   - Dropdown shows all modules in unit

3. **Responsive**:
   - Narrow browser: unit name hides, just module name shown
   - Very narrow: everything hides (priority 4)

4. **No course context** (direct module URL without course):
   - Falls back to plain module title, no dropdown

- [ ] **Step 2: Run final checks**

Run: `cd /home/penguin/code/lens-platform/ws1/web_frontend && npm run lint && npm run build`
Expected: Clean build, no lint errors.

- [ ] **Step 3: Commit if any fixes needed**

```
fix: breadcrumb navigation polish
```
