# Analytics Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add PostHog (analytics + session replay) and Sentry (error tracking) with GDPR-compliant cookie consent.

**Architecture:** Consent-gated loading - neither tool initializes until user accepts. Geolocation detection shows banner only to GDPR regions. PostHog EU cloud for data residency.

**Tech Stack:** posthog-js, @sentry/react, sentry-sdk[fastapi]

---

## Task 1: Install Frontend Dependencies

**Files:**
- Modify: `web_frontend/package.json`

**Step 1: Install PostHog and Sentry**

```bash
cd /home/penguin/code-in-WSL/ai-safety-course-platform-ws2/web_frontend && npm install posthog-js @sentry/react
```

**Step 2: Verify installation**

```bash
cd /home/penguin/code-in-WSL/ai-safety-course-platform-ws2/web_frontend && npm ls posthog-js @sentry/react
```

Expected: Both packages listed with versions.

**Step 3: Commit**

```bash
jj describe -m "chore: add posthog-js and @sentry/react dependencies"
```

---

## Task 2: Create Geolocation Utility

**Files:**
- Create: `web_frontend/src/geolocation.ts`

**Step 1: Create geolocation module**

```typescript
// web_frontend/src/geolocation.ts

// GDPR regions: EU (27) + EEA (3) + UK + Switzerland + Brazil (LGPD)
const GDPR_COUNTRIES = [
  // EU Member States
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
  'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  // EEA (not in EU)
  'IS', 'LI', 'NO',
  // UK GDPR
  'GB', 'UK',
  // Switzerland
  'CH',
  // Brazil LGPD
  'BR',
];

interface GeolocationResponse {
  country: string;
}

/**
 * Detect user's country using ipapi.co (free tier: 30K requests/month)
 */
export async function detectUserCountry(): Promise<string | null> {
  try {
    const response = await fetch('https://ipapi.co/json/', {
      signal: AbortSignal.timeout(5000), // 5s timeout
    });
    if (!response.ok) {
      console.warn('[geolocation] API error:', response.status);
      return null;
    }
    const data: GeolocationResponse = await response.json();
    return data.country || null;
  } catch (error) {
    console.warn('[geolocation] Failed to detect country:', error);
    return null;
  }
}

/**
 * Check if a country requires GDPR cookie consent
 */
export function requiresCookieConsent(countryCode: string | null): boolean {
  // If detection failed, show banner to be safe
  if (!countryCode) return true;
  return GDPR_COUNTRIES.includes(countryCode.toUpperCase());
}
```

**Step 2: Commit**

```bash
jj describe -m "feat: add geolocation utility for GDPR region detection"
```

---

## Task 3: Create Analytics Module (PostHog)

**Files:**
- Create: `web_frontend/src/analytics.ts`

**Step 1: Create analytics module**

```typescript
// web_frontend/src/analytics.ts
import posthog from 'posthog-js';

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY;
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://eu.posthog.com';
const CONSENT_KEY = 'analytics-consent';

let initialized = false;

/**
 * Initialize PostHog (call after user consents)
 */
export function initPostHog(): void {
  if (initialized || !POSTHOG_KEY) {
    if (!POSTHOG_KEY) {
      console.warn('[analytics] VITE_POSTHOG_KEY not set, skipping PostHog init');
    }
    return;
  }

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    capture_pageview: false, // We'll capture manually for SPA
    capture_pageleave: true,
    persistence: 'localStorage',
    loaded: (ph) => {
      const consent = localStorage.getItem(CONSENT_KEY);
      if (consent === 'accepted') {
        ph.opt_in_capturing();
      } else {
        ph.opt_out_capturing();
      }
    },
  });

  initialized = true;
}

/**
 * Opt in to tracking (user accepted consent)
 */
export function optIn(): void {
  localStorage.setItem(CONSENT_KEY, 'accepted');
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
  localStorage.setItem(CONSENT_KEY, 'declined');
  if (initialized) {
    posthog.opt_out_capturing();
  }
}

/**
 * Check if user has consented
 */
export function hasConsent(): boolean {
  return localStorage.getItem(CONSENT_KEY) === 'accepted';
}

/**
 * Check if user has made a consent choice (either way)
 */
export function hasConsentChoice(): boolean {
  const consent = localStorage.getItem(CONSENT_KEY);
  return consent === 'accepted' || consent === 'declined';
}

/**
 * Capture a page view (call on route change)
 */
export function capturePageView(path: string): void {
  if (!initialized || !hasConsent()) return;
  posthog.capture('$pageview', { $current_url: window.origin + path });
}

// ============ Custom Events ============

// Lesson events
export function trackLessonStarted(lessonId: string, lessonTitle: string): void {
  if (!hasConsent()) return;
  posthog.capture('lesson_started', { lesson_id: lessonId, lesson_title: lessonTitle });
}

export function trackVideoStarted(lessonId: string): void {
  if (!hasConsent()) return;
  posthog.capture('video_started', { lesson_id: lessonId });
}

export function trackVideoCompleted(lessonId: string, watchDuration: number): void {
  if (!hasConsent()) return;
  posthog.capture('video_completed', { lesson_id: lessonId, watch_duration: watchDuration });
}

export function trackArticleScrolled(lessonId: string, percent: 25 | 50 | 75 | 100): void {
  if (!hasConsent()) return;
  posthog.capture('article_scrolled', { lesson_id: lessonId, percent });
}

export function trackArticleCompleted(lessonId: string): void {
  if (!hasConsent()) return;
  posthog.capture('article_completed', { lesson_id: lessonId });
}

export function trackChatOpened(lessonId: string): void {
  if (!hasConsent()) return;
  posthog.capture('chat_opened', { lesson_id: lessonId });
}

export function trackChatMessageSent(lessonId: string, messageLength: number): void {
  if (!hasConsent()) return;
  posthog.capture('chat_message_sent', { lesson_id: lessonId, message_length: messageLength });
}

export function trackChatSessionEnded(lessonId: string, messageCount: number, durationSeconds: number): void {
  if (!hasConsent()) return;
  posthog.capture('chat_session_ended', { lesson_id: lessonId, message_count: messageCount, duration: durationSeconds });
}

export function trackLessonCompleted(lessonId: string): void {
  if (!hasConsent()) return;
  posthog.capture('lesson_completed', { lesson_id: lessonId });
}

// Signup events
export function trackSignupStarted(): void {
  if (!hasConsent()) return;
  posthog.capture('signup_started');
}

export function trackSignupStepCompleted(stepName: string): void {
  if (!hasConsent()) return;
  posthog.capture('signup_step_completed', { step_name: stepName });
}

export function trackSignupCompleted(): void {
  if (!hasConsent()) return;
  posthog.capture('signup_completed');
}

export { posthog };
```

**Step 2: Commit**

```bash
jj describe -m "feat: add PostHog analytics module with custom events"
```

---

## Task 4: Create Error Tracking Module (Sentry)

**Files:**
- Create: `web_frontend/src/errorTracking.ts`

**Step 1: Create error tracking module**

```typescript
// web_frontend/src/errorTracking.ts
import * as Sentry from '@sentry/react';

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;

let initialized = false;

/**
 * Initialize Sentry (call after user consents)
 */
export function initSentry(): void {
  if (initialized || !SENTRY_DSN) {
    if (!SENTRY_DSN) {
      console.warn('[errorTracking] VITE_SENTRY_DSN not set, skipping Sentry init');
    }
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
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

export { Sentry };
```

**Step 2: Commit**

```bash
jj describe -m "feat: add Sentry error tracking module"
```

---

## Task 5: Create Cookie Banner Component

**Files:**
- Create: `web_frontend/src/components/CookieBanner.tsx`

**Step 1: Create cookie banner component**

```tsx
// web_frontend/src/components/CookieBanner.tsx
import { useState, useEffect } from 'react';
import { detectUserCountry, requiresCookieConsent } from '../geolocation';
import { optIn, optOut, hasConsentChoice } from '../analytics';
import { initSentry } from '../errorTracking';

export default function CookieBanner() {
  const [showBanner, setShowBanner] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function checkConsent() {
      // Already made a choice
      if (hasConsentChoice()) {
        setIsLoading(false);
        return;
      }

      // Detect country for GDPR check
      const country = await detectUserCountry();
      const needsConsent = requiresCookieConsent(country);

      if (needsConsent) {
        setShowBanner(true);
      } else {
        // Auto-consent for non-GDPR regions
        optIn();
        initSentry();
      }

      setIsLoading(false);
    }

    checkConsent();
  }, []);

  const handleAccept = () => {
    optIn();
    initSentry();
    setShowBanner(false);
  };

  const handleDecline = () => {
    optOut();
    setShowBanner(false);
  };

  if (isLoading || !showBanner) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-700 p-4 z-50 shadow-lg">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex-1">
          <p className="text-sm text-slate-300">
            We care about AI Safety. We use analytics to understand how to improve this course platform.{' '}
            <strong className="text-white">No marketing, no data selling.</strong>{' '}
            <a href="/privacy" className="text-blue-400 hover:text-blue-300 underline">
              Learn more
            </a>
          </p>
        </div>
        <div className="flex gap-3 flex-shrink-0">
          {/* Equal buttons - GDPR compliant (no dark patterns) */}
          <button
            onClick={handleDecline}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors"
          >
            Decline Analytics
          </button>
          <button
            onClick={handleAccept}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors"
          >
            Accept Analytics
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
jj describe -m "feat: add GDPR-compliant cookie consent banner"
```

---

## Task 6: Create Cookie Settings Modal

**Files:**
- Create: `web_frontend/src/components/CookieSettings.tsx`

**Step 1: Create cookie settings modal**

```tsx
// web_frontend/src/components/CookieSettings.tsx
import { useState, useEffect } from 'react';
import { optIn, optOut, hasConsent } from '../analytics';
import { initSentry } from '../errorTracking';

interface CookieSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CookieSettings({ isOpen, onClose }: CookieSettingsProps) {
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setAnalyticsEnabled(hasConsent());
    }
  }, [isOpen]);

  const handleToggle = (enabled: boolean) => {
    setAnalyticsEnabled(enabled);
    if (enabled) {
      optIn();
      initSentry();
    } else {
      optOut();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg max-w-md w-full p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-slate-900">Cookie Settings</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="space-y-4">
          {/* Essential Cookies */}
          <div className="pb-4 border-b border-slate-200">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-slate-900">Essential Cookies</h3>
              <span className="text-sm text-slate-500">Always Active</span>
            </div>
            <p className="text-sm text-slate-600">
              Required for login and core functionality. These cannot be disabled.
            </p>
          </div>

          {/* Analytics Cookies */}
          <div className="pb-4 border-b border-slate-200">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-slate-900">Analytics Cookies</h3>
              <button
                onClick={() => handleToggle(!analyticsEnabled)}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  analyticsEnabled ? 'bg-blue-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    analyticsEnabled ? 'translate-x-6' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            <p className="text-sm text-slate-600">
              Help us understand how users interact with the platform to improve the experience.
              No marketing, no tracking, no data selling.
            </p>
          </div>

          {/* Privacy Policy Link */}
          <div className="pt-2">
            <a
              href="/privacy"
              className="text-sm text-blue-600 hover:text-blue-500 underline"
              onClick={onClose}
            >
              View full privacy policy
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
jj describe -m "feat: add cookie settings modal for changing preferences"
```

---

## Task 7: Wire Up Analytics in App

**Files:**
- Modify: `web_frontend/src/App.tsx`

**Step 1: Add analytics initialization and page view tracking**

Add imports at top of file:

```typescript
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import CookieBanner from "./components/CookieBanner";
import { initPostHog, capturePageView, hasConsent } from "./analytics";
import { initSentry } from "./errorTracking";
```

Add after existing imports, before the App function:

```typescript
// Initialize analytics if user previously consented
if (hasConsent()) {
  initPostHog();
  initSentry();
}
```

Add inside App function, before the return statement:

```typescript
  const location = useLocation();

  // Track page views on route change
  useEffect(() => {
    capturePageView(location.pathname);
  }, [location.pathname]);
```

Add `<CookieBanner />` at the end of the JSX, just before the closing `</>`:

```tsx
      <CookieBanner />
    </>
```

**Step 2: Verify the app still compiles**

```bash
cd /home/penguin/code-in-WSL/ai-safety-course-platform-ws2/web_frontend && npm run build
```

Expected: Build succeeds.

**Step 3: Commit**

```bash
jj describe -m "feat: wire up analytics and cookie banner in App"
```

---

## Task 8: Add Footer Link to Layout

**Files:**
- Modify: `web_frontend/src/components/Layout.tsx`

**Step 1: Add cookie settings state and modal**

Replace the entire Layout.tsx with:

```tsx
// web_frontend/src/components/Layout.tsx
import { useState } from "react";
import { Outlet } from "react-router-dom";
import { DISCORD_INVITE_URL } from "../config";
import CookieSettings from "./CookieSettings";

export default function Layout() {
  const [showCookieSettings, setShowCookieSettings] = useState(false);

  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased flex flex-col">
      <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md bg-white/70 border-b border-slate-200/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <a href="/" className="text-xl font-bold bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent">
              Coursey McCourseface
            </a>
            <a
              href={DISCORD_INVITE_URL}
              className="px-5 py-2 rounded-full border-2 border-slate-200 text-slate-700 font-medium text-sm hover:border-slate-300 hover:bg-slate-50 transition-all duration-200"
            >
              Join Our Discord
            </a>
          </div>
        </div>
      </nav>
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 py-6 mt-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-center gap-4 text-sm text-slate-500">
            <a href="/privacy" className="hover:text-slate-700">Privacy Policy</a>
            <span>·</span>
            <button
              onClick={() => setShowCookieSettings(true)}
              className="hover:text-slate-700"
            >
              Cookie Settings
            </button>
          </div>
        </div>
      </footer>
      <CookieSettings
        isOpen={showCookieSettings}
        onClose={() => setShowCookieSettings(false)}
      />
    </div>
  );
}
```

**Step 2: Verify build**

```bash
cd /home/penguin/code-in-WSL/ai-safety-course-platform-ws2/web_frontend && npm run build
```

**Step 3: Commit**

```bash
jj describe -m "feat: add footer with cookie settings link to Layout"
```

---

## Task 9: Add Analytics Events to UnifiedLesson

**Files:**
- Modify: `web_frontend/src/pages/UnifiedLesson.tsx`

**Step 1: Add analytics imports**

Add at top of imports:

```typescript
import {
  trackLessonStarted,
  trackLessonCompleted,
  trackVideoStarted,
  trackVideoCompleted,
  trackChatOpened,
  trackChatMessageSent,
} from "../analytics";
```

**Step 2: Track lesson started**

In the `useEffect` that initializes the session (around line 39-94), add after `setSession(state)` is called (around line 82):

```typescript
        // Track lesson start
        trackLessonStarted(lessonId!, state.lesson_title);
```

**Step 3: Track lesson completed**

In the `LessonCompleteModal` section (around line 466), add a useEffect to track completion:

Add before the return statement (around line 350):

```typescript
  // Track lesson completion
  useEffect(() => {
    if (session?.completed && lessonId) {
      trackLessonCompleted(lessonId);
    }
  }, [session?.completed, lessonId]);
```

**Step 4: Track chat messages**

In `handleSendMessage` (around line 96), add after `setPendingMessage` (around line 101):

```typescript
    // Track chat message (only if non-empty user message)
    if (content && lessonId) {
      trackChatMessageSent(lessonId, content.length);
    }
```

**Step 5: Track chat stage entered**

In the auto-initiate AI useEffect (around line 283), add before `handleSendMessage("")`:

```typescript
    // Track chat opened
    if (lessonId) {
      trackChatOpened(lessonId);
    }
```

**Step 6: Verify build**

```bash
cd /home/penguin/code-in-WSL/ai-safety-course-platform-ws2/web_frontend && npm run build
```

**Step 7: Commit**

```bash
jj describe -m "feat: add analytics events to UnifiedLesson"
```

---

## Task 10: Add Analytics Events to SignupWizard

**Files:**
- Modify: `web_frontend/src/components/signup/SignupWizard.tsx`

**Step 1: Add analytics imports**

Add at top of imports:

```typescript
import {
  trackSignupStarted,
  trackSignupStepCompleted,
  trackSignupCompleted,
} from "../../analytics";
```

**Step 2: Track signup started**

Add a useEffect after the state declarations (around line 35):

```typescript
  // Track signup started on mount
  useEffect(() => {
    trackSignupStarted();
  }, []);
```

**Step 3: Track step completions**

In each step component's `onNext` callback, add tracking. Modify the step transitions:

For step 1 → 2 (around line 181):

```typescript
          onNext={() => {
            trackSignupStepCompleted("personal_info");
            setCurrentStep(2);
          }}
```

For step 2 → 3 (around line 203):

```typescript
          onNext={() => {
            trackSignupStepCompleted("cohort_role");
            setCurrentStep(3);
          }}
```

**Step 4: Track signup completed**

In `handleSubmit`, add after `setCurrentStep("complete")` (around line 144):

```typescript
      trackSignupCompleted();
```

**Step 5: Verify build**

```bash
cd /home/penguin/code-in-WSL/ai-safety-course-platform-ws2/web_frontend && npm run build
```

**Step 6: Commit**

```bash
jj describe -m "feat: add analytics events to SignupWizard"
```

---

## Task 11: Add Sentry to Backend

**Files:**
- Modify: `requirements.txt`
- Modify: `main.py`

**Step 1: Add sentry-sdk to requirements**

Add to `requirements.txt` after the FastAPI section:

```
# Error tracking
sentry-sdk[fastapi]>=1.40.0
```

**Step 2: Install backend dependencies**

```bash
cd /home/penguin/code-in-WSL/ai-safety-course-platform-ws2 && pip install sentry-sdk[fastapi]
```

**Step 3: Add Sentry initialization to main.py**

Add import near top of file (after other imports, around line 31):

```python
import sentry_sdk
```

Add Sentry initialization after the dotenv loading (around line 37, before the early parser):

```python
# Initialize Sentry for error tracking
sentry_dsn = os.getenv("SENTRY_DSN")
if sentry_dsn:
    sentry_sdk.init(
        dsn=sentry_dsn,
        environment=os.getenv("ENVIRONMENT", "development"),
        traces_sample_rate=0.1,  # 10% of transactions for performance monitoring
    )
    print("✓ Sentry error tracking initialized")
else:
    print("Note: SENTRY_DSN not set, error tracking disabled")
```

**Step 4: Verify the server starts**

```bash
cd /home/penguin/code-in-WSL/ai-safety-course-platform-ws2 && python -c "import main; print('Import OK')"
```

**Step 5: Commit**

```bash
jj describe -m "feat: add Sentry error tracking to backend"
```

---

## Task 12: Create Environment Variable Template

**Files:**
- Modify: `.env.example` (or create if doesn't exist)

**Step 1: Check if .env.example exists**

```bash
ls -la /home/penguin/code-in-WSL/ai-safety-course-platform-ws2/.env.example 2>/dev/null || echo "Does not exist"
```

**Step 2: Add analytics env vars to template**

If exists, append. If not, create with analytics section:

```bash
# Analytics & Error Tracking
VITE_POSTHOG_KEY=           # PostHog project API key (get from eu.posthog.com)
VITE_POSTHOG_HOST=https://eu.posthog.com
VITE_SENTRY_DSN=            # Sentry DSN for frontend (get from sentry.io)
SENTRY_DSN=                 # Sentry DSN for backend (same project or separate)
```

**Step 3: Commit**

```bash
jj describe -m "docs: add analytics env vars to .env.example"
```

---

## Task 13: Final Verification

**Step 1: Run full frontend build**

```bash
cd /home/penguin/code-in-WSL/ai-safety-course-platform-ws2/web_frontend && npm run build
```

Expected: Build succeeds with no errors.

**Step 2: Run frontend lint**

```bash
cd /home/penguin/code-in-WSL/ai-safety-course-platform-ws2/web_frontend && npm run lint
```

Expected: No errors (warnings OK).

**Step 3: Check backend import**

```bash
cd /home/penguin/code-in-WSL/ai-safety-course-platform-ws2 && python -c "import main"
```

Expected: No import errors.

**Step 4: Squash commits into single feature commit**

```bash
jj squash --from "description(glob:'*posthog*') | description(glob:'*sentry*') | description(glob:'*analytics*') | description(glob:'*cookie*') | description(glob:'*geolocation*')"
jj describe -m "feat: add analytics (PostHog) and error tracking (Sentry) with GDPR consent

- PostHog for analytics + session replay (EU cloud)
- Sentry for frontend + backend error tracking
- GDPR-compliant cookie banner (geolocation-aware)
- Cookie settings modal in footer
- Custom events for lessons, chat, signup funnel"
```

---

## Manual Setup After Implementation

1. **Create PostHog account** at https://eu.posthog.com
   - Create project → copy API key
   - Add `VITE_POSTHOG_KEY` to `.env.local` and Railway

2. **Create Sentry account** at https://sentry.io
   - Create React project → copy DSN → `VITE_SENTRY_DSN`
   - Create Python project → copy DSN → `SENTRY_DSN`
   - Add both to `.env.local` and Railway

3. **Create privacy policy page** at `/privacy`
   - Explain what data is collected
   - Explain PostHog + Sentry usage
   - Explain user rights under GDPR
