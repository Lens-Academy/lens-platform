import { useState, useEffect } from "react";
import type { SignupFormData, Cohort } from "../../types/signup";
import { EMPTY_AVAILABILITY, getBrowserTimezone } from "../../types/signup";
import PersonalInfoStep from "./PersonalInfoStep";
import CohortRoleStep from "./CohortRoleStep";
import AvailabilityStep from "./AvailabilityStep";
import SuccessMessage from "./SuccessMessage";
import { useAuth } from "../../hooks/useAuth";
import { API_URL } from "../../config";
import {
  trackSignupStarted,
  trackSignupStepCompleted,
  trackSignupCompleted,
} from "../../analytics";

type Step = 1 | 2 | 3 | "complete";

export default function SignupWizard() {
  const { isAuthenticated, isLoading, user, discordUsername, login } =
    useAuth();

  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [formData, setFormData] = useState<SignupFormData>({
    displayName: "",
    email: "",
    discordConnected: false,
    discordUsername: undefined,
    termsAccepted: false,
    availability: { ...EMPTY_AVAILABILITY },
    timezone: getBrowserTimezone(),
    selectedCohortId: null,
    selectedRole: null,
  });
  // Submission state tracked for future UI improvements (e.g., disable button during submit)
  const [, setIsSubmitting] = useState(false);

  // Cohort data
  const [enrolledCohorts, setEnrolledCohorts] = useState<Cohort[]>([]);
  const [availableCohorts, setAvailableCohorts] = useState<Cohort[]>([]);
  const [isFacilitator, setIsFacilitator] = useState(false);

  // Track signup started on mount
  useEffect(() => {
    trackSignupStarted();
  }, []);

  // Sync auth state with form data
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

      // Fetch cohorts and facilitator status
      fetchCohortData();
      fetchFacilitatorStatus();
    }
  }, [isAuthenticated, discordUsername, user]);

  const fetchCohortData = async () => {
    try {
      const response = await fetch(`${API_URL}/api/cohorts/available`, {
        credentials: "include",
      });
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
      const response = await fetch(
        `${API_URL}/api/users/me/facilitator-status`,
        {
          credentials: "include",
        }
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
    const response = await fetch(`${API_URL}/api/users/me/become-facilitator`, {
      method: "POST",
      credentials: "include",
    });
    if (response.ok) {
      setIsFacilitator(true);
      setFormData((prev) => ({ ...prev, selectedRole: "facilitator" }));
    }
  };

  const handleDiscordConnect = () => {
    login();
  };

  const handleSubmit = async () => {
    if (!isAuthenticated) {
      console.error("User not authenticated");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_URL}/api/users/me`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          nickname: formData.displayName || null,
          email: formData.email || null,
          timezone: formData.timezone,
          availability_local: JSON.stringify(formData.availability),
          cohort_id: formData.selectedCohortId,
          role: formData.selectedRole,
          tos_accepted: formData.termsAccepted,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to update profile");
      }

      trackSignupCompleted();
      setCurrentStep("complete");
    } catch (error) {
      console.error("Failed to submit:", error);
      alert("Failed to save your profile. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (currentStep === "complete") {
    return <SuccessMessage />;
  }

  return (
    <div>
      {currentStep === 1 && (
        <PersonalInfoStep
          displayName={formData.displayName}
          email={formData.email}
          discordConnected={formData.discordConnected}
          discordUsername={formData.discordUsername}
          termsAccepted={formData.termsAccepted}
          onDisplayNameChange={(value) =>
            setFormData((prev) => ({ ...prev, displayName: value }))
          }
          onEmailChange={(value) =>
            setFormData((prev) => ({ ...prev, email: value }))
          }
          onTermsAcceptedChange={(value) =>
            setFormData((prev) => ({ ...prev, termsAccepted: value }))
          }
          onDiscordConnect={handleDiscordConnect}
          onNext={() => {
            trackSignupStepCompleted("personal_info");
            setCurrentStep(2);
          }}
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
          onCohortSelect={(id) =>
            setFormData((prev) => ({
              ...prev,
              selectedCohortId: id,
              selectedRole: isFacilitator ? null : "participant",
            }))
          }
          onRoleSelect={(role) =>
            setFormData((prev) => ({ ...prev, selectedRole: role }))
          }
          onBecomeFacilitator={handleBecomeFacilitator}
          onNext={() => {
            trackSignupStepCompleted("cohort_role");
            setCurrentStep(3);
          }}
          onBack={() => setCurrentStep(1)}
        />
      )}

      {currentStep === 3 && (
        <AvailabilityStep
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
          cohort={availableCohorts.find(c => c.cohort_id === formData.selectedCohortId) ?? null}
        />
      )}
    </div>
  );
}
