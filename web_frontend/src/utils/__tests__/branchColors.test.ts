import { describe, it, expect } from "vitest";
import {
  buildBranchPaths,
  computeBranchStates,
  getSegmentColor,
  computeLayoutColors,
  type BranchState,
  type LayoutItemColors,
} from "../branchColors";
import { buildBranchLayout } from "../branchLayout";
import type { StageInfo } from "../../types/course";

/** Narrow a LayoutItemColors to a record for property access in tests. */
function asRecord(item: LayoutItemColors): Record<string, string> {
  return item as unknown as Record<string, string>;
}

function stages(...pattern: ("r" | "o")[]): { optional: boolean }[] {
  return pattern.map((p) => ({ optional: p === "o" }));
}

function stageInfo(title: string, optional = false): StageInfo {
  return { type: "article", title, duration: null, optional };
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
      [0, 1, 3, 4], // trunk
      [0, 1, 2], // branch B (prefix 0,1 + optional 2)
      [0, 1, 3, 4, 5], // branch C (prefix 0,1,3,4 + optional 5)
    ]);
  });

  it("handles optional at the start (no trunk prefix)", () => {
    const paths = buildBranchPaths(stages("o", "r", "r"));
    expect(paths).toEqual([
      [1, 2], // trunk (required only)
      [0], // branch (no trunk prefix before it, just the optional)
    ]);
  });

  it("handles optional at the end", () => {
    const paths = buildBranchPaths(stages("r", "r", "o"));
    expect(paths).toEqual([
      [0, 1], // trunk
      [0, 1, 2], // branch (full trunk prefix + optional)
    ]);
  });

  it("handles consecutive optionals as one branch", () => {
    const paths = buildBranchPaths(stages("r", "o", "o", "r"));
    expect(paths).toEqual([
      [0, 3], // trunk
      [0, 1, 2], // branch (prefix [0] + optionals [1,2])
    ]);
  });

  it("handles all-optional stages", () => {
    const paths = buildBranchPaths(stages("o", "o"));
    expect(paths).toEqual([
      [], // trunk (empty -- no required stages)
      [0, 1], // one branch with all optionals
    ]);
  });

  it("returns trunk-only for empty stages", () => {
    const paths = buildBranchPaths([]);
    expect(paths).toEqual([[]]);
  });
});

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
      { selected: -1, highestCompleted: -1 }, // A: 2 not in [0,1,3,4]
      { selected: 2, highestCompleted: -1 }, // B: 2 in [0,1,2]
      { selected: -1, highestCompleted: -1 }, // C: 2 not in [0,1,3,4,5]
    ]);
  });

  it("computes highestCompleted per branch", () => {
    // Completed sections 0 and 5
    const states = computeBranchStates(paths, new Set([0, 5]), 1);
    expect(states).toEqual([
      { selected: 1, highestCompleted: 0 }, // A: only 0 in trunk
      { selected: 1, highestCompleted: 0 }, // B: only 0 in branch B
      { selected: 1, highestCompleted: 5 }, // C: 0 and 5 both in branch C
    ]);
  });

  it("ignores completed sections not in the branch", () => {
    // Completed section 2 (only in branch B)
    const states = computeBranchStates(paths, new Set([2]), 3);
    expect(states).toEqual([
      { selected: 3, highestCompleted: -1 }, // A: 2 not in trunk
      { selected: -1, highestCompleted: 2 }, // B: 2 in B, but 3 not in B
      { selected: 3, highestCompleted: -1 }, // C: 2 not in C
    ]);
  });
});

describe("getSegmentColor", () => {
  it("returns light when no branches have activity past previousIndex", () => {
    const states: BranchState[] = [{ selected: -1, highestCompleted: -1 }];
    expect(getSegmentColor(0, states)).toBe("bg-gray-200");
  });

  it("returns gray when a branch has selected > previousIndex", () => {
    const states: BranchState[] = [{ selected: 3, highestCompleted: -1 }];
    expect(getSegmentColor(1, states)).toBe("bg-gray-400");
  });

  it("returns blue when a branch has highestCompleted > previousIndex", () => {
    const states: BranchState[] = [{ selected: -1, highestCompleted: 5 }];
    expect(getSegmentColor(1, states)).toBe("bg-blue-400");
  });

  it("blue wins over gray", () => {
    const states: BranchState[] = [
      { selected: 3, highestCompleted: -1 },
      { selected: -1, highestCompleted: 5 },
    ];
    expect(getSegmentColor(1, states)).toBe("bg-blue-400");
  });

  it("returns blue when highestCompleted equals previousIndex and selected is past", () => {
    // Bug scenario: completed section 1, viewing section 2
    // Line from 1→2 should be blue (completion-backed reach)
    const states: BranchState[] = [{ selected: 2, highestCompleted: 1 }];
    expect(getSegmentColor(1, states)).toBe("bg-blue-400");
  });

  it("returns light when highestCompleted equals previousIndex but nothing past it", () => {
    // Completed section 1, not viewing anything further
    const states: BranchState[] = [{ selected: 1, highestCompleted: 1 }];
    expect(getSegmentColor(1, states)).toBe("bg-gray-200");
  });

  it("returns light when highestCompleted equals previousIndex and selected is before", () => {
    // Completed section 1, viewing section 0 (went back)
    const states: BranchState[] = [{ selected: 0, highestCompleted: 1 }];
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

  it("checks > not >=", () => {
    const states: BranchState[] = [{ selected: 3, highestCompleted: -1 }];
    // selected(3) > previousIndex(3) is false
    expect(getSegmentColor(3, states)).toBe("bg-gray-200");
  });

  it("returns light for empty branch list", () => {
    expect(getSegmentColor(0, [])).toBe("bg-gray-200");
  });
});

describe("computeLayoutColors", () => {
  // Reference stages: [0:req, 1:req, 2:opt, 3:req, 4:req, 5:opt]
  const stageList = [
    stageInfo("S0"),
    stageInfo("S1"),
    stageInfo("S2", true),
    stageInfo("S3"),
    stageInfo("S4"),
    stageInfo("S5", true),
  ];
  const layout = buildBranchLayout(stageList);
  const paths = buildBranchPaths(
    stageList.map((s) => ({ optional: s.optional })),
  );

  it("viewing trunk(3), nothing completed", () => {
    const states = computeBranchStates(paths, new Set(), 3);
    const colors = computeLayoutColors(layout, paths, states);

    // Trunk 0: first item, no incoming → default light
    expect(colors[0]).toMatchObject({
      kind: "trunk",
      connectorColor: "bg-gray-200",
    });
    expect(asRecord(colors[0]).outgoingColor).toBe("bg-gray-400"); // prev=0, [A,B,C], A.selected=3, 3>0

    // Trunk 1: connector = segment 0→1 (prev=0, [A,B,C]) → gray
    expect(colors[1]).toMatchObject({
      kind: "trunk",
      connectorColor: "bg-gray-400",
    });
    expect(asRecord(colors[1]).outgoingColor).toBe("bg-gray-400"); // prev=1, shared stem

    // Branch group [2]: pass → gray; branch → light
    expect(colors[2]).toMatchObject({
      kind: "branch",
      passColor: "bg-gray-400",
      segmentColors: ["bg-gray-200"],
    });

    // Trunk 3: connector →3 (prev=1, [A,C]) → gray; outgoing (prev=3) → light
    expect(colors[3]).toMatchObject({
      kind: "trunk",
      connectorColor: "bg-gray-400",
    });
    expect(asRecord(colors[3]).outgoingColor).toBe("bg-gray-200");

    // Trunk 4: connector 3→4 (prev=3, [A,C]) → light; outgoing → light
    expect(colors[4]).toMatchObject({
      kind: "trunk",
      connectorColor: "bg-gray-200",
    });
    expect(asRecord(colors[4]).outgoingColor).toBe("bg-gray-200");

    // Branch group [5]: both light
    expect(colors[5]).toMatchObject({
      kind: "branch",
      passColor: "bg-gray-200",
      segmentColors: ["bg-gray-200"],
    });
  });

  it("viewing branch(2), nothing completed", () => {
    const states = computeBranchStates(paths, new Set(), 2);
    const colors = computeLayoutColors(layout, paths, states);
    expect(asRecord(colors[1]).connectorColor).toBe("bg-gray-400"); // B.selected=2, 2>0
    expect(colors[2]).toMatchObject({
      kind: "branch",
      passColor: "bg-gray-200",
      segmentColors: ["bg-gray-400"],
    });
    expect(asRecord(colors[3]).connectorColor).toBe("bg-gray-200"); // neither A nor C
    expect(asRecord(colors[4]).connectorColor).toBe("bg-gray-200");
  });

  it("viewing branch(5), nothing completed", () => {
    const states = computeBranchStates(paths, new Set(), 5);
    const colors = computeLayoutColors(layout, paths, states);
    expect(asRecord(colors[1]).connectorColor).toBe("bg-gray-400");
    expect(colors[2]).toMatchObject({
      kind: "branch",
      passColor: "bg-gray-400",
      segmentColors: ["bg-gray-200"],
    });
    expect(asRecord(colors[3]).connectorColor).toBe("bg-gray-400");
    expect(asRecord(colors[4]).connectorColor).toBe("bg-gray-400");
    expect(colors[5]).toMatchObject({
      kind: "branch",
      passColor: "bg-gray-400",
      segmentColors: ["bg-gray-400"],
    });
  });

  it("handles leading optional branch group", () => {
    const leadingStages = [
      stageInfo("S0", true),
      stageInfo("S1"),
      stageInfo("S2"),
    ];
    const leadingLayout = buildBranchLayout(leadingStages);
    const leadingPaths = buildBranchPaths(
      leadingStages.map((s) => ({ optional: s.optional })),
    );
    const s = computeBranchStates(leadingPaths, new Set(), 0);
    const c = computeLayoutColors(leadingLayout, leadingPaths, s);
    expect(c[0]).toMatchObject({
      kind: "branch",
      passColor: "bg-gray-200",
      segmentColors: ["bg-gray-200"],
    });
    expect(c[1]).toMatchObject({
      kind: "trunk",
      connectorColor: "bg-gray-200",
    });
  });

  it("handles all-optional stages", () => {
    const optStages = [stageInfo("S0", true), stageInfo("S1", true)];
    const optLayout = buildBranchLayout(optStages);
    const optPaths = buildBranchPaths(
      optStages.map((s) => ({ optional: s.optional })),
    );
    const s = computeBranchStates(optPaths, new Set(), 0);
    const c = computeLayoutColors(optLayout, optPaths, s);
    expect(c[0]).toMatchObject({
      kind: "branch",
      passColor: "bg-gray-200",
      segmentColors: ["bg-gray-200", "bg-gray-200"],
    });
  });

  it("section 5 completed, viewing trunk(1)", () => {
    const states = computeBranchStates(paths, new Set([5]), 1);
    const colors = computeLayoutColors(layout, paths, states);
    expect(asRecord(colors[1]).connectorColor).toBe("bg-blue-400");
    expect(colors[2]).toMatchObject({
      kind: "branch",
      passColor: "bg-blue-400",
      segmentColors: ["bg-gray-200"],
    });
    expect(asRecord(colors[3]).connectorColor).toBe("bg-blue-400");
    expect(asRecord(colors[4]).connectorColor).toBe("bg-blue-400");
    expect(colors[5]).toMatchObject({
      kind: "branch",
      passColor: "bg-blue-400",
      segmentColors: ["bg-blue-400"],
    });
  });

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
    expect(colors[0]).toMatchObject({
      kind: "trunk",
      connectorColor: "bg-gray-200",
    });
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
    //   trunk state: { selected: -1, highestCompleted: 1 }
    //   hc(1)>=1 → true, max(1,-1)=1>1 → false. Not blue.
    //   selected(-1)>1 → false. Not gray. → light.
    expect(colors[2]).toMatchObject({ kind: "branch" });
    expect(asRecord(colors[2]).passColor).toBe("bg-gray-200");

    // segmentColors[0] (arc to branch, prev=1, subscribed=branches containing 2 → [branch B]):
    //   B: hc(1)>=1 → true, max(1,2)=2>1 → true → blue
    expect(asRecord(colors[2]).segmentColors[0]).toBe("bg-blue-400");

    // Trunk 3 connector (prev=1, subscribed=[trunk] containing 1 AND 3):
    //   trunk: hc(1)>=1, max(1,-1)=1>1→NO. Not blue. selected(-1)>1→NO. Not gray.
    //   → light
    expect(asRecord(colors[3]).connectorColor).toBe("bg-gray-200");
  });

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
});
