# Branch Subscription Color Model — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the fragmented progress-bar color logic with the unified branch subscription model described in `docs/plans/2026-02-12-progress-bar-color-model.md`.

**Architecture:** Every path through the content is a "branch" (trunk included). Line segments subscribe to branches and check `branch.state > previousIndex` to determine color. One shared utility (`branchColors.ts`) computes all colors, consumed by both `StageProgressBar` (horizontal) and `ModuleOverview` (vertical). Dot colors are unchanged — they use their own per-section state.

**Tech Stack:** TypeScript, React 19, Tailwind CSS v4, Vitest

---

## Reference example

Used throughout this plan. Stages: `[0:req, 1:req, 2:opt, 3:req, 4:req, 5:opt]`

Branch paths:
- A (trunk): `[0, 1, 3, 4]`
- B (first optional): `[0, 1, 2]`
- C (second optional): `[0, 1, 3, 4, 5]`

---

### Task 1: `buildBranchPaths` — tests and implementation

**Files:**
- Create: `web_frontend/src/utils/branchColors.ts`
- Create: `web_frontend/src/utils/__tests__/branchColors.test.ts`

This function takes a flat stages array and returns one `number[]` per branch: the trunk branch (all required indices), plus one branch per consecutive optional group (trunk prefix up to fork point + optional indices).

**Step 1: Write the failing tests**

```ts
// web_frontend/src/utils/__tests__/branchColors.test.ts
import { describe, it, expect } from "vitest";
import { buildBranchPaths } from "../branchColors";

function stages(...pattern: ("r" | "o")[]): { optional: boolean }[] {
  return pattern.map((p) => ({ optional: p === "o" }));
}

describe("buildBranchPaths", () => {
  it("returns only trunk for all-required stages", () => {
    const paths = buildBranchPaths(stages("r", "r", "r"));
    expect(paths).toEqual([[0, 1, 2]]);
  });

  it("creates trunk + one branch for a mid-sequence optional", () => {
    // [0:req, 1:req, 2:opt, 3:req, 4:req, 5:opt]
    const paths = buildBranchPaths(stages("r", "r", "o", "r", "r", "o"));
    expect(paths).toEqual([
      [0, 1, 3, 4],       // trunk
      [0, 1, 2],           // branch B (prefix 0,1 + optional 2)
      [0, 1, 3, 4, 5],    // branch C (prefix 0,1,3,4 + optional 5)
    ]);
  });

  it("handles optional at the start (no trunk prefix)", () => {
    const paths = buildBranchPaths(stages("o", "r", "r"));
    expect(paths).toEqual([
      [1, 2],  // trunk (required only)
      [0],     // branch (no trunk prefix before it, just the optional)
    ]);
  });

  it("handles optional at the end", () => {
    const paths = buildBranchPaths(stages("r", "r", "o"));
    expect(paths).toEqual([
      [0, 1],      // trunk
      [0, 1, 2],   // branch (full trunk prefix + optional)
    ]);
  });

  it("handles consecutive optionals as one branch", () => {
    const paths = buildBranchPaths(stages("r", "o", "o", "r"));
    expect(paths).toEqual([
      [0, 3],         // trunk
      [0, 1, 2],      // branch (prefix [0] + optionals [1,2])
    ]);
  });

  it("handles all-optional stages", () => {
    const paths = buildBranchPaths(stages("o", "o"));
    expect(paths).toEqual([
      [],       // trunk (empty — no required stages)
      [0, 1],   // one branch with all optionals
    ]);
  });

  it("returns trunk-only for empty stages", () => {
    const paths = buildBranchPaths([]);
    expect(paths).toEqual([[]]);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd web_frontend && npx vitest run src/utils/__tests__/branchColors.test.ts`
Expected: FAIL — module `branchColors` doesn't exist yet

**Step 3: Write minimal implementation**

```ts
// web_frontend/src/utils/branchColors.ts

/**
 * Branch subscription color model for progress indicators.
 *
 * See docs/plans/2026-02-12-progress-bar-color-model.md for full design.
 */

/**
 * Build branch paths from a flat stages array.
 *
 * Returns one number[] per branch:
 * - paths[0] = trunk (all required section indices)
 * - paths[1..n] = one per consecutive optional group
 *   (trunk prefix up to the fork point + the optional indices)
 *
 * "Trunk prefix" = all required indices that precede this optional group.
 */
export function buildBranchPaths(
  stages: { optional: boolean }[],
): number[][] {
  const trunk: number[] = [];
  const branches: number[][] = [];

  let i = 0;
  while (i < stages.length) {
    if (stages[i].optional) {
      // Collect consecutive optionals
      const optionals: number[] = [];
      while (i < stages.length && stages[i].optional) {
        optionals.push(i);
        i++;
      }
      // Branch = trunk prefix (all required indices so far) + these optionals
      branches.push([...trunk, ...optionals]);
    } else {
      trunk.push(i);
      i++;
    }
  }

  return [trunk, ...branches];
}
```

**Step 4: Run tests to verify they pass**

Run: `cd web_frontend && npx vitest run src/utils/__tests__/branchColors.test.ts`
Expected: All 7 tests PASS

**Step 5: Commit**

```
feat: add buildBranchPaths utility for branch subscription color model
```

---

### Task 2: `computeBranchStates` — tests and implementation

**Files:**
- Modify: `web_frontend/src/utils/branchColors.ts`
- Modify: `web_frontend/src/utils/__tests__/branchColors.test.ts`

This function takes branch paths + progress data and returns per-branch `{ selected, highestCompleted }`.

**Step 1: Write the failing tests**

Add to `branchColors.test.ts`:

```ts
import { buildBranchPaths, computeBranchStates } from "../branchColors";

describe("computeBranchStates", () => {
  // Reference: [0:req, 1:req, 2:opt, 3:req, 4:req, 5:opt]
  const paths = buildBranchPaths(stages("r", "r", "o", "r", "r", "o"));
  // paths = [[0,1,3,4], [0,1,2], [0,1,3,4,5]]

  it("returns -1 for everything when nothing selected or completed", () => {
    const states = computeBranchStates(paths, new Set(), -1);
    expect(states).toEqual([
      { selected: -1, highestCompleted: -1 },
      { selected: -1, highestCompleted: -1 },
      { selected: -1, highestCompleted: -1 },
    ]);
  });

  it("sets selected on all branches containing the viewed section", () => {
    // Viewing section 1 (in all three branches)
    const states = computeBranchStates(paths, new Set(), 1);
    expect(states).toEqual([
      { selected: 1, highestCompleted: -1 },
      { selected: 1, highestCompleted: -1 },
      { selected: 1, highestCompleted: -1 },
    ]);
  });

  it("sets selected only on the branch containing the viewed section", () => {
    // Viewing section 2 (only in branch B)
    const states = computeBranchStates(paths, new Set(), 2);
    expect(states).toEqual([
      { selected: -1, highestCompleted: -1 },  // A: 2 not in [0,1,3,4]
      { selected: 2, highestCompleted: -1 },   // B: 2 in [0,1,2]
      { selected: -1, highestCompleted: -1 },   // C: 2 not in [0,1,3,4,5]
    ]);
  });

  it("computes highestCompleted per branch", () => {
    // Completed sections 0 and 5
    const states = computeBranchStates(paths, new Set([0, 5]), 1);
    expect(states).toEqual([
      { selected: 1, highestCompleted: 0 },   // A: only 0 in trunk
      { selected: 1, highestCompleted: 0 },   // B: only 0 in branch B
      { selected: 1, highestCompleted: 5 },   // C: 0 and 5 both in branch C
    ]);
  });

  it("ignores completed sections not in the branch", () => {
    // Completed section 2 (only in branch B)
    const states = computeBranchStates(paths, new Set([2]), 3);
    expect(states).toEqual([
      { selected: 3, highestCompleted: -1 },  // A: 2 not in trunk
      { selected: -1, highestCompleted: 2 },  // B: 2 in B, but 3 not in B
      { selected: 3, highestCompleted: -1 },  // C: 2 not in C
    ]);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd web_frontend && npx vitest run src/utils/__tests__/branchColors.test.ts`
Expected: FAIL — `computeBranchStates` not exported

**Step 3: Write minimal implementation**

Add to `branchColors.ts`:

```ts
export type BranchState = {
  selected: number;        // currently viewed index in this branch, or -1
  highestCompleted: number; // highest completed index in this branch, or -1
};

/**
 * Compute per-branch state from progress data.
 *
 * For each branch path, checks which sections are selected/completed
 * and returns the relevant indices (scoped to that branch's sections).
 */
export function computeBranchStates(
  paths: number[][],
  completedStages: Set<number>,
  currentSectionIndex: number,
): BranchState[] {
  return paths.map((path) => {
    const pathSet = new Set(path);
    const selected = pathSet.has(currentSectionIndex) ? currentSectionIndex : -1;
    let highestCompleted = -1;
    for (const idx of path) {
      if (completedStages.has(idx) && idx > highestCompleted) {
        highestCompleted = idx;
      }
    }
    return { selected, highestCompleted };
  });
}
```

**Step 4: Run tests to verify they pass**

Run: `cd web_frontend && npx vitest run src/utils/__tests__/branchColors.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```
feat: add computeBranchStates for branch subscription color model
```

---

### Task 3: `getSegmentColor` — tests and implementation

**Files:**
- Modify: `web_frontend/src/utils/branchColors.ts`
- Modify: `web_frontend/src/utils/__tests__/branchColors.test.ts`

The unified color function: `branch.highestCompleted > prev` → blue, `branch.selected > prev` → gray, else light.

**Step 1: Write the failing tests**

Add to `branchColors.test.ts`:

```ts
import {
  buildBranchPaths,
  computeBranchStates,
  getSegmentColor,
  type BranchState,
} from "../branchColors";

describe("getSegmentColor", () => {
  it("returns light when no branches have activity past previousIndex", () => {
    const states: BranchState[] = [
      { selected: -1, highestCompleted: -1 },
    ];
    expect(getSegmentColor(0, states)).toBe("bg-gray-200");
  });

  it("returns gray when a branch has selected > previousIndex", () => {
    const states: BranchState[] = [
      { selected: 3, highestCompleted: -1 },
    ];
    expect(getSegmentColor(1, states)).toBe("bg-gray-400");
  });

  it("returns blue when a branch has highestCompleted > previousIndex", () => {
    const states: BranchState[] = [
      { selected: -1, highestCompleted: 5 },
    ];
    expect(getSegmentColor(1, states)).toBe("bg-blue-400");
  });

  it("blue wins over gray", () => {
    const states: BranchState[] = [
      { selected: 3, highestCompleted: -1 },
      { selected: -1, highestCompleted: 5 },
    ];
    expect(getSegmentColor(1, states)).toBe("bg-blue-400");
  });

  it("checks > not >=", () => {
    const states: BranchState[] = [
      { selected: 3, highestCompleted: -1 },
    ];
    // selected(3) > previousIndex(3) is false
    expect(getSegmentColor(3, states)).toBe("bg-gray-200");
  });

  it("returns light for empty branch list", () => {
    expect(getSegmentColor(0, [])).toBe("bg-gray-200");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd web_frontend && npx vitest run src/utils/__tests__/branchColors.test.ts`
Expected: FAIL — `getSegmentColor` not exported

**Step 3: Write minimal implementation**

Add to `branchColors.ts`:

```ts
export type SegmentColor = "bg-blue-400" | "bg-gray-400" | "bg-gray-200";

/**
 * Unified color function for line segments.
 *
 * Checks whether any subscribed branch has completed/selected state
 * past the given previousIndex. Blue (completed) wins over gray (selected).
 */
export function getSegmentColor(
  previousIndex: number,
  subscribedBranches: BranchState[],
): SegmentColor {
  if (subscribedBranches.some((b) => b.highestCompleted > previousIndex))
    return "bg-blue-400";
  if (subscribedBranches.some((b) => b.selected > previousIndex))
    return "bg-gray-400";
  return "bg-gray-200";
}
```

**Step 4: Run tests to verify they pass**

Run: `cd web_frontend && npx vitest run src/utils/__tests__/branchColors.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```
feat: add getSegmentColor for branch subscription color model
```

---

### Task 4: `computeLayoutColors` — tests and implementation

**Files:**
- Modify: `web_frontend/src/utils/branchColors.ts`
- Modify: `web_frontend/src/utils/__tests__/branchColors.test.ts`

This is the high-level function that takes a layout + branch paths/states and returns per-element colors. It encapsulates the subscription-assignment logic so both components can consume it.

Return type per layout item:
- Trunk: `{ kind: "trunk", connectorColor, outgoingColor }` — `connectorColor` = incoming (used by both components), `outgoingColor` = bottom connector (vertical component)
- Branch: `{ kind: "branch", passColor, branchColor }` — `passColor` = shared stem / trunk continuity, `branchColor` = arc + dotted connectors

**Subscription rules** (internal to this function):

| Segment | previousIndex | Subscribed branches |
|---------|---------------|---------------------|
| Trunk connector into item N (prevTrunk=P) | P | branches containing both P and N |
| Trunk outgoing from item N | N | all branches containing N with any index > N |
| Pass-through over branch group (prevTrunk=P) | P | all branches containing P with any index > P |
| Branch arc/connectors (prevTrunk=P) | P | branches containing any of the branch group's item indices |

**Step 1: Write the failing tests**

Add to `branchColors.test.ts`:

```ts
import {
  buildBranchPaths,
  computeBranchStates,
  getSegmentColor,
  computeLayoutColors,
  type BranchState,
} from "../branchColors";
import { buildBranchLayout } from "../branchLayout";
import type { StageInfo } from "../../types/course";

function stageInfo(title: string, optional = false): StageInfo {
  return { type: "article", title, duration: null, optional };
}

describe("computeLayoutColors", () => {
  // Reference: [0:req, 1:req, 2:opt, 3:req, 4:req, 5:opt]
  const stageList = [
    stageInfo("S0"),
    stageInfo("S1"),
    stageInfo("S2", true),
    stageInfo("S3"),
    stageInfo("S4"),
    stageInfo("S5", true),
  ];
  const layout = buildBranchLayout(stageList);
  // layout = [trunk(0), trunk(1), branch([2]), trunk(3), trunk(4), branch([5])]
  const paths = buildBranchPaths(
    stageList.map((s) => ({ optional: s.optional })),
  );
  // paths = [[0,1,3,4], [0,1,2], [0,1,3,4,5]]

  it("viewing trunk(3), nothing completed", () => {
    const states = computeBranchStates(paths, new Set(), 3);
    const colors = computeLayoutColors(layout, paths, states);

    // Trunk 0: first item, no incoming → default light; outgoing → segment 0→1
    expect(colors[0]).toMatchObject({ kind: "trunk", connectorColor: "bg-gray-200" });
    // outgoing: prev=0, [A,B,C] — A.selected=3, 3>0 → gray
    expect((colors[0] as any).outgoingColor).toBe("bg-gray-400");

    // Trunk 1: connector = segment 0→1 (prev=0, [A,B,C]) → gray
    expect(colors[1]).toMatchObject({ kind: "trunk", connectorColor: "bg-gray-400" });
    // outgoing: prev=1, [A,B,C] — A.selected=3, 3>1 → gray (shared stem)
    expect((colors[1] as any).outgoingColor).toBe("bg-gray-400");

    // Branch group [2]: pass=shared stem (prev=1, [A,B,C]) → gray; branch=[B] → light
    expect(colors[2]).toMatchObject({
      kind: "branch",
      passColor: "bg-gray-400",
      branchColor: "bg-gray-200",
    });

    // Trunk 3: connector = segment →3 (prev=1, [A,C]) — A.selected=3, 3>1 → gray
    expect(colors[3]).toMatchObject({ kind: "trunk", connectorColor: "bg-gray-400" });
    // outgoing: prev=3, [A,C] — A.selected=3, 3>3 → NO → light
    expect((colors[3] as any).outgoingColor).toBe("bg-gray-200");

    // Trunk 4: connector = segment 3→4 (prev=3, [A,C]) → light
    expect(colors[4]).toMatchObject({ kind: "trunk", connectorColor: "bg-gray-200" });
    // outgoing: prev=4, [C] — A.selected=3, 3>4 → NO; C has no selected → light
    expect((colors[4] as any).outgoingColor).toBe("bg-gray-200");

    // Branch group [5]: pass = trailing stub (prev=4, [C]) → light; branch=[C] → light
    expect(colors[5]).toMatchObject({
      kind: "branch",
      passColor: "bg-gray-200",
      branchColor: "bg-gray-200",
    });
  });

  it("viewing branch(2), nothing completed", () => {
    const states = computeBranchStates(paths, new Set(), 2);
    const colors = computeLayoutColors(layout, paths, states);

    // Connector 0→1 (prev=0, [A,B,C]): B.selected=2, 2>0 → gray
    expect((colors[1] as any).connectorColor).toBe("bg-gray-400");
    // Shared stem (prev=1, [A,B,C]): B.selected=2, 2>1 → gray (stem bug fix!)
    expect((colors[2] as any).passColor).toBe("bg-gray-400");
    // Arc to B (prev=1, [B]): B.selected=2, 2>1 → gray
    expect((colors[2] as any).branchColor).toBe("bg-gray-400");
    // Connector →3 (prev=1, [A,C]): neither selected → light
    expect((colors[3] as any).connectorColor).toBe("bg-gray-200");
    // Connector 3→4 (prev=3, [A,C]): → light
    expect((colors[4] as any).connectorColor).toBe("bg-gray-200");
  });

  it("viewing branch(5), nothing completed", () => {
    const states = computeBranchStates(paths, new Set(), 5);
    const colors = computeLayoutColors(layout, paths, states);

    // Connector 0→1 (prev=0, [A,B,C]): C.selected=5, 5>0 → gray
    expect((colors[1] as any).connectorColor).toBe("bg-gray-400");
    // Shared stem (prev=1, [A,B,C]): C.selected=5, 5>1 → gray
    expect((colors[2] as any).passColor).toBe("bg-gray-400");
    // Arc to B (prev=1, [B]): B.selected=-1 → light
    expect((colors[2] as any).branchColor).toBe("bg-gray-200");
    // Connector →3 (prev=1, [A,C]): C.selected=5, 5>1 → gray
    expect((colors[3] as any).connectorColor).toBe("bg-gray-400");
    // Connector 3→4 (prev=3, [A,C]): C.selected=5, 5>3 → gray
    expect((colors[4] as any).connectorColor).toBe("bg-gray-400");
    // Trailing stub (prev=4, [C]): C.selected=5, 5>4 → gray
    expect((colors[5] as any).passColor).toBe("bg-gray-400");
    // Arc to C (prev=4, [C]): C.selected=5, 5>4 → gray
    expect((colors[5] as any).branchColor).toBe("bg-gray-400");
  });

  it("handles leading optional branch group (no preceding trunk)", () => {
    // [0:opt, 1:req, 2:req]
    const leadingStages = [
      stageInfo("S0", true),
      stageInfo("S1"),
      stageInfo("S2"),
    ];
    const leadingLayout = buildBranchLayout(leadingStages);
    // layout = [branch([0]), trunk(1), trunk(2)]
    const leadingPaths = buildBranchPaths(
      leadingStages.map((s) => ({ optional: s.optional })),
    );
    // paths = [[1,2], [0]]

    // Viewing the optional item
    const s = computeBranchStates(leadingPaths, new Set(), 0);
    const c = computeLayoutColors(leadingLayout, leadingPaths, s);

    // Leading branch group: no prevTrunk → default light for both
    expect(c[0]).toMatchObject({
      kind: "branch",
      passColor: "bg-gray-200",
      branchColor: "bg-gray-200",
    });
    // Trunk 1: first trunk, no preceding trunk → connectorColor light
    expect(c[1]).toMatchObject({ kind: "trunk", connectorColor: "bg-gray-200" });
  });

  it("handles all-optional stages", () => {
    // [0:opt, 1:opt]
    const optStages = [stageInfo("S0", true), stageInfo("S1", true)];
    const optLayout = buildBranchLayout(optStages);
    const optPaths = buildBranchPaths(
      optStages.map((s) => ({ optional: s.optional })),
    );
    const s = computeBranchStates(optPaths, new Set(), 0);
    const c = computeLayoutColors(optLayout, optPaths, s);

    // Single branch group, no trunk → all light
    expect(c[0]).toMatchObject({
      kind: "branch",
      passColor: "bg-gray-200",
      branchColor: "bg-gray-200",
    });
  });

  it("section 5 completed, viewing trunk(1)", () => {
    const states = computeBranchStates(paths, new Set([5]), 1);
    const colors = computeLayoutColors(layout, paths, states);

    // Connector 0→1 (prev=0, [A,B,C]): C.highestCompleted=5, 5>0 → blue
    expect((colors[1] as any).connectorColor).toBe("bg-blue-400");
    // Shared stem (prev=1, [A,B,C]): C.highestCompleted=5, 5>1 → blue
    expect((colors[2] as any).passColor).toBe("bg-blue-400");
    // Arc to B (prev=1, [B]): B.selected=1, 1>1 → NO → light
    expect((colors[2] as any).branchColor).toBe("bg-gray-200");
    // Connector →3 (prev=1, [A,C]): C.highestCompleted=5, 5>1 → blue
    expect((colors[3] as any).connectorColor).toBe("bg-blue-400");
    // Connector 3→4 (prev=3, [A,C]): C.highestCompleted=5, 5>3 → blue
    expect((colors[4] as any).connectorColor).toBe("bg-blue-400");
    // Trailing stub (prev=4, [C]): C.highestCompleted=5, 5>4 → blue
    expect((colors[5] as any).passColor).toBe("bg-blue-400");
    // Arc to C (prev=4, [C]): C.highestCompleted=5, 5>4 → blue
    expect((colors[5] as any).branchColor).toBe("bg-blue-400");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd web_frontend && npx vitest run src/utils/__tests__/branchColors.test.ts`
Expected: FAIL — `computeLayoutColors` not exported

**Step 3: Write minimal implementation**

Add to `branchColors.ts`:

```ts
import type { LayoutItem } from "./branchLayout";

type TrunkItemColors = {
  kind: "trunk";
  connectorColor: SegmentColor; // color of connector leading INTO this trunk item
  outgoingColor: SegmentColor;  // color of connector going OUT (vertical uses this)
};

type BranchGroupColors = {
  kind: "branch";
  passColor: SegmentColor;   // trunk continuity / shared stem
  branchColor: SegmentColor; // SVG arc + dotted connectors
};

export type LayoutItemColors = TrunkItemColors | BranchGroupColors;

const DEFAULT_COLOR: SegmentColor = "bg-gray-200";

/**
 * Compute colors for every layout element using branch subscriptions.
 *
 * Each segment subscribes to the branches whose paths traverse it,
 * then calls getSegmentColor(previousIndex, subscribedStates).
 */
export function computeLayoutColors(
  layout: LayoutItem[],
  branchPaths: number[][],
  branchStates: BranchState[],
): LayoutItemColors[] {
  // Precompute Set versions for O(1) membership checks
  const pathSets = branchPaths.map((p) => new Set(p));

  // Helper: get states for branches whose path satisfies a predicate
  function subscribedStates(
    pred: (pathSet: Set<number>, pathArr: number[]) => boolean,
  ): BranchState[] {
    const result: BranchState[] = [];
    for (let i = 0; i < branchPaths.length; i++) {
      if (pred(pathSets[i], branchPaths[i])) {
        result.push(branchStates[i]);
      }
    }
    return result;
  }

  let prevTrunkIndex = -1;

  return layout.map((item) => {
    if (item.kind === "trunk") {
      const thisIndex = item.index;

      // Incoming connector: branches containing both prevTrunk and thisIndex
      const connectorColor =
        prevTrunkIndex >= 0
          ? getSegmentColor(
              prevTrunkIndex,
              subscribedStates(
                (s) => s.has(prevTrunkIndex) && s.has(thisIndex),
              ),
            )
          : DEFAULT_COLOR;

      // Outgoing connector: branches containing thisIndex with any member > thisIndex
      const outgoingColor = getSegmentColor(
        thisIndex,
        subscribedStates(
          (s, arr) => s.has(thisIndex) && arr.some((idx) => idx > thisIndex),
        ),
      );

      prevTrunkIndex = thisIndex;
      return { kind: "trunk" as const, connectorColor, outgoingColor };
    } else {
      // Branch group
      const branchIndices = new Set(item.items.map((bi) => bi.index));

      // Pass-through (shared stem): branches containing prevTrunk with any index > prevTrunk
      const passColor =
        prevTrunkIndex >= 0
          ? getSegmentColor(
              prevTrunkIndex,
              subscribedStates(
                (s, arr) =>
                  s.has(prevTrunkIndex) &&
                  arr.some((idx) => idx > prevTrunkIndex),
              ),
            )
          : DEFAULT_COLOR;

      // Branch arcs/connectors: branches whose path includes any branch-group item
      const branchColor =
        prevTrunkIndex >= 0
          ? getSegmentColor(
              prevTrunkIndex,
              subscribedStates((s) =>
                item.items.some((bi) => s.has(bi.index)),
              ),
            )
          : DEFAULT_COLOR;

      return { kind: "branch" as const, passColor, branchColor };
    }
  });
}
```

**Step 4: Run tests to verify they pass**

Run: `cd web_frontend && npx vitest run src/utils/__tests__/branchColors.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```
feat: add computeLayoutColors — complete branch subscription color utility
```

---

### Task 5: Replace color logic in `StageProgressBar.tsx`

**Files:**
- Modify: `web_frontend/src/components/module/StageProgressBar.tsx:1-15` (imports)
- Modify: `web_frontend/src/components/module/StageProgressBar.tsx:112-196` (color logic block)

Replace the old `getBarColor` + `layoutColors` computation with the new branch subscription utility.

**Step 1: Update imports**

Replace:
```ts
import {
  getHighestCompleted,
  getCircleFillClasses,
  getRingClasses,
} from "../../utils/stageProgress";
```

With:
```ts
import {
  getCircleFillClasses,
  getRingClasses,
} from "../../utils/stageProgress";
import {
  buildBranchPaths,
  computeBranchStates,
  computeLayoutColors,
} from "../../utils/branchColors";
```

**Step 2: Replace the color computation block**

Remove these lines (approx 112–196) as one contiguous block:
- `const highestCompleted = ...` (line ~113)
- The entire `getBarColor` function (lines ~120–126)
- The entire `const layoutColors = layout.map(...)` block (lines ~153–183) — this includes the `passColor`/`branchColor` computation and the `getBarColor(nextTrunkIndex)` call at line ~166; all of these go away together
- The `branchColorMap` and `borderColorMap` objects (lines ~186–196)

Replace with:

```ts
  // Branch subscription color model
  const branchPaths = useMemo(
    () =>
      buildBranchPaths(stages.map((s) => ({ optional: s.optional ?? false }))),
    [stages],
  );
  const branchStates = useMemo(
    () => computeBranchStates(branchPaths, completedStages, currentSectionIndex),
    [branchPaths, completedStages, currentSectionIndex],
  );
  const layoutColors = useMemo(
    () => computeLayoutColors(layout, branchPaths, branchStates),
    [layout, branchPaths, branchStates],
  );

  // Static color mappings for Tailwind CSS v4 scanner
  const branchColorMap: Record<string, { text: string; border: string }> = {
    "bg-blue-400": { text: "text-blue-400", border: "border-blue-400" },
    "bg-gray-400": { text: "text-gray-400", border: "border-gray-400" },
    "bg-gray-200": { text: "text-gray-200", border: "border-gray-200" },
  };

  const borderColorMap: Record<string, string> = {
    "bg-blue-400": "border-blue-400",
    "bg-gray-400": "border-gray-400",
    "bg-gray-200": "border-gray-200",
  };
```

**Step 3: Update trunk connector color reference**

In the trunk item rendering (around line 386), change:

```tsx
{li > 0 && (
  <div
    className={`h-0.5 ${compact ? "w-4" : "w-2 sm:w-4"} ${getBarColor(index)}`}
  />
)}
```

To:

```tsx
{li > 0 && (
  <div
    className={`h-0.5 ${compact ? "w-4" : "w-2 sm:w-4"} ${
      layoutColors[li].kind === "trunk" ? layoutColors[li].connectorColor : "bg-gray-200"
    }`}
  />
)}
```

**Step 4: Update branch group color extraction**

In the branch group rendering, the `passColor` and `branchColor` are already extracted from `layoutColors[li]`. Verify the destructuring still works:

```tsx
const colors = layoutColors[li];
const passColor = colors.kind === "branch" ? colors.passColor : "bg-gray-200";
const branchColor = colors.kind === "branch" ? colors.branchColor : "bg-gray-200";
```

This should work as-is since the shape is the same.

**Step 5: Run all tests, lint, and build**

Run: `cd web_frontend && npx vitest run && npm run lint && npm run build`
Expected: All tests PASS, no lint or build errors

**Step 6: Commit**

```
refactor: replace StageProgressBar color logic with branch subscriptions
```

---

### Task 6: Replace color logic in `ModuleOverview.tsx`

**Files:**
- Modify: `web_frontend/src/components/course/ModuleOverview.tsx:1-17` (imports)
- Modify: `web_frontend/src/components/course/ModuleOverview.tsx:44-122` (color logic block)

Same pattern as Task 5 but for the vertical component.

**Step 1: Update imports**

Replace:
```ts
import {
  getHighestCompleted,
  getCircleFillClasses,
  getRingClasses,
} from "../../utils/stageProgress";
```

With:
```ts
import {
  getCircleFillClasses,
  getRingClasses,
} from "../../utils/stageProgress";
import {
  buildBranchPaths,
  computeBranchStates,
  computeLayoutColors,
} from "../../utils/branchColors";
```

**Step 2: Replace the color computation block**

Remove these lines (approx 44–122):
- `const highestCompleted = ...`
- `const viewingIsAdjacent = ...`
- `const blueEndIndex = ...`
- The entire `getLineColor` function
- The `lastTrunkLi` computation
- The `borderColorMap` object
- `let prevTrunkIndex = -1;`
- The entire `const layoutColors = layout.map(...)` block

Replace with:

```ts
  // Branch subscription color model
  const branchPaths = useMemo(
    () => buildBranchPaths(stages.map((s) => ({ optional: s.optional }))),
    [stages],
  );
  const branchStates = useMemo(
    () => computeBranchStates(branchPaths, completedStages, currentSectionIndex),
    [branchPaths, completedStages, currentSectionIndex],
  );
  const layoutColors = useMemo(
    () => computeLayoutColors(layout, branchPaths, branchStates),
    [layout, branchPaths, branchStates],
  );

  // Index of the last trunk item in the layout
  const lastTrunkLi = (() => {
    for (let i = layout.length - 1; i >= 0; i--) {
      if (layout[i].kind === "trunk") return i;
    }
    return -1;
  })();

  // Static mapping so Tailwind's scanner sees full class names
  const borderColorMap: Record<string, string> = {
    "bg-blue-400": "border-blue-400",
    "bg-gray-400": "border-gray-400",
    "bg-gray-200": "border-gray-200",
  };
```

**Step 3: Update trunk item rendering to use new color fields**

In the trunk rendering block, replace references to the old color fields:

```tsx
if (item.kind === "trunk" && colors.kind === "trunk") {
  const trailsIntoBranchOnly = li === lastTrunkLi && !isLast;
  return (
    <div key={li} className="relative">
      {/* Top connector */}
      {!isFirst && (
        <div
          className={`absolute left-[0.875rem] top-0 bottom-1/2 w-0.5 -translate-x-1/2 z-[1] ${colors.connectorColor}`}
        />
      )}
      {/* Bottom connector */}
      {!isLast && (
        trailsIntoBranchOnly ? (
          <div
            className={`absolute left-[0.875rem] top-1/2 bottom-0 -translate-x-1/2 z-[1] border-l-2 border-dotted ${borderColorMap[colors.outgoingColor] ?? "border-gray-200"}`}
          />
        ) : (
          <div
            className={`absolute left-[0.875rem] top-1/2 bottom-0 w-0.5 -translate-x-1/2 z-[1] ${colors.outgoingColor}`}
          />
        )
      )}
      {renderStageRow(item.stage, item.index)}
    </div>
  );
}
```

The key changes:
- `colors.incomingColor` → `colors.connectorColor`
- `colors.ownColor` → `colors.outgoingColor`

**Step 4: Verify branch group rendering still works**

The branch group rendering already destructures `colors.passColor` and `colors.branchColor`. The shape matches the new return type. No changes needed.

**Step 5: Run all tests, lint, and build**

Run: `cd web_frontend && npx vitest run && npm run lint && npm run build`
Expected: All tests PASS, no lint or build errors

**Step 6: Commit**

```
refactor: replace ModuleOverview color logic with branch subscriptions
```

---

### Task 7: Clean up dead code

**Files:**
- Modify: `web_frontend/src/utils/stageProgress.ts`

**Step 1: Check if `getHighestCompleted` is still referenced**

Search for `getHighestCompleted` across the codebase. After Tasks 5 and 6, neither component should import it.

**Step 2: Remove `getHighestCompleted` if unreferenced**

Remove the function and its export from `stageProgress.ts`.

**Step 3: Run all tests**

Run: `cd web_frontend && npx vitest run`
Expected: All tests PASS (branchLayout tests + new branchColors tests)

**Step 4: Run lint and build**

Run: `cd web_frontend && npm run lint && npm run build`
Expected: No errors

**Step 5: Commit**

```
refactor: remove unused getHighestCompleted from stageProgress
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | `buildBranchPaths` | `branchColors.ts`, test |
| 2 | `computeBranchStates` | `branchColors.ts`, test |
| 3 | `getSegmentColor` | `branchColors.ts`, test |
| 4 | `computeLayoutColors` | `branchColors.ts`, test |
| 5 | Replace `StageProgressBar` colors | `StageProgressBar.tsx` |
| 6 | Replace `ModuleOverview` colors | `ModuleOverview.tsx` |
| 7 | Remove dead code | `stageProgress.ts` |

Total new file: 1 (`branchColors.ts`). Total new test file: 1 (`branchColors.test.ts`). Modified files: 3.
