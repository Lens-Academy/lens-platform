// web_frontend/src/components/unified-lesson/AuthPromptModal.tsx
import { DiscordIcon } from "../icons/DiscordIcon";

interface Props {
  isOpen: boolean;
  onLogin: () => void;
  onDismiss: () => void;
}

export default function AuthPromptModal({ isOpen, onLogin, onDismiss }: Props) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-8 max-w-md w-full mx-4 shadow-xl">
        <h2 className="text-2xl font-semibold text-gray-900 mb-4">
          Save Your Progress
        </h2>
        <p className="text-gray-600 mb-6">
          Sign in with Discord to save your progress and continue later.
        </p>
        <div className="flex flex-col gap-3">
          <button
            onClick={onLogin}
            className="w-full bg-indigo-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
          >
            <DiscordIcon className="w-5 h-5" />
            Sign in with Discord
          </button>
          <button
            onClick={onDismiss}
            className="w-full text-gray-600 py-2 px-4 hover:text-gray-800 transition-colors"
          >
            Continue without saving
          </button>
        </div>
      </div>
    </div>
  );
}
