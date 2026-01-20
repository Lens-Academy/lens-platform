import { cookies } from "next/headers";

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "";

/**
 * Fetch from API with session cookie forwarded (for SSR).
 * Use this in Server Components only.
 */
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session");

  const headers: Record<string, string> = {};

  // Copy existing headers if they're a plain object
  if (options.headers && typeof options.headers === "object" && !Array.isArray(options.headers)) {
    Object.assign(headers, options.headers);
  }

  if (sessionCookie) {
    headers["Cookie"] = `session=${sessionCookie.value}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    cache: "no-store", // Don't cache authenticated requests
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get current user from API (for SSR).
 * Returns null if not authenticated.
 */
export async function getCurrentUser() {
  try {
    const data = await apiFetch<{ authenticated: boolean; [key: string]: unknown }>("/auth/me");
    return data.authenticated ? data : null;
  } catch {
    return null;
  }
}
