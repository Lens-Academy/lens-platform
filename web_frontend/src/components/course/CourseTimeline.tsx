/**
 * Vertical timeline view for course overview.
 * Shows units as collapsible "Week N" rows that expand to show modules and meetings.
 */

import { useState } from "react";
import type { UnitInfo, ModuleInfo } from "../../types/course";
import { ChevronDown, ChevronRight, Users } from "lucide-react";

type CourseTimelineProps = {
  courseTitle: string;
  units: UnitInfo[];
  selectedModuleSlug: string | null;
  onModuleSelect: (module: ModuleInfo) => void;
};

function formatMeetingDate(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatRelativeDate(isoDate: string): string {
  const target = new Date(isoDate);
  const now = new Date();
  const diffMs = target.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return formatMeetingDate(isoDate);
  if (diffDays === 0) return "Due Today";
  if (diffDays === 1) return "Due Tomorrow";
  if (diffDays <= 7) return `Due in ${diffDays}d`;
  return formatMeetingDate(isoDate);
}

type UnitStatus = "completed" | "in_progress" | "not_started";

function getUnitStatus(unit: UnitInfo): UnitStatus {
  const required = unit.modules.filter((m) => !m.optional);
  if (required.length === 0) return "not_started";
  if (required.every((m) => m.status === "completed")) return "completed";
  if (required.some((m) => m.status === "in_progress" || m.status === "completed"))
    return "in_progress";
  return "not_started";
}

function StatusDot({ status }: { status: ModuleInfo["status"] | UnitStatus }) {
  const color =
    status === "completed" || status === "in_progress"
      ? "bg-blue-500"
      : "bg-slate-300";
  return (
    <div className="w-5 h-5 flex items-center justify-center">
      <div className={`w-2 h-2 rounded-full ${color}`} />
    </div>
  );
}

function getParentStatus(children: ModuleInfo[]): ModuleInfo["status"] {
  if (children.every((m) => m.status === "completed")) return "completed";
  if (children.some((m) => m.status === "in_progress" || m.status === "completed"))
    return "in_progress";
  return "not_started";
}

export default function CourseTimeline({
  courseTitle,
  units,
  selectedModuleSlug,
  onModuleSelect,
}: CourseTimelineProps) {
  const now = new Date();
  const upcomingIndex = units.findIndex(
    (u) => u.meetingDate && new Date(u.meetingDate) > now,
  );

  const [expandedUnits, setExpandedUnits] = useState<Set<number>>(() => {
    const expanded = new Set<number>();
    for (let i = 0; i < units.length; i++) {
      const status = getUnitStatus(units[i]);
      if (status === "in_progress") expanded.add(i);
      if (i === upcomingIndex) expanded.add(i);
    }
    // If nothing expanded, expand the first unit
    if (expanded.size === 0 && units.length > 0) expanded.add(0);
    return expanded;
  });

  const [expandedParents, setExpandedParents] = useState<Set<string>>(() => {
    const slugs = new Set<string>();
    for (const unit of units) {
      for (const mod of unit.modules) {
        if (mod.parentSlug) slugs.add(mod.parentSlug);
      }
    }
    return slugs;
  });

  const toggleUnit = (idx: number) => {
    setExpandedUnits((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleParent = (slug: string) => {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  return (
    <div className="h-full flex flex-col bg-slate-50 border-r border-slate-200">
      {/* Course title */}
      <div className="p-4 border-b border-slate-200">
        <h1 className="text-lg font-bold text-slate-900">{courseTitle}</h1>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[9px] top-0 bottom-0 w-px bg-slate-200 z-10 pointer-events-none" />

          {units.map((unit, unitIdx) => {
            const isExpanded = expandedUnits.has(unitIdx);
            const unitStatus = getUnitStatus(unit);
            const weekLabel = unit.meetingName
              ? `${unit.meetingNumber}. ${unit.meetingName}`
              : unit.meetingNumber !== null
                ? `Week ${unit.meetingNumber}`
                : `Week ${unitIdx + 1}`;
            const required = unit.modules.filter((m) => !m.optional);
            const completedCount = required.filter(
              (m) => m.status === "completed",
            ).length;
            const isUpcoming = unitIdx === upcomingIndex;

            // Due date for the upcoming unit (3 days before meeting)
            const dueDateIso =
              isUpcoming && unit.meetingDate
                ? new Date(
                    new Date(unit.meetingDate).getTime() - 3 * 24 * 60 * 60 * 1000,
                  ).toISOString()
                : null;

            return (
              <div key={unitIdx}>
                {/* Unit header row */}
                <button
                  onClick={() => toggleUnit(unitIdx)}
                  className="relative w-full flex items-center py-2 text-left group"
                >
                  <div className="relative z-20">
                    <StatusDot status={unitStatus} />
                  </div>
                  <div className="ml-3 flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-900">
                        {weekLabel}
                      </span>
                      <span className="text-xs text-slate-400 ml-auto mr-1">
                        {completedCount}/{required.length}
                      </span>
                      {isExpanded ? (
                        <ChevronDown className="w-3 h-3 text-slate-400 flex-shrink-0" />
                      ) : (
                        <ChevronRight className="w-3 h-3 text-slate-400 flex-shrink-0" />
                      )}
                    </div>
                  </div>
                </button>

                {/* Expanded unit contents */}
                {isExpanded && (
                  <div className="relative ml-[24px]">
                    {/* Vertical line connecting children */}
                    <div className="absolute left-[9px] top-0 bottom-0 w-px bg-slate-200 z-10 pointer-events-none" />

                    {renderUnitModules(
                      unit,
                      selectedModuleSlug,
                      onModuleSelect,
                      expandedParents,
                      toggleParent,
                      isUpcoming ? dueDateIso : null,
                    )}

                    {/* Meeting row */}
                    {unit.meetingNumber !== null && (
                      <div className="relative flex items-center py-1.5">
                        <div className="relative z-20 w-5 h-5 flex items-center justify-center">
                          <div className="w-2 h-2 rounded-full bg-slate-300" />
                        </div>
                        <div className="ml-3 flex items-center gap-2">
                          <Users className="w-3.5 h-3.5 text-slate-400" />
                          <span className="text-sm text-slate-500">
                            Meeting {unit.meetingName ? `${unit.meetingNumber}: ${unit.meetingName}` : `#${unit.meetingNumber}`}
                          </span>
                          {unit.meetingDate && (
                            <span className="text-[11px] text-slate-400">
                              {formatMeetingDate(unit.meetingDate)}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Render the modules inside an expanded unit, grouping by parentSlug. */
function renderUnitModules(
  unit: UnitInfo,
  selectedModuleSlug: string | null,
  onModuleSelect: (module: ModuleInfo) => void,
  expandedParents: Set<string>,
  toggleParent: (slug: string) => void,
  dueDateIso: string | null,
) {
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < unit.modules.length) {
    const mod = unit.modules[i];

    if (mod.parentSlug) {
      const parentSlug = mod.parentSlug;
      const parentTitle = mod.parentTitle || parentSlug;
      const children: ModuleInfo[] = [];
      while (
        i < unit.modules.length &&
        unit.modules[i].parentSlug === parentSlug
      ) {
        children.push(unit.modules[i]);
        i++;
      }

      const isParentExpanded = expandedParents.has(parentSlug);
      const parentStatus = getParentStatus(children);
      const anyChildSelected = children.some(
        (c) => c.slug === selectedModuleSlug,
      );
      const completed = children.filter(
        (m) => m.status === "completed",
      ).length;

      elements.push(
        <div key={parentSlug}>
          <button
            onClick={() => toggleParent(parentSlug)}
            className={`relative w-full flex items-center py-1.5 group text-left rounded-lg ${
              anyChildSelected && !isParentExpanded
                ? "bg-blue-50/50 -mx-2 px-2"
                : "-mx-2 px-2"
            }`}
          >
            <div className="relative z-20">
              <StatusDot status={parentStatus} />
            </div>
            <div className="ml-3 flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-900 truncate">
                  {parentTitle}
                </span>
                <span className="text-xs text-slate-400">
                  {completed}/{children.length}
                </span>
                {isParentExpanded ? (
                  <ChevronDown className="w-3 h-3 text-slate-400 flex-shrink-0" />
                ) : (
                  <ChevronRight className="w-3 h-3 text-slate-400 flex-shrink-0" />
                )}
              </div>
            </div>
          </button>

          {isParentExpanded && (
            <div className="relative ml-[24px]">
              <div className="absolute left-[9px] top-0 bottom-0 w-px bg-slate-200 z-10 pointer-events-none" />
              {children.map((child) => {
                const isSelected = child.slug === selectedModuleSlug;
                return (
                  <button
                    key={child.slug}
                    onClick={() => onModuleSelect(child)}
                    className={`relative w-full flex items-center py-1.5 text-left transition-colors rounded-lg ${
                      isSelected
                        ? "bg-blue-50 -mx-2 px-2 text-blue-900"
                        : "hover:bg-slate-100/70 -mx-2 px-2 text-slate-600"
                    }`}
                  >
                    <div className="relative z-20">
                      <StatusDot status={child.status} />
                    </div>
                    <span className="ml-3 text-sm truncate">{child.title}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>,
      );
    } else {
      // Regular module
      const isSelected = mod.slug === selectedModuleSlug;
      const dueLabel = dueDateIso ? formatRelativeDate(dueDateIso) : null;

      elements.push(
        <button
          key={mod.slug}
          onClick={() => onModuleSelect(mod)}
          className={`relative w-full flex items-center py-1.5 text-left group transition-colors rounded-lg ${
            isSelected
              ? "bg-blue-50 -mx-2 px-2"
              : "hover:bg-slate-100/70 -mx-2 px-2"
          }`}
        >
          <div className="relative z-20">
            <StatusDot status={mod.status} />
          </div>
          <div className="ml-3 flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={`text-sm truncate ${
                  isSelected
                    ? "font-medium text-blue-900"
                    : mod.optional
                      ? "text-slate-500"
                      : "text-slate-700"
                }`}
              >
                {mod.title}
              </span>
              {mod.optional && (
                <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wide flex-shrink-0">
                  Optional
                </span>
              )}
              {!mod.optional &&
                mod.status === "in_progress" &&
                mod.completedLenses !== undefined &&
                mod.totalLenses && (
                  <span className="text-[11px] text-blue-600 font-medium">
                    {mod.completedLenses}/{mod.totalLenses}
                  </span>
                )}
              {dueLabel && !mod.optional && (
                <span className="text-[11px] text-slate-400 ml-auto flex-shrink-0">
                  {dueLabel}
                </span>
              )}
            </div>
          </div>
        </button>,
      );
      i++;
    }
  }

  return elements;
}
