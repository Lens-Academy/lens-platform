import { useState, useEffect } from "react";
import type { SignupFormData } from "../../types/signup";
import { EMPTY_AVAILABILITY, getBrowserTimezone } from "../../types/signup";
import PersonalInfoStep from "./PersonalInfoStep";
import AvailabilityStep from "./AvailabilityStep";
import SuccessMessage from "./SuccessMessage";
import { useAuth } from "../../hooks/useAuth";

type Step = 1 | 2 | "complete";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function SignupWizard() {
  const { isAuthenticated, isLoading, user, discordUsername, login } =
    useAuth();

  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [formData, setFormData] = useState<SignupFormData>({
    displayName: "",
    email: "",
    discordConnected: false,
    discordUsername: undefined,
    availability: { ...EMPTY_AVAILABILITY },
    timezone: getBrowserTimezone(),
  });
  const [_isSubmitting, setIsSubmitting] = useState(false);

  // Sync auth state with form data
  useEffect(() => {
    if (isAuthenticated && discordUsername) {
      setFormData((prev) => ({
        ...prev,
        discordConnected: true,
        discordUsername: discordUsername,
        // Pre-fill: database nickname > Discord username > existing value
        displayName: user?.nickname || discordUsername || prev.displayName,
        email: user?.email || prev.email,
      }));
    }
  }, [isAuthenticated, discordUsername, user]);

  const handleDiscordConnect = () => {
    // Redirect to Discord OAuth
    login();
  };

  const handleSubmit = async () => {
    if (!isAuthenticated) {
      console.error("User not authenticated");
      return;
    }

    setIsSubmitting(true);

    try {
      // Update user profile in the database
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
          availability_utc: JSON.stringify(formData.availability),
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to update profile");
      }

      setCurrentStep("complete");
    } catch (error) {
      console.error("Failed to submit:", error);
      alert("Failed to save your profile. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Show loading while checking auth
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
          onDisplayNameChange={(value) =>
            setFormData((prev) => ({ ...prev, displayName: value }))
          }
          onEmailChange={(value) =>
            setFormData((prev) => ({ ...prev, email: value }))
          }
          onDiscordConnect={handleDiscordConnect}
          onNext={() => setCurrentStep(2)}
        />
      )}

      {currentStep === 2 && (
        <AvailabilityStep
          availability={formData.availability}
          onAvailabilityChange={(data) =>
            setFormData((prev) => ({ ...prev, availability: data }))
          }
          timezone={formData.timezone}
          onTimezoneChange={(tz) =>
            setFormData((prev) => ({ ...prev, timezone: tz }))
          }
          onBack={() => setCurrentStep(1)}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  );
}
