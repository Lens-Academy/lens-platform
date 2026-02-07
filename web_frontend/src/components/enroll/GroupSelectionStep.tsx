import { useState, useEffect, useCallback } from "react";
import type { Group } from "../../types/enroll";
import { COMMON_TIMEZONES, formatTimezoneDisplay } from "../../types/enroll";
import { API_URL } from "../../config";
import { fetchWithRefresh } from "../../api/fetchWithRefresh";

interface GroupSelectionStepProps {
  cohortId: number;
  timezone: string;
  onTimezoneChange: (timezone: string) => void;
  selectedGroupId: number | null;
  onGroupSelect: (groupId: number) => void;
  onBack: () => void;
  onSubmit: () => void;
  onSwitchToAvailability: () => void;
  submitButtonLabel?: string;
  hideHeader?: boolean;
  isSubmitting?: boolean;
  successMessage?: string;
  cohortStartDate?: string;
  cohortEndDate?: string;
  cohortName?: string;
}

export default function GroupSelectionStep({
  cohortId,
  timezone,
  onTimezoneChange,
  selectedGroupId,
  onGroupSelect,
  onBack,
  onSubmit,
  onSwitchToAvailability,
  submitButtonLabel = "Complete Enrollment",
  hideHeader = false,
  isSubmitting = false,
  successMessage,
  cohortStartDate,
  cohortEndDate,
  cohortName,
}: GroupSelectionStepProps) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGroups = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetchWithRefresh(
        `${API_URL}/api/cohorts/${cohortId}/groups`,
        { credentials: "include" },
      );
      if (response.status === 401) {
        window.location.href = "/enroll";
        return;
      }
      if (!response.ok) {
        throw new Error("Failed to fetch groups");
      }
      const data = await response.json();
      // Backend returns pre-filtered, pre-sorted groups - just use them
      setGroups(data.groups);
    } catch (err) {
      setError("Failed to load groups. Please try again.");
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [cohortId]);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  // Format next_meeting_at in user's timezone (backend provides ISO datetime)
  const formatMeetingTime = (isoDatetime: string | null): string => {
    if (!isoDatetime) return "Time TBD";

    try {
      const date = new Date(isoDatetime);
      return new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        weekday: "long",
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
    } catch {
      return "Time TBD";
    }
  };

  // Badge display text (backend decides which groups get badges)
  const getBadgeText = (badge: string | null): string | null => {
    if (badge === "best_size") return "Best size to join!";
    return null;
  };

  // Format cohort dates
  const formatCohortDate = (dateStr: string | undefined): string => {
    if (!dateStr) return "";
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  if (isLoading) {
    return (
      <div className="max-w-md mx-auto">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto">
        <div className="text-red-600 text-center py-8">{error}</div>
        <button
          onClick={fetchGroups}
          className="w-full px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="max-w-md mx-auto">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          No Groups Available
        </h2>
        <p className="text-gray-600 mb-6">
          No groups are available to join in this cohort. Groups may not be
          scheduled yet, may be full, or may have already started. You can join
          a different cohort and be matched based on your availability.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onBack}
            className="flex-1 px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Back
          </button>
          <button
            onClick={onSwitchToAvailability}
            className="flex-1 px-4 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            Choose Different Cohort
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto">
      {!hideHeader && (
        <>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Select Your Group
          </h2>
          {cohortStartDate && cohortEndDate && (
            <p className="text-gray-600 mb-2">
              {cohortName && <>{cohortName} — </>}
              {formatCohortDate(cohortStartDate)} –{" "}
              {formatCohortDate(cohortEndDate)}
            </p>
          )}
          <p className="text-gray-600 mb-6">
            Choose a group that fits your schedule. You'll meet weekly at the
            same time.
          </p>
        </>
      )}

      {/* Timezone selector */}
      <div className="mb-6">
        <label
          htmlFor="timezone"
          className="block text-sm font-medium text-gray-700 mb-2"
        >
          Show times in:
        </label>
        <select
          id="timezone"
          value={timezone}
          onChange={(e) => onTimezoneChange(e.target.value)}
          className="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {!COMMON_TIMEZONES.includes(
            timezone as (typeof COMMON_TIMEZONES)[number],
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

      {/* Group list - rendered directly from API response */}
      <div className="space-y-3 mb-6">
        {groups.map((group) => {
          const isSelected = selectedGroupId === group.group_id;
          const badgeText = getBadgeText(group.badge);

          return (
            <button
              key={group.group_id}
              type="button"
              onClick={() => onGroupSelect(group.group_id)}
              className={`w-full text-left p-4 border rounded-lg transition-colors ${
                isSelected
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium text-gray-900">
                    {formatMeetingTime(group.next_meeting_at)}
                  </div>
                  <div className="text-sm text-gray-600">
                    {group.group_name}
                  </div>
                  {group.facilitator_name && (
                    <div className="text-sm text-gray-600 mt-1">
                      with {group.facilitator_name}
                    </div>
                  )}
                  <div className="text-sm text-gray-500 mt-1">
                    {group.is_current ? (
                      <span className="text-blue-600">
                        You're in this group
                      </span>
                    ) : (
                      <>
                        {group.member_count} member
                        {group.member_count !== 1 ? "s" : ""}
                      </>
                    )}
                  </div>
                </div>
                {badgeText && !group.is_current && (
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    {badgeText}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Escape hatch */}
      <div className="text-center mb-6">
        <button
          type="button"
          onClick={onSwitchToAvailability}
          className="text-sm text-blue-600 hover:text-blue-800 underline"
        >
          None of these work? Join a different cohort
        </button>
      </div>

      {/* Navigation */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 px-4 py-3 font-medium rounded-lg border border-gray-300 hover:bg-gray-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={
            isSubmitting ||
            !selectedGroupId ||
            groups.find((g) => g.group_id === selectedGroupId)?.is_current
          }
          className={`flex-1 px-4 py-3 font-medium rounded-lg transition-colors disabled:cursor-default ${
            !isSubmitting &&
            selectedGroupId &&
            !groups.find((g) => g.group_id === selectedGroupId)?.is_current
              ? "bg-blue-500 hover:bg-blue-600 text-white"
              : "bg-gray-200 text-gray-400"
          }`}
        >
          {submitButtonLabel}
        </button>
      </div>

      {isSubmitting && (
        <div className="mt-4 p-3 bg-blue-50 text-blue-700 rounded-lg flex items-center gap-2">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-700"></div>
          Updating your group...
        </div>
      )}

      {successMessage && !isSubmitting && (
        <div className="mt-4 p-3 bg-green-50 text-green-700 rounded-lg">
          {successMessage}
        </div>
      )}
    </div>
  );
}
