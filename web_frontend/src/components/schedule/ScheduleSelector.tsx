import type { DayName, AvailabilityData } from "../../types/signup";
import { DAY_NAMES } from "../../types/signup";
import { useScheduleSelection } from "./useScheduleSelection";

interface ScheduleSelectorProps {
  value: AvailabilityData;
  onChange: (data: AvailabilityData) => void;
  startHour?: number;
  endHour?: number;
}

const SHORT_DAY_NAMES: Record<DayName, string> = {
  Monday: "Mon",
  Tuesday: "Tue",
  Wednesday: "Wed",
  Thursday: "Thu",
  Friday: "Fri",
  Saturday: "Sat",
  Sunday: "Sun",
};

function formatHour(hour: number): string {
  if (hour === 0) return "12am";
  if (hour === 12) return "12pm";
  if (hour < 12) return `${hour}am`;
  return `${hour - 12}pm`;
}

interface TimeSlotCellProps {
  day: DayName;
  slot: number;
  isSelected: boolean;
  isPreview: boolean;
  isHovered: boolean;
  selectionMode: "add" | "remove" | null;
  onMouseDown: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onTouchStart: () => void;
}

function TimeSlotCell({
  day,
  slot,
  isSelected,
  isPreview,
  isHovered,
  selectionMode,
  onMouseDown,
  onMouseEnter,
  onMouseLeave,
  onTouchStart,
}: TimeSlotCellProps) {
  let bgClass = "bg-gray-200";

  if (isHovered && !isPreview) {
    // Hover state (only when not dragging)
    bgClass = isSelected ? "bg-blue-400" : "bg-gray-300";
  } else if (isPreview) {
    // During drag, show preview state
    bgClass = selectionMode === "add" ? "bg-blue-300" : "bg-red-200";
  } else if (isSelected) {
    bgClass = "bg-blue-500";
  }

  return (
    <div
      className="p-px cursor-pointer select-none touch-none"
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onTouchStart={onTouchStart}
    >
      <div data-day={day} data-slot={slot} className={`h-6 ${bgClass}`} />
    </div>
  );
}

export default function ScheduleSelector({
  value,
  onChange,
  startHour = 8,
  endHour = 22,
}: ScheduleSelectorProps) {
  const slots = Array.from(
    { length: (endHour - startHour) * 2 },
    (_, i) => startHour + i * 0.5
  );

  const {
    gridRef,
    selectionState,
    isSelected,
    isPreview,
    isHovered,
    handlers,
  } = useScheduleSelection({
    value,
    onChange,
    slots,
  });

  const totalSelected = Object.values(value).reduce(
    (sum, slots) => sum + slots.length,
    0
  );

  return (
    <div className="w-full">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-600">
          Click and drag to select your available times
        </p>
        <span className="text-sm font-medium text-gray-700">
          {totalSelected} slot{totalSelected !== 1 ? "s" : ""} selected
        </span>
      </div>

      <div
        ref={gridRef}
        className="grid select-none overflow-x-auto"
        style={{
          gridTemplateColumns: "50px repeat(7, minmax(40px, 1fr))",
        }}
      >
        {/* Header row: empty corner + day names */}
        <div className="sticky left-0" />
        {DAY_NAMES.map((day) => (
          <div
            key={day}
            className="text-center font-medium text-sm py-2 text-gray-700"
          >
            {SHORT_DAY_NAMES[day]}
          </div>
        ))}

        {/* Time rows */}
        {slots.map((slot) => (
          <div key={`row-${slot}`} className="contents">
            {/* Time label - only show on full hours, positioned at top edge */}
            <div className="sticky left-0 text-right pr-2 text-xs text-gray-500 flex items-start justify-end relative">
              {slot % 1 === 0 && (
                <span className="relative -top-2">{formatHour(slot)}</span>
              )}
            </div>

            {/* Day cells for this slot */}
            {DAY_NAMES.map((day) => (
              <TimeSlotCell
                key={`${day}-${slot}`}
                day={day}
                slot={slot}
                isSelected={isSelected(day, slot)}
                isPreview={isPreview(day, slot)}
                isHovered={isHovered(day, slot)}
                selectionMode={selectionState.selectionMode}
                onMouseDown={() => handlers.onMouseDown(day, slot)}
                onMouseEnter={() => handlers.onMouseEnter(day, slot)}
                onMouseLeave={handlers.onMouseLeave}
                onTouchStart={() => handlers.onTouchStart(day, slot)}
              />
            ))}
          </div>
        ))}

        {/* Final time label row */}
        <div className="sticky left-0 text-right pr-2 text-xs text-gray-500 flex items-start justify-end relative">
          <span className="relative -top-2">{formatHour(endHour)}</span>
        </div>
        {DAY_NAMES.map((day) => (
          <div key={`empty-${day}`} />
        ))}
      </div>

      <div className="mt-4 flex gap-4 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-gray-200 border border-gray-300" />
          <span className="text-gray-600">Not available</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-blue-500 border border-gray-300" />
          <span className="text-gray-600">Available</span>
        </div>
      </div>
    </div>
  );
}
