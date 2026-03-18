import { forwardRef, useState, useRef, useCallback, useEffect } from "react";
import { useMedia } from "react-use";
import type { ModuleInfo, StageInfo } from "@/types/course";
import { formatDurationMinutes } from "@/utils/duration";

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
  size = 12,
}: {
  status: "completed" | "in_progress" | "not_started" | "current";
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
    return (
      <svg className="flex-shrink-0" width={size} height={size} viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="8" stroke="#d08838" strokeWidth="2" fill="#fde8c8" />
      </svg>
    );
  }
  return (
    <svg className="flex-shrink-0" width={size} height={size} viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="8" stroke="#ccc" strokeWidth="2" fill="white" />
    </svg>
  );
}

function SectionDot({ completed, isCurrent }: { completed: boolean; isCurrent: boolean }) {
  const color = completed
    ? "bg-[#d08838]"
    : isCurrent
      ? "border-2 border-[#d08838] bg-white"
      : "border-[1.5px] border-gray-300 bg-white";
  return <div className={`w-[7px] h-[7px] rounded-full flex-shrink-0 ${color}`} />;
}

function ModuleRow({
  module: mod,
  isCurrent,
  currentSectionIndex,
  completedSections,
  currentModuleSections,
  courseId,
  onSectionClick,
  onClose,
}: {
  module: ModuleInfo;
  isCurrent: boolean;
  currentSectionIndex: number;
  completedSections: Set<number>;
  currentModuleSections: StageInfo[];
  courseId: string;
  onSectionClick: (index: number) => void;
  onClose: () => void;
}) {
  const status = isCurrent ? "current" : mod.status;
  const stageCount = mod.stages.length;
  const duration = mod.duration;

  return (
    <div>
      {isCurrent ? (
        <div className="flex items-center gap-1.5 px-2 py-1 ml-1 rounded-md bg-[#fdf3e3]">
          <ProgressCircle status="current" size={12} />
          <span className="text-xs font-semibold text-[#7a470c] truncate">{mod.title}</span>
        </div>
      ) : (
        <a
          href={`/course/${courseId}/module/${mod.slug}`}
          className="flex items-center gap-1.5 px-2 py-1 ml-1 rounded-md hover:bg-[#faf8f5] transition-colors"
          onClick={onClose}
        >
          <ProgressCircle status={status} size={12} />
          <span className={`text-xs truncate ${status === "completed" ? "text-gray-500" : "text-gray-700"}`}>
            {mod.title}
          </span>
          <span className="text-[10px] text-gray-400 ml-auto whitespace-nowrap">
            {stageCount > 0 && `${stageCount} sections`}
            {stageCount > 0 && duration ? " · " : ""}
            {duration ? formatDurationMinutes(duration) : ""}
          </span>
        </a>
      )}

      {/* Expanded sections for current module */}
      {isCurrent && currentModuleSections.length > 0 && (
        <div className="ml-5 border-l-2 border-[#e8e4dc] mt-0.5 mb-1">
          {currentModuleSections.map((section, idx) => {
            const isCompleted = completedSections.has(idx);
            const isCurrentSection = idx === currentSectionIndex;
            return (
              <button
                key={idx}
                onClick={() => {
                  onSectionClick(idx);
                  onClose();
                }}
                className={`flex items-center gap-1.5 px-2 py-0.5 ml-1 rounded text-left w-full transition-colors ${
                  isCurrentSection
                    ? "text-[#d08838] font-medium"
                    : "text-gray-500 hover:text-gray-700 hover:bg-[#faf8f5]"
                }`}
              >
                <SectionDot completed={isCompleted} isCurrent={isCurrentSection} />
                <span className="text-[11px] truncate">{section.title}</span>
              </button>
            );
          })}
        </div>
      )}
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
                <span className="text-sm text-[#9a5c10] whitespace-nowrap truncate max-w-[140px]">
                  {unitName}
                </span>
                <span className="text-sm text-gray-300 mx-1.5 flex-shrink-0">›</span>
              </span>
              <span className="text-base font-semibold text-gray-900 whitespace-nowrap truncate max-w-[200px]">
                {moduleName}
              </span>
            </>
          ) : (
            <span className="text-base font-semibold text-gray-900 whitespace-nowrap truncate max-w-[200px]">
              {unitName}
            </span>
          )}
        </div>

        {isOpen && (
          <div className="absolute top-full left-0 mt-1 bg-white border border-[#e8e4dc] rounded-xl shadow-lg z-50 w-[300px] max-w-[calc(100vw-2rem)] max-h-[400px] overflow-y-auto py-2 px-2">
            {groupModules(unitModules).map((group) => {
              if (group.kind === "parent") {
                const completedCount = group.children.filter((c) => c.status === "completed").length;
                return (
                  <div key={group.parentSlug} className="mb-1">
                    <div className="flex items-center gap-1.5 px-2 py-1">
                      <ProgressCircle
                        status={
                          completedCount === group.children.length
                            ? "completed"
                            : completedCount > 0
                              ? "in_progress"
                              : "not_started"
                        }
                        size={12}
                      />
                      <span className="text-xs font-semibold text-[#7a470c]">{group.parentTitle}</span>
                      <span className="text-[10px] text-[#9a5c10] bg-[#fdf3e3] px-1.5 rounded ml-auto">
                        {completedCount}/{group.children.length}
                      </span>
                    </div>
                    <div className="ml-3 border-l-2 border-[#f0e8d8]">
                      {group.children.map((child) => (
                        <ModuleRow
                          key={child.slug}
                          module={child}
                          isCurrent={child.slug === currentModuleSlug}
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
                );
              }
              return (
                <ModuleRow
                  key={group.module.slug}
                  module={group.module}
                  isCurrent={group.module.slug === currentModuleSlug}
                  currentSectionIndex={currentSectionIndex}
                  completedSections={completedSections}
                  currentModuleSections={currentModuleSections}
                  courseId={courseId}
                  onSectionClick={onSectionClick}
                  onClose={() => setIsOpen(false)}
                />
              );
            })}
          </div>
        )}
      </div>
    );
  },
);

export default BreadcrumbNav;
