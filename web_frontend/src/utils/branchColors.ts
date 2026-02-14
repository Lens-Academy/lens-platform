/**
 * Branch subscription color model for progress indicators.
 *
 * See docs/plans/2026-02-12-progress-bar-color-model.md for full design.
 */

import type { LayoutItem } from "./branchLayout";

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
export function buildBranchPaths(stages: { optional: boolean }[]): number[][] {
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

export type BranchState = {
  selected: number; // currently viewed index in this branch, or -1
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
    const selected = pathSet.has(currentSectionIndex)
      ? currentSectionIndex
      : -1;
    let highestCompleted = -1;
    for (const idx of path) {
      if (completedStages.has(idx) && idx > highestCompleted) {
        highestCompleted = idx;
      }
    }
    return { selected, highestCompleted };
  });
}

export type SegmentColor = "bg-blue-400" | "bg-gray-400" | "bg-gray-200";

/**
 * Unified color function for line segments.
 *
 * Three-tier priority:
 * - Blue: completion-backed reach (previous point is completed AND
 *   the user has progressed past it via completion or viewing)
 * - Gray: selected past this point (no completion backing)
 * - Light: nothing past this point
 */
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

type TrunkItemColors = {
  kind: "trunk";
  connectorColor: SegmentColor;
  outgoingColor: SegmentColor;
};

type BranchGroupColors = {
  kind: "branch";
  passColor: SegmentColor;
  segmentColors: SegmentColor[];
};

export type LayoutItemColors = TrunkItemColors | BranchGroupColors;

const DEFAULT_COLOR: SegmentColor = "bg-gray-200";

export function computeLayoutColors(
  layout: LayoutItem[],
  branchPaths: number[][],
  branchStates: BranchState[],
): LayoutItemColors[] {
  const pathSets = branchPaths.map((p) => new Set(p));

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

  return layout.map((item, layoutIndex) => {
    if (item.kind === "trunk") {
      const thisIndex = item.index;

      const connectorColor =
        prevTrunkIndex >= 0
          ? getSegmentColor(
              prevTrunkIndex,
              subscribedStates(
                (s) => s.has(prevTrunkIndex) && s.has(thisIndex),
              ),
            )
          : DEFAULT_COLOR;

      const outgoingColor = getSegmentColor(
        thisIndex,
        subscribedStates(
          (s, arr) => s.has(thisIndex) && arr.some((idx) => idx > thisIndex),
        ),
      );

      prevTrunkIndex = thisIndex;
      return { kind: "trunk" as const, connectorColor, outgoingColor };
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
  });
}
