import { useState, useEffect, useCallback } from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export interface User {
  user_id: number;
  discord_id: string;
  discord_username: string;
  nickname: string | null;
  email: string | null;
  timezone: string | null;
  availability_utc: string | null;
}

export interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: User | null;
  discordId: string | null;
  discordUsername: string | null;
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
  });

  const fetchUser = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/auth/me`, {
        credentials: "include", // Include cookies
      });

      if (response.ok) {
        const data = await response.json();
        setState({
          isAuthenticated: true,
          isLoading: false,
          user: data.user,
          discordId: data.discord_id,
          discordUsername: data.discord_username,
        });
      } else {
        setState({
          isAuthenticated: false,
          isLoading: false,
          user: null,
          discordId: null,
          discordUsername: null,
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
    window.location.href = `${API_URL}/auth/discord?next=${next}&origin=${origin}`;
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch(`${API_URL}/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
      setState({
        isAuthenticated: false,
        isLoading: false,
        user: null,
        discordId: null,
        discordUsername: null,
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
