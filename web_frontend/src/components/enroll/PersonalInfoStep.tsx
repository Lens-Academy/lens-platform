import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { DiscordIconLarge } from "../icons/DiscordIcon";

interface PersonalInfoStepProps {
  discordConnected: boolean;
  discordUsername?: string;
  onDiscordConnect: () => void;
}

export default function PersonalInfoStep({
  discordConnected,
  discordUsername,
  onDiscordConnect,
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
    </div>
  );
}
