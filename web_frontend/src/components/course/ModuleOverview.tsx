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
  getCircleFillClasses,
  getRingClasses,
} from "../../utils/stageProgress";
import {
  buildBranchPaths,
  computeBranchStates,
  computeLayoutColors,
} from "../../utils/branchColors";
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
  const layout = useMemo(() => buildBranchLayout(stages), [stages]);

  // Branch subscription color model
  const branchPaths = useMemo(
    () => buildBranchPaths(stages.map((s) => ({ optional: s.optional }))),
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

  // Index of the last trunk item in the layout
  const lastTrunkLi = (() => {
    for (let i = layout.length - 1; i >= 0; i--) {
      if (layout[i].kind === "trunk") return i;
    }
    return -1;
  })();

  // Static mapping so Tailwind's scanner sees full class names
  const textColorMap: Record<string, string> = {
    "bg-blue-400": "text-blue-400",
    "bg-gray-400": "text-gray-400",
    "bg-gray-200": "text-gray-300",
  };

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
        className={`group relative flex items-center gap-4 py-2 rounded-lg ${
          isClickable ? "cursor-pointer" : ""
        }`}
        onClick={() => isClickable && onStageClick(index)}
      >
        {/* Hover background — absolutely positioned at z-auto, paints below z-[1]+ elements */}
        {isClickable && (
          <div className="absolute inset-0 rounded-lg bg-slate-50 opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
        {/* Circle */}
        <div
          className={`relative z-10 w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${fillClasses} ${ringClasses}`}
        >
          <StageIcon type={stage.type} small />
        </div>

        {/* Content */}
        <div className="relative z-[5] flex-1 min-w-0">
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
              // Dash the bottom connector when only optional content follows
              const trailsIntoBranchOnly = li === lastTrunkLi && !isLast;
              return (
                <div key={li} className="relative">
                  {/* Top connector: from previous item to this circle center */}
                  {/* left-[0.875rem] = half of w-7 (14px) = center of circle within this wrapper */}
                  {!isFirst && (
                    <div
                      className={`absolute left-[0.875rem] top-0 bottom-1/2 w-0.5 -translate-x-1/2 z-[1] ${colors.connectorColor}`}
                    />
                  )}
                  {/* Bottom connector: from this circle center to next item */}
                  {!isLast &&
                    (trailsIntoBranchOnly ? (
                      <div
                        className={`absolute left-[0.875rem] top-1/2 bottom-0 -translate-x-1/2 z-[1] dotted-round-v ${textColorMap[colors.outgoingColor] ?? "text-gray-200"}`}
                      />
                    ) : (
                      <div
                        className={`absolute left-[0.875rem] top-1/2 bottom-0 w-0.5 -translate-x-1/2 z-[1] ${colors.outgoingColor}`}
                      />
                    ))}
                  {renderStageRow(item.stage, item.index)}
                </div>
              );
            }

            if (item.kind === "branch" && colors.kind === "branch") {
              // Leading branch (first layout item) = no preceding trunk
              const hasPrecedingTrunk = li > 0;

              // Geometry (px from branch wrapper's left edge):
              //   Trunk line center:  14  (0.875rem = half of w-7)
              //   Branch dot center:  46  (ml-8 32px + half w-7 14px)
              const trunkX = 14;
              const branchX = 46; // ml-8 (32px) + half w-7 (14px)
              const endX = branchX - trunkX + 1;
              const r = 10; // arc corner radius
              const trunkEndY = 0;
              // The SVG draws only the curve (two arcs). The vertical drop
              // to the first circle is handled by a separate div with bottom-1/2,
              // so it adapts to variable row heights (2-line vs 3-line titles).
              const svgHeight = 2 * r + 2;
              // Offset from first branch item's top to where the curve ends:
              // curve ends at y = 2*r = 32 in wrapper; pt-6 (24px) pushes items down,
              // so the curve endpoint is 32 - 24 = 8px below the first item's top.
              const forkConnectorTop = 2 * r - 24; // 8px

              // Static mapping so Tailwind's scanner sees full class names
              const forkColors: Record<
                string,
                { text: string; border: string }
              > = {
                "bg-blue-400": {
                  text: "text-blue-400",
                  border: "border-blue-400",
                },
                "bg-gray-400": {
                  text: "text-gray-400",
                  border: "border-gray-400",
                },
                "bg-gray-200": {
                  text: "text-gray-300",
                  border: "border-gray-200",
                },
              };
              const segmentColors = colors.segmentColors;
              const arcFork =
                forkColors[segmentColors[0]] ?? forkColors["bg-gray-200"];
              const forkDotColor = (i: number) =>
                (forkColors[segmentColors[i]] ?? forkColors["bg-gray-200"])
                  .text;

              // When branch lines are darker than the trunk pass-through,
              // bump them above so the light solid line doesn't cover the dark dotted lines.
              const colorRank: Record<string, number> = {
                "bg-gray-200": 0,
                "bg-gray-400": 1,
                "bg-blue-400": 2,
              };
              const arcDarker =
                (colorRank[segmentColors[0]] ?? 0) >
                (colorRank[colors.passColor] ?? 0);
              const arcZ = arcDarker ? "z-[2]" : "z-[1]";
              const passZ = arcDarker ? "z-[1]" : "z-[2]";
              const branchConnZ = arcDarker ? "z-[3]" : "z-[2]";

              return (
                <div key={li} className="relative">
                  {/* SVG fork curve — rendered first so trunk pass-through paints over the overlap */}
                  {hasPrecedingTrunk && (
                    <svg
                      className={`absolute ${arcZ} ${arcFork.text} pointer-events-none`}
                      style={{
                        left: trunkX - 1,
                        top: 0,
                        width: branchX - trunkX + 2,
                        height: svgHeight,
                      }}
                      viewBox={`0 0 ${branchX - trunkX + 2} ${svgHeight}`}
                      fill="none"
                    >
                      <path
                        d={`M 1 0 A ${r} ${r} 0 0 0 ${1 + r} ${r} L ${endX - r} ${r} A ${r} ${r} 0 0 1 ${endX} ${2 * r}`}
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeDasharray="0 5"
                        strokeLinecap="round"
                      />
                    </svg>
                  )}
                  {/* Trunk pass-through — on top of SVG so solid line hides the dashed overlap */}
                  {hasPrecedingTrunk && (
                    <div
                      className={`absolute left-[0.875rem] top-0 w-0.5 -translate-x-1/2 ${passZ} ${colors.passColor} ${
                        isLast ? "" : "bottom-0"
                      }`}
                      style={isLast ? { height: trunkEndY } : undefined}
                    />
                  )}
                  {/* Branch items, indented — pt-6 gives the S-curve room to breathe */}
                  <div className="ml-8 pt-6 pb-1">
                    {item.items.map((branchItem, bi) => (
                      <div key={bi} className="relative">
                        {/* Fork-to-circle connector for first item (adapts to row height via bottom-1/2) */}
                        {bi === 0 && hasPrecedingTrunk && (
                          <div
                            className={`absolute ${branchConnZ} left-[0.875rem] bottom-1/2 -translate-x-1/2 dotted-round-v ${forkDotColor(0)}`}
                            style={{ top: forkConnectorTop }}
                          />
                        )}
                        {/* Branch connector above (dashed, between items) */}
                        {bi > 0 && (
                          <div
                            className={`absolute ${branchConnZ} left-[0.875rem] top-0 bottom-1/2 -translate-x-1/2 dotted-round-v ${forkDotColor(bi)}`}
                          />
                        )}
                        {/* Branch connector below */}
                        {bi < item.items.length - 1 && (
                          <div
                            className={`absolute ${branchConnZ} left-[0.875rem] top-1/2 bottom-0 -translate-x-1/2 dotted-round-v ${forkDotColor(bi + 1)}`}
                          />
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
