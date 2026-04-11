# Guest Meeting Visits

Users who can't attend their group's meeting can temporarily join another group's same-week meeting within the same cohort.

## Constraints

- Same cohort only (no cross-cohort visits)
- Same meeting number only (Week 5 user can only visit another group's Week 5)
- No capacity limits, no facilitator approval
- Web-only flow (no Discord commands, no LLM parsing)
- One guest visit per meeting number (can't visit two groups for the same week)

## Schema Change

One column added to `attendances`:

```sql
ALTER TABLE attendances ADD COLUMN is_guest BOOLEAN NOT NULL DEFAULT false;
```

No new tables. Guest visits are represented as attendance records with `is_guest=true` on the host meeting.

## User Flow

1. User visits `/reschedule` page
2. Page shows their upcoming meetings (from their active group)
3. User clicks "Can't attend" on a specific meeting
4. System finds other groups in the same cohort with the same `meeting_number`
5. User selects an alternative meeting time
6. System creates guest attendance, triggers Discord role grant + Calendar invite
7. After meeting + 3 days, system auto-revokes Discord role

## API Endpoints

```
GET  /api/guest-visits/options?meeting_id={id}
  Returns alternative meetings: meeting_id, group_name, scheduled_at, facilitator name
  Filters: same cohort, same meeting_number, different group, future only

POST /api/guest-visits
  Body: { home_meeting_id, host_meeting_id }
  Creates guest attendance on host meeting (is_guest=true, rsvp_status=attending)
  Updates home meeting attendance to rsvp_status=not_attending
  Triggers: Discord role grant, Calendar instance patch
  Returns: created attendance record

DELETE /api/guest-visits/{host_meeting_id}
  Cancels guest visit (deletes guest attendance, resets home RSVP to pending)
  Only allowed before the meeting starts
  Triggers: Discord role revoke, Calendar instance patch (remove email)

GET  /api/guest-visits
  Lists user's guest visits (upcoming and past) for display
```

## Core Business Logic

New module: `core/guest_visits.py`

### find_alternative_meetings(user_id, meeting_id)

1. Get the meeting's group, cohort, and meeting_number
2. Query meetings in the same cohort with same meeting_number but different group
3. Filter out past meetings
4. Join with group info (name, facilitator) for display
5. Return list of options

### create_guest_visit(user_id, home_meeting_id, host_meeting_id)

1. Validate: user belongs to home meeting's group (via groups_users)
2. Validate: host meeting is same cohort and same meeting_number
3. Validate: user doesn't already have a guest visit for this meeting_number
4. Create attendance on host meeting: `is_guest=true, rsvp_status=attending`
5. Update/create attendance on home meeting: `rsvp_status=not_attending`
6. Trigger Discord sync on host group (grants role via diff)
7. Patch host group's calendar instance to add guest's email
8. Schedule two one-shot APScheduler jobs:
   - **Grant** at `host_meeting.scheduled_at - 6 days` → `sync_group_discord_permissions(host_group_id)`
   - **Revoke** at `host_meeting.scheduled_at + 3 days` → `sync_group_discord_permissions(host_group_id)`

Both jobs are fire-and-forget. The grant job ensures the guest gets the Discord role 6 days before the meeting (not immediately at booking time). If the visit is created within 6 days, the immediate sync (step 6) handles the grant and the scheduled grant job is a harmless no-op. No cancellation of scheduled jobs needed — if cancelled, the attendance record is already deleted, so syncs are no-ops.

### cancel_guest_visit(user_id, host_meeting_id)

1. Validate: guest attendance exists and meeting hasn't started
2. Delete guest attendance record
3. Reset home meeting attendance to `rsvp_status=pending`
4. Trigger Discord sync on host group (revokes role via diff)
5. Patch host group's calendar instance to remove guest's email

## Discord Integration

Guests temporarily receive the host group's Discord role (in addition to their own group's role). This grants access to the host group's text and voice channels.

The existing `sync_group_discord_permissions` is modified to include guests in its "expected members" query:

```sql
-- permanent members (existing)
SELECT u.discord_id FROM users u
  JOIN groups_users gu ON u.user_id = gu.user_id
  WHERE gu.group_id = :group_id AND gu.status = 'active'
    AND u.discord_id IS NOT NULL
UNION
-- active guests (new): access window is 6 days before → 3 days after meeting
SELECT u.discord_id FROM attendances a
  JOIN meetings m ON a.meeting_id = m.meeting_id
  JOIN users u ON a.user_id = u.user_id
  WHERE m.group_id = :group_id
    AND a.is_guest = true
    AND a.rsvp_status = 'attending'
    AND m.scheduled_at > now() - interval '3 days'
    AND m.scheduled_at < now() + interval '6 days'
    AND u.discord_id IS NOT NULL
```

The existing diff logic (compare expected vs actual role members, add/remove roles) handles everything. Two one-shot APScheduler jobs are scheduled per guest visit:

1. **Grant** at `meeting - 6 days` → sync runs, guest enters expected set, diff grants role
2. **Revoke** at `meeting + 3 days` → sync runs, guest exits expected set, diff removes role

If the visit is created within 6 days of the meeting, the immediate sync handles the grant. Both jobs are fire-and-forget — if cancelled, the attendance is deleted, so syncs are no-ops. Self-healing: any manual sync auto-corrects since the query computes the desired state from the current time.

### Channel notifications

When `sync_group_discord_permissions` grants or revokes a role because of a guest visit, the bot posts a short message in the host group's text channel:

- **Grant:** "[User] is joining this week's meeting as a guest from [home group name]."
- **Revoke:** "[User]'s guest visit has ended."

The sync function already returns `granted_discord_ids` and `revoked_discord_ids`. After sync, cross-reference these with the guest expected-members query to determine which additions/removals are guests (vs regular member changes). For each guest, look up the user's display name and home group name, then call `send_channel_message(text_channel_id, message)`.

This runs inside the same APScheduler job that triggers the sync — no extra scheduling needed.

## Google Calendar Integration

New function needed: `patch_event_instance(instance_event_id, attendees)` to modify attendees on a specific instance of a recurring event.

### Adding guest to calendar instance

1. Call `get_event_instances(group.gcal_recurring_event_id)` to get all instances
2. Find the instance matching `host_meeting.scheduled_at`
3. Append guest's email to that instance's attendee list
4. Call `patch_event_instance(instance_id, updated_attendees)`

The guest receives a calendar invite for that single meeting.

### Removing guest from calendar instance (cancellation only)

Same process but remove the email. Only done when the user cancels before the meeting. After the meeting, the calendar instance is historical and left untouched.

### RSVP sync safety

The existing `sync_group_rsvps_from_recurring` upserts with `ON CONFLICT DO UPDATE` that only touches `rsvp_status` and `rsvp_at` — it does not touch `is_guest`. So if the sync finds the guest's email on the calendar instance, it updates RSVP status but preserves `is_guest=true`.

The guest attendance record is always created before the calendar patch (step 4 before step 7 in `create_guest_visit`), preventing a race where the RSVP sync creates a non-guest record.

## Existing Query Fixes

Three queries in `core/queries/facilitator.py` assume all attendances are group members:

1. **`get_group_members_with_progress()` (~line 104)** — meetings-attended subquery. Add `AND NOT a.is_guest` so guest check-ins don't inflate member attendance counts.

2. **`get_group_completion_data()` (~line 297)** — attendance fetch for timeline. Add `AND NOT a.is_guest` so guests don't appear in group completion data.

3. **`get_user_meeting_attendance()` (~line 207)** — user meeting history for facilitator view. Add `AND NOT a.is_guest` to exclude guest records from the member's attendance view.

## Frontend

New page at `/reschedule`:

- Shows upcoming meetings from the user's active group
- Each meeting has a "Can't attend" button
- Clicking shows available alternatives: group name, meeting time, facilitator name
- User selects one, confirms
- Page shows active guest visits with a "Cancel" option (disabled after meeting starts)
- Shows past guest visits for reference

## Migration

```python
def upgrade():
    op.add_column('attendances',
        sa.Column('is_guest', sa.Boolean(), nullable=False,
                  server_default=sa.text('false')))

def downgrade():
    op.drop_column('attendances', 'is_guest')
```

## Out of Scope

- Discord bot commands or message detection for absence
- LLM-based absence intent parsing
- Cross-cohort guest visits
- Facilitator approval workflow
- Capacity limits on guests per meeting
- Guest visits spanning multiple meetings
