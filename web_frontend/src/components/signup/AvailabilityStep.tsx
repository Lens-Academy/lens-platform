import type { AvailabilityData } from "../../types/signup";
import { COMMON_TIMEZONES, formatTimezoneDisplay } from "../../types/signup";
import ScheduleSelector from "../schedule/ScheduleSelector";

interface AvailabilityStepProps {
  availability: AvailabilityData;
  onAvailabilityChange: (data: AvailabilityData) => void;
  timezone: string;
  onTimezoneChange: (timezone: string) => void;
  onBack: () => void;
  onSubmit: () => void;
  cohort: { cohort_start_date: string; duration_days: number } | null;
}

export default function AvailabilityStep({
  availability,
  onAvailabilityChange,
  timezone,
  onTimezoneChange,
  onBack,
  onSubmit,
  cohort,
}: AvailabilityStepProps) {
  const totalSlots = Object.values(availability).reduce(
    (sum, slots) => sum + slots.length,
    0
  );

  const formatDateRange = () => {
    if (!cohort || !cohort.duration_days) return null;

    const startDate = new Date(cohort.cohort_start_date);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + cohort.duration_days - 1);

    const formatDate = (date: Date) =>
      date.toLocaleDateString("en-US", { month: "long", day: "numeric" });

    return `${formatDate(startDate)} and ${formatDate(endDate)}`;
  };

  const dateRange = formatDateRange();

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-900 mb-2">
        Your Availability
      </h2>
      <p className="text-gray-600 mb-6">
        {dateRange ? (
          <>
            Give us your weekly recurring availability between <strong>{dateRange}</strong>.
            This helps us match you with a group that fits your schedule.
            You will have a weekly group meeting at the same time each week.
          </>
        ) : (
          <>
            Give us your weekly recurring availability.
            This helps us match you with a group that fits your schedule.
            You will have a weekly group meeting at the same time each week.
          </>
        )}
      </p>

      <div className="mb-6">
        <label
          htmlFor="timezone"
          className="block text-sm font-medium text-gray-700 mb-2"
        >
          Your Timezone
        </label>
        <select
          id="timezone"
          value={timezone}
          onChange={(e) => onTimezoneChange(e.target.value)}
          className="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          {/* Include current timezone if not in common list */}
          {!COMMON_TIMEZONES.includes(
            timezone as (typeof COMMON_TIMEZONES)[number]
          ) && (
            <option value={timezone}>{formatTimezoneDisplay(timezone)}</option>
          )}
          {COMMON_TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {formatTimezoneDisplay(tz)}
            </option>
          ))}
        </select>
      </div>

      <ScheduleSelector
        value={availability}
        onChange={onAvailabilityChange}
        startHour={8}
        endHour={22}
      />

      <div className="mt-8 flex gap-4">
        <button
          type="button"
          onClick={onBack}
          className="px-6 py-3 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={totalSlots === 0}
          className={`flex-1 px-6 py-3 font-medium rounded-lg transition-colors disabled:cursor-default ${
            totalSlots === 0
              ? "bg-gray-300 text-gray-500"
              : "bg-blue-500 hover:bg-blue-600 text-white"
          }`}
        >
          {totalSlots === 0
            ? "Select at least one time slot"
            : "Complete Signup"}
        </button>
      </div>
    </div>
  );
}
