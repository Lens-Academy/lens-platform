# Facilitator Panel Enhancements

## Features

1. **Attendance in members table** — `X/Y` where X = meetings attended (checked_in_at), Y = past meetings for the group. Denominator grows as meetings pass.

2. **AI message count in members table** — Count of user-role messages across all chat_sessions for each member. Quick engagement signal.

3. **Per-meeting attendance in user detail** — When clicking a member, show each meeting with their RSVP status and check-in status.

4. **Discord links** — "DM user" link (discord.com/users/{discord_id}) in user detail. "Message group" link (discord.com/channels/{guild_id}/{channel_id}) at group level.

## Changes by layer

### Core queries (`core/queries/facilitator.py`)

- **`get_group_members_with_progress`**: Add subqueries joining `meetings` + `attendances` to get `meetings_attended` and `meetings_occurred` per member. Add subquery on `chat_sessions` to count user-role messages from JSONB.
- **New: `get_user_meeting_attendance`**: For user detail — returns all meetings for the group with that user's RSVP status and check-in timestamp.
- Add `discord_id` to the member query (already on users table, just not selected).

### API routes (`web_api/routes/facilitator.py`)

- **`list_group_members`**: Return new fields (`meetings_attended`, `meetings_occurred`, `ai_message_count`, `discord_id`).
- **`list_groups`**: Return `discord_text_channel_id` for each group.
- **New or extend user detail**: Return meeting attendance data. Could be a new endpoint or folded into existing progress endpoint.

### Frontend types (`web_frontend/src/types/facilitator.ts`)

- `GroupMember` += `meetings_attended`, `meetings_occurred`, `ai_message_count`, `discord_id`
- `FacilitatorGroup` += `discord_text_channel_id`
- New `MeetingAttendance` type

### Frontend view (`web_frontend/src/views/Facilitator.tsx`)

- Members table: add Attendance and AI Messages columns
- Group header: add "Message group" Discord link
- User detail: add "DM user" link, add meetings section with per-meeting RSVP/attendance
- Discord links open in new tab

## Implementation order

1. Core queries (add attendance + message count to members query, new meeting attendance query, discord_id)
2. API routes (expose new fields, add group channel ID, meeting attendance)
3. Frontend types (update interfaces)
4. Frontend view (add columns, links, meeting detail section)
