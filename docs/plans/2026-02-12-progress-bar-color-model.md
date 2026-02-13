# Progress Bar Color Model — Design Notes

## Context

The horizontal `StageProgressBar` and vertical `ModuleOverview` both render branching progress indicators. Required sections form a "trunk" (main line). Optional sections fork off as "branches" (metro-map style). Both use `buildBranchLayout()` to transform flat `Stage[]` into `LayoutItem[]` (trunk items + branch groups).

The color logic for line segments and dots has been iterated on incrementally and now needs a systematic redesign. This document captures the design conversation and open questions.

## Current State of the Code

### What's been implemented and committed

1. **Branching layout** — `buildBranchLayout` utility groups consecutive optional sections into branches. Both components use it. (committed)
2. **Horizontal branching** — `StageProgressBar` renders branch groups below the trunk with SVG S-curve arc connectors, dotted branch lines, responsive alignment. (committed)
3. **Visual polish** — dotted SVG arcs (`strokeDasharray="0 4"` with round linecaps), tight corner radius (r=8 horizontal, r=10 vertical), dotted branch connectors (`border-dotted`). (committed)

### What's in the current uncommitted change

4. **Pass-through color fix** — branch pass-through now uses `nextTrunkIndex` color instead of `prevTrunkIndex`, preventing premature darkening of trunk continuity lines. Applied to both components.
5. **Ring z-index fix** — viewing dot gets `z-[3]` so selection ring isn't clipped by adjacent pass-through lines (`z-[2]`).
6. **Branch color independence** — `layoutColors` now computes separate `passColor` (trunk continuity) and `branchColor` (arc + dotted connectors). Branch connectors only darken when viewing/completing items ON that branch, not when trunk progress passes the branch point. Applied to both components.

### Files modified (uncommitted)

- `web_frontend/src/components/module/StageProgressBar.tsx`
- `web_frontend/src/components/course/ModuleOverview.tsx`

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

## Proposed Unified Model: Reachability

### Core concept

Every visual element (dot or line segment) has a **reachable set** — the set of section indices reachable through it. One function determines color for everything:

```ts
function segmentColor(reachable: number[]): string {
  if (reachable.some(i => /* blue condition for i */)) return "bg-blue-400";
  if (reachable.some(i => i === currentSectionIndex))  return "bg-gray-400";
  return "bg-gray-200";
}
```

Trunk and branch aren't different systems — they're the same system with different reachable sets.

### Example reachable sets

For stages `[0:req, 1:req, 2:opt, 3:req, 4:req, 5:opt]`:
Layout: `[trunk(0), trunk(1), branch([2]), trunk(3), trunk(4), branch([5])]`

#### Line segments

| Segment | Type | Reachable | Notes |
|---------|------|-----------|-------|
| Connector 0→1 | Trunk solid | `{1,2,3,4,5}` | Everything downstream |
| Shared stem (pass-through, branch [2]) | Trunk solid | `{2,3,4,5}` | Trunk + branch downstream |
| SVG arc to branch [2] | Branch dotted | `{2}` | Branch items only |
| Dotted connector between branch dots | Branch dotted | `{2}` | Branch items only |
| Connector →3 | Trunk solid | `{3,4,5}` | Everything downstream |
| Connector 3→4 | Trunk solid | `{4,5}` | Everything downstream |
| Trailing stub after 4 | Trunk dotted | `{5}` | Leads to trailing branch |
| SVG arc to branch [5] | Branch dotted | `{5}` | Branch items only |

#### Dots

| Dot | Reachable | Notes |
|-----|-----------|-------|
| Dot 0 | `{0}` | Only itself |
| Dot 1 | `{1}` | Only itself |
| Dot 2 (optional) | `{2}` | Only itself |
| Dot 3 | `{3}` | Only itself |
| Dot 4 | `{4}` | Only itself |
| Dot 5 (optional) | `{5}` | Only itself |

Dots always have reachable = just themselves. Their color logic additionally handles the ring and dashed border for optional sections.

### Color tiers

| Tier | Color | Tailwind | Meaning |
|------|-------|----------|---------|
| Blue | Blue | `bg-blue-400` | Completed / earned progress |
| Dark gray | Gray | `bg-gray-400` | Currently viewing (not yet earned) |
| Light gray | Light | `bg-gray-200` | Not reached |

### Behavior traces

**Viewing trunk(3), nothing completed:**
- Connector 0→1: `3 ∈ {1,2,3,4,5}` → dark gray ✓
- Shared stem: `3 ∈ {2,3,4,5}` → dark gray ✓
- Branch arc [2]: `3 ∈ {2}` → NO → light gray ✓
- Connector →3: `3 ∈ {3,4,5}` → dark gray ✓
- Connector 3→4: `3 ∈ {4,5}` → NO → light gray ✓

**Viewing branch(2), nothing completed:**
- Connector 0→1: `2 ∈ {1,2,3,4,5}` → dark gray ✓
- Shared stem: `2 ∈ {2,3,4,5}` → dark gray ✓ (fixes current bug!)
- Branch arc [2]: `2 ∈ {2}` → dark gray ✓
- Connector →3: `2 ∈ {3,4,5}` → NO → light gray ✓
- Connector 3→4: `2 ∈ {4,5}` → NO → light gray ✓

**Viewing branch(5), nothing completed:**
- Connector 0→1: `5 ∈ {1,2,3,4,5}` → dark gray ✓
- Shared stem (branch [2]): `5 ∈ {2,3,4,5}` → dark gray ✓
- Branch arc [2]: `5 ∈ {2}` → NO → light gray ✓ (other branch stays light)
- Connector →3: `5 ∈ {3,4,5}` → dark gray ✓
- Connector 3→4: `5 ∈ {4,5}` → dark gray ✓
- Trailing stub: `5 ∈ {5}` → dark gray ✓
- Branch arc [5]: `5 ∈ {5}` → dark gray ✓

## Open Questions

### 1. Blue logic with reachable sets

If section 5 is completed, connector 0→1's reachable set includes 5, so it would turn blue. But that's wrong — blue should mean "progress has reached here," not "anything downstream was completed."

Options:
- **A) Keep `highestCompleted` for blue:** Blue condition is `index <= highestCompleted` for trunk segments. Branch segments use `branchItems.some(i => completedStages.has(i))`. This means blue still uses a separate system.
- **B) "Nearest completed" rule:** A segment turns blue if its nearest/first reachable section is completed. This would require ordered reachable sets.
- **C) "All preceding completed" rule:** A segment turns blue only if all sections on the path from start to it are completed (contiguous completion). Most correct but most complex.
- **D) Keep the current `highestCompleted` shortcut:** It's simple and works in practice because sections are typically completed in order. Accept it as an acceptable approximation.

### 2. Adjacency-blue rule

Currently, viewing section N with section N-1 completed makes the connector INTO N blue (not dark gray). This gives a smooth "blue extends to where you are" effect for trunk. Should this apply to branches too? Probably not — branches are non-linear side paths. But should it apply to the shared stem? If you completed trunk(1) and are viewing branch(2), should the shared stem be blue?

### 3. Dot "passed but not completed" state

When you skip from section 0 to section 3, sections 1 and 2 are on the path but not completed. Lines turn dark gray (showing the path taken). Should dots also show a "passed" state (e.g., slightly different shade)? Currently they stay light gray. This seems fine — lines show the path, dots show individual completion — but worth confirming.

### 4. Implementation approach

Two options for building reachable sets:
- **Precompute:** Build `reachable: number[]` for every segment in `layoutColors`. Simple, explicit, but O(n) per segment.
- **Lazy/structural:** Use the layout structure to infer reachability. Trunk segments: `currentSectionIndex >= segmentDestination`. Branch segments: membership check. Shared stems: either condition. Same result, less memory, but back to two code paths (which is what we're trying to avoid).

Recommendation: precompute for clarity, even if slightly more memory. The number of segments is small (typically <20).

### 5. Scope

Should both `StageProgressBar` (horizontal) and `ModuleOverview` (vertical) share the same color computation, or is it enough to align their logic? They could share a `computeSegmentColors(layout, completedStages, currentSectionIndex)` utility that returns colors for all segments, which both components consume.

## Key Files

- `web_frontend/src/components/module/StageProgressBar.tsx` — horizontal bar
- `web_frontend/src/components/course/ModuleOverview.tsx` — vertical list
- `web_frontend/src/utils/stageProgress.ts` — shared dot styling (getCircleFillClasses, getRingClasses)
- `web_frontend/src/utils/branchLayout.ts` — shared layout grouping (buildBranchLayout)
- `web_frontend/src/utils/__tests__/branchLayout.test.ts` — layout tests (5 tests, all passing)
