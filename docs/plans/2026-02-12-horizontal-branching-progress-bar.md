# Horizontal Branching Progress Bar Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make optional sections in the horizontal `StageProgressBar` drop below the main trunk line with SVG arc connectors, matching the metro-map aesthetic from `ModuleOverview`.

**Architecture:** Reuse `buildBranchLayout` utility with a thin type adapter (`Stage[]` -> `StageInfo[]`-compatible). Refactor `StageProgressBar` to iterate `LayoutItem[]` instead of flat `stages[]`. Trunk items render in a single horizontal row (identical to current). Branch groups render as two-row `flex-col` blocks: pass-through connector on top (trunk continuity), SVG S-curve arc + dashed branch connectors + branch dots below. The outer flex changes from `items-center` to `items-start` so trunk dots align with branch block top rows.

**Key files:**
- `web_frontend/src/components/module/StageProgressBar.tsx` — main rendering changes (modify)
- `web_frontend/src/utils/branchLayout.ts` — shared layout utility (no changes)
- `web_frontend/src/utils/stageProgress.ts` — shared dot styling (no changes)
- `web_frontend/src/components/ModuleHeader.tsx` — parent component (no changes expected)

**Tech Stack:** React 19, Tailwind CSS v4, TypeScript, Vite, Vitest

**Type compatibility note:** `buildBranchLayout` takes `StageInfo[]` (where `optional: boolean` is required). `StageProgressBar` uses `Stage[]` (where `optional?: boolean`). We use a thin adapter at the call site — no changes to the shared utility. We index back into the original `stages[]` via `item.index` for rendering.

**Visual target:**
```
  ●──●─────────●──●
        ╲
         ○──○
```

---

### Task 1: Refactor trunk rendering to use buildBranchLayout

Replace the flat `stages.map()` with `layout.map()` that only renders trunk items. Branch items are skipped (returned as `null`). The visual result must be identical to the current bar — this is a pure refactor that establishes the layout infrastructure.

**Files:**
- Modify: `web_frontend/src/components/module/StageProgressBar.tsx`

**Step 1: Add imports and compute layout**

At the top of `StageProgressBar.tsx`, add:

```tsx
import { useMemo } from "react";
import { buildBranchLayout } from "../../utils/branchLayout";
import type { StageInfo } from "../../types/course";
```

Inside the component body (after `getBarColor` and `handleDotClick`, before the `return`), add:

```tsx
// Adapt Stage[] to StageInfo[]-compatible input for buildBranchLayout
const layoutInput = useMemo(
  () =>
    stages.map(
      (s): StageInfo => ({
        type: s.type as StageInfo["type"],
        title: getStageTitle(s),
        duration: null,
        optional: s.optional ?? false,
      }),
    ),
  [stages],
);
const layout = useMemo(() => buildBranchLayout(layoutInput), [layoutInput]);
```

**Step 2: Replace `stages.map()` with `layout.map()` (trunk only)**

Replace the `<div className="flex items-center">` block containing `{stages.map((stage, index) => { ... })}` with:

```tsx
<div className="flex items-center">
  {layout.map((item, li) => {
    if (item.kind !== "trunk") return null;

    const stage = stages[item.index];
    const index = item.index;
    const isCompleted = completedStages.has(index);
    const isViewing = index === currentSectionIndex;
    const isOptional = "optional" in stage && stage.optional === true;

    const fillClasses = getCircleFillClasses(
      { isCompleted, isViewing, isOptional },
      { includeHover: true },
    );
    const ringClasses = getRingClasses(isViewing, isCompleted);

    return (
      <div key={li} className="flex items-center">
        {/* Connector line (except before first layout item) */}
        {li > 0 && (
          <div
            className={`h-0.5 ${compact ? "w-4" : "w-2 sm:w-4"} ${getBarColor(index)}`}
          />
        )}

        {/* Dot */}
        <Tooltip
          content={getTooltipContent(stage, index, isCompleted, isViewing)}
          placement="bottom"
        >
          <button
            onClick={() => handleDotClick(index)}
            className={`
              relative rounded-full flex items-center justify-center
              transition-all duration-150
              ${compact ? "" : "active:scale-95 shrink-0"}
              ${
                compact
                  ? "w-7 h-7"
                  : "min-w-8 min-h-8 w-8 h-8 sm:min-w-[44px] sm:min-h-[44px] sm:w-11 sm:h-11"
              }
              ${fillClasses}
              ${ringClasses}
            `}
          >
            <StageIcon type={stage.type} small={compact} />
          </button>
        </Tooltip>
      </div>
    );
  })}
</div>
```

**Step 3: Verify visually**

Run: `cd /home/penguin/code/lens-platform/ws1/web_frontend && npm run dev -- --host --port 3100`

Navigate to `http://dev.vps:3100/course/default/module/what-even-is-ai` (desktop width). Verify the horizontal bar in the header looks identical to before — same dots, same connectors, same colors. Optional sections are simply absent (they were previously inline, now they're skipped). This is expected — Task 2 adds them back.

**Step 4: Run lint and build**

Run: `cd /home/penguin/code/lens-platform/ws1/web_frontend && npm run lint && npm run build`
Expected: clean

**Step 5: Commit**

```bash
jj new -m "refactor: use buildBranchLayout in horizontal StageProgressBar (trunk only)"
```

---

### Task 2: Render branch groups below trunk

Add rendering for `kind: "branch"` layout items. Branch groups are two-row `flex-col` blocks: a pass-through connector on top (trunk line continuity) and SVG arc + branch dots below.

**Files:**
- Modify: `web_frontend/src/components/module/StageProgressBar.tsx`

**Step 1: Change outer flex alignment**

Find the inner stages container (the `<div className="flex items-center">` wrapping the `layout.map()` — NOT the outer wrapper with prev/next buttons). Change to:

```tsx
<div className="flex items-start">
```

This ensures trunk dots and branch block top rows align at the same Y position.

**Step 2: Extract a `renderDot` helper**

The dot rendering logic (circle + icon + tooltip) is shared between trunk and branch items. Extract it into an inline function inside the component, above the `return`:

```tsx
function renderDot(stage: Stage, index: number) {
  const isCompleted = completedStages.has(index);
  const isViewing = index === currentSectionIndex;
  const isOptional = "optional" in stage && stage.optional === true;

  const fillClasses = getCircleFillClasses(
    { isCompleted, isViewing, isOptional },
    { includeHover: true },
  );
  const ringClasses = getRingClasses(isViewing, isCompleted);

  return (
    <Tooltip
      content={getTooltipContent(stage, index, isCompleted, isViewing)}
      placement="bottom"
    >
      <button
        onClick={() => handleDotClick(index)}
        className={`
          relative rounded-full flex items-center justify-center
          transition-all duration-150
          ${compact ? "" : "active:scale-95 shrink-0"}
          ${
            compact
              ? "w-7 h-7"
              : "min-w-8 min-h-8 w-8 h-8 sm:min-w-[44px] sm:min-h-[44px] sm:w-11 sm:h-11"
          }
          ${fillClasses}
          ${ringClasses}
        `}
      >
        <StageIcon type={stage.type} small={compact} />
      </button>
    </Tooltip>
  );
}
```

Update trunk rendering to use `renderDot`:
```tsx
{/* inside trunk item */}
{renderDot(stages[item.index], item.index)}
```

**Step 3: Add branch group rendering**

Replace `if (item.kind !== "trunk") return null;` with full branch rendering. The geometry constants for compact mode:

```
dotSize = 28  (w-7 = 1.75rem = 28px)
r = 8         (arc corner radius, px)
arcWidth = 2*r + 2 = 18px   (SVG element width)
arcHeight = dotSize + 2 = 30px  (SVG element height: trunk center → branch dot center)
```

The SVG arc is an S-curve (two quarter-circle arcs connected by a vertical segment), matching the vertical version's metro-map style. It uses negative `margin-top` to reach from the branch row up to the trunk line center. The pass-through line in the top row has `z-[2]` to paint over the arc overlap (arc is `z-[1]`).

Add this block in the `layout.map()`:

```tsx
if (item.kind === "branch") {
  const dotSize = compact ? 28 : 32;
  const r = 8;
  const arcWidth = 2 * r + 2;
  const arcHeight = dotSize + 2;

  return (
    <div key={li} className="relative inline-flex flex-col items-start">
      {/* Row 1: pass-through connector at trunk height */}
      <div className="flex items-center" style={{ height: dotSize }}>
        {li > 0 && (
          <div
            className={`h-0.5 ${compact ? "w-4" : "w-2 sm:w-4"} ${getBarColor(item.items[0].index)}`}
          />
        )}
        <div
          className={`relative z-[2] h-0.5 flex-1 ${getBarColor(item.items[0].index)}`}
        />
      </div>

      {/* Row 2: SVG arc + branch dots */}
      <div className="flex items-center">
        {/* S-curve arc from trunk line to first branch dot */}
        <svg
          className="shrink-0 text-gray-300 z-[1]"
          style={{
            width: arcWidth,
            height: arcHeight,
            marginTop: -(dotSize / 2 + 1),
          }}
          viewBox={`0 0 ${arcWidth} ${arcHeight}`}
          fill="none"
        >
          <path
            d={`M 1 1 A ${r} ${r} 0 0 1 ${r + 1} ${r + 1} L ${r + 1} ${dotSize - r + 1} A ${r} ${r} 0 0 0 ${2 * r + 1} ${dotSize + 1}`}
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="4 3"
            strokeLinecap="round"
          />
        </svg>

        {/* Branch dots */}
        {item.items.map((branchItem, bi) => (
          <div key={bi} className="flex items-center">
            {bi > 0 && (
              <div
                className={`border-t-2 border-dashed border-gray-300 ${compact ? "w-3" : "w-2 sm:w-3"}`}
              />
            )}
            {renderDot(stages[branchItem.index], branchItem.index)}
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Step 4: Verify visually**

Navigate to `http://dev.vps:3100/course/default/module/what-even-is-ai` (desktop).

Check:
- Trunk dots form a continuous horizontal line
- Optional sections appear below with an S-curve arc connector
- Pass-through line is visually continuous with the trunk connectors
- Branch dots have dashed-border optional styling
- Clicking branch dots navigates correctly

**Step 5: Commit**

```bash
jj new -m "feat: render branch groups below trunk in horizontal StageProgressBar"
```

---

### Task 3: Polish colors, z-index, edge cases, and sizing

Fine-tune the branch rendering for visual quality.

**Files:**
- Modify: `web_frontend/src/components/module/StageProgressBar.tsx`

**Step 1: Precompute pass-through colors**

The pass-through and branch connector colors should be based on the surrounding trunk context (same as vertical version). Add a precomputation step after `layout` is computed:

```tsx
let prevTrunkIndex = -1;
const layoutColors = layout.map((item) => {
  if (item.kind === "trunk") {
    const color = getBarColor(item.index);
    prevTrunkIndex = item.index;
    return { kind: "trunk" as const, color };
  } else {
    const passColor =
      prevTrunkIndex >= 0 ? getBarColor(prevTrunkIndex) : "bg-gray-200";
    return { kind: "branch" as const, passColor };
  }
});
```

Update branch rendering to use `layoutColors[li].passColor` for:
- The pass-through connector in row 1
- The connector-in before the branch block
- The SVG arc color (via a Tailwind text-color class lookup, same pattern as vertical)

Static color mapping (needed for Tailwind scanner):
```tsx
const branchColorMap: Record<string, { text: string; border: string }> = {
  "bg-blue-400": { text: "text-blue-400", border: "border-blue-400" },
  "bg-gray-400": { text: "text-gray-400", border: "border-gray-400" },
  "bg-gray-200": { text: "text-gray-200", border: "border-gray-200" },
};
```

**Step 2: Handle edge cases**

- **Branch at start** (no preceding trunk): no connector-in, no arc. Branch dots render at the start of row 2 with just dashed connectors between them. The pass-through in row 1 still renders (it provides the gap for the next trunk dot's connector). Check: `li === 0` to skip the arc SVG.

- **Branch at end** (no following trunk): dead-ends naturally. The pass-through might be unnecessary (no trunk line to continue). If the branch is the last layout item AND the only layout item, skip the pass-through. Otherwise keep it for visual consistency.

- **Dashed trunk trailing connector**: when the last trunk item is followed only by a branch (no more trunk items after), the connector from the last trunk to the branch block should be dashed (matching the vertical version's trailing dashed line). Compute `lastTrunkLi` the same way as `ModuleOverview`:
  ```tsx
  const lastTrunkLi = (() => {
    for (let i = layout.length - 1; i >= 0; i--) {
      if (layout[i].kind === "trunk") return i;
    }
    return -1;
  })();
  ```
  Use this in trunk connector rendering: if `li === lastTrunkLi && !isLast`, render the bottom connector as dashed.

**Step 3: Tune arc geometry**

The S-curve arc from Task 2 is a starting point. During visual verification, adjust:
- `r` (arc radius): try 6, 8, 10 to see what reads best at compact size
- `strokeDasharray`: try "4 3", "3 2", "6 4" for different dash densities
- `marginTop` offset: may need ±1px adjustment for pixel-perfect alignment

**Step 4: Experiment with branch dot sizing**

Try rendering branch dots at a smaller size to reinforce hierarchy:
- Current: `w-7 h-7` (28px) in compact
- Try: `w-5 h-5` (20px) with `small` icon variant

Add a constant at the top of the branch rendering block:
```tsx
const branchDotSize = compact ? "w-7 h-7" : "..."; // swap to "w-5 h-5" to test
```

Decide visually which looks better. If same size wins, remove the constant and keep the shared `renderDot` as-is. If smaller wins, add a `branchCompact` parameter to `renderDot`.

**Step 5: Verify all cases visually**

Navigate to modules with different structures:
- Module with no optional sections (should look identical to before)
- Module with optional sections in the middle
- Module with optional sections at the end
- Check trunk line color continuity through branch blocks
- Check hover states on both trunk and branch dots
- Check ring indicator on viewing dot (both trunk and branch)

**Step 6: Run lint, build, and existing tests**

Run: `cd /home/penguin/code/lens-platform/ws1/web_frontend && npm run lint && npm run build && npx vitest run src/utils/__tests__/branchLayout.test.ts`
Expected: all clean, 5 tests pass

**Step 7: Commit**

```bash
jj new -m "feat: polish horizontal branching bar colors, edge cases, and sizing"
```

---

### Verification

1. **Unit tests:** `cd web_frontend && npx vitest run src/utils/__tests__/branchLayout.test.ts` (existing tests still pass)
2. **Lint:** `cd web_frontend && npm run lint`
3. **Build:** `cd web_frontend && npm run build`
4. **Visual QA — desktop header bar:**
   - Module with no optional sections → identical to before
   - Module with optional sections → branches drop below trunk with arc connectors
   - Trunk line visually continuous through branch blocks
   - Branch dots clickable, navigate correctly
   - Hover and selection ring states work on all dots
5. **Visual QA — edge cases:**
   - Optional at start (no preceding trunk)
   - Optional at end (dead-end branch)
   - Multiple separate branches
   - Single-item branch
