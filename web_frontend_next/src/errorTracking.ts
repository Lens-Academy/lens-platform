// web_frontend/src/errorTracking.ts
import * as Sentry from "@sentry/react";

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;
const APP_VERSION = import.meta.env.VITE_APP_VERSION || "unknown";

let initialized = false;

/**
 * Initialize Sentry (call after user consents)
 * Sentry runs in all environments (dev + prod) with environment tagging for filtering.
 */
export function initSentry(): void {
  if (initialized || !SENTRY_DSN) {
    if (!SENTRY_DSN) {
      console.warn(
        "[errorTracking] VITE_SENTRY_DSN not set, skipping Sentry init"
      );
    }
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
    release: `ai-safety-course@${APP_VERSION}`,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: false,
        blockAllMedia: true,
      }),
    ],
    // Performance sampling
    tracesSampleRate: 0.1, // 10% of transactions
    // Session replay on errors
    replaysSessionSampleRate: 0, // Don't record all sessions
    replaysOnErrorSampleRate: 1.0, // 100% when error occurs
  });

  initialized = true;
}

/**
 * Check if Sentry is initialized
 */
export function isSentryInitialized(): boolean {
  return initialized;
}

/**
 * Identify a user in Sentry (call when user logs in)
 */
export function identifySentryUser(
  userId: number,
  properties?: {
    discord_id?: string;
    discord_username?: string;
    email?: string | null;
  }
): void {
  if (!initialized) return;

  Sentry.setUser({
    id: String(userId),
    username: properties?.discord_username,
    email: properties?.email || undefined,
  });
}

/**
 * Reset user identity in Sentry (call when user logs out)
 */
export function resetSentryUser(): void {
  if (!initialized) return;
  Sentry.setUser(null);
}

export { Sentry };
