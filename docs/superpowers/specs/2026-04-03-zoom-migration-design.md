# Zoom Migration Design

Replace Discord voice channels with Zoom for study group meetings. Zoom meetings are created via the Zoom API (Server-to-Server OAuth) and integrated into the existing sync pipeline, Google Calendar events, and notification templates.

## Zoom API Integration (Done)

`core/zoom/` module with S2S OAuth token management and meeting CRUD. Env vars: `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`. Tested and working.

**Files:** `core/zoom/client.py`, `core/zoom/meetings.py`, `core/zoom/__init__.py`

## Host Assignment

Licensed Zoom hosts are queried on demand from the Zoom API (`GET /users`), not stored in a local table. This keeps the Zoom account as the single source of truth — adding a licensed user to the account automatically makes them available as a host.

Zoom Pro allows 1 concurrent meeting per licensed user, so the number of licensed users determines max concurrent meetings.

### Database

New columns on `meetings` table:

| Column | Type | Notes |
|--------|------|-------|
| `zoom_meeting_id` | bigint, nullable | Zoom's meeting ID |
| `zoom_join_url` | text, nullable | Participant join URL |
| `zoom_host_email` | text, nullable | Email of the host user for this meeting |

### Assignment Logic

When creating a Zoom meeting for a time slot:
1. `GET /users` → filter to licensed (type=2), active users
2. Query `meetings` table for hosts with overlapping meetings at the target time
3. Pick the first host not in the busy set

If no host is available, raise an error during realize (admin needs to add more licensed users or resolve scheduling conflicts).

## Sync Pipeline Changes

### Additions

New `sync_group_zoom()` in `core/sync.py`:
- For each meeting in the group missing a `zoom_meeting_id`:
  1. Pick an available host from the pool for the time slot
  2. Create a standalone scheduled Zoom meeting via `POST /users/{host_email}/meetings`
  3. Store `zoom_meeting_id`, `zoom_join_url`, `zoom_host_email` on the meeting row
- For meetings that already have a Zoom meeting: verify it still exists (handle external deletion), patch if time has drifted

### Removals

- **`_ensure_meeting_discord_events()`** — remove entirely (no more Discord scheduled events)
- **Voice channel creation** in `_ensure_group_channels()` — skip voice channel, create text channel only

### Updated Pipeline Order

```
sync_group()
├─ _ensure_cohort_category()
├─ _ensure_group_channels()        # text only, no voice
├─ _ensure_group_meetings()
├─ sync_group_discord_permissions()
├─ sync_group_zoom()               # NEW
├─ sync_group_calendar()           # now includes Zoom URL
├─ sync_group_reminders()
└─ sync_group_rsvps()
```

## Google Calendar Changes

When creating/updating calendar events, include the Zoom join URL as `conferenceData` with an `entryPoint` so Google Calendar renders a "Join Zoom Meeting" button.

Since each meeting instance may have a different Zoom URL (standalone meetings), patch individual calendar event instances with their specific Zoom link — same pattern as existing per-instance attendee patching.

## Discord Changes

### Removed
- Voice channel creation in `_ensure_group_channels()`
- `_ensure_meeting_discord_events()` and all Discord scheduled event logic
- Stop populating `discord_event_id` on meetings

### Kept
- Text channels per group
- Channel reminder messages — updated to include Zoom join URL

## Notification Changes

### Template Updates (`messages.yaml`)

- `meeting_reminder_24h` — include Zoom join URL prominently
- `meeting_reminder_1h` — include Zoom join URL prominently
- `group_assigned` / `member_joined` — mention meetings are on Zoom
- `module_nudge_3d` — unchanged (about content, not meetings)

### Email
Zoom URL as a prominent "Join Meeting" link in all meeting-related emails.

### Discord Channel Posts
Zoom URL replaces voice channel reference in reminder messages.

## Rescheduling & Postponing

### `reschedule_meeting()`
1. Update meeting time in DB
2. `PATCH /meetings/{zoom_meeting_id}` with new start_time
3. If current host has a conflict at the new time: delete old Zoom meeting, pick new host, create new Zoom meeting
4. Patch Google Calendar instance with new Zoom URL if it changed

### `postpone_meeting()`
1. Delete the Zoom meeting for the skipped week
2. Create a new Zoom meeting for the replacement date (possibly different host)
3. Update Google Calendar accordingly

## Future Work (Not This Iteration)

- **Stable redirect URLs** — `lensacademy.org/meet/{group-slug}` resolving to next Zoom URL
- **Zoom attendance tracking** — webhook or polling-based
- **Recording management** — auto-share links after meetings
