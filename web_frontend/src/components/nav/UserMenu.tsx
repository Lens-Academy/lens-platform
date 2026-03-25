import { useCallback } from "react";
import { User } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { Popover } from "../Popover";
import { API_URL } from "../../config";

interface UserMenuProps {
  /** Override the default redirect path after sign in */
  signInRedirect?: string;
  /** When true, show only avatar/icon (hide username + chevron) */
  compact?: boolean;
  /** When true, render menu items directly without popover (for mobile menus) */
  inline?: boolean;
}

export function UserMenu({
  signInRedirect,
  compact,
  inline,
}: UserMenuProps = {}) {
  const {
    isAuthenticated,
    isLoading,
    user,
    discordUsername,
    discordAvatarUrl,
    login,
    logout,
  } = useAuth();

  // Custom login that uses signInRedirect if provided
  const handleLogin = useCallback(() => {
    if (signInRedirect) {
      const next = encodeURIComponent(signInRedirect);
      const origin = encodeURIComponent(window.location.origin);
      const anonymousToken = localStorage.getItem("anonymous_token");
      const tokenParam = anonymousToken
        ? `&anonymous_token=${encodeURIComponent(anonymousToken)}`
        : "";
      window.location.href = `${API_URL}/auth/discord?next=${next}&origin=${origin}${tokenParam}`;
    } else {
      login();
    }
  }, [signInRedirect, login]);

  if (isLoading) {
    return <div className="w-20 h-6" />; // Placeholder to prevent layout shift
  }

  const avatar = discordAvatarUrl ? (
    <img
      src={discordAvatarUrl}
      alt={`${discordUsername}'s avatar`}
      className="w-6 h-6 rounded-full"
    />
  ) : (
    <div className="w-6 h-6 rounded-full bg-[var(--brand-border)]" />
  );

  const menuItems = (close?: () => void) => (
    <>
      {isAuthenticated ? (
        <>
          <a
            href="/availability"
            className="text-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]"
            onClick={close}
          >
            Edit Availability
          </a>
          <a
            href="/meetings"
            className="text-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]"
            onClick={close}
          >
            Meetings
          </a>
          <button
            onClick={() => {
              logout();
              close?.();
            }}
            className="w-full text-left text-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]"
          >
            Sign out
          </button>
        </>
      ) : (
        <button
          onClick={() => {
            handleLogin();
            close?.();
          }}
          className="w-full text-left text-sm font-medium text-gray-700 hover:text-gray-900 whitespace-nowrap"
        >
          Sign in (via Discord)
        </button>
      )}
    </>
  );

  // Non-compact unauthenticated: plain button, no popover
  if (!isAuthenticated && !compact) {
    if (inline) {
      return (
        <button
          onClick={handleLogin}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[var(--brand-text)] font-medium text-sm transition-colors duration-200"
          aria-label="Sign in via Discord"
        >
          Sign in (via Discord)
        </button>
      );
    }
    return (
      <button
        onClick={handleLogin}
        className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[var(--brand-text)] font-medium text-sm transition-colors duration-200"
        aria-label="Sign in via Discord"
      >
        Sign in (via Discord)
      </button>
    );
  }

  // Inline mode (mobile menus): render items directly, no popover
  if (inline) {
    return (
      <div className="flex flex-col gap-3">
        {isAuthenticated && (
          <div className="flex items-center gap-2 text-sm text-[var(--brand-text-muted)]">
            {avatar}
            <span>{user?.nickname || discordUsername}</span>
          </div>
        )}
        {menuItems()}
      </div>
    );
  }

  // Popover mode (desktop)
  const landingPopoverProps = compact
    ? {
        className:
          "rounded-lg shadow-[0_4px_24px_rgba(0,0,0,0.12)] p-4 z-50 max-w-xs border-t-2",
        panelStyle: {
          backgroundColor: "var(--landing-bg)",
          borderColor: "var(--landing-border)",
          fontFamily: "var(--landing-font-body)",
        },
      }
    : {};

  return (
    <Popover
      placement="bottom-end"
      {...landingPopoverProps}
      content={(close) => (
        <div className="flex flex-col gap-2">{menuItems(close)}</div>
      )}
    >
      <button className="min-h-[44px] min-w-[44px] flex items-center justify-center gap-2 text-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors duration-200">
        {isAuthenticated ? avatar : <User className="w-5 h-5" />}
        {!compact && isAuthenticated && (
          <>
            <span>{user?.nickname || discordUsername}</span>
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
          </>
        )}
      </button>
    </Popover>
  );
}
