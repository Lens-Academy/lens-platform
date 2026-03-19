/**
 * Unit navigation panel — tree view of modules and sections within a unit.
 * Shows parent groups, expandable modules with branch timelines, and inline TLDRs.
 * Used inside ModuleDrawer (sidebar).
 */

import { useState, useCallback, useMemo } from "react";
import { ChevronRight, BotMessageSquare, X } from "lucide-react";
import type { ModuleInfo, StageInfo } from "@/types/course";
import { formatDurationMinutes } from "@/utils/duration";
import { StageIcon } from "./StageProgressBar";
import { getCircleFillClasses, getRingClasses } from "@/utils/stageProgress";
import { buildBranchLayout } from "@/utils/branchLayout";
import { generateHeadingId } from "@/utils/extractHeadings";
import { buildBranchPaths, computeBranchStates, computeLayoutColors } from "@/utils/branchColors";

// --- Helper types and functions ---

type ModuleGroup =
  | { kind: "parent"; parentSlug: string; parentTitle: string; children: ModuleInfo[] }
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

function ProgressCircle({
  status,
  completedLenses,
  totalLenses,
  size = 12,
}: {
  status: "completed" | "in_progress" | "not_started" | "current";
  completedLenses?: number;
  totalLenses?: number;
  size?: number;
}) {
  if (status === "completed") {
    return (
      <svg className="flex-shrink-0" width={size} height={size} viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="9" fill="#b87018" />
        <path
          d="M6 10.5l2.5 2.5 5-5"
          stroke="white"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    );
  }
  if (status === "current" || status === "in_progress") {
    const r = 8;
    const cx = 10;
    const cy = 10;
    const circumference = 2 * Math.PI * r;
    const fraction =
      status === "in_progress" && totalLenses && totalLenses > 0
        ? Math.min((completedLenses ?? 0) / totalLenses, 1)
        : 0;

    return (
      <svg
        className="flex-shrink-0"
        width={size}
        height={size}
        viewBox="0 0 20 20"
        fill="none"
        style={fraction > 0 ? { transform: "rotate(-90deg)" } : undefined}
      >
        <circle cx={cx} cy={cy} r={r} stroke={fraction > 0 ? "#cbd5e1" : "#d08838"} strokeWidth="2" fill={fraction > 0 ? "none" : "#fde8c8"} />
        {fraction > 0 && (
          <circle
            cx={cx}
            cy={cy}
            r={r}
            stroke="#b87018"
            strokeWidth="2"
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - fraction)}
            strokeLinecap="round"
          />
        )}
      </svg>
    );
  }
  return (
    <svg className="flex-shrink-0" width={size} height={size} viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="8" stroke="#ccc" strokeWidth="2" fill="white" />
    </svg>
  );
}

function StageDot({
  stage,
  isCompleted,
  isViewing,
}: {
  stage: StageInfo;
  isCompleted: boolean;
  isViewing: boolean;
}) {
  const isOptional = stage.optional;
  const fillClasses = getCircleFillClasses(
    { isCompleted, isViewing, isOptional },
    { optionalBg: "bg-white" },
  );
  const ringClasses = getRingClasses(isViewing, isCompleted);

  const isLargeIcon = stage.type === "video" || stage.type === "lens-video" || stage.type === "chat";
  return (
    <div
      className={`relative z-10 w-6 h-6 rounded-[16px] flex items-center justify-center flex-shrink-0 ${isLargeIcon ? "[&_svg]:w-[18px] [&_svg]:h-[18px]" : "[&_svg]:w-3.5 [&_svg]:h-3.5"} ${fillClasses} ${ringClasses}`}
    >
      <StageIcon type={stage.type} small />
    </div>
  );
}

function StageDuration({ duration, type }: { duration: number | null; type: string }) {
  if (!duration || duration <= 0) return null;
  const isVideo = type === "video" || type === "lens-video";
  const contentTime = Math.round(duration / 1.5);
  const aiTime = duration - contentTime;
  return (
    <span className="inline-flex items-center gap-0.5 text-xs text-slate-500 whitespace-nowrap ml-auto flex-shrink-0 tabular-nums">
      {isVideo ? (
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
        </svg>
      ) : (
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
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
  "bg-lens-gold-400": "text-lens-gold-400",
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
    stages.forEach((st, i) => { if (st.completed) s.add(i); });
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

  const lastTrunkLi = useMemo(() => {
    for (let i = layout.length - 1; i >= 0; i--) {
      if (layout[i].kind === "trunk") return i;
    }
    return -1;
  }, [layout]);

  if (stages.length === 0) return null;

  function renderRow(stage: StageInfo, index: number) {
    const isCompleted = completed.has(index);
    const isCurrentSection = index === curIdx;

    const dot = <StageDot stage={stage} isCompleted={isCompleted} isViewing={isCurrentSection} />;
    const content = (
      <div className="flex items-start gap-2.5 w-full min-w-0">
        {dot}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <span className={`text-[17px] font-display truncate text-slate-900 ${allTldrsExpanded ? "font-medium" : ""}`}>{stage.title}</span>
            <StageDuration duration={stage.duration} type={stage.type} />
          </div>
          {stage.tldr && (
              <p
                className={`text-sm text-slate-600 overflow-hidden transition-[max-height] duration-500 ease-in-out mt-0.5`}
                style={{ maxHeight: allTldrsExpanded ? "20em" : 0 }}
              >
                {stage.tldr}
              </p>
          )}
        </div>
      </div>
    );

    if (isCurrent) {
      return (
        <button
          onClick={() => { onSectionClick(index); onClose(); }}
          className={`block px-2 py-1 rounded-[16px] text-left w-full transition-colors ${
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
      <a
        href={`/course/${courseId}/module/${moduleSlug}#${generateHeadingId(stage.title)}`}
        onClick={onClose}
        className="block px-2 py-1 rounded-[16px] text-gray-800 hover:text-gray-900 hover:bg-[#f5f1ea] transition-colors"
      >
        {content}
      </a>
    );
  }

  const dotCenter = 20;
  const branchDotCenter = 40;
  const forkR = 8;
  const forkSvgH = 2 * forkR + 2;

  return (
    <div className="ml-5 mt-1.5 mb-1.5 pl-0.5">
      {layout.map((item, li) => {
        const colors = layoutColors[li];
        const isFirst = li === 0;
        const isLast = li === layout.length - 1;

        if (item.kind === "trunk" && colors.kind === "trunk") {
          const trailsIntoBranchOnly = li === lastTrunkLi && !isLast;
          return (
            <div key={li} className="relative">
              {!isFirst && (
                <div
                  className={`absolute left-[20px] top-0 h-[20px] w-0.5 -translate-x-1/2 z-[1] ${colors.connectorColor}`}
                />
              )}
              {!isLast && (
                trailsIntoBranchOnly ? (
                  <div
                    className={`absolute left-[20px] top-[20px] bottom-0 -translate-x-1/2 z-[1] dotted-round-v ${textColorMap[colors.outgoingColor] ?? "text-gray-200"}`}
                  />
                ) : (
                  <div
                    className={`absolute left-[20px] top-[20px] bottom-0 w-0.5 -translate-x-1/2 z-[1] ${colors.outgoingColor}`}
                  />
                )
              )}
              {renderRow(item.stage, item.index)}
            </div>
          );
        }

        if (item.kind === "branch" && colors.kind === "branch") {
          const hasPrecedingTrunk = li > 0;
          const segmentColors = colors.segmentColors;
          const endX = branchDotCenter - dotCenter + 1;

          const forkColors: Record<string, { text: string }> = {
            "bg-lens-gold-400": { text: "text-lens-gold-400" },
            "bg-gray-400": { text: "text-gray-400" },
            "bg-gray-200": { text: "text-gray-300" },
          };
          const arcForkText = (forkColors[segmentColors[0]] ?? forkColors["bg-gray-200"]).text;
          const forkDotColor = (i: number) =>
            (forkColors[segmentColors[i]] ?? forkColors["bg-gray-200"]).text;

          const colorRank: Record<string, number> = {
            "bg-gray-200": 0,
            "bg-gray-400": 1,
            "bg-lens-gold-400": 2,
          };
          const arcDarker = (colorRank[segmentColors[0]] ?? 0) > (colorRank[colors.passColor] ?? 0);
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
                {item.items.map((branchItem, bi) => (
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
                    {bi < item.items.length - 1 && (
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
    <div>
      <button
        onClick={hasStages ? onToggleExpand : undefined}
        className={`flex items-center gap-2 px-2 py-1 rounded-[16px] w-full text-left transition-colors ${
          isCurrent
            ? "bg-[#f0ece4]"
            : hasStages ? "hover:bg-[#f5f1ea]" : ""
        }`}
      >
        <ProgressCircle
          status={status}
          completedLenses={mod.completedLenses}
          totalLenses={mod.totalLenses}
          size={14}
        />
        <span
          className="text-base font-display truncate text-gray-900"
        >
          {mod.title}
        </span>
        <span className="flex items-center gap-1.5 ml-auto flex-shrink-0">
          {!isExpanded && duration ? (
            <span className="text-xs text-slate-500 whitespace-nowrap tabular-nums">
              {formatDurationMinutes(duration)}
            </span>
          ) : null}
          {hasStages && (
            <ChevronRight
              className={`w-3.5 h-3.5 text-gray-400 flex-shrink-0 transition-transform duration-200 ${
                isExpanded ? "rotate-90" : ""
              }`}
            />
          )}
        </span>
      </button>

      <div
        className={`grid transition-[grid-template-rows] duration-200 ${
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
  unitName: _unitName,
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

  const [allTldrsExpanded, setAllTldrsExpanded] = useState(true);
  const toggleSummaries = useCallback(() => setAllTldrsExpanded((prev) => !prev), []);

  return (
    <div>
      <div className="flex items-center justify-between mb-2 px-1">
        <a
          href={`/course/${courseId}`}
          onClick={onClose}
          className="flex items-center gap-1 text-xs text-[#9a5c10] hover:text-[#7a470c]"
        >
          <ChevronRight className="w-3 h-3 rotate-180" />
          Back to course overview
        </a>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleSummaries}
            className="text-xs text-slate-500 hover:text-slate-700 transition-colors"
          >
            {allTldrsExpanded ? "Hide descriptions" : "Show descriptions"}
          </button>
          <button
            onClick={onClose}
            className="p-2 hover:bg-black/5 rounded-lg transition-colors"
            title="Close sidebar"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
      </div>
      <div>
        {groupModules(unitModules).map((group) => {
          if (group.kind === "parent") {
            const completedCount = group.children.filter((c) => c.status === "completed").length;
            const isParentExpanded = expandedParents.has(group.parentSlug);
            const parentFraction =
              group.children.reduce((sum, c) => {
                if (!c.totalLenses || c.totalLenses === 0) return sum;
                return sum + (c.completedLenses ?? 0) / c.totalLenses;
              }, 0) / group.children.length;

            return (
              <div key={group.parentSlug} className="mb-1">
                <button
                  onClick={() => toggleParent(group.parentSlug)}
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
                  <span className="text-base font-display text-gray-900">{group.parentTitle}</span>
                  <ChevronRight
                    className={`w-3.5 h-3.5 text-gray-400 flex-shrink-0 ml-auto transition-transform duration-200 ${
                      isParentExpanded ? "rotate-90" : ""
                    }`}
                  />
                </button>
                <div
                  className={`grid transition-[grid-template-rows] duration-200 ${
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
        })}
      </div>
    </div>
  );
}
