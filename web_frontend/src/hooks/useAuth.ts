import { useState, useEffect, useCallback } from "react";
import { API_URL } from "../config";
import { fetchWithRefresh } from "../api/fetchWithRefresh";
import {
  identifyUser,
  resetUser,
  hasConsent,
  syncConsentToServer,
  syncMarketingConsentToServer,
} from "../analytics";
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
  cookies_analytics_consent: string | null;
  cookies_analytics_consent_at: string | null;
  cookies_marketing_consent: string | null;
  cookies_marketing_consent_at: string | null;
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
  login: (options?: { refSlug?: string; nextPath?: string }) => void;
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
      const response = await fetchWithRefresh(`${API_URL}/auth/me`, {
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

        // Backfill consent from localStorage to DB (browser→DB only).
        // We never restore DB→browser: GDPR requires per-device consent,
        // so each browser must ask independently via the cookie banner.
        if (user) {
          const localChoice = localStorage.getItem("analytics-consent") as
            | "accepted"
            | "declined"
            | null;
          const dbChoice = user.cookies_analytics_consent;

          if (localChoice && localChoice !== dbChoice) {
            syncConsentToServer(localChoice);
          }

          // Same for marketing consent
          const marketingChoice = localStorage.getItem("marketing-consent") as
            | "accepted"
            | "declined"
            | null;
          const dbMarketingChoice = user.cookies_marketing_consent;

          if (marketingChoice && marketingChoice !== dbMarketingChoice) {
            syncMarketingConsentToServer(marketingChoice);
          }

          // Clear referral ref from sessionStorage — attribution is done
          sessionStorage.removeItem("ref");
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

  // Persist ?ref= param across page navigations within this session.
  // When a user lands on /?ref=slug and navigates to /enroll, the URL
  // param is lost — sessionStorage preserves it until they sign up.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const urlRef = params.get("ref");
    if (urlRef) {
      sessionStorage.setItem("ref", urlRef);
      const clickId = params.get("click_id");
      if (clickId) {
        sessionStorage.setItem("ref_click_id", clickId);
      }
      // Clean the URL — ref and click_id are now in sessionStorage
      params.delete("ref");
      params.delete("click_id");
      const clean = params.toString();
      const newUrl = window.location.pathname + (clean ? `?${clean}` : "");
      window.history.replaceState({}, "", newUrl);
    }
  }, []);

  const login = useCallback(
    (options?: { refSlug?: string; nextPath?: string }) => {
      // Redirect to Discord OAuth, with current path as the return URL
      const next = encodeURIComponent(
        options?.nextPath || window.location.pathname,
      );
      const origin = encodeURIComponent(window.location.origin);
      const anonymousToken = getAnonymousToken();
      const tokenParam = anonymousToken
        ? `&anonymous_token=${encodeURIComponent(anonymousToken)}`
        : "";
      // Auto-detect ref: explicit param > URL > sessionStorage
      const ref =
        options?.refSlug ||
        new URLSearchParams(window.location.search).get("ref") ||
        sessionStorage.getItem("ref") ||
        undefined;
      const refParam = ref ? `&ref=${encodeURIComponent(ref)}` : "";
      // Pass click_id from sessionStorage through OAuth state
      const clickId = sessionStorage.getItem("ref_click_id") || undefined;
      const clickIdParam = clickId
        ? `&click_id=${encodeURIComponent(clickId)}`
        : "";
      window.location.href = `${API_URL}/auth/discord?next=${next}&origin=${origin}${tokenParam}${refParam}${clickIdParam}`;
    },
    [],
  );

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
