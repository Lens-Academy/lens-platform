import { useState, useEffect, useCallback } from "react";
import { API_URL } from "../config";
import { identifyUser, resetUser, hasConsent } from "../analytics";
import {
  identifySentryUser,
  resetSentryUser,
  isSentryInitialized,
} from "../errorTracking";
import { getAnonymousToken } from "./useAnonymousToken";

export interface User {
  user_id: number;
  discord_id: string;
  discord_username: string;
  nickname: string | null;
  email: string | null;
  timezone: string | null;
  availability_local: string | null;
  tos_accepted_at: string | null;
}

export interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: User | null;
  discordId: string | null;
  discordUsername: string | null;
  discordAvatarUrl: string | null;
  isInSignupsTable: boolean;
  isInActiveGroup: boolean;
  tosAccepted: boolean;
}

export interface UseAuthReturn extends AuthState {
  login: () => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

/**
 * Hook to manage authentication state.
 *
 * Checks if the user is authenticated by calling /auth/me.
 * The session is stored in an HttpOnly cookie, so we can't read it directly.
 */
export function useAuth(): UseAuthReturn {
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    isLoading: true,
    user: null,
    discordId: null,
    discordUsername: null,
    discordAvatarUrl: null,
    isInSignupsTable: false,
    isInActiveGroup: false,
    tosAccepted: false,
  });

  const fetchUser = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/auth/me`, {
        credentials: "include", // Include cookies
      });

      if (!response.ok) {
        // Server error - treat as not authenticated
        setState({
          isAuthenticated: false,
          isLoading: false,
          user: null,
          discordId: null,
          discordUsername: null,
          discordAvatarUrl: null,
          isInSignupsTable: false,
          isInActiveGroup: false,
          tosAccepted: false,
        });
        return;
      }

      const data = await response.json();

      if (data.authenticated) {
        setState({
          isAuthenticated: true,
          isLoading: false,
          user: data.user,
          discordId: data.discord_id,
          discordUsername: data.discord_username,
          discordAvatarUrl: data.discord_avatar_url,
          isInSignupsTable: data.is_in_signups_table ?? false,
          isInActiveGroup: data.is_in_active_group ?? false,
          tosAccepted: !!data.user?.tos_accepted_at,
        });

        // Identify user for analytics and error tracking
        const user = data.user;
        if (user && hasConsent()) {
          identifyUser(user.user_id, {
            discord_id: user.discord_id,
            discord_username: user.discord_username,
            email: user.email,
            nickname: user.nickname,
          });
        }
        if (user && isSentryInitialized()) {
          identifySentryUser(user.user_id, {
            discord_id: user.discord_id,
            discord_username: user.discord_username,
            email: user.email,
          });
        }
      } else {
        setState({
          isAuthenticated: false,
          isLoading: false,
          user: null,
          discordId: null,
          discordUsername: null,
          discordAvatarUrl: null,
          isInSignupsTable: false,
          isInActiveGroup: false,
          tosAccepted: false,
        });
      }
    } catch (error) {
      console.error("Failed to fetch user:", error);
      setState({
        isAuthenticated: false,
        isLoading: false,
        user: null,
        discordId: null,
        discordUsername: null,
        discordAvatarUrl: null,
        isInSignupsTable: false,
        isInActiveGroup: false,
        tosAccepted: false,
      });
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const login = useCallback(() => {
    // Redirect to Discord OAuth, with current path as the return URL
    const next = encodeURIComponent(window.location.pathname);
    const origin = encodeURIComponent(window.location.origin);
    const anonymousToken = getAnonymousToken();
    const tokenParam = anonymousToken
      ? `&anonymous_token=${encodeURIComponent(anonymousToken)}`
      : "";
    window.location.href = `${API_URL}/auth/discord?next=${next}&origin=${origin}${tokenParam}`;
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch(`${API_URL}/auth/logout`, {
        method: "POST",
        credentials: "include",
      });

      // Reset analytics and error tracking identity
      resetUser();
      resetSentryUser();

      setState({
        isAuthenticated: false,
        isLoading: false,
        user: null,
        discordId: null,
        discordUsername: null,
        discordAvatarUrl: null,
        isInSignupsTable: false,
        isInActiveGroup: false,
        tosAccepted: false,
      });
    } catch (error) {
      console.error("Failed to logout:", error);
    }
  }, []);

  const refreshUser = useCallback(async () => {
    await fetchUser();
  }, [fetchUser]);

  return {
    ...state,
    login,
    logout,
    refreshUser,
  };
}
