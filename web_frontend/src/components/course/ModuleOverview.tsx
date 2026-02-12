/**
 * Vertical stage list with progress line.
 * Reused in course overview main panel and in-player drawer.
 *
 * Optional sections render as "branches" off the main trunk (like a VCS graph)
 * to subtly disincentivize defaulting to optional content.
 */

import { useMemo } from "react";
import type { StageInfo, ModuleStatus } from "../../types/course";
import { StageIcon } from "../module/StageProgressBar";
import {
  getHighestCompleted,
  getCircleFillClasses,
  getRingClasses,
} from "../../utils/stageProgress";
import { buildBranchLayout } from "../../utils/branchLayout";

type ModuleOverviewProps = {
  moduleTitle: string;
  stages: StageInfo[];
  status: ModuleStatus;
  completedStages: Set<number>;
  currentSectionIndex: number;
  onStageClick?: (index: number) => void;
  onStartModule?: () => void;
  showActions?: boolean;
  // Lens progress (for new progress format)
  completedLenses?: number;
  totalLenses?: number;
};

export default function ModuleOverview({
  moduleTitle,
  stages,
  status,
  completedStages,
  currentSectionIndex,
  onStageClick,
  onStartModule,
  showActions = true,
  completedLenses,
  totalLenses,
}: ModuleOverviewProps) {
  const highestCompleted = getHighestCompleted(completedStages);
  const layout = useMemo(() => buildBranchLayout(stages), [stages]);

  // Progress line color boundaries
  const viewingIsAdjacent = completedStages.has(currentSectionIndex - 1);
  const blueEndIndex =
    viewingIsAdjacent && currentSectionIndex > highestCompleted
      ? currentSectionIndex
      : highestCompleted;

  /** Determine trunk connector color for a given original stage index. */
  function getLineColor(stageIndex: number): string {
    if (stageIndex <= blueEndIndex) return "bg-blue-400";
    if (
      currentSectionIndex > highestCompleted &&
      !completedStages.has(currentSectionIndex - 1) &&
      stageIndex <= currentSectionIndex
    )
      return "bg-gray-400";
    return "bg-gray-200";
  }

  // Precompute connector colors for each layout item.
  // Trunk items get incoming (top) and outgoing (bottom) colors.
  // Branch groups get a pass-through color matching the preceding trunk.
  let prevTrunkIndex = -1;
  const layoutColors = layout.map((item) => {
    if (item.kind === "trunk") {
      const ownColor = getLineColor(item.index);
      const incomingColor =
        prevTrunkIndex >= 0 ? getLineColor(prevTrunkIndex) : ownColor;
      prevTrunkIndex = item.index;
      return { kind: "trunk" as const, ownColor, incomingColor };
    } else {
      const passColor =
        prevTrunkIndex >= 0 ? getLineColor(prevTrunkIndex) : "bg-gray-200";
      return { kind: "branch" as const, passColor };
    }
  });

  /** Render a stage row (circle + content). Used by both trunk and branch items. */
  function renderStageRow(stage: StageInfo, index: number) {
    const isCompleted = completedStages.has(index);
    const isViewing = index === currentSectionIndex;
    const isClickable = onStageClick && stage.type !== "chat";

    const fillClasses = getCircleFillClasses(
      { isCompleted, isViewing, isOptional: stage.optional },
      { includeHover: false },
    );
    const ringClasses = getRingClasses(isViewing, isCompleted);

    return (
      <div
        className={`flex items-center gap-4 py-2 rounded-lg ${
          isClickable ? "cursor-pointer hover:bg-slate-50" : ""
        }`}
        onClick={() => isClickable && onStageClick(index)}
      >
        {/* Circle */}
        <div
          className={`relative z-10 w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${fillClasses} ${ringClasses}`}
        >
          <StageIcon type={stage.type} small />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`font-medium ${
                isCompleted || isViewing ? "text-slate-900" : "text-slate-400"
              }`}
            >
              {stage.title}
            </span>
            {stage.optional && (
              <span className="text-xs text-slate-400 border border-slate-200 rounded px-1">
                Optional
              </span>
            )}
          </div>
          <div className="text-sm text-slate-500 mt-0.5">
            {stage.type === "chat"
              ? "Discuss with AI tutor"
              : stage.duration ||
                (stage.type === "article" || stage.type === "lens-article"
                  ? "Article"
                  : stage.type === "page"
                    ? "Page"
                    : "Video")}
          </div>
        </div>
      </div>
    );
  }

  const getActionLabel = () => {
    if (status === "completed") return "Review Module";
    if (status === "in_progress") return "Continue Module";
    return "Start Module";
  };

  return (
    <div className="flex flex-col h-full">
      {/* Module title and progress badge */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900">{moduleTitle}</h2>
        {/* Progress badge for in-progress modules */}
        {status === "in_progress" &&
          completedLenses !== undefined &&
          totalLenses !== undefined &&
          totalLenses > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all"
                  style={{
                    width: `${(completedLenses / totalLenses) * 100}%`,
                  }}
                />
              </div>
              <span className="text-sm text-slate-600 font-medium">
                {completedLenses}/{totalLenses}
              </span>
            </div>
          )}
        {status === "completed" && (
          <div className="mt-2 flex items-center gap-1 text-sm text-green-600 font-medium">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            Completed
          </div>
        )}
      </div>

      {/* Stage list — branching layout */}
      <div className="flex-1 overflow-y-auto">
        {/* pl-1 gives space for the selection ring to not be cut off */}
        <div className="pl-1">
          {layout.map((item, li) => {
            const colors = layoutColors[li];
            const isFirst = li === 0;
            const isLast = li === layout.length - 1;

            if (item.kind === "trunk" && colors.kind === "trunk") {
              return (
                <div key={li} className="relative">
                  {/* Top connector: from previous item to this circle center */}
                  {/* left-[0.875rem] = half of w-7 (14px) = center of circle within this wrapper */}
                  {!isFirst && (
                    <div
                      className={`absolute left-[0.875rem] top-0 bottom-1/2 w-0.5 -translate-x-1/2 ${colors.incomingColor}`}
                    />
                  )}
                  {/* Bottom connector: from this circle center to next item */}
                  {!isLast && (
                    <div
                      className={`absolute left-[0.875rem] top-1/2 bottom-0 w-0.5 -translate-x-1/2 ${colors.ownColor}`}
                    />
                  )}
                  {renderStageRow(item.stage, item.index)}
                </div>
              );
            }

            if (item.kind === "branch" && colors.kind === "branch") {
              // Leading branch (first layout item) = no preceding trunk
              const hasPrecedingTrunk = li > 0;
              // Fork junction y-position: py-1 (4px) + py-2 (8px) + half circle (14px) = 26px
              // This aligns the fork with the center of the first branch dot.
              const forkY = "26px";

              return (
                <div key={li} className="relative">
                  {/* Trunk pass-through line — only when there's a trunk to connect */}
                  {hasPrecedingTrunk && (
                    <div
                      className={`absolute left-[0.875rem] top-0 w-0.5 -translate-x-1/2 ${colors.passColor} ${
                        isLast ? "" : "bottom-0"
                      }`}
                      style={isLast ? { height: forkY } : undefined}
                    />
                  )}
                  {/* Fork connector: horizontal dashed line from trunk to first branch dot */}
                  {hasPrecedingTrunk && (
                    <div
                      className="absolute border-t-2 border-dashed border-gray-300"
                      style={{
                        left: "15px" /* right edge of trunk line */,
                        top: forkY,
                        width: "25px" /* to left edge of branch items (ml-10 = 40px) */,
                        transform: "translateY(-1px)",
                      }}
                    />
                  )}
                  {/* Branch items, indented to the right */}
                  <div className="ml-10 py-1">
                    {item.items.map((branchItem, bi) => (
                      <div key={bi} className="relative">
                        {/* Branch connector above (dashed, matching optional style) */}
                        {bi > 0 && (
                          <div className="absolute left-[0.875rem] top-0 bottom-1/2 -translate-x-1/2 border-l-2 border-dashed border-gray-300" />
                        )}
                        {/* Branch connector below */}
                        {bi < item.items.length - 1 && (
                          <div className="absolute left-[0.875rem] top-1/2 bottom-0 -translate-x-1/2 border-l-2 border-dashed border-gray-300" />
                        )}
                        {renderStageRow(branchItem.stage, branchItem.index)}
                      </div>
                    ))}
                  </div>
                </div>
              );
            }

            return null;
          })}
        </div>
      </div>

      {/* Action button */}
      {showActions && onStartModule && (
        <div className="pt-6 mt-auto border-t border-slate-100">
          <button
            onClick={onStartModule}
            className="w-full py-3 px-4 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            {getActionLabel()}
          </button>
        </div>
      )}
    </div>
  );
}
