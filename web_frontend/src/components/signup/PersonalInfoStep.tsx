import { Info } from "lucide-react";

interface PersonalInfoStepProps {
  displayName: string;
  email: string;
  discordConnected: boolean;
  discordUsername?: string;
  onDisplayNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onDiscordConnect: () => void;
  onNext: () => void;
}

export default function PersonalInfoStep({
  displayName,
  email,
  discordConnected,
  discordUsername,
  onDisplayNameChange,
  onEmailChange,
  onDiscordConnect,
  onNext,
}: PersonalInfoStepProps) {
  return (
    <div className="max-w-md mx-auto">
      <h2 className="text-2xl font-bold text-gray-900 mb-2">
        Join the Course
      </h2>
      <p className="text-gray-600 mb-8">
        Connect your Discord account to get started.
      </p>

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
        <svg className="w-6 h-6" viewBox="0 0 71 55" fill="currentColor">
          <path d="M60.1045 4.8978C55.5792 2.8214 50.7265 1.2916 45.6527 0.41542C45.5603 0.39851 45.468 0.440769 45.4204 0.525289C44.7963 1.6353 44.105 3.0834 43.6209 4.2216C38.1637 3.4046 32.7345 3.4046 27.3892 4.2216C26.905 3.0581 26.1886 1.6353 25.5617 0.525289C25.5141 0.443589 25.4218 0.40133 25.3294 0.41542C20.2584 1.2888 15.4057 2.8186 10.8776 4.8978C10.8384 4.9147 10.8048 4.9429 10.7825 4.9795C1.57795 18.7309 -0.943561 32.1443 0.293408 45.3914C0.299005 45.4562 0.335386 45.5182 0.385761 45.5576C6.45866 50.0174 12.3413 52.7249 18.1147 54.5195C18.2071 54.5477 18.305 54.5139 18.3638 54.4378C19.7295 52.5728 20.9469 50.6063 21.9907 48.5383C22.0523 48.4172 21.9935 48.2735 21.8676 48.2256C19.9366 47.4931 18.0979 46.6 16.3292 45.5858C16.1893 45.5041 16.1781 45.304 16.3068 45.2082C16.679 44.9293 17.0513 44.6391 17.4067 44.3461C17.471 44.2926 17.5606 44.2813 17.6362 44.3151C29.2558 49.6202 41.8354 49.6202 53.3179 44.3151C53.3935 44.2785 53.4831 44.2898 53.5502 44.3433C53.9057 44.6363 54.2779 44.9293 54.6529 45.2082C54.7816 45.304 54.7732 45.5041 54.6333 45.5858C52.8646 46.6197 51.0259 47.4931 49.0921 48.2228C48.9662 48.2707 48.9102 48.4172 48.9718 48.5383C50.0386 50.6034 51.256 52.57 52.5765 54.4378C52.6353 54.5139 52.7332 54.5477 52.8256 54.5195C58.6317 52.7249 64.5143 50.0174 70.5872 45.5576C70.6404 45.5182 70.674 45.459 70.6796 45.3942C72.1738 29.9781 68.2465 16.7654 60.1865 4.9823C60.1669 4.9429 60.1328 4.9147 60.1045 4.8978ZM23.7259 37.3253C20.2276 37.3253 17.3451 34.1136 17.3451 30.1693C17.3451 26.225 20.1717 23.0133 23.7259 23.0133C27.308 23.0133 30.1626 26.2532 30.1066 30.1693C30.1066 34.1136 27.28 37.3253 23.7259 37.3253ZM47.3178 37.3253C43.8196 37.3253 40.9371 34.1136 40.9371 30.1693C40.9371 26.225 43.7636 23.0133 47.3178 23.0133C50.8999 23.0133 53.7545 26.2532 53.6986 30.1693C53.6986 34.1136 50.8999 37.3253 47.3178 37.3253Z" />
        </svg>
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
                  You can use any email address. It doesn't need to match the email you use for your Discord account.
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
              This will be set as your nickname in the Coursey McCourseface Discord server, visible to all members.
            </p>
          </div>
        </div>
      )}

      {/* Continue button */}
      <div className="mt-8">
        <button
          type="button"
          onClick={onNext}
          disabled={!discordConnected}
          className={`w-full px-4 py-3 font-medium rounded-lg transition-colors disabled:cursor-default ${
            discordConnected
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
