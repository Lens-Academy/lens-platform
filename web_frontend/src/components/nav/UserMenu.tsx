"use client";

import { useAuth } from "../../hooks/useAuth";
import { Popover } from "../Popover";

interface UserMenuProps {
  /** Where to redirect after sign in (default: /course) */
  signInRedirect?: string;
}

export function UserMenu({ signInRedirect = "/course" }: UserMenuProps) {
  const {
    isAuthenticated,
    isLoading,
    discordUsername,
    discordAvatarUrl,
    logout,
  } = useAuth();

  if (isLoading) {
    return <div className="w-20 h-6" />; // Placeholder to prevent layout shift
  }

  if (!isAuthenticated) {
    return (
      <a
        href={`/auth/discord?next=${encodeURIComponent(signInRedirect)}`}
        className="text-slate-600 font-medium text-sm hover:text-slate-900 transition-colors duration-200"
      >
        Sign in
      </a>
    );
  }

  return (
    <Popover
      placement="bottom-end"
      content={(close) => (
        <button
          onClick={() => {
            logout();
            close();
          }}
          className="w-full text-left text-sm text-gray-700 hover:text-gray-900"
        >
          Sign out
        </button>
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
