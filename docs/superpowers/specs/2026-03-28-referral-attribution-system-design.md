# Referral & Attribution Tracking System

## Overview

A system for tracking where users come from — both user-to-user referrals and self-managed campaign links. Each registered user gets a personalized referral link and can create additional named campaign links to compare performance across different channels.

**Goals:**
- Track the full referral funnel: click → signup → enrollment → completion
- Let users create and manage multiple campaign links with per-link stats
- Provide an admin view of all referral activity
- Work without cookies (GDPR-safe) via OAuth state parameter, with optional cookie-based long-window attribution for consenting users

**Not in v1:** leaderboard, rewards, personalized landing pages, PostHog/UTM integration, external (non-registered) referrers, email notifications on conversion, old-slug aliasing when codes change, cross-device attribution beyond cookies.

---

## Data Model

### `referral_links` table

| Column     | Type         | Notes                                              |
|------------|--------------|----------------------------------------------------|
| id         | serial PK    |                                                    |
| user_id    | FK → users   | Owner of this link                                 |
| name       | text         | Display label, e.g. "Default", "Twitter bio"       |
| slug       | text, unique | URL-safe string, e.g. `kate`, `kate-twitter-bio`  |
| is_default | boolean      | One per user, auto-created at account creation     |
| created_at | timestamptz  |                                                    |
| deleted_at | timestamptz, nullable | Soft delete — preserves attribution data  |

**Constraints:**
- Partial unique index: `CREATE UNIQUE INDEX ON referral_links (user_id) WHERE is_default = TRUE` — enforces one default link per user at DB level.
- Unique index on `slug` (for fast public lookups).

**Slug validation:** lowercase alphanumeric + hyphens, 3–50 characters, must start with a letter. Regex: `^[a-z][a-z0-9-]{2,49}$`

**Per-user link cap:** maximum 50 campaign links per user.

### `referral_clicks` table

| Column     | Type                  | Notes                    |
|------------|-----------------------|--------------------------|
| id         | serial PK             |                          |
| link_id    | FK → referral_links   | Which link was clicked   |
| clicked_at | timestamptz           |                          |

No dedup in v1. A few duplicate clicks from page refreshes are acceptable at current scale. If stats inflation becomes a problem, add server-side dedup via a short-lived in-memory cache later.

Index on `link_id` for aggregation queries.

### `users` table addition

| Column              | Type                           | Notes                                          |
|---------------------|--------------------------------|-------------------------------------------------|
| referred_by_link_id | FK → referral_links, nullable  | Set once at signup, filled by OAuth state or cookie |

### Funnel derivation

All funnel stages beyond clicks are derived from existing tables — no events table needed:

- **Clicks** → `COUNT(referral_clicks)` per link
- **Signups** → `COUNT(users)` where `referred_by_link_id` points to the referrer's links
- **Enrollments** → join `users` → `signups` table
- **Completions** → join `users` → `groups_users` where `status = 'completed'`

### Default link auto-creation

When a user account is created (during Discord OAuth callback), auto-create a `referral_links` row in the **same database transaction** as user creation:
- `is_default = true`
- `slug` = slugified display name (lowercase, alphanumeric + hyphens)
- On slug collision, append a short numeric suffix (e.g. `kate-7`)

### Soft delete behavior

When a user deletes a campaign link:
- Set `deleted_at` to now
- The slug stops resolving (treated as invalid)
- The link disappears from the user's UI
- Attribution data (`users.referred_by_link_id` pointing to this link) is preserved
- Click history is preserved

---

## URL Scheme

Referral links use the format:

```
lensacademy.com/ref/<slug>
```

`/ref/<slug>` is a **server-side FastAPI route** (not an SPA route) because it needs to set cookies and perform redirects.

When the route is hit:
1. Look up `slug` in `referral_links` (excluding soft-deleted)
2. If valid: log a row in `referral_clicks`
3. If the visitor's consent cookie indicates marketing cookies are accepted: set a first-party cookie `ref=<slug>` (HttpOnly, Secure, SameSite=Lax, Max-Age=90 days, server-set)
4. Redirect to `/enroll?ref=<slug>`
5. If slug is **invalid**: still redirect to `/enroll` (no click logged). This prevents slug enumeration — valid and invalid slugs produce the same visible behavior.

---

## Attribution Flow (Hybrid: OAuth State + Cookie)

### At click time
- Click logged in `referral_clicks`
- Cookie set if visitor has granted consent via the **client-side consent banner** (not the DB column, since the visitor has no account yet)
- Redirect to `/enroll?ref=<slug>`

### Frontend (enroll page)
- Reads `ref` param from URL query string
- When user clicks "Connect with Discord", passes `ref` slug through the OAuth state parameter (alongside existing `anonymous_token` and `next`)

### At signup (Discord OAuth callback)
Priority resolution — use the most direct signal available:
1. If OAuth state contains `ref` → look up link by slug → use that
2. Else if `ref` cookie exists → look up link by slug → use that
3. Else → no attribution

Write `referred_by_link_id` on the new `users` row. Clear the `ref` cookie if present.

### Known limitation
If a user clicks a ref link, doesn't consent to cookies, navigates away from the enroll page, then comes back later and signs up directly — attribution is lost. This is an acceptable trade-off for GDPR compliance.

---

## Cookie Consent Integration

The referral cookie is a **marketing cookie** (it tracks attribution for user acquisition), distinct from analytics cookies (PostHog, which tracks site usage). This requires a new marketing consent category.

**Consent banner update:** The existing banner has one toggle (analytics). This needs to become two toggles:
- **Analytics cookies** — PostHog site usage tracking (existing)
- **Marketing cookies** — referral attribution, future retargeting/ad pixels

Essential cookies (JWT session, refresh token, CSRF) remain consent-exempt as before. No functional cookies category needed — user preferences are DB-backed via login.

**How it works for the referral cookie:**
- **Anonymous visitors:** consent is determined by the **client-side consent banner**. If the visitor has accepted marketing cookies via the banner, the `/ref/<slug>` route sets the `ref` cookie. If not, no cookie is set.
- **Logged-in users:** consent is stored in `users.cookies_marketing_consent` (new field, alongside existing `cookies_analytics_consent`), but this is irrelevant for the referral flow since logged-in users are already past the signup attribution point.
- The cookie is **first-party** (set by the platform's own domain, server-side) — not blocked by ad blockers and more durable than third-party cookies.
- The cookie value is the **slug** (not an internal ID), consistent with the OAuth state parameter.

**New DB field on `users` table:**
- `cookies_marketing_consent` — enum ('accepted' | 'declined' | NULL), mirrors existing `cookies_analytics_consent`
- `cookies_marketing_consent_at` — timestamptz, mirrors existing `cookies_analytics_consent_at`

---

## User-Facing Page: `/referrals`

Accessible from the main nav (same location as /meetings, /group, /availability). Only visible to logged-in users.

### Top section — your referral link
- Default link displayed prominently with a one-click copy button
- Pre-written share message (copyable): "I've been taking this AI safety course and thought you'd enjoy it. Here's my link: [link]"

### Campaign links section
- "Create campaign link" button
- Form fields: name (required), custom slug (optional — defaults to `<user-default-slug>-<slugified-name>`)
- Table/cards listing all active links

### Stats per link

| Link                          | Clicks | Signups | Enrolled | Completed |
|-------------------------------|--------|---------|----------|-----------|
| Default (`/ref/kate`)         | 42     | 12      | 8        | 3         |
| Twitter bio (`/ref/kate-twitter`) | 15 | 4       | 2        | 1         |
| Reddit post (`/ref/kate-reddit`)  | 7  | 1       | 0        | 0         |
| **Total**                     | **64** | **17**  | **10**   | **4**     |

Stats are computed on-the-fly via database queries. Acceptable at current scale; add caching/materialized views if performance becomes an issue.

### Code customization
- Users can edit their default slug. Warning displayed: changing the slug breaks all existing links using the old slug (no aliasing in v1).
- Users can delete campaign links (not the default). Soft-deleted — stats preserved but link stops working.

---

## Admin-Facing View

A section in the existing admin area.

### Overview stats
- Total referral clicks, signups, enrollments, completions (global)
- Conversion rates between each funnel step

### Referrer table

| User | Links | Clicks | Signups | Enrolled | Completed |
|------|-------|--------|---------|----------|-----------|
| Kate | 3     | 64     | 17      | 10       | 4         |
| Alex | 1     | 22     | 5       | 3        | 1         |

- Sortable by any column
- Click into a user to see their per-link breakdown

---

## API Endpoints

### User-facing (authenticated)
- `GET /api/referrals/links` — list my links with per-link funnel stats
- `POST /api/referrals/links` — create a campaign link (name, optional slug). Returns error if at 50-link cap.
- `PATCH /api/referrals/links/:id` — rename or change slug. Only own links.
- `DELETE /api/referrals/links/:id` — soft-delete a campaign link. Cannot delete default link.

### Public (unauthenticated)
- `GET /ref/:slug` — click handler: log click, optionally set cookie, redirect to `/enroll?ref=<slug>`. Invalid slugs redirect to `/enroll` without logging (prevents enumeration).

### Admin (authenticated + is_admin)
- `GET /api/admin/referrals/overview` — global funnel stats
- `GET /api/admin/referrals/referrers` — all referrers with aggregated stats, sortable/pageable

---

## Core Business Logic

- `core/referrals.py` — link CRUD, slug generation/validation, click logging, attribution resolution at signup, funnel stat queries
- `web_api/routes/referrals.py` — HTTP layer for user-facing and admin API endpoints
- `web_api/routes/ref.py` (or similar) — the public `/ref/<slug>` click handler route
- `web_frontend/src/pages/referrals/` — the `/referrals` page

Follows the existing 3-layer architecture: `core/` for business logic, `web_api/routes/` for HTTP, `web_frontend/` for UI.
