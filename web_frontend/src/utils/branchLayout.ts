import type { StageInfo } from "../types/course";

export type TrunkItem = {
  kind: "trunk";
  index: number;
  stage: StageInfo;
};

export type BranchGroup = {
  kind: "branch";
  items: { index: number; stage: StageInfo }[];
};

export type LayoutItem = TrunkItem | BranchGroup;

export function buildBranchLayout(stages: StageInfo[]): LayoutItem[] {
  const layout: LayoutItem[] = [];
  let i = 0;

  while (i < stages.length) {
    if (stages[i].optional) {
      const items: { index: number; stage: StageInfo }[] = [];
      while (i < stages.length && stages[i].optional) {
        items.push({ index: i, stage: stages[i] });
        i++;
      }
      layout.push({ kind: "branch", items });
    } else {
      layout.push({ kind: "trunk", index: i, stage: stages[i] });
      i++;
    }
  }

  return layout;
}
