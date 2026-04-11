# Branch Color Granularity Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix two bugs where branch group color computation is too coarse — pass-through subscribes to wrong branches, and multi-item branches use one color for all intra-branch connectors.

**Architecture:** Replace single `branchColor` with per-segment `segmentColors[]` array, and fix `passColor` subscription to use next trunk index (trunk continuation) instead of any-branch-past-fork. Same `getSegmentColor` function, just with correct `previousIndex` per segment.

**Tech Stack:** TypeScript, Vitest, React (Tailwind CSS class changes only)

---

### Task 1: Update branchColors — type, tests, implementation

**Files:**
- Modify: `web_frontend/src/utils/branchColors.ts:101-105,132,155-178`
- Modify: `web_frontend/src/utils/__tests__/branchColors.test.ts:212-216,233-237,244-245,254-255,258-259,274-278,293-297,304-305,308-309`

**Step 1: Update the type**

In `web_frontend/src/utils/branchColors.ts`, replace lines 101-105:

```ts
type BranchGroupColors = {
  kind: "branch";
  passColor: SegmentColor;
  branchColor: SegmentColor;
};
```

with:

```ts
type BranchGroupColors = {
  kind: "branch";
  passColor: SegmentColor;
  segmentColors: SegmentColor[];
};
```

**Step 2: Update existing test assertions**

In `web_frontend/src/utils/__tests__/branchColors.test.ts`, make these changes:

Lines 212-216 — replace `branchColor` with `segmentColors` (passColor unchanged, A.selected=3 > 1 via [A,C]):
```ts
    expect(colors[2]).toMatchObject({
      kind: "branch",
      passColor: "bg-gray-400",
      segmentColors: ["bg-gray-200"],
    });
```

Lines 233-237 — same field rename:
```ts
    expect(colors[5]).toMatchObject({
      kind: "branch",
      passColor: "bg-gray-200",
      segmentColors: ["bg-gray-200"],
    });
```

Lines 243-245 — **BUG 2 FIX**: passColor changes from gray to light. With nextTrunkIndex subscription, [A,C] are subscribed (not B), neither has activity:
```ts
    expect(colors[2]).toMatchObject({
      kind: "branch",
      passColor: "bg-gray-200",
      segmentColors: ["bg-gray-400"],
    });
```

Lines 253-255 — passColor stays gray (C.selected=5>1 via [A,C]):
```ts
    expect(colors[2]).toMatchObject({
      kind: "branch",
      passColor: "bg-gray-400",
      segmentColors: ["bg-gray-200"],
    });
```

Lines 258-259:
```ts
    expect(colors[5]).toMatchObject({
      kind: "branch",
      passColor: "bg-gray-400",
      segmentColors: ["bg-gray-400"],
    });
```

Lines 274-278:
```ts
    expect(c[0]).toMatchObject({
      kind: "branch",
      passColor: "bg-gray-200",
      segmentColors: ["bg-gray-200"],
    });
```

Lines 293-297 — two-item branch now produces two-element array:
```ts
    expect(c[0]).toMatchObject({
      kind: "branch",
      passColor: "bg-gray-200",
      segmentColors: ["bg-gray-200", "bg-gray-200"],
    });
```

Lines 303-305:
```ts
    expect(colors[2]).toMatchObject({
      kind: "branch",
      passColor: "bg-blue-400",
      segmentColors: ["bg-gray-200"],
    });
```

Lines 308-309:
```ts
    expect(colors[5]).toMatchObject({
      kind: "branch",
      passColor: "bg-blue-400",
      segmentColors: ["bg-blue-400"],
    });
```

**Step 3: Add regression test for multi-item branch (Bug 1)**

Add this test inside the `computeLayoutColors` describe block, after the "section 5 completed" test:

```ts
  it("colors intra-branch connectors independently (consecutive optionals)", () => {
    // Stages: [0:r, 1:r, 2:r, 3:r, 4:o, 5:o]
    const multiStages = [
      stageInfo("S0"),
      stageInfo("S1"),
      stageInfo("S2"),
      stageInfo("S3"),
      stageInfo("S4", true),
      stageInfo("S5", true),
    ];
    const multiLayout = buildBranchLayout(multiStages);
    const multiPaths = buildBranchPaths(
      multiStages.map((s) => ({ optional: s.optional })),
    );

    // Viewing first optional (index 4): arc gray, connector 4→5 light
    const s1 = computeBranchStates(multiPaths, new Set(), 4);
    const c1 = computeLayoutColors(multiLayout, multiPaths, s1);
    expect(c1[4]).toMatchObject({
      kind: "branch",
      passColor: "bg-gray-400",
      segmentColors: ["bg-gray-400", "bg-gray-200"],
    });

    // Viewing second optional (index 5): both gray
    const s2 = computeBranchStates(multiPaths, new Set(), 5);
    const c2 = computeLayoutColors(multiLayout, multiPaths, s2);
    expect(c2[4]).toMatchObject({
      kind: "branch",
      passColor: "bg-gray-400",
      segmentColors: ["bg-gray-400", "bg-gray-400"],
    });
  });
```

**Step 4: Run tests to verify they fail**

Run: `npx vitest run src/utils/__tests__/branchColors.test.ts`

Expected: Multiple failures — `branchColor` no longer exists in the type, and `computeLayoutColors` still returns old shape.

**Step 5: Update computeLayoutColors implementation**

In `web_frontend/src/utils/branchColors.ts`:

Line 132 — add `layoutIndex` parameter:
```ts
  return layout.map((item, layoutIndex) => {
```

Replace lines 155-178 (the entire `else` branch) with:
```ts
    } else {
      // Find next trunk index for pass-through subscription
      let nextTrunkIndex = -1;
      for (let j = layoutIndex + 1; j < layout.length; j++) {
        if (layout[j].kind === "trunk") {
          nextTrunkIndex = layout[j].index;
          break;
        }
      }

      // Pass-through: trunk continuation (mid-layout) or shared stem (trailing)
      const passSubs =
        nextTrunkIndex >= 0
          ? subscribedStates(
              (s) => s.has(prevTrunkIndex) && s.has(nextTrunkIndex),
            )
          : subscribedStates(
              (s, arr) =>
                s.has(prevTrunkIndex) &&
                arr.some((idx) => idx > prevTrunkIndex),
            );

      const passColor =
        prevTrunkIndex >= 0
          ? getSegmentColor(prevTrunkIndex, passSubs)
          : DEFAULT_COLOR;

      // Per-segment branch colors: each uses previousIndex of the preceding item
      const branchSubs = subscribedStates((s) =>
        item.items.some((bi) => s.has(bi.index)),
      );

      const segmentColors = item.items.map((bi, i) => {
        const prevIdx = i === 0 ? prevTrunkIndex : item.items[i - 1].index;
        return prevIdx >= 0
          ? getSegmentColor(prevIdx, branchSubs)
          : DEFAULT_COLOR;
      });

      return { kind: "branch" as const, passColor, segmentColors };
    }
```

**Step 6: Run tests to verify they pass**

Run: `npx vitest run src/utils/__tests__/branchColors.test.ts`

Expected: All tests PASS (25 tests — 24 existing + 1 new).

**Step 7: Commit**

```
jj describe -m "fix: per-segment branch colors and pass-through subscription

Replace single branchColor with segmentColors[] array so each
intra-branch connector uses the correct previousIndex. Fix passColor
subscription to use nextTrunkIndex (trunk continuation) instead of
any-branch-past-fork.

Fixes: pass-through too dark when viewing branch item, and connector
between consecutive optionals incorrectly colored."
```

---

### Task 2: Update components to use segmentColors

**Files:**
- Modify: `web_frontend/src/components/module/StageProgressBar.tsx:255-266,300,332-335`
- Modify: `web_frontend/src/components/course/ModuleOverview.tsx:250-251,258,292,296,300`

**Step 1: Update StageProgressBar**

In `web_frontend/src/components/module/StageProgressBar.tsx`:

Replace lines 255-266:
```tsx
            const branchColor =
              colors.kind === "branch" ? colors.branchColor : "bg-gray-200";
            const hasPrecedingTrunk = li > 0 && layout[li - 1]?.kind === "trunk";
            const isAfterLastTrunk =
              hasPrecedingTrunk &&
              li - 1 === lastTrunkLi &&
              lastTrunkLi < layout.length - 1;
            // Arc + dotted connectors use branch-specific color
            const textColor =
              branchColorMap[branchColor]?.text ?? "text-gray-200";
            const branchBorderColor =
              branchColorMap[branchColor]?.border ?? "border-gray-200";
```

with:
```tsx
            const segmentColors =
              colors.kind === "branch" ? colors.segmentColors : [];
            const hasPrecedingTrunk = li > 0 && layout[li - 1]?.kind === "trunk";
            const isAfterLastTrunk =
              hasPrecedingTrunk &&
              li - 1 === lastTrunkLi &&
              lastTrunkLi < layout.length - 1;
            // Arc color from first segment
            const arcColor = segmentColors[0] ?? "bg-gray-200";
            const arcTextColor =
              branchColorMap[arcColor]?.text ?? "text-gray-200";
```

Line 300 — replace `textColor` with `arcTextColor`:
```tsx
                    className={`absolute ${arcTextColor} z-[1] pointer-events-none ${compact ? "left-4" : "left-2 sm:left-4"}`}
```

Replace lines 332-335:
```tsx
                      {bi > 0 && (
                        <div
                          className={`border-t-2 border-dotted ${branchBorderColor} ${compact ? "w-3" : "w-2 sm:w-3"}`}
                        />
                      )}
```

with:
```tsx
                      {bi > 0 && (
                        <div
                          className={`border-t-2 border-dotted ${
                            branchColorMap[segmentColors[bi]]?.border ?? "border-gray-200"
                          } ${compact ? "w-3" : "w-2 sm:w-3"}`}
                        />
                      )}
```

**Step 2: Update ModuleOverview**

In `web_frontend/src/components/course/ModuleOverview.tsx`:

Replace lines 250-251:
```tsx
              const { text: forkTextColor, border: forkBorderColor } =
                forkColors[colors.branchColor] ?? forkColors["bg-gray-200"];
```

with:
```tsx
              const segmentColors = colors.segmentColors;
              const arcFork = forkColors[segmentColors[0]] ?? forkColors["bg-gray-200"];
              const forkBorder = (i: number) =>
                (forkColors[segmentColors[i]] ?? forkColors["bg-gray-200"]).border;
```

Line 258 — replace `forkTextColor` with `arcFork.text`:
```tsx
                      className={`absolute z-[1] ${arcFork.text} pointer-events-none`}
```

Line 292 — replace `forkBorderColor` with `forkBorder(0)`:
```tsx
                          <div className={`absolute z-[2] left-[0.875rem] bottom-1/2 -translate-x-1/2 border-l-2 border-dotted ${forkBorder(0)}`} style={{ top: forkConnectorTop }} />
```

Line 296 — replace `forkBorderColor` with `forkBorder(bi)`:
```tsx
                          <div className={`absolute z-[2] left-[0.875rem] top-0 bottom-1/2 -translate-x-1/2 border-l-2 border-dotted ${forkBorder(bi)}`} />
```

Line 300 — replace `forkBorderColor` with `forkBorder(bi + 1)`:
```tsx
                          <div className={`absolute z-[2] left-[0.875rem] top-1/2 bottom-0 -translate-x-1/2 border-l-2 border-dotted ${forkBorder(bi + 1)}`} />
```

**Step 3: Run full verification**

Run: `npx vitest run && npm run lint && npm run build`

Expected: 25 branchColors tests pass, 88+ total tests pass (2 pre-existing failures in module.render.test.tsx), lint clean, build successful.

**Step 4: Commit**

```
jj describe -m "fix: update components for per-segment branch colors

StageProgressBar and ModuleOverview now use segmentColors[] array
for per-connector coloring within branch groups."
```
