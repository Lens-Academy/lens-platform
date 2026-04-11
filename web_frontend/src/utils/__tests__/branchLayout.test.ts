import { describe, it, expect } from "vitest";
import { buildBranchLayout } from "../branchLayout";
import type { StageInfo } from "../../types/course";

function stage(title: string, optional = false): StageInfo {
  return { type: "article", title, duration: null, optional };
}

describe("buildBranchLayout", () => {
  it("returns all trunk items when no optional sections", () => {
    const stages = [stage("A"), stage("B"), stage("C")];
    const layout = buildBranchLayout(stages);
    expect(layout).toEqual([
      { kind: "trunk", index: 0, stage: stages[0] },
      { kind: "trunk", index: 1, stage: stages[1] },
      { kind: "trunk", index: 2, stage: stages[2] },
    ]);
  });

  it("groups consecutive optional sections into a branch", () => {
    const stages = [
      stage("A"),
      stage("Opt1", true),
      stage("Opt2", true),
      stage("B"),
    ];
    const layout = buildBranchLayout(stages);
    expect(layout).toEqual([
      { kind: "trunk", index: 0, stage: stages[0] },
      {
        kind: "branch",
        items: [
          { index: 1, stage: stages[1] },
          { index: 2, stage: stages[2] },
        ],
      },
      { kind: "trunk", index: 3, stage: stages[3] },
    ]);
  });

  it("handles optional sections at the start", () => {
    const stages = [stage("Opt1", true), stage("A"), stage("B")];
    const layout = buildBranchLayout(stages);
    expect(layout).toEqual([
      {
        kind: "branch",
        items: [{ index: 0, stage: stages[0] }],
      },
      { kind: "trunk", index: 1, stage: stages[1] },
      { kind: "trunk", index: 2, stage: stages[2] },
    ]);
  });

  it("handles optional sections at the end", () => {
    const stages = [stage("A"), stage("Opt1", true)];
    const layout = buildBranchLayout(stages);
    expect(layout).toEqual([
      { kind: "trunk", index: 0, stage: stages[0] },
      {
        kind: "branch",
        items: [{ index: 1, stage: stages[1] }],
      },
    ]);
  });

  it("handles multiple separate branches", () => {
    const stages = [
      stage("A"),
      stage("Opt1", true),
      stage("B"),
      stage("Opt2", true),
      stage("C"),
    ];
    const layout = buildBranchLayout(stages);
    expect(layout).toEqual([
      { kind: "trunk", index: 0, stage: stages[0] },
      { kind: "branch", items: [{ index: 1, stage: stages[1] }] },
      { kind: "trunk", index: 2, stage: stages[2] },
      { kind: "branch", items: [{ index: 3, stage: stages[3] }] },
      { kind: "trunk", index: 4, stage: stages[4] },
    ]);
  });
});
