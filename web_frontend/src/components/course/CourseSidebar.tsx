/**
 * Accordion sidebar showing course units and modules.
 * Units are identified by meeting number (or null for additional content).
 */

import { useState, useEffect } from "react";
import type { UnitInfo, ModuleInfo } from "../../types/course";
import { ChevronDown, ChevronRight, Check, Circle } from "lucide-react";

type CourseSidebarProps = {
  courseTitle: string;
  units: UnitInfo[];
  selectedModuleSlug: string | null;
  onModuleSelect: (module: ModuleInfo) => void;
};

function ModuleStatusIcon({ status }: { status: ModuleInfo["status"] }) {
  if (status === "completed") {
    return <Check className="w-4 h-4 text-blue-500" />;
  }
  if (status === "in_progress") {
    return <Circle className="w-4 h-4 text-blue-500 fill-blue-500" />;
  }
  return <Circle className="w-4 h-4 text-slate-300" />;
}

function getUnitLabel(unit: UnitInfo): string {
  if (unit.meetingNumber === null) {
    return "Additional Content";
  }
  return `Unit ${unit.meetingNumber}`;
}

export default function CourseSidebar({
  courseTitle,
  units,
  selectedModuleSlug,
  onModuleSelect,
}: CourseSidebarProps) {
  // Track which units are expanded (by index)
  const [expandedUnits, setExpandedUnits] = useState<Set<number>>(new Set());

  // Auto-expand unit containing selected module on mount
  useEffect(() => {
    if (selectedModuleSlug) {
      for (let i = 0; i < units.length; i++) {
        if (units[i].modules.some((m) => m.slug === selectedModuleSlug)) {
          setExpandedUnits((prev) => new Set(prev).add(i));
          break;
        }
      }
    }
  }, [selectedModuleSlug, units]);

  const toggleUnit = (unitIndex: number) => {
    setExpandedUnits((prev) => {
      const next = new Set(prev);
      if (next.has(unitIndex)) {
        next.delete(unitIndex);
      } else {
        next.add(unitIndex);
      }
      return next;
    });
  };

  const getUnitProgress = (unit: UnitInfo) => {
    // Only count required modules for progress
    const requiredModules = unit.modules.filter((m) => !m.optional);
    const completed = requiredModules.filter(
      (m) => m.status === "completed",
    ).length;
    return `${completed}/${requiredModules.length}`;
  };

  return (
    <div className="h-full flex flex-col bg-slate-50 border-r border-slate-200">
      {/* Course title */}
      <div className="p-4 border-b border-slate-200">
        <h1 className="text-lg font-bold text-slate-900">{courseTitle}</h1>
      </div>

      {/* Units list */}
      <div className="flex-1 overflow-y-auto">
        {units.map((unit, unitIndex) => {
          const isExpanded = expandedUnits.has(unitIndex);

          return (
            <div key={unitIndex} className="border-b border-slate-200">
              {/* Unit header */}
              <button
                onClick={() => toggleUnit(unitIndex)}
                className="w-full flex items-center gap-2 p-4 hover:bg-slate-100 transition-colors text-left"
              >
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-slate-500 flex-shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-slate-500 flex-shrink-0" />
                )}
                <span className="flex-1 font-medium text-slate-900">
                  {getUnitLabel(unit)}
                </span>
                <span className="text-sm text-slate-500">
                  {getUnitProgress(unit)}
                </span>
              </button>

              {/* Modules list */}
              {isExpanded && (
                <div className="pb-2">
                  {unit.modules.map((module) => {
                    const isSelected = module.slug === selectedModuleSlug;

                    return (
                      <button
                        key={module.slug}
                        onClick={() => onModuleSelect(module)}
                        className={`w-full flex items-center gap-3 px-4 py-2 pl-10 text-left transition-colors ${
                          isSelected
                            ? "bg-blue-50 text-blue-900"
                            : "hover:bg-slate-100 text-slate-700"
                        }`}
                      >
                        <ModuleStatusIcon status={module.status} />
                        <span
                          className={`flex-1 text-sm ${
                            module.optional ? "text-slate-500" : ""
                          }`}
                        >
                          {module.title}
                        </span>
                        {module.optional && (
                          <span className="text-xs text-slate-400 font-medium">
                            Optional
                          </span>
                        )}
                        {!module.optional &&
                          module.status === "in_progress" && (
                            <span className="text-xs text-blue-600 font-medium">
                              Continue
                            </span>
                          )}
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
