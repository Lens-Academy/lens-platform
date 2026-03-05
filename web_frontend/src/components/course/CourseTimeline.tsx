/**
 * Vertical timeline view for course overview.
 * Shows units as collapsible "Week N" rows that expand to show modules and meetings.
 */

import { useState } from "react";
import type { UnitInfo, ModuleInfo } from "../../types/course";
import { ChevronRight, Users } from "lucide-react";

/**
 * Circular progress indicator:
 * - not_started: gray outline ring
 * - in_progress: gray outline ring with blue arc fill (clock-style, starting at 12 o'clock)
 * - completed: green filled circle with white checkmark
 */
function ProgressCircle({
  status,
  completedLenses,
  totalLenses,
  size = 16,
}: {
  status: "completed" | "in_progress" | "not_started";
  completedLenses?: number;
  totalLenses?: number;
  size?: number;
}) {
  if (status === "completed") {
    const cr = 8;
    const ccx = 10;
    const ccy = 10;
    return (
      <svg className="flex-shrink-0" width={size} height={size} viewBox="0 0 20 20" fill="none">
        {/* Full blue ring */}
        <circle cx={ccx} cy={ccy} r={cr} stroke="#3b82f6" strokeWidth="2" fill="none" />
        {/* Checkmark */}
        <path d="M6 10.5l2.5 2.5 5-5" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    );
  }

  const r = 8;
  const cx = 10;
  const cy = 10;
  const circumference = 2 * Math.PI * r;
  const fraction =
    status === "in_progress" && totalLenses && totalLenses > 0
      ? Math.min((completedLenses ?? 0) / totalLenses, 1)
      : 0;

  return (
    <svg className="flex-shrink-0" width={size} height={size} viewBox="0 0 20 20" fill="none"
      style={{ transform: "rotate(-90deg)" }}
    >
      {/* Gray background ring */}
      <circle cx={cx} cy={cy} r={r} stroke="#cbd5e1" strokeWidth="2" fill="none" />
      {/* Blue progress arc */}
      {fraction > 0 && (
        <circle cx={cx} cy={cy} r={r} stroke="#3b82f6" strokeWidth="2" fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

// Hard-coded time estimates (minutes) for prototype — will be replaced by real data
const MOCK_DURATIONS: Record<string, number> = {
  "introduction": 25,
  "feedback-loops": 40,
  "what-even-is-ai": 35,
  "cognitive-superpowers": 30,
  "module-fundamental-difficulties": 45,
  "existing-approaches/welcome": 10,
  "existing-approaches/automating-alignment": 20,
  "existing-approaches/mechanistic-interpretability": 25,
  "existing-approaches/evals": 15,
  "existing-approaches/control": 20,
  "existing-approaches/agent-foundations": 25,
  "existing-approaches/test-your-understanding": 15,
};

function formatDuration(minutes: number): string {
  if (minutes >= 60) {
    const h = minutes / 60;
    return h % 1 === 0 ? `${h}h` : `${h.toFixed(1)}h`;
  }
  return `${minutes}min`;
}

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
    if (upcomingIndex >= 0) {
      expanded.add(upcomingIndex);
    } else if (units.length > 0) {
      // No upcoming unit — expand the first one
      expanded.add(0);
    }
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
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
        // Auto-select first module when expanding
        const firstModule = units[idx]?.modules[0];
        if (firstModule) onModuleSelect(firstModule);
      }
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
        <h1 className="text-xl font-bold text-slate-900">{courseTitle}</h1>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div>
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
                {unitIdx > 0 && (
                  <div className="border-t border-slate-200 my-1" />
                )}
              <div
                className="relative transition-all duration-200"
              >
                {/* Unit header row */}
                <button
                  onClick={() => toggleUnit(unitIdx)}
                  className={`relative w-full flex items-center text-left transition-[padding] duration-200 ${
                    isExpanded ? "py-1" : "py-1.5"
                  }`}
                >
                  {/* Left spacer: grows to push label right when expanded */}
                  <div
                    className={`transition-[flex-grow] duration-300 ${
                      isExpanded ? "grow" : "grow-0"
                    }`}
                  />
                  {/* Label */}
                  <span
                    className={`shrink-0 whitespace-nowrap transition-all duration-300 ${
                      isExpanded
                        ? "text-sm text-slate-900"
                        : "text-base text-slate-900"
                    }`}
                  >
                    {weekLabel}
                  </span>
                  {/* Due label (collapsed only) */}
                  {!isExpanded && dueDateIso && (
                    (() => {
                      const dueLabel = formatRelativeDate(dueDateIso);
                      return (
                        <span className={`shrink-0 text-xs ml-1.5 ${
                          dueLabel === "Due Today"
                            ? "text-amber-600 font-medium"
                            : dueLabel === "Due Tomorrow"
                              ? "text-amber-500"
                              : "text-slate-400"
                        }`}>
                          {dueLabel}
                        </span>
                      );
                    })()
                  )}
                  {/* Right spacer: grows when collapsed, shrinks when expanded */}
                  <div
                    className={`transition-[flex-grow] duration-300 ${
                      isExpanded ? "grow-0" : "grow min-w-0"
                    }`}
                  />
                  {/* Chevron */}
                  <ChevronRight
                    className={`shrink-0 w-3.5 h-3.5 text-slate-400 ml-1 transition-transform duration-300 ${
                      isExpanded ? "rotate-90" : ""
                    }`}
                  />
                </button>

                {/* Expandable content */}
                <div
                  className={`grid transition-[grid-template-rows] duration-200 ${
                    isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                  }`}
                >
                  <div className="overflow-hidden">
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
                      <div className="flex items-center py-1.5 gap-2">
                          <Users className="w-4 h-4 text-slate-700" />
                          <span className="text-base text-slate-700">
                            #{unit.meetingNumber}
                          </span>
                          {unit.meetingDate && (
                            <span className="text-xs text-slate-400">
                              {formatMeetingDate(unit.meetingDate)}
                            </span>
                          )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
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
      // Average of each child's completion fraction
      const parentFraction = children.reduce((sum, c) => {
        if (!c.totalLenses || c.totalLenses === 0) return sum;
        return sum + (c.completedLenses ?? 0) / c.totalLenses;
      }, 0) / children.length;

      elements.push(
        <div key={parentSlug}>
          <button
            onClick={() => toggleParent(parentSlug)}
            className={`relative w-full flex items-center py-1.5 group text-left rounded-lg ${
              anyChildSelected && !isParentExpanded
                ? "bg-slate-200/50 -mx-2 px-2"
                : "-mx-2 px-2"
            }`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <ProgressCircle
                  status={parentStatus}
                  completedLenses={Math.round(parentFraction * 100)}
                  totalLenses={100}
                />
                <span className="text-base font-medium truncate text-slate-900">
                  {parentTitle}
                </span>
                <ChevronRight
                  className={`w-3.5 h-3.5 text-slate-400 flex-shrink-0 transition-transform duration-200 ${
                    isParentExpanded ? "rotate-90" : ""
                  }`}
                />
              </div>
            </div>
          </button>

          <div
            className={`grid transition-[grid-template-rows] duration-200 ${
              isParentExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
            }`}
          >
            <div className="overflow-hidden">
              {children.map((child) => {
                const isSelected = child.slug === selectedModuleSlug;
                const childEstimate = MOCK_DURATIONS[child.slug];
                return (
                  <button
                    key={child.slug}
                    onClick={() => onModuleSelect(child)}
                    className={`relative w-full flex items-center py-1 text-left transition-colors rounded-lg ${
                      isSelected
                        ? "bg-slate-200/50 text-slate-900"
                        : "hover:bg-slate-100/70 text-slate-600"
                    }`}
                  >
                    <div className="ml-4 flex-1 min-w-0 flex items-center gap-2">
                      <ProgressCircle
                        status={child.status}
                        completedLenses={child.completedLenses}
                        totalLenses={child.totalLenses}
                        size={14}
                      />
                      <span className="text-base truncate text-slate-700">
                        {child.title}
                      </span>
                      {childEstimate && child.status !== "completed" && (
                        <span className="text-xs text-slate-400 ml-auto flex-shrink-0 tabular-nums">
                          {formatDuration(childEstimate)}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>,
      );
    } else {
      // Regular module
      const isSelected = mod.slug === selectedModuleSlug;
      const dueLabel = dueDateIso ? formatRelativeDate(dueDateIso) : null;
      const estimate = MOCK_DURATIONS[mod.slug];

      elements.push(
        <button
          key={mod.slug}
          onClick={() => onModuleSelect(mod)}
          className={`relative w-full flex items-center py-1.5 text-left group transition-colors rounded-lg ${
            isSelected
              ? "bg-slate-200/50 -mx-2 px-2"
              : "hover:bg-slate-100/70 -mx-2 px-2"
          }`}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {!mod.optional && (
                <ProgressCircle
                  status={mod.status}
                  completedLenses={mod.completedLenses}
                  totalLenses={mod.totalLenses}
                />
              )}
              <span
                className={`text-base truncate ${
                  mod.optional
                    ? "text-slate-500"
                    : "text-slate-700"
                }`}
              >
                {mod.title}
              </span>
              {mod.optional && (
                <span className="text-[11px] text-slate-400 font-medium uppercase tracking-wide flex-shrink-0">
                  Optional
                </span>
              )}
              {/* Right-aligned: due date or time estimate */}
              {dueLabel && !mod.optional && mod.status !== "completed" ? (
                <span className={`text-xs ml-auto flex-shrink-0 ${
                  dueLabel === "Due Today"
                    ? "text-amber-600 font-medium"
                    : dueLabel === "Due Tomorrow"
                      ? "text-amber-500"
                      : "text-slate-400"
                }`}>
                  {dueLabel}
                </span>
              ) : estimate && mod.status !== "completed" ? (
                <span className="text-xs text-slate-400 ml-auto flex-shrink-0 tabular-nums">
                  {formatDuration(estimate)}
                </span>
              ) : null}
            </div>
          </div>
        </button>,
      );
      i++;
    }
  }

  return elements;
}
