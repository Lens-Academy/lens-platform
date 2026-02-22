// web_frontend/src/hooks/__tests__/useAuth.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import {
  createFetchMock,
  jsonResponse,
  errorResponse,
} from "@/test/fetchMock";
import { useAuth } from "../useAuth";

const fm = createFetchMock();

const mockUser = {
  user_id: 1,
  discord_id: "123456",
  discord_username: "testuser",
  nickname: "Test User",
  email: "test@example.com",
  timezone: "America/New_York",
  availability_local: null,
  tos_accepted_at: "2026-01-01T00:00:00Z",
};

const authenticatedResponse = {
  authenticated: true,
  discord_id: "123456",
  discord_username: "testuser",
  discord_avatar_url: "https://cdn.discordapp.com/avatar.png",
  is_in_signups_table: true,
  is_in_active_group: false,
  user: mockUser,
};

let originalLocation: Location;

beforeEach(() => {
  fm.install();
  originalLocation = window.location;
});

afterEach(() => {
  fm.restore();
  vi.restoreAllMocks();
  // Restore location if it was replaced
  if (window.location !== originalLocation) {
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  }
});

describe("useAuth", () => {
  it("starts with isLoading: true", async () => {
    fm.mock.mockResolvedValue(jsonResponse(authenticatedResponse));

    const { result } = renderHook(() => useAuth());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isAuthenticated).toBe(false);

    // Let the async fetchUser() settle to avoid act() warning
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it("resolves to authenticated state with all fields mapped", async () => {
    fm.mock.mockResolvedValue(jsonResponse(authenticatedResponse));

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.discordId).toBe("123456");
    expect(result.current.discordUsername).toBe("testuser");
    expect(result.current.discordAvatarUrl).toBe(
      "https://cdn.discordapp.com/avatar.png",
    );
    expect(result.current.isInSignupsTable).toBe(true);
    expect(result.current.isInActiveGroup).toBe(false);
    expect(result.current.user).toEqual(mockUser);
  });

  it("derives tosAccepted from tos_accepted_at", async () => {
    fm.mock.mockResolvedValue(jsonResponse(authenticatedResponse));

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.tosAccepted).toBe(true);
  });

  it("tosAccepted is false when tos_accepted_at is null", async () => {
    const noTos = {
      ...authenticatedResponse,
      user: { ...mockUser, tos_accepted_at: null },
    };
    fm.mock.mockResolvedValue(jsonResponse(noTos));

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.tosAccepted).toBe(false);
  });

  it("resolves to unauthenticated on non-ok response", async () => {
    fm.mock.mockResolvedValue(errorResponse(500));

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it("resolves to unauthenticated on network error", async () => {
    fm.mock.mockRejectedValue(new Error("Network error"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it("resolves to unauthenticated when authenticated: false", async () => {
    fm.mock.mockResolvedValue(jsonResponse({ authenticated: false }));

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isAuthenticated).toBe(false);
  });

  it("login() redirects to Discord OAuth URL with params", async () => {
    fm.mock.mockResolvedValue(jsonResponse({ authenticated: false }));

    // Replace location to capture href assignment
    const mockLocation = {
      pathname: "/course/test",
      origin: "http://localhost",
      href: "",
    };
    Object.defineProperty(window, "location", {
      value: mockLocation,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.login();
    });

    expect(mockLocation.href).toContain("/auth/discord");
    expect(mockLocation.href).toContain("next=%2Fcourse%2Ftest");
    expect(mockLocation.href).toContain("origin=");
    expect(mockLocation.href).toContain("anonymous_token=");
  });

  it("logout() POSTs to /auth/logout and resets state", async () => {
    fm.mock.mockResolvedValue(jsonResponse(authenticatedResponse));

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(fm.callsTo("/auth/logout")).toHaveLength(1);

    const logoutCall = fm.callsTo("/auth/logout")[0];
    expect(logoutCall[1]).toMatchObject({
      method: "POST",
      credentials: "include",
    });
  });

  it("refreshUser() re-fetches from /auth/me", async () => {
    fm.mock.mockResolvedValue(jsonResponse(authenticatedResponse));

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    const updated = {
      ...authenticatedResponse,
      discord_username: "updated-user",
    };
    fm.mock.mockResolvedValue(jsonResponse(updated));

    await act(async () => {
      await result.current.refreshUser();
    });

    expect(result.current.discordUsername).toBe("updated-user");
  });
});
