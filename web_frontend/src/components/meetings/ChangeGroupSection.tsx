import { useState } from "react";
import { API_URL } from "../../config";
import { fetchWithRefresh } from "../../api/fetchWithRefresh";
import { getBrowserTimezone } from "../../types/enroll";
import GroupSelectionStep from "../enroll/GroupSelectionStep";

interface ChangeGroupSectionProps {
  cohortId: number;
  currentGroupId: number | null;
  onGroupChanged: () => void;
}

export default function ChangeGroupSection({
  cohortId,
  currentGroupId,
  onGroupChanged,
}: ChangeGroupSectionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [timezone, setTimezone] = useState(getBrowserTimezone());
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(
    currentGroupId,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleJoinGroup = async () => {
    if (!selectedGroupId) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetchWithRefresh(`${API_URL}/api/groups/join`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_id: selectedGroupId }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || "Failed to join group");
      }

      setSuccess(true);
      onGroupChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join group");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) {
    return (
      <div className="border-t border-gray-200 pt-6 mt-8">
        <button
          onClick={() => setIsOpen(true)}
          className="text-sm text-blue-600 hover:text-blue-800 underline"
        >
          Need a permanent schedule change? Change your group
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-gray-200 pt-6 mt-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Change Group</h2>
        <button
          onClick={() => {
            setIsOpen(false);
            setSelectedGroupId(currentGroupId);
            setSuccess(false);
            setError(null);
          }}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          Cancel
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg">
          {error}
        </div>
      )}

      <GroupSelectionStep
        cohortId={cohortId}
        timezone={timezone}
        onTimezoneChange={setTimezone}
        selectedGroupId={selectedGroupId}
        onGroupSelect={(groupId) => {
          setSelectedGroupId(groupId);
          setSuccess(false);
        }}
        onBack={() => {
          setIsOpen(false);
          setSelectedGroupId(currentGroupId);
        }}
        onSubmit={handleJoinGroup}
        onSwitchToAvailability={() => {
          window.location.href = "/enroll";
        }}
        submitButtonLabel="Change Group"
        hideHeader
        isSubmitting={isSubmitting}
        successMessage={
          success
            ? "You've joined your new group. Calendar invites and Discord access will be set up in the next few minutes."
            : undefined
        }
      />
    </div>
  );
}
