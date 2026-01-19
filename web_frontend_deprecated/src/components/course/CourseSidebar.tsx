/**
 * Accordion sidebar showing course units and lessons.
 * Units are identified by meeting number (or null for additional content).
 */

import { useState, useEffect } from "react";
import type { UnitInfo, LessonInfo } from "../../types/course";
import { ChevronDown, ChevronRight, Check, Circle } from "lucide-react";

type CourseSidebarProps = {
  courseTitle: string;
  units: UnitInfo[];
  selectedLessonSlug: string | null;
  onLessonSelect: (lesson: LessonInfo) => void;
};

function LessonStatusIcon({ status }: { status: LessonInfo["status"] }) {
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
  selectedLessonSlug,
  onLessonSelect,
}: CourseSidebarProps) {
  // Track which units are expanded (by index)
  const [expandedUnits, setExpandedUnits] = useState<Set<number>>(new Set());

  // Auto-expand unit containing selected lesson on mount
  useEffect(() => {
    if (selectedLessonSlug) {
      for (let i = 0; i < units.length; i++) {
        if (units[i].lessons.some((l) => l.slug === selectedLessonSlug)) {
          setExpandedUnits((prev) => new Set(prev).add(i));
          break;
        }
      }
    }
  }, [selectedLessonSlug, units]);

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
    // Only count required lessons for progress
    const requiredLessons = unit.lessons.filter((l) => !l.optional);
    const completed = requiredLessons.filter(
      (l) => l.status === "completed"
    ).length;
    return `${completed}/${requiredLessons.length}`;
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

              {/* Lessons list */}
              {isExpanded && (
                <div className="pb-2">
                  {unit.lessons.map((lesson) => {
                    const isSelected = lesson.slug === selectedLessonSlug;

                    return (
                      <button
                        key={lesson.slug}
                        onClick={() => onLessonSelect(lesson)}
                        className={`w-full flex items-center gap-3 px-4 py-2 pl-10 text-left transition-colors ${
                          isSelected
                            ? "bg-blue-50 text-blue-900"
                            : "hover:bg-slate-100 text-slate-700"
                        }`}
                      >
                        <LessonStatusIcon status={lesson.status} />
                        <span
                          className={`flex-1 text-sm ${
                            lesson.optional ? "text-slate-500" : ""
                          }`}
                        >
                          {lesson.title}
                        </span>
                        {lesson.optional && (
                          <span className="text-xs text-slate-400 font-medium">
                            Optional
                          </span>
                        )}
                        {!lesson.optional &&
                          lesson.status === "in_progress" && (
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
