// web_frontend/src/components/unified-lesson/AuthStatusBanner.tsx
import { useAuth } from "../../hooks/useAuth";

interface Props {
  onLoginClick: () => void;
}

export default function AuthStatusBanner({ onLoginClick }: Props) {
  const { isAuthenticated, isLoading, discordUsername } = useAuth();

  if (isLoading) return null;

  if (isAuthenticated) {
    return (
      <div className="bg-green-50 border-b border-green-200 px-4 py-2 text-sm text-green-700 flex items-center gap-2">
        <span className="w-2 h-2 bg-green-500 rounded-full" />
        Signed in as {discordUsername}
      </div>
    );
  }

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-700 flex items-center justify-between">
      <span>Your progress is not being saved</span>
      <button
        onClick={onLoginClick}
        className="text-amber-800 font-medium hover:underline"
      >
        Sign in with Discord to save progress
      </button>
    </div>
  );
}
