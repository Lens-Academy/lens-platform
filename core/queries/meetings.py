"""Database queries for meetings."""

from datetime import datetime

from sqlalchemy import select, insert, update, delete, func
from sqlalchemy.ext.asyncio import AsyncConnection

from ..tables import meetings, groups, groups_users, users


async def create_meeting(
    conn: AsyncConnection,
    group_id: int,
    cohort_id: int,
    scheduled_at: datetime,
    meeting_number: int,
) -> int:
    """
    Create a meeting record.

    Returns:
        The new meeting_id
    """
    result = await conn.execute(
        insert(meetings)
        .values(
            group_id=group_id,
            cohort_id=cohort_id,
            scheduled_at=scheduled_at,
            meeting_number=meeting_number,
        )
        .returning(meetings.c.meeting_id)
    )
    return result.scalar_one()


async def get_meetings_for_group(
    conn: AsyncConnection,
    group_id: int,
) -> list[dict]:
    """Get all meetings for a group, ordered by meeting number."""
    result = await conn.execute(
        select(meetings)
        .where(meetings.c.group_id == group_id)
        .order_by(meetings.c.meeting_number)
    )
    return [dict(row._mapping) for row in result]


async def get_meeting(
    conn: AsyncConnection,
    meeting_id: int,
) -> dict | None:
    """Get a single meeting by ID."""
    result = await conn.execute(
        select(meetings).where(meetings.c.meeting_id == meeting_id)
    )
    row = result.first()
    return dict(row._mapping) if row else None


async def reschedule_meeting(
    conn: AsyncConnection,
    meeting_id: int,
    new_time: datetime,
) -> None:
    """Update meeting scheduled time."""
    await conn.execute(
        update(meetings)
        .where(meetings.c.meeting_id == meeting_id)
        .values(
            scheduled_at=new_time,
            updated_at=func.now(),
        )
    )


async def get_group_member_emails(
    conn: AsyncConnection,
    group_id: int,
) -> list[str]:
    """Get email addresses for all members of a group."""
    result = await conn.execute(
        select(users.c.email)
        .select_from(
            groups_users.join(users, groups_users.c.user_id == users.c.user_id)
        )
        .where(groups_users.c.group_id == group_id)
        .where(users.c.email.isnot(None))
    )
    return [row.email for row in result]


async def get_group_member_user_ids(
    conn: AsyncConnection,
    group_id: int,
) -> list[int]:
    """Get user IDs for all members of a group."""
    result = await conn.execute(
        select(groups_users.c.user_id).where(groups_users.c.group_id == group_id)
    )
    return [row.user_id for row in result]


async def get_meeting_dates_for_user(
    conn: AsyncConnection,
    user_id: int,
) -> dict[int, str]:
    """Get meeting dates for user's active group as {meeting_number: iso_date}."""
    from ..enums import GroupUserStatus

    # Find user's active group
    group_result = await conn.execute(
        select(groups_users.c.group_id).where(
            groups_users.c.user_id == user_id,
            groups_users.c.status == GroupUserStatus.active,
        )
    )
    group_row = group_result.first()
    if not group_row:
        return {}

    # Get all meetings for the group
    result = await conn.execute(
        select(meetings.c.meeting_number, meetings.c.scheduled_at)
        .where(meetings.c.group_id == group_row.group_id)
        .order_by(meetings.c.meeting_number)
    )

    return {
        row.meeting_number: row.scheduled_at.isoformat()
        for row in result
        if row.meeting_number is not None
    }


async def delete_meeting(
    conn: AsyncConnection,
    meeting_id: int,
) -> None:
    """Delete a meeting row. Attendance records cascade-delete via FK."""
    await conn.execute(delete(meetings).where(meetings.c.meeting_id == meeting_id))


async def renumber_meetings_after_delete(
    conn: AsyncConnection,
    group_id: int,
    deleted_meeting_number: int,
) -> None:
    """Decrement meeting_number for all meetings after the deleted one."""
    await conn.execute(
        update(meetings)
        .where(meetings.c.group_id == group_id)
        .where(meetings.c.meeting_number > deleted_meeting_number)
        .values(
            meeting_number=meetings.c.meeting_number - 1,
            updated_at=func.now(),
        )
    )


async def get_last_meeting_for_group(
    conn: AsyncConnection,
    group_id: int,
) -> dict | None:
    """Get the meeting with the highest meeting_number for a group."""
    result = await conn.execute(
        select(meetings)
        .where(meetings.c.group_id == group_id)
        .order_by(meetings.c.meeting_number.desc())
        .limit(1)
    )
    row = result.first()
    return dict(row._mapping) if row else None


async def get_group_for_meeting(
    conn: AsyncConnection,
    meeting_id: int,
) -> dict | None:
    """Get the group that a meeting belongs to."""
    result = await conn.execute(
        select(groups)
        .select_from(meetings.join(groups, meetings.c.group_id == groups.c.group_id))
        .where(meetings.c.meeting_id == meeting_id)
    )
    row = result.first()
    return dict(row._mapping) if row else None


async def get_future_meetings_for_group(
    conn: AsyncConnection,
    group_id: int,
) -> list[dict]:
    """Get all future meetings for a group."""
    from datetime import timezone

    now = datetime.now(timezone.utc)

    result = await conn.execute(
        select(meetings)
        .where(meetings.c.group_id == group_id)
        .where(meetings.c.scheduled_at > now)
        .order_by(meetings.c.scheduled_at)
    )

    return [dict(row) for row in result.mappings()]
