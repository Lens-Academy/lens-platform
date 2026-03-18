import { forwardRef, useState, useRef, useCallback, useEffect, type ReactElement } from "react";
import { useMedia } from "react-use";
import { ChevronRight, BotMessageSquare } from "lucide-react";
import type { ModuleInfo, StageInfo } from "@/types/course";
import { formatDurationMinutes } from "@/utils/duration";
import { StageIcon } from "./StageProgressBar";
import { getCircleFillClasses, getRingClasses } from "@/utils/stageProgress";
import { Tooltip } from "../Tooltip";

// CSS styles for hiding elements while keeping them measurable
const hiddenStyle: React.CSSProperties = {
  visibility: "hidden",
  position: "absolute",
  pointerEvents: "none",
};

interface BreadcrumbNavProps {
  unitName: string;
  currentModuleSlug: string;
  currentSectionIndex: number;
  completedSections: Set<number>;
  unitModules: ModuleInfo[];
  currentModuleSections: StageInfo[];
  courseId: string;
  onSectionClick: (index: number) => void;
  priority: number; // from ModuleHeader's responsive system
  onOpenChange?: (isOpen: boolean) => void;
}

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

/** Stage icon inside a small circle, styled by completion state */
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

  return (
    <div
      className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 [&_svg]:w-3 [&_svg]:h-3 ${fillClasses} ${ringClasses}`}
    >
      <StageIcon type={stage.type} small />
    </div>
  );
}

/** Compact duration display for a stage */
function StageDuration({ duration }: { duration: number | null }) {
  if (!duration || duration <= 0) return null;
  const contentTime = Math.round(duration / 1.5);
  const aiTime = duration - contentTime;
  return (
    <span className="inline-flex items-center gap-0.5 text-xs text-gray-400 whitespace-nowrap ml-auto flex-shrink-0 tabular-nums">
      {formatDurationMinutes(contentTime)}
      {aiTime > 0 && (
        <>
          <span className="mx-0.5">+</span>
          <BotMessageSquare className="w-3 h-3" />
          <span>{formatDurationMinutes(aiTime)}</span>
        </>
      )}
    </span>
  );
}

/** Render section list for an expanded module */
function SectionList({
  stages,
  isCurrent,
  currentSectionIndex,
  completedSections,
  courseId,
  moduleSlug,
  onSectionClick,
  onClose,
}: {
  stages: StageInfo[];
  isCurrent: boolean;
  currentSectionIndex: number;
  completedSections: Set<number>;
  courseId: string;
  moduleSlug: string;
  onSectionClick: (index: number) => void;
  onClose: () => void;
}) {
  if (stages.length === 0) return null;

  return (
    <div className="ml-5 mt-1.5 mb-2">
      {stages.map((stage, idx) => {
        const isCompleted = isCurrent ? completedSections.has(idx) : (stage.completed ?? false);
        const isCurrentSection = isCurrent && idx === currentSectionIndex;

        const dot = (
          <StageDot stage={stage} isCompleted={isCompleted} isViewing={isCurrentSection} />
        );
        const connector = idx < stages.length - 1 ? (
          <div className="absolute left-[17.5px] top-[22px] bottom-0 w-px bg-gray-200" />
        ) : null;

        const content = (
          <>
            {dot}
            <span className="text-[13px] truncate">{stage.title}</span>
            <StageDuration duration={stage.duration} />
          </>
        );

        const tooltipContent = stage.tldr ? (
          <div className="max-w-xs">
            <p className="font-medium text-slate-900">{stage.title}</p>
            <p className="text-slate-600 mt-1 line-clamp-4">{stage.tldr}</p>
          </div>
        ) : null;

        const wrapTooltip = (el: ReactElement) =>
          tooltipContent ? (
            <Tooltip content={tooltipContent} placement="right" delay={200}>
              {el}
            </Tooltip>
          ) : el;

        if (isCurrent) {
          return (
            <div key={idx} className="relative">
              {wrapTooltip(
                <button
                  onClick={() => {
                    onSectionClick(idx);
                    onClose();
                  }}
                  className={`flex items-center gap-2.5 px-2 py-1.5 rounded-md text-left w-full transition-colors ${
                    isCurrentSection
                      ? "text-gray-900 font-medium bg-[#fdf3e3]"
                      : "text-gray-600 hover:text-gray-800 hover:bg-[#faf8f5]"
                  }`}
                >
                  {content}
                </button>,
              )}
              {connector}
            </div>
          );
        }

        return (
          <div key={idx} className="relative">
            {wrapTooltip(
              <a
                href={`/course/${courseId}/module/${moduleSlug}`}
                onClick={onClose}
                className="flex items-center gap-2.5 px-2 py-1.5 rounded-md text-gray-600 hover:text-gray-800 hover:bg-[#faf8f5] transition-colors"
              >
                {content}
              </a>,
            )}
            {connector}
          </div>
        );
      })}
    </div>
  );
}

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
}) {
  const status = isCurrent ? "current" : mod.status;
  const duration = mod.duration;
  const stages = isCurrent ? currentModuleSections : mod.stages;
  const hasStages = stages.length > 0;

  return (
    <div>
      <button
        onClick={hasStages ? onToggleExpand : undefined}
        className={`flex items-center gap-2 px-2 py-1 rounded-md w-full text-left transition-colors ${
          isCurrent
            ? "bg-[#fdf3e3]"
            : hasStages
              ? "hover:bg-[#faf8f5]"
              : ""
        }`}
      >
        <ProgressCircle
          status={status}
          completedLenses={mod.completedLenses}
          totalLenses={mod.totalLenses}
          size={14}
        />
        <span
          className={`text-base truncate ${
            isCurrent
              ? "font-semibold text-[#7a470c]"
              : status === "completed"
                ? "text-gray-500"
                : "text-gray-700"
          }`}
        >
          {mod.title}
        </span>
        {!isExpanded && duration ? (
          <span className="text-xs text-gray-400 ml-auto whitespace-nowrap tabular-nums">
            {formatDurationMinutes(duration)}
          </span>
        ) : null}
        {hasStages && (
          <ChevronRight
            className={`w-3.5 h-3.5 text-gray-400 flex-shrink-0 transition-transform duration-200 ${
              !isExpanded && !duration ? "ml-auto" : ""
            } ${isExpanded ? "rotate-90" : ""}`}
          />
        )}
      </button>

      {/* Expandable section list */}
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
          />
        </div>
      </div>
    </div>
  );
}

// --- Main component ---

const BreadcrumbNav = forwardRef<HTMLElement, BreadcrumbNavProps>(
  function BreadcrumbNav(
    {
      unitName,
      currentModuleSlug,
      currentSectionIndex,
      completedSections,
      unitModules,
      currentModuleSections,
      courseId,
      onSectionClick,
      priority,
      onOpenChange,
    },
    ref,
  ) {
    const hasMultipleModules = unitModules.length > 1;
    const currentModule = unitModules.find((m) => m.slug === currentModuleSlug);
    const moduleName = currentModule?.title ?? currentModuleSlug;

    const [isOpen, setIsOpen] = useState(false);
    const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const isTouchDevice = useMedia("(pointer: coarse)", false);

    // Find which parent group contains the current module
    const currentParentSlug = currentModule?.parentSlug ?? null;

    // Expand/collapse state for parent groups — default: expand the group containing current module
    const [expandedParents, setExpandedParents] = useState<Set<string>>(() => {
      const s = new Set<string>();
      if (currentParentSlug) s.add(currentParentSlug);
      return s;
    });

    // Expand/collapse state for individual modules — default: current module expanded
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
      setExpandedModules((prev) => {
        const next = new Set(prev);
        if (next.has(slug)) next.delete(slug);
        else next.add(slug);
        return next;
      });
    }, []);

    const handleMouseEnter = useCallback(() => {
      if (leaveTimer.current) {
        clearTimeout(leaveTimer.current);
        leaveTimer.current = null;
      }
      enterTimer.current = setTimeout(() => setIsOpen(true), 150);
    }, []);

    const handleMouseLeave = useCallback(() => {
      if (enterTimer.current) {
        clearTimeout(enterTimer.current);
        enterTimer.current = null;
      }
      leaveTimer.current = setTimeout(() => setIsOpen(false), 300);
    }, []);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    }, []);

    // Clean up timers on unmount
    useEffect(() => {
      return () => {
        if (enterTimer.current) clearTimeout(enterTimer.current);
        if (leaveTimer.current) clearTimeout(leaveTimer.current);
      };
    }, []);

    // Propagate open state to parent
    useEffect(() => {
      onOpenChange?.(isOpen);
    }, [isOpen, onOpenChange]);

    const handleClick = useCallback(() => {
      if (isTouchDevice) {
        setIsOpen((prev) => !prev);
      }
    }, [isTouchDevice]);

    // Close on outside click (mobile)
    useEffect(() => {
      if (!isOpen || !isTouchDevice) return;
      const handleOutsideClick = (e: MouseEvent) => {
        const target = e.target as Node;
        if (containerRef.current && !containerRef.current.contains(target)) {
          setIsOpen(false);
        }
      };
      document.addEventListener("mousedown", handleOutsideClick);
      return () => document.removeEventListener("mousedown", handleOutsideClick);
    }, [isOpen, isTouchDevice]);

    return (
      <div
        ref={containerRef}
        onMouseEnter={isTouchDevice ? undefined : handleMouseEnter}
        onMouseLeave={isTouchDevice ? undefined : handleMouseLeave}
        onKeyDown={handleKeyDown}
        className="relative"
      >
        <div
          ref={ref as React.Ref<HTMLDivElement>}
          onClick={handleClick}
          className={`flex items-baseline gap-0 min-w-0 font-display ${isTouchDevice ? "cursor-pointer" : ""}`}
          style={priority >= 4 ? hiddenStyle : undefined}
        >
          {/* Unit name + separator wrapped together — hides as a unit at priority >= 3 */}
          {hasMultipleModules ? (
            <>
              <span
                className="flex items-baseline gap-0"
                style={priority >= 3 ? hiddenStyle : undefined}
              >
                <span className="text-base text-[#9a5c10] whitespace-nowrap truncate max-w-[220px]">
                  {unitName}
                </span>
                <span className="text-base text-gray-300 mx-1.5 flex-shrink-0">&rsaquo;</span>
              </span>
              <span className="text-lg font-semibold text-gray-900 whitespace-nowrap truncate max-w-[200px]">
                {moduleName}
              </span>
            </>
          ) : (
            <span className="text-lg font-semibold text-gray-900 whitespace-nowrap truncate max-w-[200px]">
              {unitName}
            </span>
          )}
        </div>

        {isOpen && (
          <div className="absolute top-full left-0 mt-1 bg-white border border-[#e8e4dc] rounded-xl shadow-lg z-50 w-[420px] max-w-[calc(100vw-2rem)] max-h-[70vh] overflow-y-auto py-3 px-3">
            <div>
              {groupModules(unitModules).map((group) => {
                if (group.kind === "parent") {
                  const completedCount = group.children.filter((c) => c.status === "completed").length;
                  const isParentExpanded = expandedParents.has(group.parentSlug);
                  // Average completion fraction for progress arc
                  const parentFraction =
                    group.children.reduce((sum, c) => {
                      if (!c.totalLenses || c.totalLenses === 0) return sum;
                      return sum + (c.completedLenses ?? 0) / c.totalLenses;
                    }, 0) / group.children.length;

                  return (
                    <div key={group.parentSlug} className="mb-1">
                      <button
                        onClick={() => toggleParent(group.parentSlug)}
                        className="flex items-center gap-2 px-2 py-1 w-full text-left rounded-md hover:bg-[#faf8f5] transition-colors"
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
                        <span className="text-base font-semibold text-[#7a470c]">{group.parentTitle}</span>
                        <span className="text-xs text-[#9a5c10] bg-[#fdf3e3] px-1.5 py-0.5 rounded ml-auto">
                          {completedCount}/{group.children.length}
                        </span>
                        <ChevronRight
                          className={`w-3.5 h-3.5 text-gray-400 flex-shrink-0 transition-transform duration-200 ${
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
                          {/* Tree indent guide — file-tree style line to the left of submodules */}
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
                                onClose={() => setIsOpen(false)}
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
                      onClose={() => setIsOpen(false)}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  },
);

export default BreadcrumbNav;
