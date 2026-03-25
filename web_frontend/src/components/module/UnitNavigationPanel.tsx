/**
 * Unit navigation panel — tree view of modules and sections within a unit.
 * Shows parent groups, expandable modules with branch timelines, and inline TLDRs.
 * Used inside ModuleDrawer (sidebar).
 */

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useMedia } from "react-use";
import { ChevronRight, BotMessageSquare, X } from "lucide-react";
import type { ModuleInfo, StageInfo } from "@/types/course";
import { formatDurationMinutes } from "@/utils/duration";
import { StageCircle } from "../StageCircle";
import { buildBranchLayout } from "@/utils/branchLayout";
import { linkProps } from "@/utils/navigateLink";
import { generateHeadingId } from "@/utils/extractHeadings";
import {
  buildBranchPaths,
  computeBranchStates,
  computeLayoutColors,
} from "@/utils/branchColors";
import { ProgressCircle } from "../ProgressCircle";

// --- Helper types and functions ---

type ModuleGroup =
  | {
      kind: "parent";
      parentSlug: string;
      parentTitle: string;
      children: ModuleInfo[];
    }
  | { kind: "standalone"; module: ModuleInfo };

function groupModules(modules: ModuleInfo[]): ModuleGroup[] {
  const groups: ModuleGroup[] = [];
  let i = 0;
  while (i < modules.length) {
    const mod = modules[i];
    if (mod.parentSlug) {
      const parentSlug = mod.parentSlug;
      const parentTitle = mod.parentTitle || parentSlug;
      const children: ModuleInfo[] = [];
      while (i < modules.length && modules[i].parentSlug === parentSlug) {
        children.push(modules[i]);
        i++;
      }
      groups.push({ kind: "parent", parentSlug, parentTitle, children });
    } else {
      groups.push({ kind: "standalone", module: mod });
      i++;
    }
  }
  return groups;
}

// --- Subcomponents ---


function StageDuration({
  duration,
  type,
  displayType,
}: {
  duration: number | null;
  type: string;
  displayType?: string;
}) {
  if (!duration || duration <= 0) return null;
  const isVideo =
    type === "video" ||
    displayType === "lens-video" ||
    displayType === "lens-mixed";
  const contentTime = Math.round(duration / 1.5);
  const aiTime = duration - contentTime;
  return (
    <span className="inline-flex items-center gap-0.5 text-xs text-slate-900 whitespace-nowrap ml-auto flex-shrink-0 tabular-nums">
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
}

// Static color map for Tailwind scanner
const textColorMap: Record<string, string> = {
  "bg-lens-orange-400": "text-lens-orange-400",
  "bg-gray-400": "text-gray-400",
  "bg-gray-200": "text-gray-300",
};

// --- SectionList with branch layout ---

function SectionList({
  stages,
  isCurrent,
  currentSectionIndex,
  completedSections,
  courseId,
  moduleSlug,
  onSectionClick,
  onClose,
  allTldrsExpanded,
}: {
  stages: StageInfo[];
  isCurrent: boolean;
  currentSectionIndex: number;
  completedSections: Set<number>;
  courseId: string;
  moduleSlug: string;
  onSectionClick: (index: number) => void;
  onClose: () => void;
  allTldrsExpanded: boolean;
}) {
  const completed = useMemo(() => {
    if (isCurrent) return completedSections;
    const s = new Set<number>();
    stages.forEach((st, i) => {
      if (st.completed) s.add(i);
    });
    return s;
  }, [isCurrent, completedSections, stages]);

  const curIdx = isCurrent ? currentSectionIndex : -1;

  const layout = useMemo(() => buildBranchLayout(stages), [stages]);
  const branchPaths = useMemo(
    () => buildBranchPaths(stages.map((s) => ({ optional: s.optional }))),
    [stages],
  );
  const branchStates = useMemo(
    () => computeBranchStates(branchPaths, completed, curIdx),
    [branchPaths, completed, curIdx],
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

  if (stages.length === 0) return null;

  function renderRow(stage: StageInfo, index: number) {
    const isCompleted = completed.has(index);
    const isCurrentSection = index === curIdx;

    const dot = (
      <StageCircle
        type={stage.type}
        displayType={stage.displayType}
        isCompleted={isCompleted}
        isViewing={isCurrentSection}
        isOptional={stage.optional}
        size={24}
        className="z-10"
      />
    );
    const content = (
      <div className="flex items-start gap-2.5 w-full min-w-0">
        {dot}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <span
              className={`text-[17px] leading-snug font-display truncate text-slate-900 ${allTldrsExpanded ? "font-medium" : ""}`}
            >
              {stage.title}
            </span>
            <StageDuration
              duration={stage.duration}
              type={stage.type}
              displayType={stage.displayType}
            />
          </div>
          {stage.attribution && (
            <span className="text-sm text-slate-600 italic truncate block">
              {stage.attribution}
            </span>
          )}
          {stage.tldr && (
            <p
              className={`text-sm text-slate-900 overflow-hidden transition-[max-height] duration-500 ease-in-out mt-0.5`}
              style={{ maxHeight: allTldrsExpanded ? "20em" : 0 }}
            >
              {stage.tldr}
            </p>
          )}
        </div>
      </div>
    );

    const sectionHref = `/course/${courseId}/module/${moduleSlug}#${generateHeadingId(stage.title)}`;

    if (isCurrent) {
      return (
        <button
          {...linkProps(sectionHref, () => {
            onSectionClick(index);
          })}
          data-section-current={isCurrentSection || undefined}
          className={`block p-2 rounded-[16px] text-left w-full transition-colors ${
            isCurrentSection
              ? "text-gray-900 bg-[#f0ece4]"
              : "text-gray-800 hover:text-gray-900 hover:bg-[#f5f1ea]"
          }`}
        >
          {content}
        </button>
      );
    }

    return (
      <button
        {...linkProps(sectionHref, () => {
          window.location.href = sectionHref;
          onClose();
        })}
        className="block p-2 rounded-[16px] text-left w-full text-gray-800 hover:text-gray-900 hover:bg-[#f5f1ea] transition-colors"
      >
        {content}
      </button>
    );
  }

  const dotCenter = 20;
  const branchDotCenter = 40;
  const forkR = 8;
  const forkSvgH = 2 * forkR + 2;

  return (
    <div className="ml-5 mt-1.5 mb-1.5 pl-0.5">
      {visibleLayout.map((entry, vi) => {
        const { item, li } = entry;
        const colors = layoutColors[li];
        const isFirst = vi === 0;
        const isLast = vi === visibleLayout.length - 1;

        if (item.kind === "trunk" && colors.kind === "trunk") {
          const trailsIntoBranchOnly = visibleLayout[vi + 1]?.item.kind === "branch";
          return (
            <div key={li} className="relative">
              {!isFirst && (
                <div
                  className={`absolute left-[20px] top-0 h-[20px] w-0.5 -translate-x-1/2 z-[1] ${colors.connectorColor}`}
                />
              )}
              {!isLast &&
                (trailsIntoBranchOnly ? (
                  <div
                    className={`absolute left-[20px] top-[20px] bottom-0 -translate-x-1/2 z-[1] dotted-round-v ${textColorMap[colors.outgoingColor] ?? "text-gray-200"}`}
                  />
                ) : (
                  <div
                    className={`absolute left-[20px] top-[20px] bottom-0 w-0.5 -translate-x-1/2 z-[1] ${colors.outgoingColor}`}
                  />
                ))}
              {renderRow(item.stage, item.index)}
            </div>
          );
        }

        if (item.kind === "branch" && colors.kind === "branch") {
          const hasPrecedingTrunk = vi > 0 && visibleLayout[vi - 1].item.kind === "trunk";
          const segmentColors = colors.segmentColors;
          const endX = branchDotCenter - dotCenter + 1;

          const forkColors: Record<string, { text: string }> = {
            "bg-lens-orange-400": { text: "text-lens-orange-400" },
            "bg-gray-400": { text: "text-gray-400" },
            "bg-gray-200": { text: "text-gray-300" },
          };
          const arcForkText = (
            forkColors[segmentColors[0]] ?? forkColors["bg-gray-200"]
          ).text;
          const forkDotColor = (i: number) =>
            (forkColors[segmentColors[i]] ?? forkColors["bg-gray-200"]).text;

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

          const forkConnectorTop = 2 * forkR - 16;

          return (
            <div key={li} className="relative">
              {hasPrecedingTrunk && (
                <svg
                  className={`absolute ${arcZ} ${arcForkText} pointer-events-none`}
                  style={{
                    left: dotCenter - 1,
                    top: 0,
                    width: branchDotCenter - dotCenter + 2,
                    height: forkSvgH,
                  }}
                  viewBox={`0 0 ${branchDotCenter - dotCenter + 2} ${forkSvgH}`}
                  fill="none"
                >
                  <path
                    d={`M 1 0 A ${forkR} ${forkR} 0 0 0 ${1 + forkR} ${forkR} L ${endX - forkR} ${forkR} A ${forkR} ${forkR} 0 0 1 ${endX} ${2 * forkR}`}
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeDasharray="0 5"
                    strokeLinecap="round"
                  />
                </svg>
              )}
              {hasPrecedingTrunk && (
                <div
                  className={`absolute left-[20px] top-0 w-0.5 -translate-x-1/2 ${passZ} ${colors.passColor} ${
                    isLast ? "" : "bottom-0"
                  }`}
                  style={isLast ? { height: 0 } : undefined}
                />
              )}
              <div className="ml-5 pt-4 pb-0.5">
                {(entry.visibleItems ?? item.items).map((branchItem, bi) => (
                  <div key={bi} className="relative">
                    {bi === 0 && hasPrecedingTrunk && (
                      <div
                        className={`absolute ${branchConnZ} left-[20px] bottom-[calc(100%-20px)] -translate-x-1/2 dotted-round-v ${forkDotColor(0)}`}
                        style={{ top: forkConnectorTop }}
                      />
                    )}
                    {bi > 0 && (
                      <div
                        className={`absolute ${branchConnZ} left-[20px] top-0 h-[20px] -translate-x-1/2 dotted-round-v ${forkDotColor(bi)}`}
                      />
                    )}
                    {bi < (entry.visibleItems ?? item.items).length - 1 && (
                      <div
                        className={`absolute ${branchConnZ} left-[20px] top-[20px] bottom-0 -translate-x-1/2 dotted-round-v ${forkDotColor(bi + 1)}`}
                      />
                    )}
                    {renderRow(branchItem.stage, branchItem.index)}
                  </div>
                ))}
              </div>
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}

// --- ModuleRow ---

function ModuleRow({
  module: mod,
  isCurrent,
  isExpanded,
  onToggleExpand,
  currentSectionIndex,
  completedSections,
  currentModuleSections,
  courseId,
  onSectionClick,
  onClose,
  allTldrsExpanded,
}: {
  module: ModuleInfo;
  isCurrent: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  currentSectionIndex: number;
  completedSections: Set<number>;
  currentModuleSections: StageInfo[];
  courseId: string;
  onSectionClick: (index: number) => void;
  onClose: () => void;
  allTldrsExpanded: boolean;
}) {
  const status = mod.status;
  const duration = mod.duration;
  const stages = isCurrent ? currentModuleSections : mod.stages;
  const hasStages = stages.length > 0;

  return (
    <div data-module-current={isCurrent || undefined}>
      <button
        onMouseDown={hasStages ? onToggleExpand : undefined}
        className={`flex items-center gap-2 px-2 py-1 rounded-[16px] w-full text-left transition-colors ${
          isCurrent ? "bg-[#f0ece4]" : hasStages ? "hover:bg-[#f5f1ea]" : ""
        }`}
      >
        <ProgressCircle
          status={status}
          completedLenses={mod.completedLenses}
          totalLenses={mod.totalLenses}
          size={14}
        />
        <span className="text-base font-display truncate text-gray-900">
          {mod.title}
        </span>
        <span className="flex items-center gap-1.5 ml-auto flex-shrink-0">
          {!isExpanded && duration ? (
            <span className="text-xs text-slate-900 whitespace-nowrap tabular-nums">
              {formatDurationMinutes(duration)}
            </span>
          ) : null}
          {hasStages && (
            <ChevronRight
              className={`w-3.5 h-3.5 text-gray-400 flex-shrink-0 transition-transform duration-400 ${
                isExpanded ? "rotate-90" : ""
              }`}
            />
          )}
        </span>
      </button>

      <div
        className={`grid transition-[grid-template-rows] duration-400 ${
          isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <SectionList
            stages={stages}
            isCurrent={isCurrent}
            currentSectionIndex={currentSectionIndex}
            completedSections={completedSections}
            courseId={courseId}
            moduleSlug={mod.slug}
            onSectionClick={onSectionClick}
            onClose={onClose}
            allTldrsExpanded={allTldrsExpanded}
          />
        </div>
      </div>
    </div>
  );
}

// --- Main component ---

interface UnitNavigationPanelProps {
  unitName: string;
  currentModuleSlug: string;
  currentSectionIndex: number;
  completedSections: Set<number>;
  unitModules: ModuleInfo[];
  currentModuleSections: StageInfo[];
  courseId: string;
  onSectionClick: (index: number) => void;
  onClose: () => void;
}

export default function UnitNavigationPanel({
  unitName,
  currentModuleSlug,
  currentSectionIndex,
  completedSections,
  unitModules,
  currentModuleSections,
  courseId,
  onSectionClick,
  onClose,
}: UnitNavigationPanelProps) {
  const currentModule = unitModules.find((m) => m.slug === currentModuleSlug);
  const currentParentSlug = currentModule?.parentSlug ?? null;

  const [expandedParents, setExpandedParents] = useState<Set<string>>(() => {
    const s = new Set<string>();
    if (currentParentSlug) s.add(currentParentSlug);
    return s;
  });

  const [expandedModules, setExpandedModules] = useState<Set<string>>(
    () => new Set([currentModuleSlug]),
  );

  const toggleParent = useCallback((slug: string) => {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }, []);

  const toggleModule = useCallback((slug: string) => {
    setExpandedModules((prev) =>
      prev.has(slug) ? new Set() : new Set([slug]),
    );
  }, []);

  const isMobile = useMedia("(max-width: 767px)", false);
  const [allTldrsExpanded, setAllTldrsExpanded] = useState(!isMobile);
  const initialSyncDone = useRef(false);
  useEffect(() => {
    if (!initialSyncDone.current) {
      initialSyncDone.current = true;
      setAllTldrsExpanded(!isMobile);
    }
  }, [isMobile]);
  const toggleSummaries = useCallback(
    () => setAllTldrsExpanded((prev) => !prev),
    [],
  );

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isScrolledFromTop, setIsScrolledFromTop] = useState(false);
  const [isScrolledToBottom, setIsScrolledToBottom] = useState(false);

  // Scroll to current section when sidebar opens (after grid-collapse transitions finish)
  useEffect(() => {
    const timer = setTimeout(() => {
      const container = scrollContainerRef.current;
      if (!container) return;
      const currentEl = container.querySelector(
        "[data-section-current]",
      ) as HTMLElement | null;
      if (!currentEl) return;
      // Walk offsetParent chain to get cumulative offset from scroll container
      let top = 0;
      let el: HTMLElement | null = currentEl;
      while (el && el !== container) {
        top += el.offsetTop;
        el = el.offsetParent as HTMLElement | null;
      }
      container.scrollTop = Math.max(0, top - container.clientHeight / 3);
    }, 250);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between pl-2 py-2 shrink-0">
        <a
          href={`/course/${courseId}`}
          onClick={onClose}
          className="flex items-center gap-1 text-sm text-lens-orange-600 hover:text-lens-orange-700"
        >
          <ChevronRight className="w-3 h-3 rotate-180" />
          Back to course overview
        </a>
        <div className="flex items-center gap-2">
          <div
            onMouseDown={toggleSummaries}
            className="relative inline-grid grid-cols-2 bg-[#e8e4dc] rounded-full p-[3px] cursor-pointer"
            title={allTldrsExpanded ? "Hide descriptions" : "Show descriptions"}
            role="button"
            tabIndex={0}
          >
            {/* Sliding pill — same size as each icon cell */}
            <span
              className={`absolute top-[3px] bottom-[3px] w-[calc(50%-3px)] rounded-full bg-white shadow-sm transition-[left] duration-400 ease-in-out ${
                allTldrsExpanded ? "left-[calc(50%)]" : "left-[3px]"
              }`}
            />
            {/* Compact icon — 3 bullet items, single line each */}
            <span
              className={`relative z-10 flex items-center justify-center w-7 h-7 rounded-full transition-colors duration-400 ${!allTldrsExpanded ? "text-gray-700" : "text-gray-400"}`}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 5h.01" />
                <path d="M8 5h13" />
                <path d="M3 12h.01" />
                <path d="M8 12h13" />
                <path d="M3 19h.01" />
                <path d="M8 19h13" />
              </svg>
            </span>
            {/* Expanded icon — 2 bullet items, each with a sub-line */}
            <span
              className={`relative z-10 flex items-center justify-center w-7 h-7 rounded-full transition-colors duration-400 ${allTldrsExpanded ? "text-gray-700" : "text-gray-400"}`}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 5h.01" />
                <path d="M8 5h13" />
                <path d="M8 9h10" />
                <path d="M3 16h.01" />
                <path d="M8 16h13" />
                <path d="M8 20h10" />
              </svg>
            </span>
          </div>
          <button
            onMouseDown={onClose}
            className="p-2 hover:bg-black/5 rounded-lg transition-colors"
            title="Close sidebar"
          >
            <X className="w-6 h-6 text-slate-500" />
          </button>
        </div>
      </div>
      {unitName && (
        <div className="px-2 pb-1 text-base text-gray-900 font-display shrink-0">
          {unitName}
        </div>
      )}
      {(() => {
        const groups = groupModules(unitModules);

        const renderGroup = (group: ModuleGroup) => {
          if (group.kind === "parent") {
            const completedCount = group.children.filter(
              (c) => c.status === "completed",
            ).length;
            const isParentExpanded = expandedParents.has(group.parentSlug);
            const parentFraction =
              group.children.reduce((sum, c) => {
                if (!c.totalLenses || c.totalLenses === 0) return sum;
                return sum + (c.completedLenses ?? 0) / c.totalLenses;
              }, 0) / group.children.length;

            return (
              <div key={group.parentSlug} className="mb-1">
                <button
                  onMouseDown={() => toggleParent(group.parentSlug)}
                  className="flex items-center gap-2 px-2 py-1 w-full text-left rounded-md hover:bg-[#f5f1ea] transition-colors"
                >
                  <ProgressCircle
                    status={
                      completedCount === group.children.length
                        ? "completed"
                        : completedCount > 0
                          ? "in_progress"
                          : "not_started"
                    }
                    completedLenses={Math.round(parentFraction * 100)}
                    totalLenses={100}
                    size={14}
                  />
                  <span className="text-base font-display text-gray-900">
                    {group.parentTitle}
                  </span>
                  <ChevronRight
                    className={`w-3.5 h-3.5 text-gray-400 flex-shrink-0 ml-auto transition-transform duration-400 ${
                      isParentExpanded ? "rotate-90" : ""
                    }`}
                  />
                </button>
                <div
                  className={`grid transition-[grid-template-rows] duration-400 ${
                    isParentExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                  }`}
                >
                  <div className="overflow-hidden">
                    <div className="relative ml-6">
                      <div className="absolute left-[-9px] top-1 bottom-1 w-px bg-[#e8e4dc]" />
                      {group.children.map((child) => (
                        <ModuleRow
                          key={child.slug}
                          module={child}
                          isCurrent={child.slug === currentModuleSlug}
                          isExpanded={expandedModules.has(child.slug)}
                          onToggleExpand={() => toggleModule(child.slug)}
                          currentSectionIndex={currentSectionIndex}
                          completedSections={completedSections}
                          currentModuleSections={currentModuleSections}
                          courseId={courseId}
                          onSectionClick={onSectionClick}
                          onClose={onClose}
                          allTldrsExpanded={allTldrsExpanded}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          }
          return (
            <div key={group.module.slug}>
              <ModuleRow
                module={group.module}
                isCurrent={group.module.slug === currentModuleSlug}
                isExpanded={expandedModules.has(group.module.slug)}
                onToggleExpand={() => toggleModule(group.module.slug)}
                currentSectionIndex={currentSectionIndex}
                completedSections={completedSections}
                currentModuleSections={currentModuleSections}
                courseId={courseId}
                onSectionClick={onSectionClick}
                onClose={onClose}
                allTldrsExpanded={allTldrsExpanded}
              />
            </div>
          );
        };

        return (
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <div
              ref={scrollContainerRef}
              className="overflow-y-auto overscroll-contain h-full"
              onScroll={(e) => {
                const el = e.currentTarget;
                setIsScrolledFromTop(el.scrollTop > 6);
                setIsScrolledToBottom(
                  el.scrollHeight - el.scrollTop - el.clientHeight < 15,
                );
              }}
            >
              {groups.map(renderGroup)}
            </div>
            {/* Top fade overlay — slides up when at scroll top */}
            <div
              className="absolute top-0 left-0 right-4 pointer-events-none z-10 transition-transform duration-400"
              style={{
                height: "1.5rem",
                transform: isScrolledFromTop
                  ? "translateY(0)"
                  : "translateY(-100%)",
                background:
                  "linear-gradient(to top, transparent, var(--brand-bg))",
              }}
            />
            {/* Bottom fade overlay — fades out when scrolled to bottom */}
            <div
              className="absolute bottom-0 left-0 right-4 pointer-events-none transition-opacity duration-400"
              style={{
                height: "3.5rem",
                opacity: isScrolledToBottom ? 0 : 1,
                background:
                  "linear-gradient(to bottom, transparent, var(--brand-bg))",
              }}
            />
          </div>
        );
      })()}
    </div>
  );
}
