import { useState } from "react";
import type { Cohort } from "../../types/enroll";

interface CohortRoleStepProps {
  enrolledCohorts: Cohort[];
  availableCohorts: Cohort[];
  selectedCohortId: number | null;
  selectedRole: string | null;
  isFacilitator: boolean;
  onCohortSelect: (cohortId: number) => void;
  onRoleSelect: (role: string) => void;
  onBecomeFacilitator: () => Promise<void>;
  onNext: () => void;
  onBack: () => void;
}

export default function CohortRoleStep({
  enrolledCohorts,
  availableCohorts,
  selectedCohortId,
  selectedRole,
  isFacilitator,
  onCohortSelect,
  onRoleSelect,
  onBecomeFacilitator,
  onNext,
  onBack,
}: CohortRoleStepProps) {
  const [showFacilitatorModal, setShowFacilitatorModal] = useState(false);
  const [isBecoming, setIsBecoming] = useState(false);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };

  const handleBecomeFacilitator = async () => {
    setIsBecoming(true);
    try {
      await onBecomeFacilitator();
      setShowFacilitatorModal(false);
    } finally {
      setIsBecoming(false);
    }
  };

  const canProceed = selectedCohortId !== null && selectedRole !== null;

  return (
    <div className="max-w-md mx-auto">
      <h2 className="text-2xl font-bold text-gray-900 mb-2">
        Choose Your Cohort
      </h2>
      <p className="text-gray-600 mb-8">
        Select which cohort you'd like to join.
      </p>

      {/* Already enrolled cohorts */}
      {enrolledCohorts.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-gray-700 mb-2">
            You're enrolled in:
          </h3>
          <ul className="space-y-2">
            {enrolledCohorts.map((cohort) => (
              <li
                key={cohort.cohort_id}
                className="flex items-center gap-2 text-sm text-gray-600 bg-gray-50 px-3 py-2 rounded-lg"
              >
                <span className="text-green-600">✓</span>
                <span>
                  {cohort.cohort_name} (as {cohort.role}) — starts{" "}
                  {formatDate(cohort.cohort_start_date)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Available cohorts dropdown */}
      {availableCohorts.length > 0 ? (
        <div className="mb-6">
          <label
            htmlFor="cohort"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Enroll in a new cohort
          </label>
          <select
            id="cohort"
            value={selectedCohortId ?? ""}
            onChange={(e) => onCohortSelect(Number(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          >
            <option value="">Select a cohort...</option>
            {availableCohorts.map((cohort) => (
              <option key={cohort.cohort_id} value={cohort.cohort_id}>
                {cohort.cohort_name} — starts{" "}
                {formatDate(cohort.cohort_start_date)}
              </option>
            ))}
          </select>
        </div>
      ) : enrolledCohorts.length > 0 ? (
        <p className="text-gray-600 mb-6">
          You're enrolled in all available cohorts.
        </p>
      ) : (
        <p className="text-gray-600 mb-6">
          No cohorts are currently available for enrollment.
        </p>
      )}

      {/* Role selection - only show when cohort selected */}
      {selectedCohortId && (
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Your role
          </label>

          {isFacilitator ? (
            <div className="space-y-2">
              <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="role"
                  value="facilitator"
                  checked={selectedRole === "facilitator"}
                  onChange={() => onRoleSelect("facilitator")}
                  className="w-4 h-4 text-blue-600"
                />
                <span>Facilitator</span>
              </label>
              <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="role"
                  value="participant"
                  checked={selectedRole === "participant"}
                  onChange={() => onRoleSelect("participant")}
                  className="w-4 h-4 text-blue-600"
                />
                <span>Participant</span>
              </label>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-3 p-3 border rounded-lg bg-gray-50">
                <input
                  type="radio"
                  checked
                  readOnly
                  className="w-4 h-4 text-blue-600"
                />
                <span>Participant</span>
              </div>
              <button
                type="button"
                onClick={() => setShowFacilitatorModal(true)}
                className="mt-3 text-sm text-blue-600 hover:text-blue-800 underline"
              >
                Become a facilitator
              </button>
            </div>
          )}
        </div>
      )}

      {/* Navigation */}
      <div className="flex gap-3 mt-8">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 px-4 py-3 font-medium rounded-lg border border-gray-300 hover:bg-gray-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!canProceed}
          className={`flex-1 px-4 py-3 font-medium rounded-lg transition-colors disabled:cursor-default ${
            canProceed
              ? "bg-blue-500 hover:bg-blue-600 text-white"
              : "bg-gray-200 text-gray-400"
          }`}
        >
          Continue to Availability
        </button>
      </div>

      {/* Facilitator confirmation modal */}
      {showFacilitatorModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-sm mx-4">
            <h3 className="text-lg font-bold text-gray-900 mb-3">
              Become a Facilitator
            </h3>
            <p className="text-gray-600 mb-6">
              Facilitators lead weekly group discussions and help participants
              engage with the material. You'll be matched with a group based on
              your availability.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowFacilitatorModal(false)}
                disabled={isBecoming}
                className="flex-1 px-4 py-2 font-medium rounded-lg border border-gray-300 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBecomeFacilitator}
                disabled={isBecoming}
                className="flex-1 px-4 py-2 font-medium rounded-lg bg-blue-500 hover:bg-blue-600 text-white"
              >
                {isBecoming ? "..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
