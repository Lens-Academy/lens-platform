/**
 * Flat sidebar showing course modules.
 * Meeting numbers shown as subtle labels on the first module of each group.
 * Modules split into submodules are grouped under collapsible parent headers.
 */

import { useState } from "react";
import type { UnitInfo, ModuleInfo } from "../../types/course";
import { ChevronDown, ChevronRight, Check, Circle } from "lucide-react";
import { OptionalBadge } from "../OptionalBadge";

type CourseSidebarProps = {
  courseTitle: string;
  units: UnitInfo[];
  selectedModuleSlug: string | null;
  onModuleSelect: (module: ModuleInfo) => void;
};

function ModuleStatusIcon({ status }: { status: ModuleInfo["status"] }) {
  if (status === "completed") {
    return <Check className="w-4 h-4 text-lens-gold-500" />;
  }
  if (status === "in_progress") {
    return <Circle className="w-4 h-4 text-lens-gold-500 fill-lens-gold-500" />;
  }
  return <Circle className="w-4 h-4 text-slate-300" />;
}

// A sidebar entry: a standalone module or a parent group with children
type SidebarItem =
  | { kind: "module"; module: ModuleInfo; meetingLabel: string | null }
  | {
      kind: "parent";
      parentSlug: string;
      parentTitle: string;
      children: ModuleInfo[];
      meetingLabel: string | null;
    };

function buildSidebarItems(units: UnitInfo[]): SidebarItem[] {
  const items: SidebarItem[] = [];
  let lastMeeting: number | null = null;

  for (const unit of units) {
    // Show meeting label on the first item of each new meeting group
    const meetingChanged =
      unit.meetingNumber !== null && unit.meetingNumber !== lastMeeting;
    let meetingLabel: string | null = meetingChanged
      ? `Meeting ${unit.meetingNumber}`
      : null;
    if (meetingChanged) lastMeeting = unit.meetingNumber;

    // Group consecutive modules with the same parentSlug
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
          meetingLabel,
        });
      } else {
        items.push({ kind: "module", module: mod, meetingLabel });
        i++;
      }
      // Only the first item in this unit gets the label
      meetingLabel = null;
    }
  }

  return items;
}

function getParentProgress(children: ModuleInfo[]) {
  const required = children.filter((m) => !m.optional);
  const completed = required.filter((m) => m.status === "completed").length;
  return `${completed}/${required.length}`;
}

function getParentStatus(children: ModuleInfo[]): ModuleInfo["status"] {
  if (children.every((m) => m.status === "completed")) return "completed";
  if (
    children.some((m) => m.status === "in_progress" || m.status === "completed")
  )
    return "in_progress";
  return "not_started";
}

function MeetingLabel({ label }: { label: string | null }) {
  if (!label) return null;
  return (
    <span className="text-[11px] text-slate-400 font-medium">{label}</span>
  );
}

export default function CourseSidebar({
  courseTitle,
  units,
  selectedModuleSlug,
  onModuleSelect,
}: CourseSidebarProps) {
  const sidebarItems = buildSidebarItems(units);

  // Track which parent groups are expanded (by parentSlug) - all expanded by default
  const [expandedParents, setExpandedParents] = useState<Set<string>>(() => {
    const slugs = new Set<string>();
    for (const item of sidebarItems) {
      if (item.kind === "parent") slugs.add(item.parentSlug);
    }
    return slugs;
  });

  const toggleParent = (slug: string) => {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      return next;
    });
  };

  return (
    <div className="h-full flex flex-col border-r" style={{ backgroundColor: "var(--brand-bg)", borderColor: "var(--brand-border)" }}>
      {/* Course title */}
      <div className="p-4 border-b" style={{ borderColor: "var(--brand-border)" }}>
        <h1 className="text-lg font-bold" style={{ color: "var(--brand-text)", fontFamily: "var(--brand-font-display)" }}>{courseTitle}</h1>
      </div>

      {/* Flat module list */}
      <div className="flex-1 overflow-y-auto">
        {sidebarItems.map((item) => {
          if (item.kind === "module") {
            const { module, meetingLabel } = item;
            const isSelected = module.slug === selectedModuleSlug;
            return (
              <button
                key={module.slug}
                onClick={() => onModuleSelect(module)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  isSelected
                    ? "bg-[var(--brand-accent)]/10 text-[var(--brand-text)]"
                    : "hover:bg-[var(--brand-border)]/30 text-slate-700"
                }`}
              >
                <ModuleStatusIcon status={module.status} />
                <span
                  className={`flex-1 text-sm ${module.optional ? "text-slate-500" : ""}`}
                >
                  {module.title}
                </span>
                {module.optional && <OptionalBadge />}
                {!module.optional && module.status === "in_progress" && (
                  <span className="text-xs text-lens-gold-500 font-medium">
                    {module.completedLenses !== undefined && module.totalLenses
                      ? `${module.completedLenses}/${module.totalLenses}`
                      : "Continue"}
                  </span>
                )}
                <MeetingLabel label={meetingLabel} />
              </button>
            );
          }

          // Parent group with collapsible children
          const { parentSlug, parentTitle, children, meetingLabel } = item;
          const isExpanded = expandedParents.has(parentSlug);
          const parentStatus = getParentStatus(children);
          const anyChildSelected = children.some(
            (c) => c.slug === selectedModuleSlug,
          );

          return (
            <div key={parentSlug}>
              {/* Parent header */}
              <button
                onClick={() => toggleParent(parentSlug)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  anyChildSelected && !isExpanded
                    ? "bg-[var(--brand-accent)]/10"
                    : "hover:bg-[var(--brand-border)]/30"
                }`}
              >
                <ModuleStatusIcon status={parentStatus} />
                <span className="flex-1 text-sm font-medium text-slate-900">
                  {parentTitle}
                </span>
                <span className="text-xs text-slate-400 mr-1">
                  {getParentProgress(children)}
                </span>
                <MeetingLabel label={meetingLabel} />
                {isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                )}
              </button>

              {/* Children (submodules) */}
              {isExpanded && (
                <div className="pb-1">
                  {children.map((child) => {
                    const isSelected = child.slug === selectedModuleSlug;
                    return (
                      <button
                        key={child.slug}
                        onClick={() => onModuleSelect(child)}
                        className={`w-full flex items-center gap-3 pl-10 pr-4 py-2 text-left transition-colors ${
                          isSelected
                            ? "bg-[var(--brand-accent)]/10 text-[var(--brand-text)]"
                            : "hover:bg-[var(--brand-border)]/30 text-slate-600"
                        }`}
                      >
                        <ModuleStatusIcon status={child.status} />
                        <span
                          className={`flex-1 text-sm ${child.optional ? "text-slate-400" : ""}`}
                        >
                          {child.title}
                        </span>
                        {child.optional && <OptionalBadge />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
