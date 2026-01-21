import { useState } from "react";
import { Info, ChevronDown } from "lucide-react";
import { DiscordIconLarge } from "../icons/DiscordIcon";

interface PersonalInfoStepProps {
  displayName: string;
  email: string;
  discordConnected: boolean;
  discordUsername?: string;
  termsAccepted: boolean;
  onDisplayNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onTermsAcceptedChange: (value: boolean) => void;
  onDiscordConnect: () => void;
  onNext: () => void;
}

export default function PersonalInfoStep({
  displayName,
  email,
  discordConnected,
  discordUsername,
  termsAccepted,
  onDisplayNameChange,
  onEmailChange,
  onTermsAcceptedChange,
  onDiscordConnect,
  onNext,
}: PersonalInfoStepProps) {
  const [discordHelpExpanded, setDiscordHelpExpanded] = useState(false);

  return (
    <div className="w-full max-w-sm mx-auto">
      <h2 className="text-2xl font-bold text-gray-900 mb-2">
        Join the AI Safety Course
      </h2>
      <p className="text-gray-600 mb-8">
        Connect your Discord account to get started.
      </p>

      {/* New to Discord? help - only show before connected */}
      {!discordConnected && (
        <div className="mb-3">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setDiscordHelpExpanded(!discordHelpExpanded)}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              New to Discord?
              <ChevronDown
                className={`w-4 h-4 transition-transform ${discordHelpExpanded ? "rotate-180" : ""}`}
              />
            </button>
          </div>
          {/* Always render to reserve space, use grid for smooth height animation */}
          <div
            className={`grid transition-[grid-template-rows] duration-200 ease-out ${
              discordHelpExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
            }`}
          >
            <div className="overflow-hidden">
              <div className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600 space-y-2">
                <p>
                  Discord is a platform where you can send messages and have
                  calls. We use it as the main communication platform for our
                  course. You can ask questions there and you will meet with
                  your group there.
                </p>
                <p>
                  You don't have to install Discord—you can just use it from
                  within the browser. We will also send you reminders via email
                  so you won't miss anything important if you don't check out
                  Discord often.
                </p>
                <p>
                  If you don't have an account yet, you can still click "Connect
                  with Discord" and make an account in the next step.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Discord Connect - Primary Action */}
      <button
        type="button"
        onClick={onDiscordConnect}
        disabled={discordConnected}
        className={`flex items-center justify-center gap-3 w-full px-6 py-4 rounded-lg font-medium text-lg transition-colors disabled:cursor-default ${
          discordConnected
            ? "bg-green-100 text-green-800"
            : "bg-[#5865F2] hover:bg-[#4752C4] text-white"
        }`}
      >
        <DiscordIconLarge className="w-6 h-6" />
        {discordConnected ? (
          <span>Connected as {discordUsername}</span>
        ) : (
          <span>Connect with Discord</span>
        )}
      </button>

      {/* Profile fields - shown after Discord connect */}
      {discordConnected && (
        <div className="mt-8 space-y-4">
          <div>
            <label
              htmlFor="email"
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
              id="email"
              value={email}
              onChange={(e) => onEmailChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
              placeholder="Enter your email"
            />
          </div>

          <div>
            <label
              htmlFor="displayName"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              What should we call you?
            </label>
            <input
              type="text"
              id="displayName"
              value={displayName}
              onChange={(e) => onDisplayNameChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
            />
            <p className="mt-1 text-sm text-gray-500">
              This will be set as your nickname in the Lens Academy Discord
              server, visible to all members.
            </p>
          </div>

          {/* Terms acceptance */}
          <div className="pt-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(e) => onTermsAcceptedChange(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500 cursor-pointer"
              />
              <span className="text-sm text-gray-600">
                I agree to the{" "}
                <a
                  href="/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-700 underline"
                >
                  Terms of Service
                </a>{" "}
                and{" "}
                <a
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-700 underline"
                >
                  Privacy Policy
                </a>
              </span>
            </label>
          </div>
        </div>
      )}

      {/* Continue button */}
      <div className="mt-8">
        <button
          type="button"
          onClick={onNext}
          disabled={!discordConnected || !termsAccepted}
          className={`w-full px-4 py-3 font-medium rounded-lg transition-colors disabled:cursor-default ${
            discordConnected && termsAccepted
              ? "bg-blue-500 hover:bg-blue-600 text-white"
              : "bg-gray-200 text-gray-400"
          }`}
        >
          Continue to Cohort Selection
        </button>
      </div>
    </div>
  );
}
