# Breadcrumb Navigation System

## Problem

Users deep-link into a submodule (e.g., via email) and see a progress bar with 4 section dots. They think those 4 sections are the entire assignment, not realizing this submodule is one of 6 within a larger parent module. The only place that communicates the bigger picture is the course overview page, which they never visit.

## Solution

Add a breadcrumb to the module header that shows the user's position within the unit hierarchy. Hovering (desktop) or tapping (mobile) the breadcrumb opens a dropdown panel showing all modules/submodules in the unit with their sections, allowing navigation to any point.

## Breadcrumb Display Rules

The breadcrumb replaces the current module title position in the `ModuleHeader`.

### Unit Name Format

Reuse the same logic as `CourseTimeline.tsx` (extract into a shared utility `src/utils/unitLabel.ts`):

```typescript
function getUnitLabel(unit: UnitInfo, unitIndex: number): string {
  if (unit.meetingName) return `${unit.meetingNumber}. ${unit.meetingName}`;
  if (unit.meetingNumber !== null) return `Week ${unit.meetingNumber}`;
  return `Week ${unitIndex + 1}`;
}
```

### Breadcrumb Variants

**Single module in unit:** Show only the unit name. No separator, no module name.
```
3. Existing Approaches
```

**Multiple standalone modules in a unit:** Show unit name › current module name.
```
3. Existing Approaches › Reward Modeling
```

**Submodule:** Show unit name › current submodule name. Skip the parent module level — it appears in the dropdown panel instead.
```
3. Existing Approaches › Automating Alignment
```

**Never show all three levels** (unit → parent module → submodule) in the breadcrumb itself. Always unit + lowest level only.

### Fallback States

When course context is not yet loaded or the module is not found in any unit, show the plain module title without any dropdown interaction (current behavior). No hover/tap behavior, no visual hint of interactivity.

## Dropdown Panel

Opens on hover (desktop) or tap (mobile). Floats below the breadcrumb as a dropdown.

### Content Structure

The panel shows all modules in the current unit, grouped by parent module when submodules exist:

1. **Parent module groups** — showing parent name + completion badge (e.g., "1/6"). Children listed as an indented tree with a left border connector.
2. **Standalone modules** — listed at root level with completion circle and duration.
3. **Current module auto-expanded** — whichever module/submodule the user is viewing has its sections shown inline beneath it (as small dots with titles). Section completion derived from `completedSections` Set by index.
4. **Other modules collapsed** — show `stages.length` from `ModuleInfo.stages[]` and total duration as a hint (e.g., "4 sections · ~20 min") so users know modules contain depth.

### Visual Hierarchy

```
┌─────────────────────────────────────┐
│ ● Existing Approaches        1/6   │  ← parent group header
│ ├ ✓ Intro to Approaches            │  ← completed submodule
│ ├ ● Automating Alignment           │  ← current submodule (active)
│ │   ├ ● The Case for Automating... │  ← section (completed)
│ │   ├ ○ Current Research Directions │  ← section (current)
│ │   └ ○ Open Problems              │  ← section (upcoming)
│ ├ ○ Reward Modeling                 │  ← upcoming submodule
│ ├ ○ Interpretability               │
│ ├ ○ Scalable Oversight             │
│ └ ○ Debate & Amplification         │
│─────────────────────────────────────│
│ ○ Cognitive Superpowers    ~30 min  │  ← standalone module
└─────────────────────────────────────┘
```

### Completion Indicators

- **Completed**: filled amber circle with checkmark
- **In progress / current**: amber ring with warm fill
- **Upcoming**: gray outline circle
- Matches the existing visual language from `CourseTimeline` and `StageProgressBar`

### Navigation

- Clicking a **module/submodule** navigates to `/course/{courseId}/module/{slug}` (courseId is the course slug, e.g., "default")
- Clicking a **section** within the current module scrolls/navigates to that section index (same as clicking a progress bar dot)
- Current module and current section are highlighted

### Dropdown Behavior

**Open/close:**
- Desktop: hover intent with ~150ms enter delay, ~300ms leave delay to avoid flicker
- Mobile: tap to open, tap outside or on an item to close
- Escape key closes the dropdown

**Scroll interaction:** Opening the dropdown locks the header visible (prevents the hide-on-scroll behavior). When the dropdown closes, normal scroll-hide behavior resumes.

**Z-index:** Dropdown panel uses `z-50`, above the header's `z-40`. The drawer (`z-50`) and dropdown are independent — both can exist but in practice the dropdown is small and non-overlapping.

**Keyboard:** Not required for initial implementation. Can be added later (arrow keys, focus management).

## Data Sources

All required data is already available in `Module.tsx`:

- **Unit info**: from `courseProgress` (already fetched via `getCourseProgress`). Each unit has meeting name/number and a list of modules.
- **Module info**: each module in `courseProgress.units[].modules` has `slug`, `title`, `status`, `parentSlug`, `parentTitle`, `completedLenses`, `totalLenses`, `duration`, `stages[]`, `optional`.
- **Stages for other modules**: `courseProgress` includes `stages[]` per module with `type`, `title`, `duration`, `optional`, `contentId`, `completed`. Use `stages.length` for collapsed module hints.
- **Sections for current module**: from `getModule()` (already loaded) plus `completedSections` state.

No new API calls required.

## Component Architecture

### New: `BreadcrumbNav` component

Location: `src/components/module/BreadcrumbNav.tsx`

Props:
```typescript
interface BreadcrumbNavProps {
  // Current position
  unitName: string;
  currentModuleSlug: string;
  currentSectionIndex: number;
  completedSections: Set<number>;
  // Unit contents
  unitModules: ModuleInfo[];         // from courseProgress
  currentModuleSections: StageInfo[]; // from loaded module, reuse StageInfo type
  // Course context
  courseId: string;                   // course slug (e.g., "default")
  // Navigation
  onSectionClick: (index: number) => void;  // for within-module navigation
}
```

Section completion state for the current module is derived by checking `completedSections.has(index)` for each entry in `currentModuleSections`.

Internal state:
- `isOpen: boolean` — dropdown visibility
- Hover intent timers (refs)

### New: `src/utils/unitLabel.ts`

Shared unit name formatting, extracted from `CourseTimeline.tsx` so both components use the same logic.

### Modified: `ModuleHeader`

- Accept new optional props: `unitName`, `unitModules`, `currentModuleSections`, `courseId`
- Replace the module title `<h1>` with `<BreadcrumbNav>` when `unitName` is provided
- Fall back to plain module title when `unitName` is undefined (loading or no course context)
- Module.tsx derives `unitName` and `unitModules` from `courseProgress` and passes them down (no raw `courseProgress` passed to header)

### Modified: `Module.tsx`

- Add a `useMemo` that finds the current module's unit in `courseProgress` and computes `unitName` (via shared utility) and `unitModules`
- Pass these as props to `ModuleHeader`

### Unchanged

- `ModuleDrawer` — stays as-is
- `StageProgressBar` — stays as-is
- `SectionChoiceModal` — stays as-is

## Responsive Behavior

The existing `ModuleHeader` uses a priority-based system (0–4) that hides elements as space gets tight. The breadcrumb participates in this:

- **Priority 0–2**: Full breadcrumb shown ("3. Existing Approaches › Automating Alignment")
- **Priority 3+**: Compact mode — breadcrumb collapses. The unit name portion hides first, leaving just the module/submodule name. At priority 4 it hides entirely (same as current title behavior).

The dropdown panel should be wide enough to show module names without truncation (~280–320px) but capped at `calc(100vw - 2rem)` on mobile.

## Edge Cases

1. **No course context loaded yet**: Show plain module title (current behavior) until `courseProgress` resolves. No dropdown interaction.
2. **Module not found in any unit**: Fall back to plain module title with no dropdown. Can happen for standalone modules accessed outside a course context.
3. **Single module, single section**: Breadcrumb shows unit name only. Dropdown shows one module with one section — still useful for showing the unit context.
4. **Very long unit/module names**: Truncate with ellipsis. Unit name truncates first since it's the parent context. Same `max-w-[200px] truncate` treatment as current title.
5. **Mobile tap**: Tap opens, tap outside or on an item closes. No hover behavior on touch devices.
