/**
 * Vertical timeline view for course overview.
 * Shows units as collapsible "Week N" rows that expand to show modules and meetings.
 */

import { useState, useEffect } from "react";
import type { UnitInfo, ModuleInfo } from "../../types/course";
import { ChevronRight, Users } from "lucide-react";
import { OptionalBadge } from "../OptionalBadge";
import { formatDurationMinutes } from "../../utils/duration";
import { Tooltip } from "../Tooltip";
import { getUnitLabel } from "../../utils/unitLabel";

/**
 * Circular progress indicator:
 * - not_started: gray outline ring
 * - in_progress: gray outline ring with amber arc fill (clock-style, starting at 12 o'clock)
 * - completed: green filled circle with white checkmark
 */
function ProgressCircle({
  status,
  completedLenses,
  totalLenses,
  size = 16,
  selected,
}: {
  status: "completed" | "in_progress" | "not_started";
  completedLenses?: number;
  totalLenses?: number;
  size?: number;
  selected?: boolean;
}) {
  if (status === "completed") {
    return (
      <svg
        className="flex-shrink-0"
        width={size}
        height={size}
        viewBox="0 0 20 20"
        fill="none"
      >
        {/* Blue filled circle */}
        <circle cx="10" cy="10" r="9" fill="#b87018" />
        {/* White checkmark */}
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
      style={{ transform: "rotate(-90deg)" }}
    >
      {/* Gray background ring */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        stroke={selected ? "#94a3b8" : "#cbd5e1"}
        strokeWidth="2"
        fill="none"
      />
      {/* Blue progress arc */}
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

const formatDuration = formatDurationMinutes;

type CourseTimelineProps = {
  courseTitle: string;
  units: UnitInfo[];
  selectedModuleSlug: string | null;
  onModuleSelect: (module: ModuleInfo) => void;
  isMobile?: boolean;
};

function formatMeetingDate(isoDate: string): string {
  const d = new Date(isoDate);
  const date = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date}, ${time}`;
}

function formatMeetingDateLong(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDateOnly(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatRelativeDate(isoDate: string): string {
  const target = new Date(isoDate);
  const now = new Date();
  const diffMs = target.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return formatDateOnly(isoDate);
  if (diffDays === 0) return "Due Today";
  if (diffDays === 1) return "Due Tomorrow";
  if (diffDays <= 7) return `Due in ${diffDays} days`;
  return formatDateOnly(isoDate);
}

function getParentStatus(children: ModuleInfo[]): ModuleInfo["status"] {
  if (children.every((m) => m.status === "completed")) return "completed";
  if (
    children.some((m) => m.status === "in_progress" || m.status === "completed")
  )
    return "in_progress";
  return "not_started";
}

export default function CourseTimeline({
  courseTitle,
  units,
  selectedModuleSlug,
  onModuleSelect,
  isMobile,
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

  // Auto-expand unit and parent group containing the selected module
  useEffect(() => {
    if (!selectedModuleSlug) return;
    for (let ui = 0; ui < units.length; ui++) {
      for (const mod of units[ui].modules) {
        if (mod.slug === selectedModuleSlug) {
          setExpandedUnits((prev) => {
            if (prev.has(ui)) return prev;
            const next = new Set(prev);
            next.add(ui);
            return next;
          });
          if (mod.parentSlug) {
            setExpandedParents((prev) => {
              if (prev.has(mod.parentSlug!)) return prev;
              const next = new Set(prev);
              next.add(mod.parentSlug!);
              return next;
            });
          }
          return;
        }
      }
    }
  }, [selectedModuleSlug, units]);

  const toggleUnit = (idx: number) => {
    setExpandedUnits((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
        // Auto-select first module on desktop (on mobile, let user browse)
        if (!isMobile) {
          const firstModule = units[idx]?.modules[0];
          if (firstModule) onModuleSelect(firstModule);
        }
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
    <div
      className="h-full flex flex-col border-r"
      style={{
        backgroundColor: "var(--brand-bg)",
        borderColor: "var(--brand-border)",
      }}
    >
      {/* Course title */}
      <div
        className="p-4 border-b"
        style={{ borderColor: "var(--brand-border)" }}
      >
        <h1
          className="text-xl font-bold"
          style={{
            color: "var(--brand-text)",
            fontFamily: "var(--brand-font-display)",
          }}
        >
          {courseTitle}
        </h1>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto py-4 px-2">
        <div>
          {units.map((unit, unitIdx) => {
            const isExpanded = expandedUnits.has(unitIdx);
            const weekLabel = getUnitLabel(unit, unitIdx);
            const isUpcoming = unitIdx === upcomingIndex;

            // Due date for the upcoming unit (3 days before meeting)
            const dueDateIso =
              isUpcoming && unit.meetingDate
                ? new Date(
                    new Date(unit.meetingDate).getTime() -
                      3 * 24 * 60 * 60 * 1000,
                  ).toISOString()
                : null;

            return (
              <div key={unitIdx}>
                {unitIdx > 0 && (
                  <div
                    className="border-t my-1 mx-2"
                    style={{ borderColor: "var(--brand-border)" }}
                  />
                )}
                <div className="relative transition-all duration-200">
                  {/* Unit header row */}
                  <button
                    onClick={() => toggleUnit(unitIdx)}
                    className={`relative w-full flex items-center text-left px-2 transition-[padding] duration-200 ${
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
                          ? "text-sm text-[var(--brand-text)]"
                          : "text-base text-[var(--brand-text)]"
                      }`}
                    >
                      {weekLabel}
                    </span>
                    {/* Due label (collapsed only) */}
                    {!isExpanded &&
                      dueDateIso &&
                      (() => {
                        const dueLabel = formatRelativeDate(dueDateIso);
                        return (
                          <span
                            className={`shrink-0 text-xs ml-1.5 ${
                              dueLabel === "Due Today"
                                ? "text-amber-600 font-medium"
                                : dueLabel === "Due Tomorrow"
                                  ? "text-amber-500"
                                  : "text-[var(--brand-text-muted)]"
                            }`}
                          >
                            {dueLabel}
                          </span>
                        );
                      })()}
                    {/* Right spacer: grows when collapsed, shrinks when expanded */}
                    <div
                      className={`transition-[flex-grow] duration-300 ${
                        isExpanded ? "grow-0" : "grow min-w-0"
                      }`}
                    />
                    {/* Chevron */}
                    <ChevronRight
                      className={`shrink-0 w-3.5 h-3.5 text-[var(--brand-border)] ml-1 transition-transform duration-300 ${
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
                        <Tooltip
                          placement="right"
                          delay={200}
                          content={
                            unit.meetingDate ? (
                              <span>
                                You'll discuss this unit with your group on{" "}
                                {formatMeetingDateLong(unit.meetingDate)}
                              </span>
                            ) : (
                              <span>
                                Group discussion meeting #{unit.meetingNumber}
                              </span>
                            )
                          }
                        >
                          <div className="flex items-center py-1.5 px-2 gap-2 cursor-default">
                            <Users className="w-4 h-4 text-[var(--brand-text-muted)]" />
                            <span className="text-base text-[var(--brand-text-muted)]">
                              #{unit.meetingNumber}
                            </span>
                            {unit.meetingDate && (
                              <span className="text-xs text-[var(--brand-text-muted)]">
                                {formatMeetingDate(unit.meetingDate)}
                              </span>
                            )}
                          </div>
                        </Tooltip>
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
      const parentFraction =
        children.reduce((sum, c) => {
          if (!c.totalLenses || c.totalLenses === 0) return sum;
          return sum + (c.completedLenses ?? 0) / c.totalLenses;
        }, 0) / children.length;
      // Sum core (non-optional) child durations for the collapsed parent row
      const parentDuration = children
        .filter((c) => !c.optional)
        .reduce((sum, c) => sum + (c.duration ?? 0), 0);

      elements.push(
        <div key={parentSlug}>
          <button
            onClick={() => toggleParent(parentSlug)}
            className={`relative w-full flex items-center py-1.5 group text-left px-2 rounded-lg ${
              anyChildSelected && !isParentExpanded ? "bg-[#f0ece4]" : ""
            }`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <ProgressCircle
                  status={parentStatus}
                  completedLenses={Math.round(parentFraction * 100)}
                  totalLenses={100}
                  selected={anyChildSelected && !isParentExpanded}
                />
                <div className="flex-1 min-w-0">
                  <span className="text-base font-medium truncate block leading-snug text-[var(--brand-text)]">
                    {parentTitle}
                  </span>
                  {dueDateIso &&
                    parentStatus !== "completed" &&
                    (() => {
                      const dueLabel = formatRelativeDate(dueDateIso);
                      return (
                        <span
                          className={`text-xs leading-none block ${
                            dueLabel === "Due Today"
                              ? "text-amber-600 font-medium"
                              : dueLabel === "Due Tomorrow"
                                ? "text-amber-500"
                                : "text-[var(--brand-text-muted)]"
                          }`}
                        >
                          {dueLabel}
                        </span>
                      );
                    })()}
                </div>
                {!isParentExpanded && parentDuration > 0 && (
                  <span className="text-xs text-[var(--brand-text-muted)] flex-shrink-0 tabular-nums">
                    {formatDuration(parentDuration)}
                  </span>
                )}
                <ChevronRight
                  className={`w-3.5 h-3.5 text-[var(--brand-border)] flex-shrink-0 transition-transform duration-200 ${
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
                const childEstimate = child.duration;
                return (
                  <button
                    key={child.slug}
                    onClick={() => onModuleSelect(child)}
                    className={`relative w-full flex items-center py-1 text-left transition-colors px-2 rounded-lg ${
                      isSelected
                        ? "bg-[#f0ece4] text-[var(--brand-text)]"
                        : "hover:bg-[var(--brand-border)]/30 text-[var(--brand-text-muted)]"
                    }`}
                  >
                    <div className="ml-4 flex-1 min-w-0 flex items-center gap-2">
                      <ProgressCircle
                        status={child.status}
                        completedLenses={child.completedLenses}
                        totalLenses={child.totalLenses}
                        size={14}
                        selected={isSelected}
                      />
                      <span className="text-base truncate text-[var(--brand-text-muted)]">
                        {child.title}
                      </span>
                      {childEstimate && (
                        <span className="text-xs text-[var(--brand-text-muted)] ml-auto flex-shrink-0 tabular-nums">
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
      const estimate = mod.duration;

      elements.push(
        <button
          key={mod.slug}
          onClick={() => onModuleSelect(mod)}
          className={`relative w-full flex items-center py-1.5 text-left group transition-colors px-2 rounded-lg ${
            isSelected ? "bg-[#f0ece4]" : "hover:bg-[var(--brand-border)]/30"
          }`}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {!mod.optional && (
                <ProgressCircle
                  status={mod.status}
                  completedLenses={mod.completedLenses}
                  totalLenses={mod.totalLenses}
                  selected={isSelected}
                />
              )}
              <span
                className={`text-base truncate ${
                  mod.optional ? "text-[var(--brand-text-muted)]" : "text-[var(--brand-text-muted)]"
                }`}
              >
                {mod.title}
              </span>
              {mod.optional && <OptionalBadge />}
              {/* Right-aligned: due date and/or time estimate */}
              {dueLabel && !mod.optional && mod.status !== "completed" ? (
                <span
                  className={`text-xs ml-auto flex-shrink-0 flex items-center gap-1.5 ${
                    dueLabel === "Due Today"
                      ? "text-amber-600 font-medium"
                      : dueLabel === "Due Tomorrow"
                        ? "text-amber-500"
                        : "text-[var(--brand-text-muted)]"
                  }`}
                >
                  {dueLabel}
                  {estimate ? (
                    <span className="text-[var(--brand-text-muted)] font-normal tabular-nums">
                      · {formatDuration(estimate)}
                    </span>
                  ) : null}
                </span>
              ) : estimate ? (
                <span className="text-xs text-[var(--brand-text-muted)] ml-auto flex-shrink-0 tabular-nums">
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
