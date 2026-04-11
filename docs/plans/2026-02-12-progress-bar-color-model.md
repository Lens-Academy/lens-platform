# Progress Bar Color Model — Design Notes

## Context

The horizontal `StageProgressBar` and vertical `ModuleOverview` both render branching progress indicators. Required sections form a "trunk" (main line). Optional sections fork off as "branches" (metro-map style). Both use `buildBranchLayout()` to transform flat `Stage[]` into `LayoutItem[]` (trunk items + branch groups).

The color logic for line segments and dots has been iterated on incrementally and now needs a systematic redesign. This document captures the design conversation and open questions.

## Current State of the Code

All committed on branch `branching-progress-bar`:

1. **Branching layout** — `buildBranchLayout` utility groups consecutive optional sections into branches. Both components use it.
2. **Horizontal branching** — `StageProgressBar` renders branch groups below the trunk with SVG S-curve arc connectors, dotted branch lines, responsive alignment.
3. **Visual polish** — dotted SVG arcs (`strokeDasharray="0 4"` with round linecaps), tight corner radius (r=8 horizontal, r=10 vertical), dotted branch connectors (`border-dotted`).
4. **Pass-through color fix** — branch pass-through now uses `nextTrunkIndex` color instead of `prevTrunkIndex`, preventing premature darkening of trunk continuity lines. Applied to both components.
5. **Ring z-index fix** — viewing dot gets `z-[3]` so selection ring isn't clipped by adjacent pass-through lines (`z-[2]`).
6. **Branch color independence** — `layoutColors` now computes separate `passColor` (trunk continuity) and `branchColor` (arc + dotted connectors). Branch connectors only darken when viewing/completing items ON that branch, not when trunk progress passes the branch point. Applied to both components.

Lint and build pass. Tests pass.

## The Problem

The color logic is split across multiple systems:

- `getBarColor(index)` — trunk connector colors, uses `index <= currentSectionIndex` (cascading)
- `branchColor` in `layoutColors` — branch connector colors, uses `item.items.some(bi => bi.index === currentSectionIndex)` (membership check)
- `getCircleFillClasses()` — dot fill colors, uses `isCompleted` / `isViewing` per-dot
- `getRingClasses()` — selection ring, uses `isViewing` per-dot

These use fundamentally different approaches (index comparison vs set membership) for what should be the same conceptual operation. This makes the behavior hard to reason about and leads to subtle bugs.

### Specific bug still open

When selecting an optional (branch) article, the SVG arc and dotted connectors correctly darken, but the "shared stem" (the straight trunk pass-through line that the arc forks from) stays light. The user expects the shared stem to also darken since it's on the path to the branch.

## ~~Proposed Unified Model: Reachability~~ (superseded)

The reachability model proposed building `reachable: number[]` sets per segment. It worked for gray (viewing) but broke for blue (completed) — completing a far-downstream optional section would turn the entire trunk blue. See git history for the full writeup.

## Proposed Unified Model: Branch Subscriptions

### Core concept

**Every group of sections is a "branch."** The trunk is a branch. Each optional group forms its own branch. Branches are full paths from start, not just the optional fork — they share prefix sections with the trunk.

**Each branch tracks its own state:**
- `selected`: index of the currently viewed item, if it's in this branch (-1 otherwise)
- `highestCompleted`: highest completed index within this branch (-1 if none)

**Every visual element (line segment or dot) subscribes to one or more branches.** One color rule for everything:

```ts
function elementColor(previousIndex: number, subscribedBranches: Branch[]): Color {
  if (subscribedBranches.some(b => b.highestCompleted > previousIndex)) return BLUE;
  if (subscribedBranches.some(b => b.selected > previousIndex))         return GRAY;
  return LIGHT;
}
```

No trunk/branch asymmetry. No special cases. The only difference between line segments is which branches they subscribe to.

**Dots are simpler.** A dot represents a single section. Its color depends only on its own state: blue if completed, gray if currently viewing, light otherwise. Dots don't need the branch subscription model — they use `getCircleFillClasses()` / `getRingClasses()` as before. The branch subscription model is for **line segments** (connectors, stems, arcs).

### Branch definitions

For stages `[0:req, 1:req, 2:opt, 3:req, 4:req, 5:opt]`:

```
Branch A (trunk):          {0, 1, 3, 4}
Branch B (first optional): {0, 1, 2}
Branch C (second optional):{0, 1, 3, 4, 5}
```

Sections belong to multiple branches. Section 0 is in A, B, and C. Section 2 is only in B. Section 5 is only in C.

Construction rule: the trunk branch contains all required sections. Each optional branch contains the trunk prefix up to its fork point, plus its own optional sections.

### Segment subscriptions

Each line segment has a `previousIndex` and subscribes to one or more branches. `previousIndex` is the index of the last trunk dot before this segment — i.e. the most recent "decision point" the user passed through to reach this segment. The color check is `branch.state > previousIndex`.

| Segment | previousIndex | Subscribed | Notes |
|---------|---------------|------------|-------|
| Connector 0→1 | 0 | A, B, C | All paths pass through here |
| Shared stem (over branch B) | 1 | A, B, C | Junction — all paths pass through |
| SVG arc to branch B | 1 | B | Only the branch B path |
| Dotted connector within B | 1 | B | Only the branch B path |
| Connector →3 (after branch B) | 1 | A, C | Trunk paths only (B ends at 2) |
| Connector 3→4 | 3 | A, C | Trunk paths only |
| Trailing stub (over branch C) | 4 | C | Only exists because of branch C |
| SVG arc to branch C | 4 | C | Only the branch C path |

### Color tiers

| Tier | Color | Tailwind | Meaning |
|------|-------|----------|---------|
| Blue | Blue | `bg-blue-400` | Something downstream on a subscribed branch was completed |
| Dark gray | Gray | `bg-gray-400` | Currently viewing something downstream on a subscribed branch |
| Light gray | Light | `bg-gray-200` | No activity downstream |

**Design decision:** Blue means "you completed something downstream on this path." If you complete section 5 (optional at end), the entire path to it turns blue — including trunk connectors. This is intentional: you can't reach section 5 without traversing the trunk, so the trunk earned its blue.

### Behavior traces

**Viewing trunk(3), nothing completed:**
- Connector 0→1 (prev=0, [A,B,C]): A.selected=3, `3 > 0` → gray
- Shared stem (prev=1, [A,B,C]): A.selected=3, `3 > 1` → gray
- Arc to B (prev=1, [B]): B.selected=-1 → light
- Connector →3 (prev=1, [A,C]): A.selected=3, `3 > 1` → gray
- Connector 3→4 (prev=3, [A,C]): A.selected=3, `3 > 3` → NO → light
- Trailing stub (prev=4, [C]): `3 > 4` → NO → light

**Viewing branch(2), nothing completed:**
- Connector 0→1 (prev=0, [A,B,C]): B.selected=2, `2 > 0` → gray
- Shared stem (prev=1, [A,B,C]): B.selected=2, `2 > 1` → gray (fixes stem bug!)
- Arc to B (prev=1, [B]): B.selected=2, `2 > 1` → gray
- Connector →3 (prev=1, [A,C]): neither A nor C has selected → light
- Connector 3→4 (prev=3, [A,C]): → light

**Viewing branch(5), nothing completed:**
- Connector 0→1 (prev=0, [A,B,C]): C.selected=5, `5 > 0` → gray
- Shared stem (prev=1, [A,B,C]): C.selected=5, `5 > 1` → gray
- Arc to B (prev=1, [B]): B.selected=-1 → light (other branch stays light)
- Connector →3 (prev=1, [A,C]): C.selected=5, `5 > 1` → gray
- Connector 3→4 (prev=3, [A,C]): C.selected=5, `5 > 3` → gray
- Trailing stub (prev=4, [A,C]): C.selected=5, `5 > 4` → gray
- Arc to C (prev=4, [C]): C.selected=5, `5 > 4` → gray

**Section 5 completed, viewing trunk(1):**
Branch state: A.selected=1, B.selected=1, C.selected=1 (section 1 is in all branches). C.highestCompleted=5.
- Connector 0→1 (prev=0, [A,B,C]): C.highestCompleted `5 > 0` → blue (blue wins over gray from A.selected `1 > 0`)
- Shared stem (prev=1, [A,B,C]): C.highestCompleted `5 > 1` → blue
- Arc to B (prev=1, [B]): B.highestCompleted=-1, B.selected `1 > 1` → NO → light
- Connector →3 (prev=1, [A,C]): C.highestCompleted `5 > 1` → blue
- Connector 3→4 (prev=3, [A,C]): C.highestCompleted `5 > 3` → blue
- Trailing stub (prev=4, [C]): C.highestCompleted `5 > 4` → blue
- Arc to C (prev=4, [C]): C.highestCompleted `5 > 4` → blue

### Implementation approach

1. **Build branch paths** from the flat `stages[]` array. One trunk branch (all required sections), one branch per consecutive optional group (trunk prefix + optional sections). Shared utility function.

2. **Compute per-branch state** from `completedStages` and `currentSectionIndex`. Each branch gets `selected` and `highestCompleted`.

3. **Assign subscriptions** per visual element. During layout iteration, each segment/dot knows which branches it belongs to based on the layout structure and the branch path definitions.

4. **One color function** takes `previousIndex` + subscribed branches → color. Used by both `StageProgressBar` and `ModuleOverview`.

This can live in a shared utility (e.g. `web_frontend/src/utils/branchColors.ts`) consumed by both components. The layout utility (`buildBranchLayout`) stays as-is — it handles visual grouping. The new utility handles color computation on top of it.

## Previous open questions — resolved

1. **Blue logic** — Resolved. Blue means "completed something downstream on a subscribed branch." No separate `highestCompleted` system needed.
2. **Adjacency-blue** — Subsumed by branch subscriptions. No special adjacency rule.
3. **Dot "passed" state** — Dots don't use the branch subscription model. They check their own section's state (completed/viewing/neither). No "passed" state needed.
4. **Implementation approach** — Build branch paths + per-branch state + subscriptions. One system, precomputed.
5. **Shared utility** — Yes. One `computeSegmentColors()` (or similar) serves both components.

## Key Files

- `web_frontend/src/components/module/StageProgressBar.tsx` — horizontal bar
- `web_frontend/src/components/course/ModuleOverview.tsx` — vertical list
- `web_frontend/src/utils/stageProgress.ts` — shared dot styling (getCircleFillClasses, getRingClasses)
- `web_frontend/src/utils/branchLayout.ts` — shared layout grouping (buildBranchLayout)
- `web_frontend/src/utils/__tests__/branchLayout.test.ts` — layout tests (5 tests, all passing)
