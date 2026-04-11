# Completion-Backed Reach — Blue Line to Current Section

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the segment coloring so the line from the last completed section to the currently viewed section is blue (not gray), matching standard progress-stepper UX.

**Architecture:** Change `getSegmentColor` in `branchColors.ts` from strict `highestCompleted > previousIndex` to a "completion-backed reach" rule: blue if the previous point is completed (`highestCompleted >= previousIndex`) AND the user has progressed past it (`max(highestCompleted, selected) > previousIndex`). The gray tier survives for "viewing ahead without completion backing." No changes to components — only the shared color function changes.

**Tech Stack:** TypeScript, Vitest

---

## Background

The bug: stages `[0, 1, 2, 3]` all required. Sections 0 and 1 completed. Viewing section 2. The line from 1→2 is gray because `highestCompleted(1) > previousIndex(1)` is false (strict `>`). It should be blue because section 1 is completed and the user has progressed past it to section 2.

The fix adds one condition to `getSegmentColor`: when `highestCompleted == previousIndex` (you're AT the completion frontier), the segment going forward is blue IF `selected > previousIndex` (you've reached past it). This subsumes the original `highestCompleted > previousIndex` check, so the implementation simplifies to a single blue condition.

**New rule:**
```
blue:  highestCompleted >= previousIndex AND max(highestCompleted, selected) > previousIndex
gray:  selected > previousIndex (no completion backing)
light: nothing past this point
```

**No existing tests change.** All existing test scenarios either have no completions (hc=-1, never triggers `>=`) or have completions far past previousIndex (already `>`). The new condition only fires when `hc == previousIndex`, which no existing test exercises.

---

### Task 1: Add failing tests to `getSegmentColor`

**Files:**
- Modify: `web_frontend/src/utils/__tests__/branchColors.test.ts:135-176` (getSegmentColor describe block)

**Step 1: Add test for completion-backed reach (the core bug)**

Add after the "blue wins over gray" test (line 163), before the "checks > not >=" test:

```ts
  it("returns blue when highestCompleted equals previousIndex and selected is past", () => {
    // Bug scenario: completed section 1, viewing section 2
    // Line from 1→2 should be blue (completion-backed reach)
    const states: BranchState[] = [
      { selected: 2, highestCompleted: 1 },
    ];
    expect(getSegmentColor(1, states)).toBe("bg-blue-400");
  });

  it("returns light when highestCompleted equals previousIndex but nothing past it", () => {
    // Completed section 1, not viewing anything further
    const states: BranchState[] = [
      { selected: 1, highestCompleted: 1 },
    ];
    expect(getSegmentColor(1, states)).toBe("bg-gray-200");
  });

  it("returns light when highestCompleted equals previousIndex and selected is before", () => {
    // Completed section 1, viewing section 0 (went back)
    const states: BranchState[] = [
      { selected: 0, highestCompleted: 1 },
    ];
    expect(getSegmentColor(1, states)).toBe("bg-gray-200");
  });

  it("requires both conditions on the same branch for blue", () => {
    // Branch A has reach (selected ahead) but no completion backing
    // Branch B has completion at frontier but no reach past it
    // Neither alone satisfies both conditions → no blue
    const states: BranchState[] = [
      { selected: 3, highestCompleted: -1 },
      { selected: -1, highestCompleted: 1 },
    ];
    // Branch A: hc(-1) >= 1 → false
    // Branch B: hc(1) >= 1 → true, max(1, -1) = 1 > 1 → false
    // Result: gray (from Branch A's selected(3) > 1)
    expect(getSegmentColor(1, states)).toBe("bg-gray-400");
  });
```

**Step 2: Run tests to verify they fail**

Run: `cd /home/penguin/code/lens-platform/ws3/web_frontend && npx vitest run src/utils/__tests__/branchColors.test.ts`

Expected: First new test FAILS (returns `bg-gray-400` instead of `bg-blue-400`). Other three new tests PASS (they expect light/gray, which is the current behavior).

**Step 3: Commit**

```
jj describe -m "test: add failing tests for completion-backed reach coloring"
```

---

### Task 2: Add failing integration test to `computeLayoutColors`

**Files:**
- Modify: `web_frontend/src/utils/__tests__/branchColors.test.ts:178-360` (computeLayoutColors describe block)

**Step 1: Add test for "completed sections 0,1 — viewing section 2"**

Add after the "section 5 completed, viewing trunk(1)" test (line 325), before the "colors intra-branch connectors" test:

```ts
  it("completed 0,1 viewing trunk(2) — line to current is blue", () => {
    // Simple all-required: [0:req, 1:req, 2:req, 3:req]
    const simpleStages = [
      stageInfo("S0"),
      stageInfo("S1"),
      stageInfo("S2"),
      stageInfo("S3"),
    ];
    const simpleLayout = buildBranchLayout(simpleStages);
    const simplePaths = buildBranchPaths(
      simpleStages.map((s) => ({ optional: s.optional })),
    );
    // paths = [[0,1,2,3]] (one trunk, no branches)

    const states = computeBranchStates(simplePaths, new Set([0, 1]), 2);
    // state = [{ selected: 2, highestCompleted: 1 }]
    const colors = computeLayoutColors(simpleLayout, simplePaths, states);

    // Trunk 0: no incoming; outgoing (prev=0): hc(1)>=0, max(1,2)>0 → blue
    expect(colors[0]).toMatchObject({ kind: "trunk", connectorColor: "bg-gray-200" });
    expect(asRecord(colors[0]).outgoingColor).toBe("bg-blue-400");

    // Trunk 1: connector 0→1 (prev=0): hc(1)>=0, max(1,2)>0 → blue
    expect(asRecord(colors[1]).connectorColor).toBe("bg-blue-400");
    // outgoing (prev=1): hc(1)>=1, max(1,2)=2>1 → blue (THE KEY FIX)
    expect(asRecord(colors[1]).outgoingColor).toBe("bg-blue-400");

    // Trunk 2: connector 1→2 (prev=1): hc(1)>=1, max(1,2)=2>1 → blue
    expect(asRecord(colors[2]).connectorColor).toBe("bg-blue-400");
    // outgoing (prev=2): hc(1)>=2? NO → selected(2)>2? NO → light
    expect(asRecord(colors[2]).outgoingColor).toBe("bg-gray-200");

    // Trunk 3: connector 2→3 (prev=2): → light
    expect(asRecord(colors[3]).connectorColor).toBe("bg-gray-200");
  });
```

**Step 2: Add test for "completed trunk, viewing branch — blue into branch"**

Add immediately after the previous test:

```ts
  it("completed 0,1 viewing branch(2) — blue extends into branch", () => {
    // [0:req, 1:req, 2:opt, 3:req]
    const branchStages = [
      stageInfo("S0"),
      stageInfo("S1"),
      stageInfo("S2", true),
      stageInfo("S3"),
    ];
    const branchLayout = buildBranchLayout(branchStages);
    // layout = [trunk(0), trunk(1), branch([2]), trunk(3)]
    const branchPathsLocal = buildBranchPaths(
      branchStages.map((s) => ({ optional: s.optional })),
    );
    // paths = [[0, 1, 3], [0, 1, 2]]

    const states = computeBranchStates(branchPathsLocal, new Set([0, 1]), 2);
    // trunk: { selected: -1, highestCompleted: 1 }
    // branch B: { selected: 2, highestCompleted: 1 }
    const colors = computeLayoutColors(branchLayout, branchPathsLocal, states);

    // Trunk 0 outgoing (prev=0): both branches have hc(1)>=0, max(1,?)>0 → blue
    expect(asRecord(colors[0]).outgoingColor).toBe("bg-blue-400");

    // Trunk 1 connector (prev=0) → blue
    expect(asRecord(colors[1]).connectorColor).toBe("bg-blue-400");
    // Trunk 1 outgoing (prev=1): trunk has hc(1)>=1, max(1,-1)=1>1→NO;
    //   branch B has hc(1)>=1, max(1,2)=2>1→YES → blue
    expect(asRecord(colors[1]).outgoingColor).toBe("bg-blue-400");

    // Branch group: pass (prev=1, subscribed=[trunk] containing 1 AND 3):
    //   trunk: hc(1)>=1, max(1,-1)=1>1→NO → gray? selected(-1)>1→NO → light
    //   Wait: this only subscribes trunk (which has no selected past 1). Light.
    expect(colors[2]).toMatchObject({ kind: "branch" });
    // Actually, pass-through subscribes branches with s.has(1) && s.has(3) → only trunk [0,1,3].
    // trunk state: { selected: -1, highestCompleted: 1 }
    // hc(1)>=1 → true, max(1,-1)=1>1 → false. Not blue.
    // selected(-1)>1 → false. Not gray. → light.
    expect((colors[2] as any).passColor).toBe("bg-gray-200");

    // segmentColors[0] (arc to branch, prev=1, subscribed=branches containing 2 → [branch B]):
    //   B: hc(1)>=1 → true, max(1,2)=2>1 → true → blue
    expect((colors[2] as any).segmentColors[0]).toBe("bg-blue-400");

    // Trunk 3 connector (prev=1, subscribed=[trunk,C] containing 1 AND 3):
    //   trunk: hc(1)>=1, max(1,-1)=1>1→NO. Not blue. selected(-1)>1→NO. Not gray.
    //   → light
    expect(asRecord(colors[3]).connectorColor).toBe("bg-gray-200");
  });
```

**Step 3: Run tests to verify they fail**

Run: `cd /home/penguin/code/lens-platform/ws3/web_frontend && npx vitest run src/utils/__tests__/branchColors.test.ts`

Expected: Both new tests FAIL — connectors return `bg-gray-400` instead of `bg-blue-400` where the fix would produce blue.

**Step 4: Commit**

```
jj describe -m "test: add failing integration test for blue line to current section"
```

---

### Task 3: Implement the fix in `getSegmentColor`

**Files:**
- Modify: `web_frontend/src/utils/branchColors.ts:84-93`

**Step 1: Replace `getSegmentColor` implementation**

Replace lines 84-93:

```ts
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

With:

```ts
export function getSegmentColor(
  previousIndex: number,
  subscribedBranches: BranchState[],
): SegmentColor {
  if (
    subscribedBranches.some(
      (b) =>
        b.highestCompleted >= previousIndex &&
        Math.max(b.highestCompleted, b.selected) > previousIndex,
    )
  )
    return "bg-blue-400";
  if (subscribedBranches.some((b) => b.selected > previousIndex))
    return "bg-gray-400";
  return "bg-gray-200";
}
```

The original `highestCompleted > previousIndex` is a subset of the new condition (if `hc > prev`, then `hc >= prev` is true and `max(hc, sel) >= hc > prev` is true), so this is a strict superset — all previously-blue segments stay blue.

**Step 2: Run tests to verify they all pass**

Run: `cd /home/penguin/code/lens-platform/ws3/web_frontend && npx vitest run src/utils/__tests__/branchColors.test.ts`

Expected: ALL tests PASS (existing + new). Specifically:
- 7 buildBranchPaths tests: unchanged, pass
- 5 computeBranchStates tests: unchanged, pass
- 10 getSegmentColor tests (6 existing + 4 new): all pass
- 9 computeLayoutColors tests (7 existing + 2 new): all pass

**Step 3: Run full verification**

Run: `cd /home/penguin/code/lens-platform/ws3/web_frontend && npx vitest run && npm run lint && npm run build`

Expected: All tests pass, lint clean, build successful.

**Step 4: Commit**

```
jj describe -m "fix: blue line extends to currently viewed section

Change getSegmentColor rule from strict 'highestCompleted > previousIndex'
to 'completion-backed reach': blue when the previous point is completed
(highestCompleted >= previousIndex) AND the user has progressed past it
(max(highestCompleted, selected) > previousIndex).

This fixes the line from the last completed section to the currently
viewed section being gray instead of blue."
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Add failing `getSegmentColor` tests (4 tests: core bug, no-reach, went-back, multi-branch) | `branchColors.test.ts` |
| 2 | Add failing `computeLayoutColors` integration tests (trunk-only + branch scenario) | `branchColors.test.ts` |
| 3 | Implement the fix + verify | `branchColors.ts` |

Total modified files: 2. No new files. No component changes needed.
