import { useState, useMemo, useRef, useEffect } from "react";
import type { DayName, AvailabilityData } from "../../types/enroll";
import { DAY_NAMES, parseTimeSlot } from "../../types/enroll";
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

const GRID_COLUMNS = "50px repeat(7, minmax(40px, 1fr))";

function formatHour(hour: number, use24h: boolean): string {
  if (use24h) return `${hour.toString().padStart(2, "0")}:00`;
  if (hour === 0 || hour === 24) return "12am";
  if (hour === 12) return "12pm";
  if (hour < 12) return `${hour}am`;
  return `${hour - 12}pm`;
}

function makeSlots(from: number, to: number): number[] {
  return Array.from({ length: (to - from) * 2 }, (_, i) => from + i * 0.5);
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
    bgClass = isSelected ? "bg-lens-orange-300" : "bg-gray-300";
  } else if (isPreview) {
    bgClass = selectionMode === "add" ? "bg-lens-orange-100" : "bg-red-200";
  } else if (isSelected) {
    bgClass = "bg-lens-orange-400";
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

interface SlotGridProps {
  slots: number[];
  use24h: boolean;
  showEndLabel?: number;
  topPad?: boolean;
  isSelected: (day: DayName, slot: number) => boolean;
  isPreview: (day: DayName, slot: number) => boolean;
  isHovered: (day: DayName, slot: number) => boolean;
  selectionMode: "add" | "remove" | null;
  handlers: {
    onMouseDown: (day: DayName, slot: number) => void;
    onMouseEnter: (day: DayName, slot: number) => void;
    onMouseLeave: () => void;
    onTouchStart: (day: DayName, slot: number) => void;
  };
}

function SlotGrid({
  slots,
  use24h,
  showEndLabel,
  topPad,
  isSelected,
  isPreview,
  isHovered,
  selectionMode,
  handlers,
}: SlotGridProps) {
  if (slots.length === 0) return null;
  return (
    <div
      className="grid select-none"
      style={{ gridTemplateColumns: GRID_COLUMNS }}
    >
      {/* Spacer row so first label's -top-2 doesn't clip */}
      {topPad && <div className="col-span-8 h-2" />}
      {slots.map((slot) => (
        <div key={`row-${slot}`} className="contents">
          <div className="sticky left-0 text-right pr-2 text-xs text-gray-500 flex items-start justify-end relative">
            {slot % 1 === 0 && (
              <span className="relative -top-2">
                {formatHour(slot, use24h)}
              </span>
            )}
          </div>
          {DAY_NAMES.map((day) => (
            <TimeSlotCell
              key={`${day}-${slot}`}
              day={day}
              slot={slot}
              isSelected={isSelected(day, slot)}
              isPreview={isPreview(day, slot)}
              isHovered={isHovered(day, slot)}
              selectionMode={selectionMode}
              onMouseDown={() => handlers.onMouseDown(day, slot)}
              onMouseEnter={() => handlers.onMouseEnter(day, slot)}
              onMouseLeave={handlers.onMouseLeave}
              onTouchStart={() => handlers.onTouchStart(day, slot)}
            />
          ))}
        </div>
      ))}
      {showEndLabel !== undefined && (
        <>
          <div className="sticky left-0 text-right pr-2 text-xs text-gray-500 flex items-start justify-end relative">
            <span className="relative -top-2">
              {formatHour(showEndLabel, use24h)}
            </span>
          </div>
          {DAY_NAMES.map((day) => (
            <div key={`empty-${day}`} />
          ))}
        </>
      )}
    </div>
  );
}

export default function ScheduleSelector({
  value,
  onChange,
  startHour = 8,
  endHour = 22,
}: ScheduleSelectorProps) {
  const [showEarlier, setShowEarlier] = useState(false);
  const [showLater, setShowLater] = useState(false);
  const [use24h, setUse24h] = useState(false);

  // Find the earliest and latest selected slots so we never hide them
  const { earliestSelected, latestSelected } = useMemo(() => {
    let earliest = Infinity;
    let latest = -Infinity;
    for (const slots of Object.values(value)) {
      for (const slot of slots) {
        const hour = parseTimeSlot(slot);
        if (hour < earliest) earliest = hour;
        if (hour + 0.5 > latest) latest = hour + 0.5;
      }
    }
    return {
      earliestSelected: earliest === Infinity ? null : Math.floor(earliest),
      latestSelected: latest === -Infinity ? null : Math.ceil(latest),
    };
  }, [value]);

  // Main section always includes default range + any selected slots
  const mainStart = Math.min(startHour, earliestSelected ?? startHour);
  const mainEnd = Math.max(endHour, latestSelected ?? endHour);

  // Collapsible sections: only slots NOT covered by main
  const earlierSlots = makeSlots(0, mainStart);
  const mainSlots = makeSlots(mainStart, mainEnd);
  const laterSlots = makeSlots(mainEnd, 24);

  // Pass all slots to the selection hook so drag works across sections
  const allSlots = [...earlierSlots, ...mainSlots, ...laterSlots];

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
    slots: allSlots,
  });

  const totalSelected = Object.values(value).reduce(
    (sum, slots) => sum + slots.length,
    0,
  );

  const earlierExpanded = showEarlier && earlierSlots.length > 0;
  const laterExpanded = showLater && laterSlots.length > 0;

  // Track whether the bottom of the grid is visible
  const bottomRef = useRef<HTMLDivElement>(null);
  const [bottomVisible, setBottomVisible] = useState(false);

  useEffect(() => {
    const el = bottomRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setBottomVisible(entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const gridProps = {
    use24h,
    isSelected,
    isPreview,
    isHovered,
    selectionMode: selectionState.selectionMode,
    handlers,
  };

  return (
    <div className="w-full">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-600">
          Click and drag to select your available times
        </p>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setUse24h(!use24h)}
            className="flex rounded-full bg-gray-200 p-0.5 text-xs cursor-pointer"
          >
            <span
              className={`px-2 py-0.5 rounded-full transition-colors ${!use24h ? "bg-white shadow text-gray-900" : "text-gray-500"}`}
            >
              AM/PM
            </span>
            <span
              className={`px-2 py-0.5 rounded-full transition-colors ${use24h ? "bg-white shadow text-gray-900" : "text-gray-500"}`}
            >
              24h
            </span>
          </button>
          <span className="text-sm font-medium text-gray-700">
            {totalSelected} slot{totalSelected !== 1 ? "s" : ""} selected
          </span>
        </div>
      </div>

      {earlierSlots.length > 0 && (
        <button
          type="button"
          onClick={() => setShowEarlier(!showEarlier)}
          className={`mb-2 text-sm hover:underline ${showEarlier ? "text-gray-500 hover:text-gray-700" : "text-blue-600 hover:text-blue-800"}`}
        >
          {showEarlier
            ? "Hide earlier time slots"
            : `Show earlier time slots (${formatHour(0, use24h)}–${formatHour(mainStart, use24h)})`}
        </button>
      )}

      <div className="relative">
      <div ref={gridRef} className="overflow-x-auto overflow-y-hidden select-none">
        {/* Header row — always at top */}
        <div
          className="grid select-none"
          style={{ gridTemplateColumns: GRID_COLUMNS }}
        >
          <div className="sticky left-0" />
          {DAY_NAMES.map((day) => (
            <div
              key={day}
              className="text-center font-medium text-sm py-2 text-gray-700"
            >
              {SHORT_DAY_NAMES[day]}
            </div>
          ))}
        </div>

        {/* Earlier slots — animated */}
        {earlierSlots.length > 0 && (
          <div
            className="grid transition-[grid-template-rows] duration-300 ease-in-out -mb-2"
            style={{
              gridTemplateRows: earlierExpanded ? "1fr" : "0fr",
            }}
          >
            <div className="overflow-hidden min-h-0">
              <SlotGrid slots={earlierSlots} topPad {...gridProps} />
            </div>
          </div>
        )}

        {/* Main slots — always visible */}
        <SlotGrid
          slots={mainSlots}
          showEndLabel={laterExpanded ? undefined : mainEnd}
          {...gridProps}
        />

        {/* Later slots — animated */}
        {laterSlots.length > 0 && (
          <div
            className="grid transition-[grid-template-rows] duration-300 ease-in-out -mt-2"
            style={{
              gridTemplateRows: laterExpanded ? "1fr" : "0fr",
            }}
          >
            <div className="overflow-hidden min-h-0">
              <SlotGrid
                slots={laterSlots}
                showEndLabel={24}
                topPad
                {...gridProps}
              />
            </div>
          </div>
        )}
      </div>

      {/* Sentinel — placed at grid bottom to track visibility */}
      <div ref={bottomRef} className="h-px" />
      </div>

      {/* Fixed gradient + scroll hint when bottom of grid is off-screen */}
      {!bottomVisible && (
        <div className="fixed bottom-21 left-0 right-0 pointer-events-none z-10">
          <div className="h-24 bg-gradient-to-t from-[var(--background,#faf8f3)] to-transparent" />
          <div className="bg-[var(--background,#faf8f3)] flex justify-center items-center gap-1 pb-2">
            <span className="text-sm text-gray-500">Scroll for more times</span>
            <svg className="w-4 h-4 text-gray-500 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      )}

      {laterSlots.length > 0 && (
        <button
          type="button"
          onClick={() => setShowLater(!showLater)}
          className={`mt-2 text-sm hover:underline ${showLater ? "text-gray-500 hover:text-gray-700" : "text-blue-600 hover:text-blue-800"}`}
        >
          {showLater
            ? "Hide later time slots"
            : `Show later time slots (${formatHour(mainEnd, use24h)}–${formatHour(24, use24h)})`}
        </button>
      )}

      <div className="mt-4 flex gap-4 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-gray-200 border border-gray-300" />
          <span className="text-gray-600">Not available</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-lens-orange-400 border border-gray-300" />
          <span className="text-gray-600">Available</span>
        </div>
      </div>

    </div>
  );
}
