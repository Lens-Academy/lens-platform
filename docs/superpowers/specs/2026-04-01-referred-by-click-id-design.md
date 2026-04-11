# Referred-by-click-id Design

## Goal

Replace `users.referred_by_link_id` with `users.referred_by_click_id` so signup attribution points to a specific referral click, enabling click-to-signup delay analysis and consent state visibility. Transport the click_id to the auth callback via OAuth state (primary) and a `ref_click_id` cookie (cross-session fallback).

## Schema Change

- **Remove:** `users.referred_by_link_id` (FK → referral_links, ON DELETE SET NULL)
- **Add:** `users.referred_by_click_id` (FK → referral_clicks, ON DELETE SET NULL, nullable)

The link is reachable via `referral_clicks.link_id`, so no data is lost.

## Click Handler (`web_api/routes/ref.py`)

When a click is logged and the `ref` cookie is set, also set a `ref_click_id` cookie:

- Key: `ref_click_id`
- Value: the click_id (stringified integer)
- Same settings as `ref` cookie: 90-day, HttpOnly, Secure, SameSite=Lax, Path=/

On dedup (cookie matches slug, click skipped), neither cookie is updated — the original click_id persists from the first visit.

## Frontend (`useAuth.ts`)

The `login()` function already sends `ref` through the OAuth state query params. Add `click_id` the same way:

- Source: `sessionStorage.getItem("ref_click_id")` (already stored from the redirect URL)
- Append `&click_id=<value>` to the `/auth/discord?...` URL
- The `ref_click_id` cookie is HttpOnly, so JS can't read it — sessionStorage is the only frontend source

## Auth Callback (`web_api/routes/auth.py`)

Priority for click_id resolution:

1. OAuth state `click_id` (most direct — same-session signup)
2. `ref_click_id` cookie (cross-session fallback)
3. Nothing — no click attribution

Pass click_id to `resolve_attribution`. After attribution, delete both `ref` and `ref_click_id` cookies.

## `resolve_attribution` (`core/referrals.py`)

Signature changes from:
```python
async def resolve_attribution(conn, user_id, ref_slug)
```

To:
```python
async def resolve_attribution(conn, user_id, ref_slug, click_id=None)
```

Logic:
1. If `click_id` is provided, look up the click to get `link_id`. Validate the click exists.
2. If no `click_id`, do nothing (acceptable attribution loss for edge cases).
3. Self-referral check: click's link owner != user_id.
4. Idempotency: if `referred_by_click_id` is already set, do nothing.
5. Set `users.referred_by_click_id = click_id`.

The `ref_slug` parameter is kept for the self-referral check (slug → link → owner) but could also be derived from the click. Keep it for now to avoid an extra query; can be cleaned up later.

Actually, since click_id gives us link_id which gives us user_id (owner), `ref_slug` is redundant when click_id is present. Simplify: if click_id is provided, derive everything from it. Drop the `ref_slug` parameter entirely — the slug is only needed to find the link, and the click already has the link.

New signature:
```python
async def resolve_attribution(conn, user_id, click_id)
```

If click_id is None (no attribution data), caller skips the call entirely.

## Stats Queries

`get_link_stats` and `get_all_referrer_stats` currently join `users.referred_by_link_id`. Update to join through referral_clicks:

```
users.referred_by_click_id → referral_clicks.click_id → referral_clicks.link_id → referral_links.link_id
```

## Auth Callback Cookie Cleanup

After resolving attribution, delete both cookies:
- `ref` (already done)
- `ref_click_id` (new)

## Edge Cases

- **Slug without click_id:** Visitor has `ref` cookie but no `ref_click_id` cookie (partial cookie clear, or clicked before this feature). No attribution. Acceptable since the system is new and unused.
- **Invalid click_id:** Click doesn't exist in DB (cookie tampered or click deleted). No attribution. Silent failure.
- **Self-referral:** Click's link belongs to the signing-up user. No attribution. Same as current behavior.

## Migration

Single Alembic migration:
1. Add `referred_by_click_id` column (nullable FK → referral_clicks)
2. Drop `referred_by_link_id` column
