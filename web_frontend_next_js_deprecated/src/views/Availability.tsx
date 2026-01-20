"use client";

import { useState, useEffect } from "react";
import { useAuth } from "../hooks/useAuth";
import ScheduleSelector from "../components/schedule/ScheduleSelector";
import type { AvailabilityData } from "../types/signup";
import {
  COMMON_TIMEZONES,
  formatTimezoneDisplay,
  EMPTY_AVAILABILITY,
  getBrowserTimezone,
} from "../types/signup";
import { API_URL } from "../config";

export default function Availability() {
  const { isAuthenticated, isLoading, user, login } = useAuth();
  const [availability, setAvailability] = useState<AvailabilityData>({
    ...EMPTY_AVAILABILITY,
  });
  const [timezone, setTimezone] = useState(getBrowserTimezone());
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">(
    "idle"
  );

  // Load existing data when user is authenticated
  useEffect(() => {
    if (user) {
      if (user.availability_local) {
        try {
          setAvailability(JSON.parse(user.availability_local));
        } catch {
          // Keep default empty
        }
      }
      if (user.timezone) {
        setTimezone(user.timezone);
      }
    }
  }, [user]);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveStatus("idle");
    try {
      const response = await fetch(`${API_URL}/api/users/me`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timezone: timezone,
          availability_local: JSON.stringify(availability),
        }),
      });
      if (!response.ok) throw new Error("Failed to save");
      setSaveStatus("success");
    } catch {
      setSaveStatus("error");
    } finally {
      setIsSaving(false);
    }
  };

  const totalSlots = Object.values(availability).reduce(
    (sum, slots) => sum + slots.length,
    0
  );

  if (isLoading) {
    return (
      <div className="py-8 flex justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="py-8 max-w-md mx-auto text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">
          Edit Your Availability
        </h1>
        <p className="text-gray-600 mb-6">
          Please sign in with Discord to view and edit your availability.
        </p>
        <button
          onClick={login}
          className="px-6 py-3 bg-[#5865F2] hover:bg-[#4752C4] text-white font-medium rounded-lg transition-colors"
        >
          Sign in with Discord
        </button>
      </div>
    );
  }

  return (
    <div className="py-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Your Availability
        </h1>
        <p className="text-gray-600 mb-6">
          Update the times when you're available to participate in course
          sessions.
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
            onChange={(e) => setTimezone(e.target.value)}
            className="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            {/* Include current timezone if not in common list */}
            {!COMMON_TIMEZONES.includes(
              timezone as (typeof COMMON_TIMEZONES)[number]
            ) && (
              <option value={timezone}>
                {formatTimezoneDisplay(timezone)}
              </option>
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
          onChange={setAvailability}
          startHour={8}
          endHour={22}
        />

        <div className="mt-8 flex items-center gap-4">
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || totalSlots === 0}
            className={`px-6 py-3 font-medium rounded-lg transition-colors disabled:cursor-default ${
              isSaving || totalSlots === 0
                ? "bg-gray-300 text-gray-500"
                : "bg-blue-500 hover:bg-blue-600 text-white"
            }`}
          >
            {isSaving
              ? "Saving..."
              : totalSlots === 0
                ? "Select at least one time slot"
                : "Save Changes"}
          </button>
          {saveStatus === "success" && (
            <span className="text-green-600 font-medium">Saved!</span>
          )}
          {saveStatus === "error" && (
            <span className="text-red-600 font-medium">
              Error saving. Please try again.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
