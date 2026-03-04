/**
 * Vertical timeline view for course overview.
 * Shows modules and meetings as nodes along a vertical timeline.
 */

import { useState } from "react";
import type { UnitInfo, ModuleInfo } from "../../types/course";
import { Check, Circle, ChevronDown, ChevronRight, Users } from "lucide-react";

type CourseTimelineProps = {
  courseTitle: string;
  units: UnitInfo[];
  selectedModuleSlug: string | null;
  onModuleSelect: (module: ModuleInfo) => void;
};

// Timeline items: modules (possibly grouped under a parent), or meeting markers
type TimelineItem =
  | { kind: "module"; module: ModuleInfo; dueDate: string }
  | {
      kind: "parent";
      parentSlug: string;
      parentTitle: string;
      children: ModuleInfo[];
      dueDate: string;
    }
  | { kind: "meeting"; number: number; date: string };

function formatMeetingDate(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function buildTimeline(units: UnitInfo[]): TimelineItem[] {
  const items: TimelineItem[] = [];

  for (const unit of units) {
    const mn = unit.meetingNumber;
    const meetingDateLabel = unit.meetingDate
      ? formatMeetingDate(unit.meetingDate)
      : null;
    const dueDate = unit.meetingDate
      ? formatMeetingDate(
          new Date(
            new Date(unit.meetingDate).getTime() - 3 * 24 * 60 * 60 * 1000,
          ).toISOString(),
        )
      : null;
    const weekLabel = dueDate ?? (mn !== null ? `Week ${mn}` : "");

    // Group modules with same parentSlug (mirrors CourseSidebar logic)
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
        items.push({
          kind: "parent",
          parentSlug,
          parentTitle,
          children,
          dueDate: weekLabel,
        });
      } else {
        items.push({ kind: "module", module: mod, dueDate: weekLabel });
        i++;
      }
    }

    if (mn !== null) {
      items.push({
        kind: "meeting",
        number: mn,
        date: meetingDateLabel ?? "",
      });
    }
  }

  return items;
}

function StatusDot({ status }: { status: ModuleInfo["status"] }) {
  if (status === "completed") {
    return (
      <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
        <Check className="w-3 h-3 text-white" strokeWidth={3} />
      </div>
    );
  }
  if (status === "in_progress") {
    return (
      <div className="w-5 h-5 rounded-full bg-blue-500" />
    );
  }
  return (
    <div className="w-5 h-5 rounded-full border-2 border-slate-300 bg-slate-50" />
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
  const timeline = buildTimeline(units);

  const [expandedParents, setExpandedParents] = useState<Set<string>>(() => {
    const slugs = new Set<string>();
    for (const item of timeline) {
      if (item.kind === "parent") slugs.add(item.parentSlug);
    }
    return slugs;
  });

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
          {/* Vertical line - z-10 to stay above item highlights but below dots */}
          <div className="absolute left-[9px] top-0 bottom-0 w-px bg-slate-200 z-10 pointer-events-none" />

          {timeline.map((item, idx) => {
            if (item.kind === "meeting") {
              return (
                <div key={`meeting-${item.number}`} className="relative flex items-center py-1">
                  {/* Small dot on the line */}
                  <div className="relative z-20 w-5 h-5 flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-slate-300" />
                  </div>
                  {/* Meeting label - aligned with module text */}
                  <div className="ml-3 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-400 w-10 flex-shrink-0">
                        {item.date || `#${item.number}`}
                      </span>
                      <Users className="w-3.5 h-3.5 text-slate-400" />
                      {item.date && (
                        <span className="text-[11px] text-slate-400">#{item.number}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            }

            if (item.kind === "parent") {
              const { parentSlug, parentTitle, children, dueDate } = item;
              const isExpanded = expandedParents.has(parentSlug);
              const parentStatus = getParentStatus(children);
              const anyChildSelected = children.some(
                (c) => c.slug === selectedModuleSlug,
              );
              const completed = children.filter(
                (m) => m.status === "completed",
              ).length;

              return (
                <div key={parentSlug}>
                  {/* Parent node */}
                  <button
                    onClick={() => toggleParent(parentSlug)}
                    className={`relative w-full flex items-center py-2 group text-left ${
                      anyChildSelected && !isExpanded ? "bg-blue-50/50 -mx-2 px-2 rounded-lg" : ""
                    }`}
                  >
                    <div className="relative z-20">
                      <StatusDot status={parentStatus} />
                    </div>
                    <div className="ml-3 flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {dueDate && (
                          <span className="text-[11px] text-slate-400 w-10 flex-shrink-0">
                            {dueDate}
                          </span>
                        )}
                        <span className="text-sm font-medium text-slate-900 truncate">
                          {parentTitle}
                        </span>
                        <span className="text-xs text-slate-400">
                          {completed}/{children.length}
                        </span>
                        {isExpanded ? (
                          <ChevronDown className="w-3 h-3 text-slate-400 flex-shrink-0" />
                        ) : (
                          <ChevronRight className="w-3 h-3 text-slate-400 flex-shrink-0" />
                        )}
                      </div>
                    </div>
                  </button>

                  {/* Children */}
                  {isExpanded && (
                    <div className="relative ml-[24px]">
                      {/* Vertical line connecting children */}
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
                </div>
              );
            }

            // Regular module
            const { module, dueDate } = item;
            const isSelected = module.slug === selectedModuleSlug;

            return (
              <button
                key={module.slug}
                onClick={() => onModuleSelect(module)}
                className={`relative w-full flex items-center py-2 text-left group transition-colors rounded-lg ${
                  isSelected
                    ? "bg-blue-50 -mx-2 px-2"
                    : "hover:bg-slate-100/70 -mx-2 px-2"
                }`}
              >
                <div className="relative z-20">
                  <StatusDot status={module.status} />
                </div>
                <div className="ml-3 flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {dueDate && (
                      <span className="text-[11px] text-slate-400 w-10 flex-shrink-0">
                        {dueDate}
                      </span>
                    )}
                    <span
                      className={`text-sm truncate ${
                        isSelected
                          ? "font-medium text-blue-900"
                          : module.optional
                            ? "text-slate-500"
                            : "text-slate-700"
                      }`}
                    >
                      {module.title}
                    </span>
                    {module.optional && (
                      <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wide flex-shrink-0">
                        Optional
                      </span>
                    )}
                    {!module.optional &&
                      module.status === "in_progress" &&
                      module.completedLenses !== undefined &&
                      module.totalLenses && (
                        <span className="text-[11px] text-blue-600 font-medium">
                          {module.completedLenses}/{module.totalLenses}
                        </span>
                      )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
