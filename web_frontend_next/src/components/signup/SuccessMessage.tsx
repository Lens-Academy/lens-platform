import { DISCORD_INVITE_URL } from "../../config";
import { DiscordIconLarge } from "../icons/DiscordIcon";

export default function SuccessMessage() {
  return (
    <div className="max-w-md mx-auto text-center">
      <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
        <svg
          className="w-8 h-8 text-green-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 13l4 4L19 7"
          />
        </svg>
      </div>

      <h2 className="text-2xl font-bold text-gray-900 mb-2">
        You're Signed Up!
      </h2>
      <p className="text-gray-600 mb-8">
        Your registration has been submitted successfully. Now join our Discord
        server to connect with your cohort and get started.
      </p>

      <a
        href={DISCORD_INVITE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-center gap-3 px-6 py-4 bg-[#5865F2] hover:bg-[#4752C4] text-white font-medium text-lg rounded-lg transition-colors"
      >
        <DiscordIconLarge className="w-6 h-6" />
        Join us on Discord
      </a>
    </div>
  );
}
