# Facilitator Panel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an admin/facilitator dashboard to view user progress, time spent, and chat history.

**Architecture:** Activity-based heartbeat tracking stored in `content_events` table, aggregated via SQL queries. Group-scoped API endpoints enforce access control. React frontend at `/facilitator` route.

**Tech Stack:** PostgreSQL (SQLAlchemy Core), FastAPI, React + TypeScript, TailwindCSS

**Design Doc:** `docs/plans/2026-01-11-facilitator-panel-design.md`

---

## Phase 1: Database Layer

### Task 1: Add content_events table

**Files:**
- Modify: `core/tables.py`
- Modify: `core/enums.py`

**Step 1: Add enums to `core/enums.py`**

Add after existing enums:

```python
class StageType(str, enum.Enum):
    article = "article"
    video = "video"
    chat = "chat"


class ContentEventType(str, enum.Enum):
    heartbeat = "heartbeat"
    start = "start"
    complete = "complete"
```

**Step 2: Add table to `core/tables.py`**

Add import at top (if not present):
```python
from core.enums import StageType, ContentEventType
```

Add table definition after `lesson_sessions` table:

```python
content_events = Table(
    "content_events",
    metadata,
    Column("event_id", Integer, primary_key=True, autoincrement=True),
    Column(
        "user_id",
        Integer,
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,  # Anonymous sessions allowed
    ),
    Column(
        "session_id",
        Integer,
        ForeignKey("lesson_sessions.session_id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("lesson_id", Text, nullable=False),
    Column("stage_index", Integer, nullable=False),
    Column(
        "stage_type",
        SQLEnum(StageType, name="stage_type_enum", create_type=True),
        nullable=False,
    ),
    Column(
        "event_type",
        SQLEnum(ContentEventType, name="content_event_type_enum", create_type=True),
        nullable=False,
    ),
    Column("timestamp", TIMESTAMP(timezone=True), server_default=func.now()),
    Column("metadata", JSONB, nullable=True),  # scroll_depth, video_time, etc.
    Index("idx_content_events_user_id", "user_id"),
    Index("idx_content_events_session_id", "session_id"),
    Index("idx_content_events_lesson_id", "lesson_id"),
    Index("idx_content_events_timestamp", "timestamp"),
)
```

**Step 3: Run migration**

```bash
# Connect to database and create table
python -c "
import asyncio
from core.database import get_engine
from core.tables import metadata

async def create():
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(metadata.create_all)
    print('Tables created')

asyncio.run(create())
"
```

**Step 4: Verify table exists**

```bash
# Check table was created (requires psql or database client)
python -c "
import asyncio
from core.database import get_connection

async def check():
    async with get_connection() as conn:
        result = await conn.execute('SELECT COUNT(*) FROM content_events')
        print('content_events table exists, count:', result.scalar())

asyncio.run(check())
"
```

---

## Phase 2: Backend Queries

### Task 2: Add facilitator access queries

**Files:**
- Create: `core/queries/facilitator.py`
- Modify: `core/queries/__init__.py`

**Step 1: Create `core/queries/facilitator.py`**

```python
"""Queries for facilitator panel access control."""

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from ..enums import UserRole
from ..tables import groups, groups_users, roles_users, users, cohorts


async def is_admin(conn: AsyncConnection, user_id: int) -> bool:
    """Check if user has admin role."""
    result = await conn.execute(
        select(roles_users.c.role_user_id).where(
            (roles_users.c.user_id == user_id) & (roles_users.c.role == UserRole.admin)
        )
    )
    return result.first() is not None


async def get_facilitator_group_ids(
    conn: AsyncConnection, user_id: int
) -> list[int]:
    """Get group IDs where user is a facilitator."""
    result = await conn.execute(
        select(groups_users.c.group_id).where(
            (groups_users.c.user_id == user_id)
            & (groups_users.c.role == "facilitator")
            & (groups_users.c.status == "active")
        )
    )
    return [row.group_id for row in result]


async def get_accessible_groups(
    conn: AsyncConnection, user_id: int
) -> list[dict[str, Any]]:
    """
    Get groups accessible to this user.

    Admins see all groups, facilitators see only their groups.
    """
    admin = await is_admin(conn, user_id)

    query = (
        select(
            groups.c.group_id,
            groups.c.group_name,
            groups.c.status,
            cohorts.c.cohort_id,
            cohorts.c.cohort_name,
            cohorts.c.cohort_start_date,
        )
        .join(cohorts, groups.c.cohort_id == cohorts.c.cohort_id)
        .where(groups.c.status.in_(["forming", "active", "completed"]))
        .order_by(cohorts.c.cohort_start_date.desc(), groups.c.group_name)
    )

    if not admin:
        # Facilitators only see their groups
        group_ids = await get_facilitator_group_ids(conn, user_id)
        if not group_ids:
            return []
        query = query.where(groups.c.group_id.in_(group_ids))

    result = await conn.execute(query)
    return [dict(row) for row in result.mappings()]


async def can_access_group(
    conn: AsyncConnection, user_id: int, group_id: int
) -> bool:
    """Check if user can access a specific group."""
    if await is_admin(conn, user_id):
        return True

    group_ids = await get_facilitator_group_ids(conn, user_id)
    return group_id in group_ids
```

**Step 2: Export in `core/queries/__init__.py`**

Add imports:
```python
from .facilitator import (
    is_admin,
    get_facilitator_group_ids,
    get_accessible_groups,
    can_access_group,
)
```

Add to `__all__` list:
```python
    "is_admin",
    "get_facilitator_group_ids",
    "get_accessible_groups",
    "can_access_group",
```

---

### Task 3: Add progress aggregation queries

**Files:**
- Create: `core/queries/progress.py`
- Modify: `core/queries/__init__.py`

**Step 1: Create `core/queries/progress.py`**

```python
"""Queries for user progress tracking and aggregation."""

from typing import Any

from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncConnection

from ..tables import (
    content_events,
    groups,
    groups_users,
    users,
    lesson_sessions,
    cohorts,
    courses_users,
)
from ..enums import ContentEventType

HEARTBEAT_INTERVAL_SECONDS = 30


async def get_group_members_summary(
    conn: AsyncConnection, group_id: int
) -> list[dict[str, Any]]:
    """
    Get progress summary for all members of a group.

    Returns list of members with lessons_completed, total_time, last_active.
    """
    # Get group's cohort to scope lesson progress
    group_result = await conn.execute(
        select(groups.c.cohort_id).where(groups.c.group_id == group_id)
    )
    group_row = group_result.first()
    if not group_row:
        return []
    cohort_id = group_row.cohort_id

    # Subquery: count heartbeats per user
    heartbeat_counts = (
        select(
            content_events.c.user_id,
            func.count(content_events.c.event_id).label("heartbeat_count"),
            func.max(content_events.c.timestamp).label("last_active_at"),
        )
        .where(content_events.c.event_type == ContentEventType.heartbeat)
        .group_by(content_events.c.user_id)
        .subquery()
    )

    # Subquery: count completed lessons per user
    completed_lessons = (
        select(
            lesson_sessions.c.user_id,
            func.count(lesson_sessions.c.session_id).label("lessons_completed"),
        )
        .where(lesson_sessions.c.completed_at.isnot(None))
        .group_by(lesson_sessions.c.user_id)
        .subquery()
    )

    # Main query: group members with stats
    query = (
        select(
            users.c.user_id,
            users.c.discord_username,
            users.c.nickname,
            func.coalesce(completed_lessons.c.lessons_completed, 0).label(
                "lessons_completed"
            ),
            (
                func.coalesce(heartbeat_counts.c.heartbeat_count, 0)
                * HEARTBEAT_INTERVAL_SECONDS
            ).label("total_time_seconds"),
            func.coalesce(
                heartbeat_counts.c.last_active_at, users.c.last_active_at
            ).label("last_active_at"),
        )
        .join(groups_users, users.c.user_id == groups_users.c.user_id)
        .outerjoin(heartbeat_counts, users.c.user_id == heartbeat_counts.c.user_id)
        .outerjoin(completed_lessons, users.c.user_id == completed_lessons.c.user_id)
        .where(
            (groups_users.c.group_id == group_id)
            & (groups_users.c.status == "active")
        )
        .order_by(users.c.discord_username)
    )

    result = await conn.execute(query)
    rows = []
    for row in result.mappings():
        rows.append({
            "user_id": row["user_id"],
            "name": row["nickname"] or row["discord_username"],
            "lessons_completed": row["lessons_completed"],
            "total_time_seconds": row["total_time_seconds"],
            "last_active_at": row["last_active_at"].isoformat() if row["last_active_at"] else None,
        })
    return rows


async def get_user_progress_for_group(
    conn: AsyncConnection, user_id: int, group_id: int
) -> dict[str, Any]:
    """
    Get detailed progress for a user within a group's cohort context.

    Returns per-lesson and per-stage breakdowns.
    """
    # Get group's cohort
    group_result = await conn.execute(
        select(groups.c.cohort_id).where(groups.c.group_id == group_id)
    )
    group_row = group_result.first()
    if not group_row:
        return {"lessons": [], "total_time_seconds": 0, "last_active_at": None}

    # Get user's lesson sessions
    sessions_result = await conn.execute(
        select(
            lesson_sessions.c.session_id,
            lesson_sessions.c.lesson_id,
            lesson_sessions.c.completed_at,
            lesson_sessions.c.started_at,
        ).where(lesson_sessions.c.user_id == user_id)
    )
    sessions = {row.lesson_id: dict(row._mapping) for row in sessions_result}

    # Get heartbeat counts per lesson/stage
    heartbeat_query = (
        select(
            content_events.c.lesson_id,
            content_events.c.stage_index,
            content_events.c.stage_type,
            func.count(content_events.c.event_id).label("heartbeat_count"),
        )
        .where(
            (content_events.c.user_id == user_id)
            & (content_events.c.event_type == ContentEventType.heartbeat)
        )
        .group_by(
            content_events.c.lesson_id,
            content_events.c.stage_index,
            content_events.c.stage_type,
        )
    )
    heartbeat_result = await conn.execute(heartbeat_query)

    # Organize by lesson
    lessons_map: dict[str, dict] = {}
    total_time = 0

    for row in heartbeat_result.mappings():
        lesson_id = row["lesson_id"]
        stage_time = row["heartbeat_count"] * HEARTBEAT_INTERVAL_SECONDS
        total_time += stage_time

        if lesson_id not in lessons_map:
            session = sessions.get(lesson_id, {})
            lessons_map[lesson_id] = {
                "lesson_id": lesson_id,
                "completed": session.get("completed_at") is not None,
                "time_spent_seconds": 0,
                "stages": [],
            }

        lessons_map[lesson_id]["time_spent_seconds"] += stage_time
        lessons_map[lesson_id]["stages"].append({
            "stage_index": row["stage_index"],
            "stage_type": row["stage_type"].value if hasattr(row["stage_type"], "value") else row["stage_type"],
            "time_spent_seconds": stage_time,
        })

    # Sort stages within each lesson
    for lesson in lessons_map.values():
        lesson["stages"].sort(key=lambda s: s["stage_index"])

    # Get last active
    last_active_result = await conn.execute(
        select(func.max(content_events.c.timestamp)).where(
            content_events.c.user_id == user_id
        )
    )
    last_active = last_active_result.scalar()

    return {
        "lessons": list(lessons_map.values()),
        "total_time_seconds": total_time,
        "last_active_at": last_active.isoformat() if last_active else None,
    }


async def get_user_chat_sessions(
    conn: AsyncConnection, user_id: int, group_id: int
) -> list[dict[str, Any]]:
    """
    Get chat sessions for a user.

    Returns lesson_sessions with messages, ordered by most recent.
    """
    result = await conn.execute(
        select(
            lesson_sessions.c.session_id,
            lesson_sessions.c.lesson_id,
            lesson_sessions.c.messages,
            lesson_sessions.c.started_at,
            lesson_sessions.c.completed_at,
            lesson_sessions.c.last_active_at,
        )
        .where(lesson_sessions.c.user_id == user_id)
        .order_by(lesson_sessions.c.last_active_at.desc())
    )

    sessions = []
    for row in result.mappings():
        # Calculate duration from heartbeats
        duration_result = await conn.execute(
            select(func.count(content_events.c.event_id)).where(
                (content_events.c.session_id == row["session_id"])
                & (content_events.c.stage_type == "chat")
                & (content_events.c.event_type == ContentEventType.heartbeat)
            )
        )
        heartbeat_count = duration_result.scalar() or 0

        sessions.append({
            "session_id": row["session_id"],
            "lesson_id": row["lesson_id"],
            "messages": row["messages"] or [],
            "started_at": row["started_at"].isoformat() if row["started_at"] else None,
            "completed_at": row["completed_at"].isoformat() if row["completed_at"] else None,
            "duration_seconds": heartbeat_count * HEARTBEAT_INTERVAL_SECONDS,
        })

    return sessions
```

**Step 2: Export in `core/queries/__init__.py`**

Add imports:
```python
from .progress import (
    get_group_members_summary,
    get_user_progress_for_group,
    get_user_chat_sessions,
)
```

Add to `__all__` list:
```python
    "get_group_members_summary",
    "get_user_progress_for_group",
    "get_user_chat_sessions",
```

---

## Phase 3: API Endpoints

### Task 4: Create facilitator API routes

**Files:**
- Create: `web_api/routes/facilitator.py`
- Modify: `main.py`

**Step 1: Create `web_api/routes/facilitator.py`**

```python
"""
Facilitator panel API routes.

Endpoints:
- GET /api/facilitator/groups - List accessible groups
- GET /api/facilitator/groups/{group_id}/members - List group members with progress
- GET /api/facilitator/groups/{group_id}/users/{user_id}/progress - User progress detail
- GET /api/facilitator/groups/{group_id}/users/{user_id}/chats - User chat sessions
"""

import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.database import get_connection
from core.queries.facilitator import (
    can_access_group,
    get_accessible_groups,
    is_admin,
)
from core.queries.progress import (
    get_group_members_summary,
    get_user_progress_for_group,
    get_user_chat_sessions,
)
from core.queries.users import get_user_by_discord_id
from web_api.auth import get_current_user

router = APIRouter(prefix="/api/facilitator", tags=["facilitator"])


async def get_db_user_or_403(discord_id: str):
    """Get database user, raise 403 if not found or not facilitator/admin."""
    async with get_connection() as conn:
        db_user = await get_user_by_discord_id(conn, discord_id)
        if not db_user:
            raise HTTPException(403, "User not found in database")

        # Check if user is admin or facilitator
        from core.queries.facilitator import get_facilitator_group_ids

        admin = await is_admin(conn, db_user["user_id"])
        facilitator_groups = await get_facilitator_group_ids(conn, db_user["user_id"])

        if not admin and not facilitator_groups:
            raise HTTPException(403, "Access denied: not an admin or facilitator")

        return db_user


@router.get("/groups")
async def list_groups(
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """
    List groups accessible to the current user.

    Admins see all groups, facilitators see only their groups.
    """
    discord_id = user["sub"]
    db_user = await get_db_user_or_403(discord_id)

    async with get_connection() as conn:
        groups = await get_accessible_groups(conn, db_user["user_id"])
        admin = await is_admin(conn, db_user["user_id"])

    return {
        "groups": groups,
        "is_admin": admin,
    }


@router.get("/groups/{group_id}/members")
async def list_group_members(
    group_id: int,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """
    List members of a group with progress summary.
    """
    discord_id = user["sub"]
    db_user = await get_db_user_or_403(discord_id)

    async with get_connection() as conn:
        if not await can_access_group(conn, db_user["user_id"], group_id):
            raise HTTPException(403, "Access denied to this group")

        members = await get_group_members_summary(conn, group_id)

    return {"members": members}


@router.get("/groups/{group_id}/users/{target_user_id}/progress")
async def get_user_progress(
    group_id: int,
    target_user_id: int,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Get detailed progress for a specific user within a group context.
    """
    discord_id = user["sub"]
    db_user = await get_db_user_or_403(discord_id)

    async with get_connection() as conn:
        if not await can_access_group(conn, db_user["user_id"], group_id):
            raise HTTPException(403, "Access denied to this group")

        progress = await get_user_progress_for_group(conn, target_user_id, group_id)

    return progress


@router.get("/groups/{group_id}/users/{target_user_id}/chats")
async def get_user_chats(
    group_id: int,
    target_user_id: int,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Get chat sessions for a specific user.
    """
    discord_id = user["sub"]
    db_user = await get_db_user_or_403(discord_id)

    async with get_connection() as conn:
        if not await can_access_group(conn, db_user["user_id"], group_id):
            raise HTTPException(403, "Access denied to this group")

        chats = await get_user_chat_sessions(conn, target_user_id, group_id)

    return {"chats": chats}
```

**Step 2: Register router in `main.py`**

Find the router imports section (around line 25-30) and add:
```python
from web_api.routes.facilitator import router as facilitator_router
```

Find where routers are included (around line 245) and add:
```python
app.include_router(facilitator_router)
```

**Step 3: Verify routes are registered**

```bash
python main.py --dev --no-bot &
sleep 3
curl -s http://localhost:8000/openapi.json | python -c "import sys,json; d=json.load(sys.stdin); print([p for p in d['paths'] if 'facilitator' in p])"
kill %1
```

Expected: List of facilitator routes.

---

### Task 5: Add heartbeat endpoint

**Files:**
- Modify: `web_api/routes/lessons.py`

**Step 1: Add heartbeat endpoint to `web_api/routes/lessons.py`**

Add imports at top:
```python
from core.tables import content_events
from core.enums import StageType, ContentEventType
from sqlalchemy import insert
```

Add Pydantic model:
```python
class HeartbeatRequest(BaseModel):
    """Request body for heartbeat tracking."""
    stage_index: int
    stage_type: str  # "article", "video", "chat"
    scroll_depth: float | None = None
    video_time: int | None = None
```

Add endpoint:
```python
@router.post("/lesson-sessions/{session_id}/heartbeat", status_code=204)
async def record_heartbeat(
    session_id: int,
    request: HeartbeatRequest,
    user: dict | None = Depends(get_optional_user),
):
    """
    Record an activity heartbeat for time tracking.

    Fire-and-forget from frontend - returns 204 No Content.
    """
    async with get_connection() as conn:
        # Get session to verify it exists and get lesson_id
        from core.lessons.sessions import get_session
        session = await get_session(conn, session_id)
        if not session:
            raise HTTPException(404, "Session not found")

        # Get user_id if authenticated
        user_id = None
        if user:
            from core.queries.users import get_user_by_discord_id
            db_user = await get_user_by_discord_id(conn, user["sub"])
            if db_user:
                user_id = db_user["user_id"]

        # Build metadata
        metadata = {}
        if request.scroll_depth is not None:
            metadata["scroll_depth"] = request.scroll_depth
        if request.video_time is not None:
            metadata["video_time"] = request.video_time

        # Insert heartbeat
        await conn.execute(
            insert(content_events).values(
                user_id=user_id,
                session_id=session_id,
                lesson_id=session["lesson_id"],
                stage_index=request.stage_index,
                stage_type=request.stage_type,
                event_type=ContentEventType.heartbeat,
                metadata=metadata if metadata else None,
            )
        )
        await conn.commit()

    return None  # 204 No Content
```

---

## Phase 4: Frontend - Activity Tracker

### Task 6: Create activity tracker hook

**Files:**
- Create: `web_frontend/src/hooks/useActivityTracker.ts`

**Step 1: Create the hook**

```typescript
import { useEffect, useRef, useCallback } from "react";
import { API_URL } from "../config";

interface ActivityTrackerOptions {
  sessionId: number;
  lessonId: string;
  stageIndex: number;
  stageType: "article" | "video" | "chat";
  inactivityTimeout?: number; // ms, default 180000 (3 min)
  heartbeatInterval?: number; // ms, default 30000 (30 sec)
  enabled?: boolean;
}

export function useActivityTracker({
  sessionId,
  lessonId,
  stageIndex,
  stageType,
  inactivityTimeout = 180_000,
  heartbeatInterval = 30_000,
  enabled = true,
}: ActivityTrackerOptions) {
  const isActiveRef = useRef(false);
  const lastActivityRef = useRef(Date.now());
  const heartbeatIntervalRef = useRef<number | null>(null);
  const scrollDepthRef = useRef(0);

  const sendHeartbeat = useCallback(async () => {
    if (!enabled) return;

    try {
      await fetch(`${API_URL}/api/lesson-sessions/${sessionId}/heartbeat`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage_index: stageIndex,
          stage_type: stageType,
          scroll_depth: stageType === "article" ? scrollDepthRef.current : null,
        }),
      });
    } catch (error) {
      // Fire-and-forget, ignore errors
      console.debug("Heartbeat failed:", error);
    }
  }, [sessionId, stageIndex, stageType, enabled]);

  const handleActivity = useCallback(() => {
    lastActivityRef.current = Date.now();

    if (!isActiveRef.current) {
      isActiveRef.current = true;
      // Send immediate heartbeat when becoming active
      sendHeartbeat();
    }
  }, [sendHeartbeat]);

  const handleScroll = useCallback(() => {
    handleActivity();

    // Track scroll depth for articles
    if (stageType === "article") {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight > 0) {
        scrollDepthRef.current = Math.min(1, scrollTop / docHeight);
      }
    }
  }, [handleActivity, stageType]);

  useEffect(() => {
    if (!enabled) return;

    // Activity listeners
    const events = ["scroll", "mousemove", "keydown"];
    events.forEach((event) => {
      window.addEventListener(event, handleActivity, { passive: true });
    });
    window.addEventListener("scroll", handleScroll, { passive: true });

    // Visibility change
    const handleVisibility = () => {
      if (document.hidden) {
        isActiveRef.current = false;
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    // Heartbeat interval
    heartbeatIntervalRef.current = window.setInterval(() => {
      const timeSinceActivity = Date.now() - lastActivityRef.current;

      if (timeSinceActivity > inactivityTimeout) {
        isActiveRef.current = false;
      }

      if (isActiveRef.current) {
        sendHeartbeat();
      }
    }, heartbeatInterval);

    // Initial activity
    handleActivity();

    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, handleActivity);
      });
      window.removeEventListener("scroll", handleScroll);
      document.removeEventListener("visibilitychange", handleVisibility);

      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
    };
  }, [
    enabled,
    handleActivity,
    handleScroll,
    sendHeartbeat,
    heartbeatInterval,
    inactivityTimeout,
  ]);

  // Manual activity trigger (for video play events)
  const triggerActivity = useCallback(() => {
    handleActivity();
  }, [handleActivity]);

  return { triggerActivity };
}
```

---

### Task 7: Create video activity tracker hook

**Files:**
- Create: `web_frontend/src/hooks/useVideoActivityTracker.ts`

**Step 1: Create the hook**

```typescript
import { useEffect, useRef, useCallback } from "react";
import { API_URL } from "../config";

interface VideoActivityTrackerOptions {
  sessionId: number;
  lessonId: string;
  stageIndex: number;
  heartbeatInterval?: number; // ms, default 30000
  enabled?: boolean;
}

export function useVideoActivityTracker({
  sessionId,
  lessonId,
  stageIndex,
  heartbeatInterval = 30_000,
  enabled = true,
}: VideoActivityTrackerOptions) {
  const isPlayingRef = useRef(false);
  const videoTimeRef = useRef(0);
  const heartbeatIntervalRef = useRef<number | null>(null);

  const sendHeartbeat = useCallback(async () => {
    if (!enabled || !isPlayingRef.current) return;

    try {
      await fetch(`${API_URL}/api/lesson-sessions/${sessionId}/heartbeat`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage_index: stageIndex,
          stage_type: "video",
          video_time: Math.floor(videoTimeRef.current),
        }),
      });
    } catch (error) {
      console.debug("Video heartbeat failed:", error);
    }
  }, [sessionId, stageIndex, enabled]);

  useEffect(() => {
    if (!enabled) return;

    heartbeatIntervalRef.current = window.setInterval(() => {
      if (isPlayingRef.current) {
        sendHeartbeat();
      }
    }, heartbeatInterval);

    return () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
    };
  }, [enabled, sendHeartbeat, heartbeatInterval]);

  const onPlay = useCallback(() => {
    isPlayingRef.current = true;
    sendHeartbeat(); // Immediate heartbeat on play
  }, [sendHeartbeat]);

  const onPause = useCallback(() => {
    isPlayingRef.current = false;
  }, []);

  const onTimeUpdate = useCallback((currentTime: number) => {
    videoTimeRef.current = currentTime;
  }, []);

  return { onPlay, onPause, onTimeUpdate };
}
```

---

## Phase 5: Frontend - Facilitator Panel

### Task 8: Create facilitator page types

**Files:**
- Create: `web_frontend/src/types/facilitator.ts`

**Step 1: Create type definitions**

```typescript
export interface FacilitatorGroup {
  group_id: number;
  group_name: string;
  status: string;
  cohort_id: number;
  cohort_name: string;
  cohort_start_date: string;
}

export interface GroupMember {
  user_id: number;
  name: string;
  lessons_completed: number;
  total_time_seconds: number;
  last_active_at: string | null;
}

export interface StageProgress {
  stage_index: number;
  stage_type: "article" | "video" | "chat";
  time_spent_seconds: number;
}

export interface LessonProgress {
  lesson_id: string;
  completed: boolean;
  time_spent_seconds: number;
  stages: StageProgress[];
}

export interface UserProgress {
  lessons: LessonProgress[];
  total_time_seconds: number;
  last_active_at: string | null;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatSession {
  session_id: number;
  lesson_id: string;
  messages: ChatMessage[];
  started_at: string | null;
  completed_at: string | null;
  duration_seconds: number;
}
```

---

### Task 9: Create facilitator page component

**Files:**
- Create: `web_frontend/src/pages/Facilitator.tsx`
- Modify: `web_frontend/src/App.tsx`

**Step 1: Create `web_frontend/src/pages/Facilitator.tsx`**

```tsx
import { useState, useEffect } from "react";
import { useAuth } from "../hooks/useAuth";
import { API_URL } from "../config";
import type {
  FacilitatorGroup,
  GroupMember,
  UserProgress,
  ChatSession,
} from "../types/facilitator";

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function formatTimeAgo(isoString: string | null): string {
  if (!isoString) return "Never";
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) return `${diffMins} minutes ago`;
  if (diffHours < 24) return `${diffHours} hours ago`;
  return `${diffDays} days ago`;
}

export default function Facilitator() {
  const { isAuthenticated, isLoading: authLoading, user, login } = useAuth();

  const [groups, setGroups] = useState<FacilitatorGroup[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [userProgress, setUserProgress] = useState<UserProgress | null>(null);
  const [userChats, setUserChats] = useState<ChatSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load groups on mount
  useEffect(() => {
    if (!user) return;

    const fetchGroups = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_URL}/api/facilitator/groups`, {
          credentials: "include",
        });
        if (!res.ok) {
          if (res.status === 403) {
            setError("Access denied. You must be an admin or facilitator.");
            return;
          }
          throw new Error("Failed to fetch groups");
        }
        const data = await res.json();
        setGroups(data.groups);
        setIsAdmin(data.is_admin);
        if (data.groups.length > 0) {
          setSelectedGroupId(data.groups[0].group_id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setIsLoading(false);
      }
    };

    fetchGroups();
  }, [user]);

  // Load members when group changes
  useEffect(() => {
    if (!selectedGroupId) return;

    const fetchMembers = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(
          `${API_URL}/api/facilitator/groups/${selectedGroupId}/members`,
          { credentials: "include" }
        );
        if (!res.ok) throw new Error("Failed to fetch members");
        const data = await res.json();
        setMembers(data.members);
        setSelectedUserId(null);
        setUserProgress(null);
        setUserChats([]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setIsLoading(false);
      }
    };

    fetchMembers();
  }, [selectedGroupId]);

  // Load user details when selected
  useEffect(() => {
    if (!selectedGroupId || !selectedUserId) return;

    const fetchUserDetails = async () => {
      setIsLoading(true);
      try {
        const [progressRes, chatsRes] = await Promise.all([
          fetch(
            `${API_URL}/api/facilitator/groups/${selectedGroupId}/users/${selectedUserId}/progress`,
            { credentials: "include" }
          ),
          fetch(
            `${API_URL}/api/facilitator/groups/${selectedGroupId}/users/${selectedUserId}/chats`,
            { credentials: "include" }
          ),
        ]);

        if (!progressRes.ok || !chatsRes.ok) {
          throw new Error("Failed to fetch user details");
        }

        const progressData = await progressRes.json();
        const chatsData = await chatsRes.json();

        setUserProgress(progressData);
        setUserChats(chatsData.chats);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setIsLoading(false);
      }
    };

    fetchUserDetails();
  }, [selectedGroupId, selectedUserId]);

  if (authLoading) {
    return (
      <div className="py-8 max-w-6xl mx-auto px-4">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="py-8 max-w-6xl mx-auto px-4">
        <h1 className="text-2xl font-bold mb-4">Facilitator Panel</h1>
        <p className="mb-4">Please log in to access the facilitator panel.</p>
        <button
          onClick={login}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          Log in with Discord
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-8 max-w-6xl mx-auto px-4">
        <h1 className="text-2xl font-bold mb-4">Facilitator Panel</h1>
        <div className="text-red-600">{error}</div>
      </div>
    );
  }

  const selectedGroup = groups.find((g) => g.group_id === selectedGroupId);
  const selectedMember = members.find((m) => m.user_id === selectedUserId);

  return (
    <div className="py-8 max-w-6xl mx-auto px-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Facilitator Panel</h1>
        <span className="text-sm text-gray-500">
          Role: {isAdmin ? "Admin" : "Facilitator"}
        </span>
      </div>

      {/* Group Selector */}
      <div className="mb-6">
        <label className="block text-sm font-medium mb-2">Select Group</label>
        <select
          value={selectedGroupId ?? ""}
          onChange={(e) => setSelectedGroupId(Number(e.target.value))}
          className="border rounded px-3 py-2 w-full max-w-md"
        >
          {groups.map((group) => (
            <option key={group.group_id} value={group.group_id}>
              {group.group_name} ({group.cohort_name})
            </option>
          ))}
        </select>
      </div>

      {selectedGroup && (
        <div className="mb-4 text-sm text-gray-600">
          Cohort: {selectedGroup.cohort_name} | Status: {selectedGroup.status}
        </div>
      )}

      {/* Members Table */}
      <div className="bg-white border rounded-lg overflow-hidden mb-6">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-4 py-3 font-medium">User</th>
              <th className="text-left px-4 py-3 font-medium">Progress</th>
              <th className="text-left px-4 py-3 font-medium">Time Spent</th>
              <th className="text-left px-4 py-3 font-medium">Last Active</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr
                key={member.user_id}
                onClick={() => setSelectedUserId(member.user_id)}
                className={`border-t cursor-pointer hover:bg-gray-50 ${
                  selectedUserId === member.user_id ? "bg-blue-50" : ""
                }`}
              >
                <td className="px-4 py-3">{member.name}</td>
                <td className="px-4 py-3">{member.lessons_completed} lessons</td>
                <td className="px-4 py-3">
                  {formatDuration(member.total_time_seconds)}
                </td>
                <td className="px-4 py-3">
                  {formatTimeAgo(member.last_active_at)}
                </td>
              </tr>
            ))}
            {members.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                  No members in this group
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* User Detail Panel */}
      {selectedUserId && selectedMember && (
        <div className="bg-white border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">{selectedMember.name}</h2>

          {/* Progress Tab */}
          <div className="mb-6">
            <h3 className="font-medium mb-3">Lesson Progress</h3>
            {userProgress && userProgress.lessons.length > 0 ? (
              <div className="space-y-3">
                {userProgress.lessons.map((lesson) => (
                  <div key={lesson.lesson_id} className="border rounded p-3">
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-medium">{lesson.lesson_id}</span>
                      <span className="text-sm">
                        {lesson.completed ? "✓ Completed" : "In Progress"} |{" "}
                        {formatDuration(lesson.time_spent_seconds)}
                      </span>
                    </div>
                    <div className="flex gap-4 text-sm text-gray-600">
                      {lesson.stages.map((stage) => (
                        <span key={stage.stage_index}>
                          {stage.stage_type}: {formatDuration(stage.time_spent_seconds)}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500">No lesson progress recorded</p>
            )}
          </div>

          {/* Chat History Tab */}
          <div>
            <h3 className="font-medium mb-3">Chat History</h3>
            {userChats.length > 0 ? (
              <div className="space-y-4">
                {userChats.map((chat) => (
                  <details key={chat.session_id} className="border rounded">
                    <summary className="px-4 py-3 cursor-pointer hover:bg-gray-50">
                      <span className="font-medium">{chat.lesson_id}</span>
                      <span className="text-sm text-gray-500 ml-2">
                        {chat.started_at
                          ? new Date(chat.started_at).toLocaleDateString()
                          : "Unknown date"}{" "}
                        | Duration: {formatDuration(chat.duration_seconds)}
                      </span>
                    </summary>
                    <div className="px-4 py-3 border-t bg-gray-50 max-h-96 overflow-y-auto">
                      {chat.messages.map((msg, idx) => (
                        <div
                          key={idx}
                          className={`mb-3 ${
                            msg.role === "user" ? "text-blue-800" : "text-gray-700"
                          }`}
                        >
                          <span className="font-medium capitalize">
                            {msg.role}:
                          </span>{" "}
                          {msg.content}
                        </div>
                      ))}
                      {chat.messages.length === 0 && (
                        <p className="text-gray-500">No messages</p>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            ) : (
              <p className="text-gray-500">No chat sessions recorded</p>
            )}
          </div>
        </div>
      )}

      {isLoading && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center">
          <div className="bg-white px-6 py-4 rounded shadow">Loading...</div>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Add route to `web_frontend/src/App.tsx`**

Add import at top:
```tsx
import Facilitator from "./pages/Facilitator";
```

Add route inside the `<Route element={<Layout />}>` section:
```tsx
<Route path="/facilitator" element={<Facilitator />} />
```

---

### Task 10: Add navigation link (optional)

**Files:**
- Modify: `web_frontend/src/components/Layout.tsx` (if exists) or wherever nav is defined

Find the navigation component and add a link:

```tsx
<Link to="/facilitator" className="...">
  Facilitator Panel
</Link>
```

This can be conditionally shown based on user role, but for alpha a simple link is fine.

---

## Phase 6: Integration

### Task 11: Integrate activity tracker into lesson components

**Files:**
- Modify: Existing lesson/article/video/chat components

This task depends on the existing component structure. The pattern is:

**For article stages:**
```tsx
import { useActivityTracker } from "../hooks/useActivityTracker";

function ArticleStage({ sessionId, lessonId, stageIndex }) {
  useActivityTracker({
    sessionId,
    lessonId,
    stageIndex,
    stageType: "article",
    inactivityTimeout: 180_000, // 3 minutes
  });

  return <article>...</article>;
}
```

**For video stages:**
```tsx
import { useVideoActivityTracker } from "../hooks/useVideoActivityTracker";

function VideoStage({ sessionId, lessonId, stageIndex }) {
  const { onPlay, onPause, onTimeUpdate } = useVideoActivityTracker({
    sessionId,
    lessonId,
    stageIndex,
  });

  return (
    <video
      onPlay={onPlay}
      onPause={onPause}
      onTimeUpdate={(e) => onTimeUpdate(e.currentTarget.currentTime)}
    >
      ...
    </video>
  );
}
```

**For chat stages:**
```tsx
import { useActivityTracker } from "../hooks/useActivityTracker";

function ChatStage({ sessionId, lessonId, stageIndex }) {
  const { triggerActivity } = useActivityTracker({
    sessionId,
    lessonId,
    stageIndex,
    stageType: "chat",
    inactivityTimeout: 300_000, // 5 minutes
  });

  const handleSendMessage = () => {
    triggerActivity();
    // ... send message logic
  };

  return <div>...</div>;
}
```

---

## Phase 7: Testing

### Task 12: Test the complete flow

**Step 1: Start the dev server**
```bash
python main.py --dev
```

**Step 2: Manually assign yourself as admin**
```sql
-- Run in database client
INSERT INTO roles_users (user_id, role, granted_at)
SELECT user_id, 'admin', NOW()
FROM users
WHERE discord_username = 'your_username';
```

**Step 3: Test API endpoints**
```bash
# After logging in via the web UI to get auth cookie
curl -b cookies.txt http://localhost:8000/api/facilitator/groups
```

**Step 4: Test the UI**
1. Navigate to `http://localhost:5173/facilitator`
2. Verify groups load
3. Select a group, verify members load
4. Click a member, verify progress and chats load

**Step 5: Test heartbeat tracking**
1. Open a lesson page
2. Check browser Network tab for heartbeat requests every 30s
3. Verify heartbeats appear in `content_events` table

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| 1 | 1 | Database: `content_events` table |
| 2 | 2-3 | Backend queries: access control + progress aggregation |
| 3 | 4-5 | API endpoints: facilitator routes + heartbeat |
| 4 | 6-7 | Frontend: activity tracker hooks |
| 5 | 8-10 | Frontend: facilitator panel page |
| 6 | 11 | Integration: wire up trackers to lesson components |
| 7 | 12 | Testing: end-to-end verification |

Total: ~12 tasks, can be parallelized (Phase 2-3 backend, Phase 4-5 frontend).
