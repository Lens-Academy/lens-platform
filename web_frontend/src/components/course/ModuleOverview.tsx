/**
 * Vertical stage list with progress line.
 * Reused in course overview main panel and in-player drawer.
 *
 * Optional sections render as "branches" off the main trunk (like a VCS graph)
 * to subtly disincentivize defaulting to optional content.
 */

import { useMemo } from "react";
import type { StageInfo, ModuleStatus } from "../../types/course";
import { OptionalBadge } from "../OptionalBadge";
import { StageCircle } from "../StageCircle";
import {
  buildBranchPaths,
  computeBranchStates,
  computeLayoutColors,
} from "../../utils/branchColors";
import { buildBranchLayout } from "../../utils/branchLayout";
import { formatDurationMinutes } from "../../utils/duration";
import { BotMessageSquare, ChevronLeft, ChevronRight } from "lucide-react";

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
  // Test mode: dims non-test items during test
  testModeActive?: boolean;
  // Navigation between modules in the same unit
  prevModule?: { title: string } | null;
  nextModule?: { title: string } | null;
  onNavigate?: (direction: "prev" | "next") => void;
  // Parent module context (shown as breadcrumb on mobile)
  parentTitle?: string | null;
  isMobile?: boolean;
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
  testModeActive = false,
  prevModule,
  nextModule,
  onNavigate,
  parentTitle,
  isMobile,
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

  // Pre-filter hidden items so index math (isFirst/isLast/trailsIntoBranch) just works
  const visibleLayout = useMemo(() => {
    type VEntry = { item: (typeof layout)[number]; li: number; visibleItems?: { index: number; stage: StageInfo }[] };
    return layout.reduce<VEntry[]>((acc, item, li) => {
      if (item.kind === "trunk") {
        if (!item.stage.hide) acc.push({ item, li });
      } else {
        const vis = item.items.filter((bi) => !bi.stage.hide);
        if (vis.length > 0) acc.push({ item, li, visibleItems: vis });
      }
      return acc;
    }, []);
  }, [layout]);

  // Static mapping so Tailwind's scanner sees full class names
  const textColorMap: Record<string, string> = {
    "bg-lens-orange-400": "text-lens-orange-400",
    "bg-gray-400": "text-gray-400",
    "bg-gray-200": "text-gray-300",
  };

  /** Render a stage row (circle + content). Used by both trunk and branch items. */
  function renderStageRow(stage: StageInfo, index: number) {
    const isCompleted = completedStages.has(index);
    const isViewing = index === currentSectionIndex;
    const isClickable = onStageClick && stage.type !== "chat";

    // Test mode dimming: dim non-test items
    const isTestStage = stage.type === "test";
    const isDimmed = testModeActive && !isTestStage;

    return (
      <div
        className={`group relative flex items-start gap-4 py-2 rounded-lg ${
          isClickable && !isDimmed ? "cursor-pointer" : ""
        } ${isDimmed ? "opacity-30 pointer-events-none" : ""}`}
        onClick={() => isClickable && !isDimmed && onStageClick(index)}
      >
        {/* Hover background — absolutely positioned at z-auto, paints below z-[1]+ elements */}
        {isClickable && (
          <div
            className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ backgroundColor: "var(--brand-bg)" }}
          />
        )}
        {/* Circle */}
        <StageCircle
          type={stage.type}
          displayType={stage.displayType}
          isCompleted={isCompleted}
          isViewing={isViewing}
          isOptional={stage.optional}
          size={28}
          optionalBg="bg-[var(--brand-bg)]"
          className="z-10"
        />

        {/* Content */}
        <div className="relative z-[5] flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span
              className="font-medium text-[var(--brand-text)]"
              style={{ fontFamily: "var(--brand-font-display)" }}
            >
              {stage.title}
            </span>
            {stage.type !== "chat" && stage.duration != null && stage.duration > 0 && (() => {
              const isVideo =
                stage.type === "video" ||
                stage.displayType === "lens-video" ||
                stage.displayType === "lens-mixed";
              const contentTime = Math.round(stage.duration / 1.5);
              const aiTime = stage.duration - contentTime;
              return (
                <span className="inline-flex items-center gap-0.5 whitespace-nowrap text-sm text-[var(--brand-text)] ml-auto flex-shrink-0">
                  {isVideo ? (
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                        clipRule="evenodd"
                      />
                    </svg>
                  ) : (
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
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
                </span>
              );
            })()}
          </div>
          <div className="text-sm text-[var(--brand-text)] flex items-center gap-1.5">
            {stage.optional && <OptionalBadge />}
            {stage.type === "chat"
              ? "Discuss with AI tutor"
              : (() => {
                  const isVideo =
                    stage.type === "video" ||
                    stage.displayType === "lens-video" ||
                    stage.displayType === "lens-mixed";
                  if (!stage.duration) {
                    const label = isVideo
                      ? "Video"
                      : stage.type === "test"
                        ? "Test"
                        : stage.displayType === "lens-article"
                          ? "Article"
                          : stage.type === "lens"
                            ? "Lens"
                            : "Article";
                    return stage.attribution ? (
                      <span>
                        {label} · <span className="italic">{stage.attribution}</span>
                      </span>
                    ) : (
                      label
                    );
                  }
                  return stage.attribution ? (
                    <span className="italic">{stage.attribution}</span>
                  ) : null;
                })()}
          </div>
          {stage.tldr && (
            <p className="mt-1 text-sm text-[var(--brand-text)]">
              {stage.tldr}
            </p>
          )}
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
        {isMobile && parentTitle && (
          <p className="text-sm text-[var(--brand-text-muted)] mb-1">
            {parentTitle} ›
          </p>
        )}
        <div className="flex items-start justify-between gap-4">
          <h2
            className="text-2xl font-bold"
            style={{
              color: "var(--brand-text)",
              fontFamily: "var(--brand-font-display)",
            }}
          >
            {moduleTitle}
          </h2>
          {showActions && onStartModule && (
            <button
              onClick={onStartModule}
              className="px-5 py-1.5 text-sm font-semibold rounded-lg transition-colors shrink-0"
              style={{
                backgroundColor: "var(--brand-accent)",
                color: "var(--brand-accent-text)",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.backgroundColor =
                  "var(--brand-accent-hover)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.backgroundColor = "var(--brand-accent)")
              }
            >
              {getActionLabel()}
            </button>
          )}
        </div>
        {/* Progress badge for in-progress modules */}
        {status === "in_progress" &&
          completedLenses !== undefined &&
          totalLenses !== undefined &&
          totalLenses > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <div
                className="flex-1 h-2 rounded-full overflow-hidden"
                style={{ backgroundColor: "var(--brand-border)" }}
              >
                <div
                  className="h-full bg-lens-orange-400 rounded-full transition-all"
                  style={{
                    width: `${(completedLenses / totalLenses) * 100}%`,
                  }}
                />
              </div>
              <span className="text-sm text-[var(--brand-text-muted)] font-medium">
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

      {/* Prev/Next module navigation */}
      {(prevModule || nextModule) && (
        <div className="flex items-center justify-between mb-4 -mt-2">
          {prevModule ? (
            <button
              onClick={() => onNavigate?.("prev")}
              className="flex items-center gap-1 text-sm text-[var(--brand-text)] hover:text-[var(--brand-text)] transition-colors min-w-0 max-w-[45%]"
            >
              <ChevronLeft className="w-4 h-4 flex-shrink-0" />
              <span className="truncate">{prevModule.title}</span>
            </button>
          ) : (
            <div />
          )}
          {nextModule ? (
            <button
              onClick={() => onNavigate?.("next")}
              className="flex items-center gap-1 text-sm text-[var(--brand-text)] hover:text-[var(--brand-text)] transition-colors min-w-0 max-w-[45%]"
            >
              <span className="truncate">{nextModule.title}</span>
              <ChevronRight className="w-4 h-4 flex-shrink-0" />
            </button>
          ) : (
            <div />
          )}
        </div>
      )}

      {/* Stage list — branching layout */}
      <div className="flex-1 overflow-y-auto">
        {/* pl-1 gives space for the selection ring to not be cut off */}
        <div className="pl-1">
          {visibleLayout.map((entry, vi) => {
            const { item, li } = entry;
            const colors = layoutColors[li];
            const isFirst = vi === 0;
            const isLast = vi === visibleLayout.length - 1;

            if (item.kind === "trunk" && colors.kind === "trunk") {
              const trailsIntoBranchOnly = visibleLayout[vi + 1]?.item.kind === "branch";
              return (
                <div key={li} className="relative">
                  {/* Top connector: from previous item to this circle center */}
                  {/* left-[0.875rem] = half of w-7 (14px) = center of circle within this wrapper */}
                  {/* h-[22px] = py-2 (8px) + half circle (14px) = circle center from top */}
                  {!isFirst && (
                    <div
                      className={`absolute left-[0.875rem] top-0 h-[22px] w-0.5 -translate-x-1/2 z-[1] ${colors.connectorColor}`}
                    />
                  )}
                  {/* Bottom connector: from this circle center to next item */}
                  {!isLast &&
                    (trailsIntoBranchOnly ? (
                      <div
                        className={`absolute left-[0.875rem] top-[22px] bottom-0 -translate-x-1/2 z-[1] dotted-round-v ${textColorMap[colors.outgoingColor] ?? "text-gray-200"}`}
                      />
                    ) : (
                      <div
                        className={`absolute left-[0.875rem] top-[22px] bottom-0 w-0.5 -translate-x-1/2 z-[1] ${colors.outgoingColor}`}
                      />
                    ))}
                  {renderStageRow(item.stage, item.index)}
                </div>
              );
            }

            if (item.kind === "branch" && colors.kind === "branch") {
              // Leading branch (first layout item) = no preceding trunk
              const hasPrecedingTrunk = vi > 0 && visibleLayout[vi - 1].item.kind === "trunk";

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
                "bg-lens-orange-400": {
                  text: "text-lens-orange-400",
                  border: "border-lens-orange-400",
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
                "bg-lens-orange-400": 2,
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
                    {(entry.visibleItems ?? item.items).map((branchItem, bi) => (
                      <div key={bi} className="relative">
                        {/* Fork-to-circle connector for first item — ends at circle center (22px from top) */}
                        {bi === 0 && hasPrecedingTrunk && (
                          <div
                            className={`absolute ${branchConnZ} left-[0.875rem] bottom-[calc(100%-22px)] -translate-x-1/2 dotted-round-v ${forkDotColor(0)}`}
                            style={{ top: forkConnectorTop }}
                          />
                        )}
                        {/* Branch connector above (dashed, between items) */}
                        {bi > 0 && (
                          <div
                            className={`absolute ${branchConnZ} left-[0.875rem] top-0 h-[22px] -translate-x-1/2 dotted-round-v ${forkDotColor(bi)}`}
                          />
                        )}
                        {/* Branch connector below */}
                        {bi < (entry.visibleItems ?? item.items).length - 1 && (
                          <div
                            className={`absolute ${branchConnZ} left-[0.875rem] top-[22px] bottom-0 -translate-x-1/2 dotted-round-v ${forkDotColor(bi + 1)}`}
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
    </div>
  );
}
