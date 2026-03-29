// web_frontend/src/components/unified-lesson/StageProgressBar.tsx
import { useMemo, type ReactNode } from "react";
import { BotMessageSquare } from "lucide-react";
import type { Stage } from "../../types/module";
import type { StageInfo } from "../../types/course";
import { buildBranchLayout } from "../../utils/branchLayout";
import { formatDurationMinutes } from "../../utils/duration";
import { triggerHaptic } from "@/utils/haptics";
import { StageCircle } from "../StageCircle";
import { Tooltip } from "../Tooltip";
import { OptionalBadge } from "../OptionalBadge";
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
  testModeActive?: boolean; // Dims non-test dots and blocks their clicks during test mode
};

function getStageTitle(stage: Stage): string {
  if (stage.title) return stage.title;
  // Fallback based on type
  if (stage.type === "video") return "Video";
  if (stage.type === "article") return "Article";
  if (stage.type === "lens") return "Lens";
  if (stage.type === "test") return "Test";
  return "Discussion";
}

function getTooltipContent(
  stage: Stage,
  index: number,
  isCompleted: boolean,
  isViewing: boolean,
): ReactNode {
  const isOptional = "optional" in stage && stage.optional === true;
  const title = getStageTitle(stage);
  const hasTldr = stage.tldr;
  const hasDuration = stage.duration != null && stage.duration > 0;

  // Simple text tooltip when no extra info
  if (!hasTldr && !hasDuration) {
    const optionalPrefix = isOptional && !isViewing ? "(Optional) " : "";
    return `${optionalPrefix}${title}`;
  }

  // Rich tooltip with title, badges, duration, and tldr
  return (
    <div className="max-w-xs">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="font-medium text-slate-900">{title}</span>
      </div>
      {hasDuration &&
        (() => {
          const isVideo = stage.type === "video";
          const contentTime = Math.round(stage.duration! / 1.5);
          const aiTime = stage.duration! - contentTime;
          return (
            <div className="flex items-center gap-0.5 text-slate-500 text-xs mt-0.5">
              {isOptional && !isViewing && (
                <>
                  <OptionalBadge />{" "}
                </>
              )}
              {isVideo ? (
                <svg
                  className="w-3 h-3"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                    clipRule="evenodd"
                  />
                </svg>
              ) : (
                <svg
                  className="w-3 h-3"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
              <span>{formatDurationMinutes(contentTime)}</span>
              {aiTime > 0 && (
                <>
                  <span>+</span>
                  <BotMessageSquare className="w-3 h-3 ml-0.5" />
                  <span>{formatDurationMinutes(aiTime)}</span>
                </>
              )}
            </div>
          );
        })()}
      {!hasDuration && isOptional && !isViewing && (
        <div className="mt-0.5">
          <OptionalBadge />
        </div>
      )}
      {hasTldr && <p className="text-slate-600 mt-1">{stage.tldr}</p>}
    </div>
  );
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
  testModeActive = false,
}: StageProgressBarProps) {
  const handleDotClick = (index: number) => {
    // Block clicks on non-test dots during test mode
    if (testModeActive) {
      const stage = stages[index];
      const isTestStage = stage.type === "test";
      if (!isTestStage) return;
    }
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
          hide: s.hide,
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
    "bg-lens-orange-400": {
      text: "text-lens-orange-400",
      border: "border-lens-orange-400",
    },
    "bg-gray-400": { text: "text-gray-400", border: "border-gray-400" },
    "bg-gray-200": { text: "text-gray-300", border: "border-gray-200" },
  };

  // Pre-filter hidden items so index math (isFirst/isLast/trailsIntoBranch) just works
  const visibleLayout = useMemo(() => {
    type VEntry = {
      item: (typeof layout)[number];
      li: number;
      visibleItems?: { index: number; stage: StageInfo }[];
    };
    return layout.reduce<VEntry[]>((acc, item, li) => {
      if (item.kind === "trunk") {
        if (!stages[item.index]?.hide) acc.push({ item, li });
      } else {
        const vis = item.items.filter((bi) => !stages[bi.index]?.hide);
        if (vis.length > 0) acc.push({ item, li, visibleItems: vis });
      }
      return acc;
    }, []);
  }, [layout, stages]);

  const lastVisibleTrunkVi = (() => {
    for (let i = visibleLayout.length - 1; i >= 0; i--) {
      if (visibleLayout[i].item.kind === "trunk") return i;
    }
    return -1;
  })();

  function renderDot(stage: Stage, index: number, branch = false) {
    const isCompleted = completedStages.has(index);
    const isViewing = index === currentSectionIndex;
    const isOptional = "optional" in stage && stage.optional === true;

    // Test mode dimming: dim non-test dots
    const isTestDot = stage.type === "test";
    const isDimmed = testModeActive && !isTestDot;

    return (
      <Tooltip
        content={getTooltipContent(stage, index, isCompleted, isViewing)}
        placement="bottom"
      >
        <button
          onClick={() => handleDotClick(index)}
          disabled={isDimmed}
          className={`
            relative
            transition-all duration-150
            ${compact ? "" : "active:scale-95 shrink-0"}
            ${isViewing ? "z-[3]" : ""}
            ${isDimmed ? "opacity-30 cursor-default" : ""}
          `}
        >
          <StageCircle
            type={stage.type}
            isCompleted={isCompleted}
            isViewing={isViewing}
            isOptional={isOptional}
            size={compact || branch ? 28 : 44}
            optionalBg="bg-[var(--brand-bg)]"
            includeHover={!isDimmed}
          />
        </button>
      </Tooltip>
    );
  }

  return (
    <div className="flex items-start gap-2">
      {/* Previous button — wrapped to align with trunk dot center */}
      <div className={`flex items-center shrink-0 ${compact ? "h-7" : "h-11"}`}>
        <Tooltip content="Previous content">
          <button
            onClick={onPrevious}
            disabled={!canGoPrevious}
            className={`rounded hover:bg-black/5 disabled:opacity-30 disabled:cursor-default ${
              compact
                ? "p-1"
                : "min-w-[44px] min-h-[44px] p-2 transition-all active:scale-95 shrink-0"
            }`}
          >
            <svg
              className={compact ? "w-4 h-4" : "w-5 h-5"}
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
        {visibleLayout.map((entry, vi) => {
          const { item, li } = entry;
          if (item.kind === "branch") {
            const visibleItems = entry.visibleItems!;
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
              vi > 0 && visibleLayout[vi - 1].item.kind === "trunk";
            const isLastBranch = vi - 1 === lastVisibleTrunkVi;
            const isAfterLastTrunk = hasPrecedingTrunk && isLastBranch;
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
              "bg-lens-orange-400": 2,
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

                  {/* Branch dots (only visible ones) */}
                  {visibleItems.map((branchItem, bi) => (
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
              {/* Connector line (except before first visible) */}
              {vi > 0 && (
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
      <div className={`flex items-center shrink-0 ${compact ? "h-7" : "h-11"}`}>
        <Tooltip content="Next content">
          <button
            onClick={onNext}
            disabled={!canGoNext}
            className={`rounded hover:bg-black/5 disabled:opacity-30 disabled:cursor-default ${
              compact
                ? "p-1"
                : "min-w-[44px] min-h-[44px] p-2 transition-all active:scale-95 shrink-0"
            }`}
          >
            <svg
              className={compact ? "w-4 h-4" : "w-5 h-5"}
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
