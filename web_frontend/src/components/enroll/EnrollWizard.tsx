import { useState, useEffect, useMemo } from "react";
import type { EnrollFormData, Cohort } from "../../types/enroll";
import { EMPTY_AVAILABILITY, getBrowserTimezone } from "../../types/enroll";
import PersonalInfoStep from "./PersonalInfoStep";
import CohortRoleStep from "./CohortRoleStep";
import AvailabilityStep from "./AvailabilityStep";
import GroupSelectionStep from "./GroupSelectionStep";
import EnrollSuccessMessage from "./EnrollSuccessMessage";
import ProspectEmailForm from "../ProspectEmailForm";
import { useAuth } from "../../hooks/useAuth";
import { API_URL } from "../../config";
import { fetchWithRefresh } from "../../api/fetchWithRefresh";
import {
  trackEnrollmentStarted,
  trackEnrollmentStepCompleted,
  trackEnrollmentCompleted,
} from "../../analytics";

type Step = 1 | 2 | 3 | "complete";

interface EnrollWizardProps {
  /** Pre-selected course slug from parent (skips course selection if only one matching cohort) */
  courseSlug?: string;
}

export default function EnrollWizard({ courseSlug }: EnrollWizardProps) {
  const { isAuthenticated, isLoading, user, discordUsername, login } =
    useAuth();

  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [formData, setFormData] = useState<EnrollFormData>({
    displayName: "",
    email: "",
    discordConnected: false,
    discordUsername: undefined,
    termsAccepted: true, // Now handled by TosConsentModal
    availability: { ...EMPTY_AVAILABILITY },
    timezone: getBrowserTimezone(),
    selectedCohortId: null,
    selectedRole: null,
    selectedGroupId: null,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Force availability mode when user clicks "switch to availability" from GroupSelectionStep
  const [forceAvailabilityMode, setForceAvailabilityMode] = useState(false);

  // Public cohort availability check (before auth)
  const [hasAvailableCohorts, setHasAvailableCohorts] = useState<
    boolean | null
  >(null);

  // Cohort data
  const [enrolledCohorts, setEnrolledCohorts] = useState<Cohort[]>([]);
  const [availableCohorts, setAvailableCohorts] = useState<Cohort[]>([]);
  const [isFacilitator, setIsFacilitator] = useState(false);

  // Auto-select cohort matching courseSlug when cohorts load
  useEffect(() => {
    if (!courseSlug || availableCohorts.length === 0) return;
    if (formData.selectedCohortId) return; // Already selected

    const matching = availableCohorts.filter(
      (c) => c.course_slug === courseSlug,
    );
    if (matching.length === 1) {
      setFormData((prev) => ({
        ...prev,
        selectedCohortId: matching[0].cohort_id,
        selectedRole: isFacilitator ? null : "participant",
      }));
    }
  }, [courseSlug, availableCohorts, isFacilitator, formData.selectedCohortId]);

  // Get the selected cohort
  const selectedCohort = useMemo(() => {
    if (!formData.selectedCohortId) return null;
    return (
      availableCohorts.find((c) => c.cohort_id === formData.selectedCohortId) ??
      null
    );
  }, [formData.selectedCohortId, availableCohorts]);

  // Determine if selected cohort has groups (for direct group join flow)
  const selectedCohortHasGroups = selectedCohort?.has_groups ?? false;

  // Calculate cohort end date from start date + duration
  const selectedCohortEndDate = useMemo(() => {
    if (!selectedCohort) return undefined;
    const startDate = new Date(selectedCohort.cohort_start_date);
    startDate.setDate(startDate.getDate() + selectedCohort.duration_days);
    return startDate.toISOString().split("T")[0];
  }, [selectedCohort]);

  // Check if any cohorts are available (public, no auth)
  useEffect(() => {
    fetch(`${API_URL}/api/cohorts/available-public`)
      .then((res) => res.json())
      .then((data) => setHasAvailableCohorts(data.has_available))
      .catch(() => setHasAvailableCohorts(true)); // Assume available on error
  }, []);

  // Track enrollment started on mount
  useEffect(() => {
    trackEnrollmentStarted();
  }, []);

  // Sync auth state with form data and auto-advance when authenticated
  useEffect(() => {
    if (isAuthenticated && discordUsername) {
      setFormData((prev) => {
        let availability = prev.availability;
        let timezone = prev.timezone;

        if (user?.availability_local) {
          try {
            availability = JSON.parse(user.availability_local);
          } catch {
            // Keep existing
          }
        }
        if (user?.timezone) {
          timezone = user.timezone;
        }

        return {
          ...prev,
          discordConnected: true,
          discordUsername: discordUsername,
          displayName: user?.nickname || discordUsername || prev.displayName,
          email: user?.email || prev.email,
          availability,
          timezone,
        };
      });

      // Auto-advance to step 2 when already authenticated
      if (currentStep === 1) {
        setCurrentStep(2);
      }

      // Fetch cohorts and facilitator status
      fetchCohortData();
      fetchFacilitatorStatus();
    }
  }, [isAuthenticated, discordUsername, user, currentStep]);

  const fetchCohortData = async () => {
    try {
      const response = await fetchWithRefresh(
        `${API_URL}/api/cohorts/available`,
        {
          credentials: "include",
        },
      );
      if (response.ok) {
        const data = await response.json();
        setEnrolledCohorts(data.enrolled);
        setAvailableCohorts(data.available);
      }
    } catch (error) {
      console.error("Failed to fetch cohorts:", error);
    }
  };

  const fetchFacilitatorStatus = async () => {
    try {
      const response = await fetchWithRefresh(
        `${API_URL}/api/users/me/facilitator-status`,
        {
          credentials: "include",
        },
      );
      if (response.ok) {
        const data = await response.json();
        setIsFacilitator(data.is_facilitator);
      }
    } catch (error) {
      console.error("Failed to fetch facilitator status:", error);
    }
  };

  const handleBecomeFacilitator = async () => {
    const response = await fetchWithRefresh(
      `${API_URL}/api/users/me/become-facilitator`,
      {
        method: "POST",
        credentials: "include",
      },
    );
    if (response.ok) {
      setIsFacilitator(true);
      setFormData((prev) => ({ ...prev, selectedRole: "facilitator" }));
    }
  };

  const handleDiscordConnect = () => {
    // Save course selection so we restore it after OAuth redirect
    if (courseSlug) {
      sessionStorage.setItem(
        "lens-enroll-state",
        JSON.stringify({ slug: courseSlug }),
      );
    }
    // login() auto-detects ref from sessionStorage, no need to pass explicitly
    login();
  };

  const handleSubmit = async () => {
    if (!isAuthenticated) {
      console.error("User not authenticated");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetchWithRefresh(`${API_URL}/api/users/me`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          nickname: formData.displayName || null,
          email: formData.email || null,
          timezone: formData.timezone,
          // Only send availability if not doing direct group join
          availability_local: formData.selectedGroupId
            ? null
            : JSON.stringify(formData.availability),
          cohort_id: formData.selectedCohortId,
          role: formData.selectedRole,
          tos_accepted: formData.termsAccepted,
          group_id: formData.selectedGroupId,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || "Failed to update profile");
      }

      trackEnrollmentCompleted();
      setCurrentStep("complete");
    } catch (error) {
      console.error("Failed to submit:", error);
      alert(
        error instanceof Error
          ? error.message
          : "Failed to save. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // Show email capture if no cohorts are available (checked before auth)
  if (hasAvailableCohorts === false) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <h2 className="text-2xl font-bold text-gray-900 mb-3">
          No courses are currently open for enrollment
        </h2>
        <p className="text-gray-600 mb-8">
          Leave your email and we&rsquo;ll notify you when the next course
          opens.
        </p>
        <ProspectEmailForm variant="standalone" />
        <p className="text-sm text-gray-500 mt-6">
          In the meantime, you can{" "}
          <a
            href="/course/default"
            className="hover:underline"
            style={{ color: "var(--brand-accent)" }}
          >
            explore our free course materials
          </a>
          .
        </p>
      </div>
    );
  }

  if (isLoading || hasAvailableCohorts === null) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--brand-accent)]"></div>
      </div>
    );
  }

  if (currentStep === "complete") {
    return <EnrollSuccessMessage />;
  }

  return (
    <div>
      {currentStep === 1 && (
        <PersonalInfoStep
          discordConnected={formData.discordConnected}
          discordUsername={formData.discordUsername}
          onDiscordConnect={handleDiscordConnect}
        />
      )}

      {currentStep === 2 && (
        <CohortRoleStep
          enrolledCohorts={enrolledCohorts}
          availableCohorts={availableCohorts}
          selectedCohortId={formData.selectedCohortId}
          selectedRole={
            formData.selectedRole ?? (isFacilitator ? null : "participant")
          }
          isFacilitator={isFacilitator}
          onCohortSelect={(id) => {
            setFormData((prev) => ({
              ...prev,
              selectedCohortId: id,
              selectedRole: isFacilitator ? null : "participant",
              selectedGroupId: null,
            }));
            setForceAvailabilityMode(false);
          }}
          onRoleSelect={(role) =>
            setFormData((prev) => ({ ...prev, selectedRole: role }))
          }
          onBecomeFacilitator={handleBecomeFacilitator}
          onNext={() => {
            trackEnrollmentStepCompleted("cohort_role");
            setCurrentStep(3);
          }}
        />
      )}

      {currentStep === 3 &&
        (selectedCohortHasGroups && !forceAvailabilityMode ? (
          <GroupSelectionStep
            cohortId={formData.selectedCohortId!}
            isSubmitting={isSubmitting}
            timezone={formData.timezone}
            onTimezoneChange={(tz) =>
              setFormData((prev) => ({ ...prev, timezone: tz }))
            }
            selectedGroupId={formData.selectedGroupId}
            onGroupSelect={(groupId) =>
              setFormData((prev) => ({ ...prev, selectedGroupId: groupId }))
            }
            onBack={() => setCurrentStep(2)}
            onSubmit={handleSubmit}
            onSwitchToAvailability={() => {
              setFormData((prev) => ({
                ...prev,
                selectedCohortId: null,
                selectedRole: null,
                selectedGroupId: null,
              }));
              setForceAvailabilityMode(true);
              setCurrentStep(2);
            }}
            cohortStartDate={selectedCohort?.cohort_start_date}
            cohortEndDate={selectedCohortEndDate}
            cohortName={selectedCohort?.cohort_name}
          />
        ) : (
          <AvailabilityStep
            isSubmitting={isSubmitting}
            availability={formData.availability}
            onAvailabilityChange={(data) =>
              setFormData((prev) => ({ ...prev, availability: data }))
            }
            timezone={formData.timezone}
            onTimezoneChange={(tz) =>
              setFormData((prev) => ({ ...prev, timezone: tz }))
            }
            onBack={() => setCurrentStep(2)}
            onSubmit={handleSubmit}
            cohort={
              availableCohorts.find(
                (c) => c.cohort_id === formData.selectedCohortId,
              ) ?? null
            }
          />
        ))}
    </div>
  );
}
