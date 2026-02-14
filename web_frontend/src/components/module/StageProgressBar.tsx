// web_frontend/src/components/unified-lesson/StageProgressBar.tsx
import { useMemo } from "react";
import type { Stage } from "../../types/module";
import type { StageInfo } from "../../types/course";
import { buildBranchLayout } from "../../utils/branchLayout";
import { triggerHaptic } from "@/utils/haptics";
import { Tooltip } from "../Tooltip";
import {
  getCircleFillClasses,
  getRingClasses,
} from "../../utils/stageProgress";
import {
  buildBranchPaths,
  computeBranchStates,
  computeLayoutColors,
} from "../../utils/branchColors";

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

  // Branch subscription color model
  const branchPaths = useMemo(
    () =>
      buildBranchPaths(stages.map((s) => ({ optional: s.optional ?? false }))),
    [stages],
  );
  const branchStates = useMemo(
    () =>
      computeBranchStates(branchPaths, completedStages, currentSectionIndex),
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
    "bg-gray-200": { text: "text-gray-300", border: "border-gray-200" },
  };

  // Find the last trunk item index for dashed trailing connector
  const lastTrunkLi = (() => {
    for (let i = layout.length - 1; i >= 0; i--) {
      if (layout[i].kind === "trunk") return i;
    }
    return -1;
  })();

  function renderDot(stage: Stage, index: number, branch = false) {
    const isCompleted = completedStages.has(index);
    const isViewing = index === currentSectionIndex;
    const isOptional = "optional" in stage && stage.optional === true;

    const fillClasses = getCircleFillClasses(
      { isCompleted, isViewing, isOptional },
      { includeHover: true },
    );
    const ringClasses = getRingClasses(isViewing, isCompleted);

    const sizeClasses = compact
      ? "w-7 h-7"
      : "min-w-8 min-h-8 w-8 h-8 sm:min-w-[44px] sm:min-h-[44px] sm:w-11 sm:h-11";

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
            ${isViewing ? "z-[3]" : ""}
            ${sizeClasses}
            ${fillClasses}
            ${ringClasses}
          `}
        >
          <StageIcon type={stage.type} small={compact || branch} />
        </button>
      </Tooltip>
    );
  }

  return (
    <div className="flex items-start gap-2">
      {/* Previous button — wrapped to align with trunk dot center */}
      <div
        className={`flex items-center shrink-0 ${compact ? "h-7" : "h-8 sm:h-11"}`}
      >
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
      </div>

      {/* Stage dots */}
      <div className="flex items-start">
        {layout.map((item, li) => {
          if (item.kind === "branch") {
            const dotSize = compact ? 28 : 32;
            const drop = compact ? 20 : 24; // distance from trunk center to branch dot center
            const r = Math.min(8, Math.floor(drop / 2));
            const arcWidth = 2 * r + 2;
            const arcHeight = drop + 2;

            const colors = layoutColors[li];
            const passColor =
              colors.kind === "branch" ? colors.passColor : "bg-gray-200";
            const segmentColors =
              colors.kind === "branch" ? colors.segmentColors : [];
            const hasPrecedingTrunk =
              li > 0 && layout[li - 1]?.kind === "trunk";
            const isAfterLastTrunk =
              hasPrecedingTrunk &&
              li - 1 === lastTrunkLi &&
              lastTrunkLi < layout.length - 1;
            // Arc color from first segment
            const arcColor = segmentColors[0] ?? "bg-gray-200";
            const arcTextColor =
              branchColorMap[arcColor]?.text ?? "text-gray-200";
            // Trunk pass-through stub uses trunk color
            const connectorTextColor =
              branchColorMap[passColor]?.text ?? "text-gray-200";

            // When branch lines are darker than the trunk pass-through,
            // bump them above so the light solid line doesn't cover the dark dotted lines.
            const colorRank: Record<string, number> = {
              "bg-gray-200": 0,
              "bg-gray-400": 1,
              "bg-blue-400": 2,
            };
            const arcDarker =
              (colorRank[segmentColors[0]] ?? 0) > (colorRank[passColor] ?? 0);
            const arcZ = arcDarker ? "z-[2]" : "z-[1]";
            const passZ = arcDarker ? "z-[1]" : "z-[2]";

            return (
              <div
                key={li}
                className="relative inline-flex flex-col items-start"
              >
                {/* Trunk pass-through — flex-centered to match trunk connector alignment */}
                {isAfterLastTrunk ? (
                  /* Trailing: short dashed stub just past the arc fork */
                  <div
                    className={`absolute left-0 w-3 flex items-center ${passZ} ${
                      compact ? "h-7" : "h-8 sm:h-11"
                    }`}
                  >
                    <div
                      className={`w-full dotted-round-h ${connectorTextColor}`}
                    />
                  </div>
                ) : (
                  /* Mid-layout: solid trunk pass-through + dotted fork overlay */
                  <>
                    {/* Layer 1: solid trunk continuation (mandatory→mandatory) */}
                    <div
                      className={`absolute left-0 right-0 flex items-center ${passZ} ${
                        compact ? "h-7" : "h-8 sm:h-11"
                      }`}
                    >
                      <div className={`flex-1 h-0.5 ${passColor}`} />
                    </div>
                    {/* Layer 2: dotted fork segment (mandatory→optional), same color as arc */}
                    {hasPrecedingTrunk && (
                      <div
                        className={`absolute left-0 flex items-center ${arcZ} ${
                          compact ? "h-7" : "h-8 sm:h-11"
                        }`}
                      >
                        <div
                          className={`dotted-round-h ${arcTextColor} ${compact ? "w-4" : "w-2 sm:w-4"}`}
                        />
                      </div>
                    )}
                  </>
                )}

                {/* S-curve arc — absolutely positioned from trunk center to branch row */}
                {hasPrecedingTrunk && (
                  <svg
                    className={`absolute ${arcTextColor} ${arcZ} pointer-events-none ${compact ? "left-4" : "left-2 sm:left-4"}`}
                    style={{
                      top: dotSize / 2 - 1,
                      width: arcWidth,
                      height: arcHeight,
                    }}
                    viewBox={`0 0 ${arcWidth} ${arcHeight}`}
                    fill="none"
                  >
                    <path
                      d={`M 1 1 A ${r} ${r} 0 0 1 ${r + 1} ${r + 1} L ${r + 1} ${drop - r + 1} A ${r} ${r} 0 0 0 ${2 * r + 1} ${drop + 1}`}
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeDasharray="0 5"
                      strokeLinecap="round"
                    />
                  </svg>
                )}

                {/* Branch content row: connector gap + arc spacer + branch dots */}
                <div className="flex items-center" style={{ paddingTop: drop }}>
                  {/* Spacer matching connector-in + arc width */}
                  {li > 0 && (
                    <div
                      className={`${compact ? "w-4" : "w-2 sm:w-4"} shrink-0`}
                    />
                  )}
                  {hasPrecedingTrunk && (
                    <div style={{ width: arcWidth }} className="shrink-0" />
                  )}

                  {/* Branch dots */}
                  {item.items.map((branchItem, bi) => (
                    <div key={bi} className="flex items-center">
                      {bi > 0 && (
                        <div
                          className={`dotted-round-h ${
                            branchColorMap[segmentColors[bi]]?.text ??
                            "text-gray-200"
                          } ${compact ? "w-3" : "w-2 sm:w-3"}`}
                        />
                      )}
                      {renderDot(
                        stages[branchItem.index],
                        branchItem.index,
                        true,
                      )}
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
                  className={`h-0.5 ${compact ? "w-4" : "w-2 sm:w-4"} ${
                    layoutColors[li].kind === "trunk"
                      ? layoutColors[li].connectorColor
                      : "bg-gray-200"
                  }`}
                />
              )}

              {/* Dot */}
              {renderDot(stages[index], index)}
            </div>
          );
        })}
      </div>

      {/* Next button — wrapped to align with trunk dot center */}
      <div
        className={`flex items-center shrink-0 ${compact ? "h-7" : "h-8 sm:h-11"}`}
      >
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
    </div>
  );
}
