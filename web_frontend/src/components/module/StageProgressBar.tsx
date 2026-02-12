// web_frontend/src/components/unified-lesson/StageProgressBar.tsx
import { useMemo } from "react";
import type { Stage } from "../../types/module";
import type { StageInfo } from "../../types/course";
import { buildBranchLayout } from "../../utils/branchLayout";
import { triggerHaptic } from "@/utils/haptics";
import { Tooltip } from "../Tooltip";
import {
  getHighestCompleted,
  getCircleFillClasses,
  getRingClasses,
} from "../../utils/stageProgress";

type StageProgressBarProps = {
  stages: Stage[];
  completedStages: Set<number>; // Which stages are completed (can be non-contiguous)
  currentSectionIndex: number; // Current section index
  onStageClick: (index: number) => void;
  onPrevious: () => void;
  onNext: () => void;
  canGoPrevious: boolean;
  canGoNext: boolean;
  compact?: boolean; // Smaller size for header use
};

export function StageIcon({
  type,
  small = false,
}: {
  type: string;
  small?: boolean;
}) {
  // Article icon: article, lens-article, page
  if (type === "article" || type === "lens-article" || type === "page") {
    const size = small ? "w-4 h-4" : "w-5 h-5";
    return (
      <svg className={size} fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z"
          clipRule="evenodd"
        />
      </svg>
    );
  }

  // Video icon: video, lens-video
  if (type === "video" || type === "lens-video") {
    const size = small ? "w-5 h-5" : "w-6 h-6";
    return (
      <svg className={size} fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
          clipRule="evenodd"
        />
      </svg>
    );
  }

  // Chat (default)
  const size = small ? "w-5 h-5" : "w-6 h-6";
  return (
    <svg className={size} fill="currentColor" viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function getStageTitle(stage: Stage): string {
  if (stage.title) return stage.title;
  // Fallback based on type
  if (stage.type === "video") return "Video";
  if (stage.type === "article") return "Article";
  // Note: lens-video and lens-article always have titles from meta,
  // so these fallbacks won't typically be used, but we include them for safety
  return "Discussion";
}

function getTooltipContent(
  stage: Stage,
  index: number,
  isCompleted: boolean,
  isViewing: boolean,
): string {
  const isOptional = "optional" in stage && stage.optional === true;
  const optionalPrefix = isOptional ? "(Optional) " : "";
  const completedSuffix = isCompleted ? " (completed)" : "";
  const title = getStageTitle(stage);

  if (isViewing) {
    return `${title}${completedSuffix}`;
  }
  return `${optionalPrefix}${title}${completedSuffix}`;
}

export default function StageProgressBar({
  stages,
  completedStages,
  currentSectionIndex,
  onStageClick,
  onPrevious,
  onNext,
  canGoPrevious,
  canGoNext,
  compact = false,
}: StageProgressBarProps) {
  // Calculate highest completed index for bar coloring
  const highestCompleted = getHighestCompleted(completedStages);

  // Bar color logic:
  // - Blue up to highest completed
  // - Blue to viewing if viewing is adjacent to a completed section
  // - Dark gray to viewing if we skipped sections
  // - Light gray beyond
  const getBarColor = (index: number) => {
    if (index <= highestCompleted) return "bg-blue-400";
    if (index === currentSectionIndex && completedStages.has(index - 1))
      return "bg-blue-400";
    if (index <= currentSectionIndex) return "bg-gray-400";
    return "bg-gray-200";
  };

  const handleDotClick = (index: number) => {
    // Trigger haptic on any tap
    triggerHaptic(10);
    onStageClick(index);
  };

  // Build branch layout from stages (adapter: Stage -> StageInfo)
  const layoutInput = useMemo(
    () =>
      stages.map(
        (s): StageInfo => ({
          type: s.type as StageInfo["type"],
          title: getStageTitle(s),
          duration: null,
          optional: s.optional ?? false,
        }),
      ),
    [stages],
  );
  const layout = useMemo(() => buildBranchLayout(layoutInput), [layoutInput]);

  // Precompute pass-through colors for branch blocks
  let prevTrunkIndex = -1;
  const layoutColors = layout.map((item) => {
    if (item.kind === "trunk") {
      const color = getBarColor(item.index);
      prevTrunkIndex = item.index;
      return { kind: "trunk" as const, color };
    } else {
      const passColor =
        prevTrunkIndex >= 0 ? getBarColor(prevTrunkIndex) : "bg-gray-200";
      return { kind: "branch" as const, passColor };
    }
  });

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

  // Find the last trunk item index for dashed trailing connector
  const lastTrunkLi = (() => {
    for (let i = layout.length - 1; i >= 0; i--) {
      if (layout[i].kind === "trunk") return i;
    }
    return -1;
  })();

  function renderDot(stage: Stage, index: number) {
    const isCompleted = completedStages.has(index);
    const isViewing = index === currentSectionIndex;
    const isOptional = "optional" in stage && stage.optional === true;

    const fillClasses = getCircleFillClasses(
      { isCompleted, isViewing, isOptional },
      { includeHover: true },
    );
    const ringClasses = getRingClasses(isViewing, isCompleted);

    return (
      <Tooltip
        content={getTooltipContent(stage, index, isCompleted, isViewing)}
        placement="bottom"
      >
        <button
          onClick={() => handleDotClick(index)}
          className={`
            relative rounded-full flex items-center justify-center
            transition-all duration-150
            ${compact ? "" : "active:scale-95 shrink-0"}
            ${
              compact
                ? "w-7 h-7"
                : "min-w-8 min-h-8 w-8 h-8 sm:min-w-[44px] sm:min-h-[44px] sm:w-11 sm:h-11"
            }
            ${fillClasses}
            ${ringClasses}
          `}
        >
          <StageIcon type={stage.type} small={compact} />
        </button>
      </Tooltip>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {/* Previous button */}
      <Tooltip content="Previous content">
        <button
          onClick={onPrevious}
          disabled={!canGoPrevious}
          className={`rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-default ${
            compact
              ? "p-1"
              : "min-w-8 min-h-8 sm:min-w-[44px] sm:min-h-[44px] p-1.5 sm:p-2 transition-all active:scale-95 shrink-0"
          }`}
        >
          <svg
            className={compact ? "w-4 h-4" : "w-4 h-4 sm:w-5 sm:h-5"}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
      </Tooltip>

      {/* Stage dots */}
      <div className="flex items-start">
        {layout.map((item, li) => {
          if (item.kind === "branch") {
            const dotSize = compact ? 28 : 32;
            const r = 8;
            const arcWidth = 2 * r + 2;
            const arcHeight = dotSize + 2;

            const colors = layoutColors[li];
            const passColor =
              colors.kind === "branch" ? colors.passColor : "bg-gray-200";
            const hasPrecedingTrunk = li > 0 && layout[li - 1]?.kind === "trunk";
            const isAfterLastTrunk =
              hasPrecedingTrunk &&
              li - 1 === lastTrunkLi &&
              lastTrunkLi < layout.length - 1;
            const textColor =
              branchColorMap[passColor]?.text ?? "text-gray-200";
            const branchBorderColor =
              branchColorMap[passColor]?.border ?? "border-gray-200";
            const connectorBorderColor =
              borderColorMap[passColor] ?? "border-gray-200";

            return (
              <div
                key={li}
                className="relative inline-flex flex-col items-start"
              >
                {/* Row 1: pass-through connector at trunk height */}
                <div
                  className="flex items-center"
                  style={{ height: dotSize }}
                >
                  {li > 0 &&
                    (isAfterLastTrunk ? (
                      <div
                        className={`border-t-2 border-dashed ${connectorBorderColor} ${compact ? "w-4" : "w-2 sm:w-4"}`}
                      />
                    ) : (
                      <div
                        className={`h-0.5 ${compact ? "w-4" : "w-2 sm:w-4"} ${passColor}`}
                      />
                    ))}
                  {isAfterLastTrunk ? (
                    <div
                      className={`relative z-[2] flex-1 border-t-2 border-dashed ${connectorBorderColor}`}
                    />
                  ) : (
                    <div
                      className={`relative z-[2] h-0.5 flex-1 ${passColor}`}
                    />
                  )}
                </div>

                {/* Row 2: SVG arc + branch dots */}
                <div className="flex items-center">
                  {/* S-curve arc from trunk line to first branch dot (skip if no preceding trunk) */}
                  {hasPrecedingTrunk && (
                    <svg
                      className={`shrink-0 ${textColor} z-[1]`}
                      style={{
                        width: arcWidth,
                        height: arcHeight,
                        marginTop: -(dotSize / 2 + 1),
                      }}
                      viewBox={`0 0 ${arcWidth} ${arcHeight}`}
                      fill="none"
                    >
                      <path
                        d={`M 1 1 A ${r} ${r} 0 0 1 ${r + 1} ${r + 1} L ${r + 1} ${dotSize - r + 1} A ${r} ${r} 0 0 0 ${2 * r + 1} ${dotSize + 1}`}
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeDasharray="4 3"
                        strokeLinecap="round"
                      />
                    </svg>
                  )}

                  {/* Branch dots */}
                  {item.items.map((branchItem, bi) => (
                    <div key={bi} className="flex items-center">
                      {bi > 0 && (
                        <div
                          className={`border-t-2 border-dashed ${branchBorderColor} ${compact ? "w-3" : "w-2 sm:w-3"}`}
                        />
                      )}
                      {renderDot(stages[branchItem.index], branchItem.index)}
                    </div>
                  ))}
                </div>
              </div>
            );
          }

          // Trunk item
          const index = item.index;

          return (
            <div key={li} className="flex items-center">
              {/* Connector line (except before first) */}
              {li > 0 && (
                <div
                  className={`h-0.5 ${compact ? "w-4" : "w-2 sm:w-4"} ${getBarColor(index)}`}
                />
              )}

              {/* Dot */}
              {renderDot(stages[index], index)}
            </div>
          );
        })}
      </div>

      {/* Next button */}
      <Tooltip content="Next content">
        <button
          onClick={onNext}
          disabled={!canGoNext}
          className={`rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-default ${
            compact
              ? "p-1"
              : "min-w-8 min-h-8 sm:min-w-[44px] sm:min-h-[44px] p-1.5 sm:p-2 transition-all active:scale-95 shrink-0"
          }`}
        >
          <svg
            className={compact ? "w-4 h-4" : "w-4 h-4 sm:w-5 sm:h-5"}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>
      </Tooltip>
    </div>
  );
}
