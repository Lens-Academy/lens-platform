# Daily Study Activity Messages

## Problem

We want to increase social accountability for students to study regularly and early. Students who spread their studying across multiple days and complete homework well before meetings learn more effectively (spaced practice).

## Solution

One Discord message per group per day that builds up as group members complete sections. The message is created when the first member studies that day and edited as more members study. Early completion of homework (before the meeting deadline) gets a callout.

## Message Format

```
📚 Today's Study Activity

🎉 @Alice — completed Cognitive Superpowers! (8/8 sections · early bird — 4 days before meeting)
📖 @Bob — studying Decision Theory (3/5 sections)
📖 @Charlie — studying Cognitive Superpowers (1/8 sections)
```

- Completed modules: 🎉 + "early bird" tag if 2+ days before the meeting
- In-progress: 📖 + section count
- Ordered: completed first, then in-progress by earliest activity

## Architecture

### Data Flow

1. User completes a section via `POST /api/progress/complete`
2. `propagate_completion()` runs (existing)
3. New: `update_study_activity()` fires as `asyncio.create_task` (non-blocking)
4. Queries `user_content_progress` for today's completions across all group members
5. Renders message, either creates new or edits existing Discord message

### Storage

- **Content**: Reconstructed from existing `user_content_progress` table on each update. No new data storage for study state.
- **Discord message ID**: In-memory dict `{(group_id, date): message_id}`. Lost on server restart (new message created — acceptable).

### Components

| File | Change |
|------|--------|
| `core/notifications/study_activity.py` | New. Main logic: query progress, render message, send/edit Discord message |
| `core/discord_outbound/messages.py` | Modify `send_channel_message()` to return message ID. Add `edit_channel_message()` |
| `web_api/routes/progress.py` | After `propagate_completion()`, fire `update_study_activity()` |

### Early Bird Logic

Uses `get_due_by_meeting()` from the course progression system to determine which meeting a module is homework for. Looks up the next meeting date from the `meetings` table. If the module is completed 2+ days before the meeting, the "early bird — N days before meeting" tag is shown.

### Edge Cases

- User not in a group: skip silently
- Group has no Discord channel: skip silently
- Discord edit fails (message deleted, permissions changed): create a new message, update in-memory dict
- Server restart mid-day: new message created on next completion
- Multiple modules same day per user: show the most recently active module

## Design Decisions

- **No new database table**: Discord message ID is ephemeral state, not worth a migration. In-memory dict is sufficient — worst case on restart is a duplicate daily message.
- **No weekly digest (yet)**: Starting with daily messages only. Weekly digest can be added later as a separate feature.
- **Programmatic rendering, not YAML template**: The message is multi-user and dynamic, so it's rendered in code rather than using the `messages.yaml` template system.
- **Fire-and-forget**: The study activity update runs as a background task so it doesn't slow down the section completion API response.
- **Only show active members**: No listing of who hasn't studied. Research shows naming inactive members in small groups feels like public shaming.

## Research Background

- Spaced practice is more effective than massed practice for learning retention
- The Kohler effect: in small groups, weaker performers push harder when they know the group depends on them
- Live event feeds create notification fatigue; a single evolving message per day is the sweet spot
- Warm + factual tone works better than competitive or celebratory in small groups (5-8 people)
- Early completion social proof drives imitation more than abstract rewards
