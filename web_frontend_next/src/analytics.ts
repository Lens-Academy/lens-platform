// web_frontend/src/analytics.ts
import posthog from "posthog-js";

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY;
const POSTHOG_HOST =
  import.meta.env.VITE_POSTHOG_HOST || "https://eu.posthog.com";
const CONSENT_KEY = "analytics-consent";

// PostHog only runs in production to keep analytics clean
const IS_PRODUCTION = import.meta.env.PROD;

let initialized = false;

/**
 * Check if analytics should be enabled (production + has key)
 */
export function isAnalyticsEnabled(): boolean {
  return IS_PRODUCTION && !!POSTHOG_KEY;
}

/**
 * Initialize PostHog (call after user consents)
 * Only initializes in production environment.
 */
export function initPostHog(): void {
  if (!isAnalyticsEnabled()) {
    if (!IS_PRODUCTION) {
      console.log("[analytics] Skipping PostHog in development mode");
    } else if (!POSTHOG_KEY) {
      console.warn(
        "[analytics] VITE_POSTHOG_KEY not set, skipping PostHog init"
      );
    }
    return;
  }

  if (initialized) return;

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    capture_pageview: false, // We'll capture manually for SPA
    capture_pageleave: true,
    persistence: "localStorage",
    loaded: (ph) => {
      const consent = localStorage.getItem(CONSENT_KEY);
      if (consent === "accepted") {
        ph.opt_in_capturing();
      } else {
        ph.opt_out_capturing();
      }
    },
  });

  initialized = true;
}

/**
 * Identify a user (call when user logs in)
 */
export function identifyUser(
  userId: number,
  properties?: {
    discord_id?: string;
    discord_username?: string;
    email?: string | null;
    nickname?: string | null;
  }
): void {
  if (!isAnalyticsEnabled() || !initialized || !hasConsent()) return;

  posthog.identify(String(userId), {
    discord_id: properties?.discord_id,
    discord_username: properties?.discord_username,
    email: properties?.email,
    name: properties?.nickname || properties?.discord_username,
  });
}

/**
 * Reset user identity (call when user logs out)
 */
export function resetUser(): void {
  if (!isAnalyticsEnabled() || !initialized) return;
  posthog.reset();
}

/**
 * Opt in to tracking (user accepted consent)
 */
export function optIn(): void {
  localStorage.setItem(CONSENT_KEY, "accepted");
  if (!isAnalyticsEnabled()) return;

  if (initialized) {
    posthog.opt_in_capturing();
  } else {
    initPostHog();
    posthog.opt_in_capturing();
  }
}

/**
 * Opt out of tracking (user declined consent)
 */
export function optOut(): void {
  localStorage.setItem(CONSENT_KEY, "declined");
  if (!isAnalyticsEnabled() || !initialized) return;
  posthog.opt_out_capturing();
}

/**
 * Check if user has consented
 */
export function hasConsent(): boolean {
  return localStorage.getItem(CONSENT_KEY) === "accepted";
}

/**
 * Check if user has made a consent choice (either way)
 */
export function hasConsentChoice(): boolean {
  const consent = localStorage.getItem(CONSENT_KEY);
  return consent === "accepted" || consent === "declined";
}

/**
 * Capture a page view (call on route change)
 */
export function capturePageView(path: string): void {
  if (!isAnalyticsEnabled() || !initialized || !hasConsent()) return;
  posthog.capture("$pageview", { $current_url: window.origin + path });
}

// ============ Custom Events ============

function shouldTrack(): boolean {
  return isAnalyticsEnabled() && initialized && hasConsent();
}

// Lesson events
export function trackLessonStarted(
  lessonId: string,
  lessonTitle: string
): void {
  if (!shouldTrack()) return;
  posthog.capture("lesson_started", {
    lesson_id: lessonId,
    lesson_title: lessonTitle,
  });
}

export function trackVideoStarted(lessonId: string): void {
  if (!shouldTrack()) return;
  posthog.capture("video_started", { lesson_id: lessonId });
}

export function trackVideoCompleted(
  lessonId: string,
  watchDuration: number
): void {
  if (!shouldTrack()) return;
  posthog.capture("video_completed", {
    lesson_id: lessonId,
    watch_duration: watchDuration,
  });
}

export function trackArticleScrolled(
  lessonId: string,
  percent: 25 | 50 | 75 | 100
): void {
  if (!shouldTrack()) return;
  posthog.capture("article_scrolled", { lesson_id: lessonId, percent });
}

export function trackArticleCompleted(lessonId: string): void {
  if (!shouldTrack()) return;
  posthog.capture("article_completed", { lesson_id: lessonId });
}

export function trackChatOpened(lessonId: string): void {
  if (!shouldTrack()) return;
  posthog.capture("chat_opened", { lesson_id: lessonId });
}

export function trackChatMessageSent(
  lessonId: string,
  messageLength: number
): void {
  if (!shouldTrack()) return;
  posthog.capture("chat_message_sent", {
    lesson_id: lessonId,
    message_length: messageLength,
  });
}

export function trackChatSessionEnded(
  lessonId: string,
  messageCount: number,
  durationSeconds: number
): void {
  if (!shouldTrack()) return;
  posthog.capture("chat_session_ended", {
    lesson_id: lessonId,
    message_count: messageCount,
    duration: durationSeconds,
  });
}

export function trackLessonCompleted(lessonId: string): void {
  if (!shouldTrack()) return;
  posthog.capture("lesson_completed", { lesson_id: lessonId });
}

// Signup events
export function trackSignupStarted(): void {
  if (!shouldTrack()) return;
  posthog.capture("signup_started");
}

export function trackSignupStepCompleted(stepName: string): void {
  if (!shouldTrack()) return;
  posthog.capture("signup_step_completed", { step_name: stepName });
}

export function trackSignupCompleted(): void {
  if (!shouldTrack()) return;
  posthog.capture("signup_completed");
}

export { posthog };
