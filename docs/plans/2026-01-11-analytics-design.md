# Analytics, Session Replay & Error Tracking Design

## Overview

Add full observability stack: analytics, session recordings, and error tracking using PostHog + Sentry.

## Tools

| Tool | Purpose | Hosting | Free Tier |
|------|---------|---------|-----------|
| PostHog | Analytics + Session Replay | EU cloud (eu.posthog.com) | 1M events/month, 5K recordings |
| Sentry | Error Tracking (Frontend + Backend) | EU data residency | 5K errors/month |

## Architecture

```
User visits site
       │
       ▼
┌─────────────────────┐
│  Cookie Consent     │ ← Shows for GDPR regions only
│  Banner             │
└─────────────────────┘
       │ (user accepts)
       ▼
┌─────────────────────┐     ┌─────────────────────┐
│  PostHog            │     │  Sentry             │
│  - Page views       │     │  - JS errors        │
│  - Custom events    │     │  - API errors       │
│  - Session replay   │     │  - Python exceptions│
└─────────────────────┘     └─────────────────────┘
       │                           │
       ▼                           ▼
   EU Cloud                    EU Cloud
```

Neither tool loads until user consents (GDPR compliance).

## Cookie Consent

**Approach:** Custom banner, no library. Geolocation-aware (only shows for GDPR regions).

**Banner text:**
> "We care about AI Safety. We use analytics to understand how to improve this course platform. **No marketing, no data selling.**"

**Non-dark-pattern design:**
- Equal buttons: "Decline Analytics" and "Accept Analytics" styled identically
- No manipulative wording or visual hierarchy tricks
- Users can change preference via footer link → settings modal

**Geolocation:**
- GDPR regions (EU, UK, Switzerland, Brazil): Show banner, require consent
- Other regions (US, Asia, etc.): Auto-consent, no banner
- Unknown location: Show banner (safe default)

**Storage:** localStorage key `analytics-consent` with values `accepted` | `declined`

## PostHog Events

| Event | Properties |
|-------|-----------|
| `lesson_started` | lesson_id, lesson_title |
| `video_started` | lesson_id |
| `video_completed` | lesson_id, watch_duration |
| `article_scrolled` | lesson_id, percent (25/50/75/100) |
| `article_completed` | lesson_id |
| `chat_opened` | lesson_id |
| `chat_message_sent` | lesson_id, message_length |
| `chat_session_ended` | lesson_id, message_count, duration |
| `lesson_completed` | lesson_id |
| `signup_started` | - |
| `signup_step_completed` | step_name |
| `signup_completed` | - |

**Note:** These duplicate some database events intentionally. Database is source of truth for app state; PostHog is for analysis (funnels, drop-off points, session replay correlation).

## Sentry Configuration

**Frontend:**
- `@sentry/react` with browser tracing
- 10% transaction sampling for performance
- 100% replay on errors

**Backend:**
- `sentry-sdk[fastapi]`
- Captures unhandled exceptions with request context
- 10% transaction sampling

## File Structure

**New files:**
```
web_frontend/src/
├── analytics.ts                # PostHog init + event helpers
├── errorTracking.ts            # Sentry init
├── geolocation.ts              # Country detection for GDPR regions
├── components/
│   ├── CookieBanner.tsx        # Bottom banner
│   └── CookieSettings.tsx      # Settings modal for changing preference
```

**Modified files:**
```
web_frontend/src/
├── App.tsx                     # Add consent check, init analytics/sentry
├── components/Layout.tsx       # Add CookieBanner, footer link
├── pages/UnifiedLesson.tsx     # Add lesson/video/article/chat events

web_frontend/package.json       # Add posthog-js, @sentry/react

main.py                         # Add Sentry SDK init
requirements.txt                # Add sentry-sdk[fastapi]
```

## Environment Variables

```bash
# Frontend (.env.local, gitignored)
VITE_POSTHOG_KEY=phc_xxx
VITE_POSTHOG_HOST=https://eu.posthog.com
VITE_SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx

# Backend (.env or Railway)
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
```

## Manual Setup Steps

1. Create PostHog account at eu.posthog.com → get API key
2. Create Sentry account → create React project + Python project → get DSNs
3. Add env vars to `.env.local` for local dev
4. Add env vars to Railway for production
