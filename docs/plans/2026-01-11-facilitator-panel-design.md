# Facilitator Panel Design

Admin and facilitator dashboard for reviewing user progress, time spent, and chat history.

## Goals

- **Admins** can view all users across all groups
- **Facilitators** can view only users in groups they facilitate
- Track time spent per content piece (articles, videos, chats)
- Enable aggregate analysis ("how long does lesson X take on average?")
- View chat conversations between users and the AI (read-only)

## Data Model

### New Table: `content_events`

Stores activity heartbeats for time tracking:

```sql
CREATE TABLE content_events (
    event_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(user_id),  -- nullable for anonymous
    session_id INTEGER REFERENCES lesson_sessions(session_id),
    lesson_id TEXT NOT NULL,
    stage_index INTEGER NOT NULL,
    stage_type TEXT NOT NULL,  -- 'article', 'video', 'chat'
    event_type TEXT NOT NULL,  -- 'heartbeat', 'start', 'complete'
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB  -- scroll_depth, video_time, etc.
);

CREATE INDEX idx_content_events_user ON content_events(user_id);
CREATE INDEX idx_content_events_session ON content_events(session_id);
CREATE INDEX idx_content_events_lesson ON content_events(lesson_id);
```

### Time Calculation

- Count heartbeats × 30 seconds = approximate active time
- Group by `(user_id, lesson_id, stage_index)` for per-content-piece time
- Group by `lesson_id` across users for averages/distributions

### Why Heartbeats Over Start/End Times

- Handles tab switches, walking away, overnight gaps automatically
- Each heartbeat is a fact: "user was active at this moment"
- No complex gap-detection logic needed on query side

## Frontend Time Tracking

### Activity Tracker Module

New module: `web_frontend/src/lib/activityTracker.ts`

```typescript
useActivityTracker({
  sessionId: string,
  lessonId: string,
  stageIndex: number,
  stageType: "article" | "video" | "chat",
  inactivityTimeout: number,  // ms, e.g., 180_000 for 3 min
})
```

### Activity Detection by Stage Type

**Articles:**
- Track: `scroll`, `mousemove` events
- Inactivity timeout: 3-5 minutes (people read without scrolling)
- Send heartbeat every 30s while active

**Videos:**
- Track: video player `play`/`pause` events
- Heartbeat while playing, regardless of other activity
- Include `video_time` in heartbeat metadata

**Chat:**
- Track: `keydown` in input field, message sends
- Heartbeat while actively typing/engaging

### Heartbeat Request

```
POST /api/lesson-sessions/{session_id}/heartbeat
{
  "stage_index": 0,
  "stage_type": "article",
  "scroll_depth": 0.65,  // optional
  "video_time": 120      // optional, seconds
}
```

Returns `204 No Content` (fire-and-forget).

## API Endpoints

### New Routes: `web_api/routes/facilitator.py`

All endpoints check user role and group access.

```
GET /api/facilitator/groups
```
Returns groups the current user can access.
- Admin: all groups across all cohorts
- Facilitator: only groups where they have `groups_users.role = 'facilitator'`

```
GET /api/facilitator/groups/{group_id}/members
```
Returns members with progress summary:
- `user_id`, `name`, `lessons_completed`, `total_time_seconds`, `last_active_at`
- 403 if user doesn't have access to this group

```
GET /api/facilitator/groups/{group_id}/users/{user_id}/progress
```
Returns detailed progress for one user within the group's cohort context:
- Per-lesson breakdown: `lesson_id`, `completed`, `time_spent_seconds`
- Per-stage breakdown: `stage_index`, `stage_type`, `time_spent_seconds`
- 403 if user isn't in a group the requester can access

```
GET /api/facilitator/groups/{group_id}/users/{user_id}/chats
```
Returns chat sessions for one user:
- List of `lesson_sessions` with `messages` array
- Filtered to lessons in the group's cohort
- Same access control

### Access Control Pattern

```python
async def check_facilitator_access(current_user, group_id):
    # Admins can access any group
    if await is_admin(current_user.user_id):
        return True

    # Facilitators can only access groups they facilitate
    return await is_group_facilitator(current_user.user_id, group_id)
```

## Frontend: Facilitator Panel

### Route: `/facilitator`

Protected by role check. Redirects to home if user is neither admin nor facilitator.

### Layout

```
┌─────────────────────────────────────────────────────┐
│  [Group Selector Dropdown]        [Your Role: Admin] │
├─────────────────────────────────────────────────────┤
│                                                      │
│  Group: "Alignment Alpacas" (Cohort: Jan 2025)      │
│                                                      │
│  ┌─────────────────────────────────────────────────┐│
│  │ User          │ Progress │ Time   │ Last Active ││
│  ├───────────────┼──────────┼────────┼─────────────┤│
│  │ Alice         │ 5/8      │ 2h 15m │ 2 hours ago ││
│  │ Bob           │ 3/8      │ 1h 30m │ 3 days ago  ││
│  │ Carol         │ 8/8 ✓    │ 4h 10m │ 1 day ago   ││
│  └─────────────────────────────────────────────────┘│
│                                                      │
└─────────────────────────────────────────────────────┘
```

### Group Selector Logic

- Admin: shows all groups, optionally grouped by cohort
- Facilitator: shows only their groups

### User Detail View

Clicking a user opens detail view (modal or separate page):

**Progress Tab:**
- Per-lesson breakdown: lesson name, time spent, completed?
- Per-stage breakdown: article (12 min), video (8 min), chat (15 min)

**Chat History Tab:**
- List of chat sessions by lesson, most recent first
- Metadata: when started, duration, completed?
- Expandable conversation view (read-only)

```
┌─────────────────────────────────────────────────────┐
│ Lesson: Intro to AI Safety                          │
│ Chat started: Jan 5, 2025 • Duration: 15 min        │
│ ┌─────────────────────────────────────────────────┐ │
│ │ User: What's the difference between...         │ │
│ │ Assistant: Great question! The key...          │ │
│ │ User: So if I understand correctly...          │ │
│ └─────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────┤
│ Lesson: Mesa-optimization                           │
│ [Collapsed - click to expand]                       │
└─────────────────────────────────────────────────────┘
```

## Backend Queries

### New Module: `core/queries/progress.py`

```python
async def get_user_progress_for_group(user_id: int, group_id: int):
    """
    Returns progress for a user within a group's cohort context.

    Returns:
        {
            "lessons": [
                {
                    "lesson_id": "intro-to-alignment",
                    "completed": True,
                    "time_spent_seconds": 1234,
                    "stages": [
                        {"stage_index": 0, "stage_type": "article", "time_spent_seconds": 720},
                        {"stage_index": 1, "stage_type": "video", "time_spent_seconds": 480},
                        {"stage_index": 2, "stage_type": "chat", "time_spent_seconds": 900},
                    ]
                },
                ...
            ],
            "total_time_seconds": 5678,
            "last_active_at": "2025-01-10T14:30:00Z"
        }
    """
    pass

async def get_group_members_summary(group_id: int):
    """
    Returns summary for all members of a group.

    Returns:
        [
            {
                "user_id": 123,
                "name": "Alice",
                "lessons_completed": 5,
                "total_lessons": 8,
                "total_time_seconds": 8100,
                "last_active_at": "2025-01-10T14:30:00Z"
            },
            ...
        ]
    """
    pass
```

## Access Control

### Admin Assignment

Manual database entry only (for alpha):

```sql
INSERT INTO roles_users (user_id, role, granted_at)
VALUES (123, 'admin', NOW());
```

### Facilitator Assignment

Already handled by `groups_users.role = 'facilitator'` when groups are formed.

## Privacy Considerations

- First-party analytics (our backend) = no cookie consent required
- Disclose time tracking in privacy policy
- Data stays on our servers, not shared with third parties

## Future Enhancements (Post-Alpha)

- Aggregate statistics per group (average completion time, dropout rates)
- Intervention triggers ("alert when user inactive for X days")
- Search across chat conversations
- Annotatable conversations (facilitator can flag for follow-up)
- Admin UI to grant/revoke roles
