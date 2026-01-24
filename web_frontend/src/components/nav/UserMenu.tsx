import { useCallback } from "react";
import { useMedia } from "react-use";
import { User } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { Popover } from "../Popover";
import { API_URL } from "../../config";

interface UserMenuProps {
  /** Override the default redirect path after sign in */
  signInRedirect?: string;
}

export function UserMenu({ signInRedirect }: UserMenuProps = {}) {
  const {
    isAuthenticated,
    isLoading,
    discordUsername,
    discordAvatarUrl,
    login,
    logout,
  } = useAuth();
  const isMobile = useMedia("(max-width: 767px)", false);

  // Custom login that uses signInRedirect if provided
  const handleLogin = useCallback(() => {
    if (signInRedirect) {
      const next = encodeURIComponent(signInRedirect);
      const origin = encodeURIComponent(window.location.origin);
      window.location.href = `${API_URL}/auth/discord?next=${next}&origin=${origin}`;
    } else {
      login();
    }
  }, [signInRedirect, login]);

  if (isLoading) {
    return <div className="w-20 h-6" />; // Placeholder to prevent layout shift
  }

  if (!isAuthenticated) {
    return (
      <button
        onClick={handleLogin}
        className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-600 font-medium text-sm hover:text-slate-900 transition-colors duration-200"
        aria-label="Sign in"
      >
        {isMobile ? <User className="w-5 h-5" /> : "Sign in"}
      </button>
    );
  }

  return (
    <Popover
      placement="bottom-end"
      content={(close) => (
        <div className="flex flex-col gap-2">
          <a
            href="/availability"
            className="text-sm text-gray-700 hover:text-gray-900"
            onClick={close}
          >
            Edit Availability
          </a>
          <a
            href="/group"
            className="text-sm text-gray-700 hover:text-gray-900"
            onClick={close}
          >
            My Group
          </a>
          <button
            onClick={() => {
              logout();
              close();
            }}
            className="w-full text-left text-sm text-gray-700 hover:text-gray-900"
          >
            Sign out
          </button>
        </div>
      )}
    >
      <button className="flex items-center gap-2 text-sm text-slate-700 hover:text-slate-900 transition-colors duration-200">
        {discordAvatarUrl ? (
          <img
            src={discordAvatarUrl}
            alt={`${discordUsername}'s avatar`}
            className="w-6 h-6 rounded-full"
          />
        ) : (
          <div className="w-6 h-6 rounded-full bg-slate-300" />
        )}
        <span>{discordUsername}</span>
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>
    </Popover>
  );
}
