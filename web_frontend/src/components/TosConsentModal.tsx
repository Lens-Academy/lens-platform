import { useState, useEffect } from "react";
import { Info } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { API_URL } from "../config";
import { fetchWithRefresh } from "../api/fetchWithRefresh";
import { DiscordIconLarge } from "./icons/DiscordIcon";

export default function TosConsentModal() {
  const {
    isAuthenticated,
    tosAccepted,
    isLoading,
    logout,
    refreshUser,
    discordUsername,
    user,
  } = useAuth();
  const [agreed, setAgreed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");

  // Pre-populate fields from existing user data
  useEffect(() => {
    if (user) {
      setEmail(user.email || "");
      setDisplayName(user.nickname || user.discord_username || "");
    }
  }, [user]);

  // Don't show if not authenticated, already accepted ToS, or still loading
  if (isLoading || !isAuthenticated || tosAccepted) {
    return null;
  }

  const canSubmit =
    agreed && email.trim() && displayName.trim() && !isSubmitting;

  const handleAccept = async () => {
    if (!canSubmit) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetchWithRefresh(`${API_URL}/api/users/me`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tos_accepted: true,
          email: email.trim(),
          nickname: displayName.trim(),
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save consent");
      }

      // Refresh user data to update tosAccepted state
      await refreshUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    await logout();
    // Reload to ensure all components reflect signed-out state
    window.location.reload();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-6">
          Complete Your Account
        </h2>

        {/* Discord account indicator */}
        <div className="flex items-center justify-center gap-3 w-full px-6 py-4 rounded-lg bg-green-100 text-green-800 font-medium text-lg mb-6">
          <DiscordIconLarge className="w-6 h-6" />
          <span>Connected as {discordUsername}</span>
        </div>

        {/* Profile fields */}
        <div className="space-y-4 mb-6">
          <div>
            <label
              htmlFor="tos-email"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Email address
              <span className="relative inline-flex items-center align-middle ml-1 group">
                <Info className="w-[18px] h-[18px] text-gray-500 cursor-help" />
                <span className="absolute left-0 bottom-full mb-2 px-3 py-2 text-xs text-white bg-gray-800 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity w-56 pointer-events-none z-10">
                  You can use any email address. It doesn't need to match the
                  email you use for your Discord account.
                </span>
              </span>
            </label>
            <input
              type="email"
              id="tos-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="Enter your email"
            />
          </div>

          <div>
            <label
              htmlFor="tos-displayName"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              What should we call you?
            </label>
            <input
              type="text"
              id="tos-displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
            <p className="mt-1 text-sm text-gray-500">
              This will be set as your nickname in the Lens Academy Discord
              server, visible to all members.
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        <div className="mb-6">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">
              I agree to the{" "}
              <a
                href="/terms"
                target="_blank"
                className="text-blue-600 hover:underline"
              >
                Terms of Service
              </a>{" "}
              and{" "}
              <a
                href="/privacy"
                target="_blank"
                className="text-blue-600 hover:underline"
              >
                Privacy Policy
              </a>
            </span>
          </label>
        </div>

        <div className="flex flex-col gap-3">
          <button
            onClick={handleAccept}
            disabled={!canSubmit}
            className={`w-full px-4 py-3 font-medium rounded-lg ${
              canSubmit
                ? "bg-blue-500 hover:bg-blue-600 text-white"
                : "bg-gray-200 text-gray-400 cursor-default"
            }`}
          >
            {isSubmitting ? "Saving..." : "Accept and Continue"}
          </button>

          <button
            onClick={handleSignOut}
            className="w-full px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
          >
            Sign out and continue anonymously
          </button>
        </div>
      </div>
    </div>
  );
}
