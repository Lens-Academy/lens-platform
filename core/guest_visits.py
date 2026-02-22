"""
Guest visit business logic.

Allows users to attend a meeting with a different group in the same cohort
(same meeting number) as a guest. Their home meeting is marked not_attending.
"""

import logging
from datetime import datetime, timezone

from sqlalchemy import and_, delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncConnection

from .enums import GroupUserStatus, RSVPStatus
from .tables import attendances, groups, groups_users, meetings, users

logger = logging.getLogger(__name__)


async def find_alternative_meetings(
    conn: AsyncConnection,
    user_id: int,
    meeting_id: int,
) -> list[dict]:
    """
    Find meetings from other groups in the same cohort with the same meeting_number.

    These are the meetings the user could attend as a guest instead of their
    own group's meeting.

    Args:
        conn: Database connection.
        user_id: The user looking for alternatives.
        meeting_id: The user's home meeting they want to skip.

    Returns:
        List of alternative meeting dicts with group_name and facilitator_name.
    """
    # 1. Get the home meeting details
    home_query = select(
        meetings.c.group_id,
        meetings.c.cohort_id,
        meetings.c.meeting_number,
    ).where(meetings.c.meeting_id == meeting_id)
    home_result = await conn.execute(home_query)
    home = home_result.mappings().first()

    if not home:
        return []

    home_group_id = home["group_id"]
    home_cohort_id = home["cohort_id"]
    home_meeting_number = home["meeting_number"]

    # 2. Get the user's current active group (to confirm membership)
    user_group_query = (
        select(groups_users.c.group_id)
        .where(groups_users.c.user_id == user_id)
        .where(groups_users.c.status == GroupUserStatus.active)
        .join(groups, groups_users.c.group_id == groups.c.group_id)
        .where(groups.c.cohort_id == home_cohort_id)
    )
    user_group_result = await conn.execute(user_group_query)
    user_group = user_group_result.mappings().first()

    if not user_group:
        return []

    # 3. Facilitator name subquery
    facilitator_subq = (
        select(
            groups_users.c.group_id,
            func.coalesce(users.c.nickname, users.c.discord_username).label(
                "facilitator_name"
            ),
        )
        .join(users, groups_users.c.user_id == users.c.user_id)
        .where(groups_users.c.role == "facilitator")
        .where(groups_users.c.status == GroupUserStatus.active)
        .subquery()
    )

    # 4. Find alternative meetings: same cohort, same meeting_number, different group, in the future
    now = datetime.now(timezone.utc)
    alt_query = (
        select(
            meetings.c.meeting_id,
            meetings.c.group_id,
            meetings.c.scheduled_at,
            meetings.c.meeting_number,
            groups.c.group_name,
            facilitator_subq.c.facilitator_name,
        )
        .join(groups, meetings.c.group_id == groups.c.group_id)
        .outerjoin(facilitator_subq, meetings.c.group_id == facilitator_subq.c.group_id)
        .where(
            and_(
                meetings.c.cohort_id == home_cohort_id,
                meetings.c.meeting_number == home_meeting_number,
                meetings.c.group_id != home_group_id,
                meetings.c.scheduled_at > now,
            )
        )
        .order_by(meetings.c.scheduled_at)
    )

    result = await conn.execute(alt_query)
    alternatives = []
    for row in result.mappings():
        alt = dict(row)
        alt["scheduled_at"] = alt["scheduled_at"].isoformat()
        alternatives.append(alt)

    return alternatives


async def create_guest_visit(
    conn: AsyncConnection,
    user_id: int,
    home_meeting_id: int,
    host_meeting_id: int,
) -> dict:
    """
    Create a guest visit: attend a different group's meeting as a guest.

    1. Validates both meetings exist and are compatible (same cohort, same meeting_number,
       different groups).
    2. Validates user belongs to the home group.
    3. Checks no existing guest visit for this meeting_number.
    4. Inserts guest attendance on host meeting (is_guest=True).
    5. Upserts home attendance as not_attending.

    Args:
        conn: Database connection (should be in a transaction).
        user_id: The user creating the guest visit.
        home_meeting_id: The user's own group meeting they'll miss.
        host_meeting_id: The other group's meeting they'll attend.

    Returns:
        Success dict with host_meeting_id, host_group_id, host_scheduled_at, home_group_id.

    Raises:
        ValueError: If validation fails (own group, same cohort, same meeting number,
                    not a member, existing visit).
    """
    # 1. Fetch both meetings
    home_query = select(
        meetings.c.meeting_id,
        meetings.c.group_id,
        meetings.c.cohort_id,
        meetings.c.meeting_number,
        meetings.c.scheduled_at,
    ).where(meetings.c.meeting_id == home_meeting_id)
    home_result = await conn.execute(home_query)
    home = home_result.mappings().first()

    host_query = select(
        meetings.c.meeting_id,
        meetings.c.group_id,
        meetings.c.cohort_id,
        meetings.c.meeting_number,
        meetings.c.scheduled_at,
    ).where(meetings.c.meeting_id == host_meeting_id)
    host_result = await conn.execute(host_query)
    host = host_result.mappings().first()

    if not home or not host:
        raise ValueError("meeting not found")

    # 2. Validate: not own group
    if home["group_id"] == host["group_id"]:
        raise ValueError("own group")

    # 3. Validate: same cohort
    if home["cohort_id"] != host["cohort_id"]:
        raise ValueError("same cohort")

    # 4. Validate: same meeting_number
    if home["meeting_number"] != host["meeting_number"]:
        raise ValueError("same meeting number")

    # 5. Validate: user belongs to home group
    membership_query = (
        select(groups_users.c.group_user_id)
        .where(groups_users.c.user_id == user_id)
        .where(groups_users.c.group_id == home["group_id"])
        .where(groups_users.c.status == GroupUserStatus.active)
    )
    membership_result = await conn.execute(membership_query)
    membership = membership_result.mappings().first()

    if not membership:
        raise ValueError("not a member")

    # 6. Check: no existing guest visit for this meeting_number in this cohort
    existing_query = (
        select(attendances.c.attendance_id)
        .join(meetings, attendances.c.meeting_id == meetings.c.meeting_id)
        .where(
            and_(
                attendances.c.user_id == user_id,
                attendances.c.is_guest == True,  # noqa: E712
                meetings.c.cohort_id == home["cohort_id"],
                meetings.c.meeting_number == home["meeting_number"],
            )
        )
    )
    existing_result = await conn.execute(existing_query)
    existing = existing_result.mappings().first()

    if existing:
        raise ValueError("existing visit")

    # 7. Insert guest attendance on host meeting (ON CONFLICT DO NOTHING)
    guest_stmt = insert(attendances).values(
        meeting_id=host_meeting_id,
        user_id=user_id,
        is_guest=True,
        rsvp_status=RSVPStatus.attending,
        rsvp_at=func.now(),
    )
    guest_stmt = guest_stmt.on_conflict_do_nothing(
        constraint="attendances_meeting_user_unique",
    )
    await conn.execute(guest_stmt)

    # 8. Upsert home attendance as not_attending
    home_stmt = insert(attendances).values(
        meeting_id=home_meeting_id,
        user_id=user_id,
        rsvp_status=RSVPStatus.not_attending,
        rsvp_at=func.now(),
    )
    home_stmt = home_stmt.on_conflict_do_update(
        constraint="attendances_meeting_user_unique",
        set_={
            "rsvp_status": RSVPStatus.not_attending,
            "rsvp_at": func.now(),
        },
    )
    await conn.execute(home_stmt)

    logger.info(
        f"Guest visit created: user {user_id} visiting meeting {host_meeting_id} "
        f"(home meeting {home_meeting_id})"
    )

    return {
        "host_meeting_id": host_meeting_id,
        "host_group_id": host["group_id"],
        "host_scheduled_at": host["scheduled_at"].isoformat(),
        "home_group_id": home["group_id"],
    }


async def cancel_guest_visit(
    conn: AsyncConnection,
    user_id: int,
    host_meeting_id: int,
) -> dict:
    """
    Cancel a guest visit: remove guest attendance and reset home RSVP.

    Args:
        conn: Database connection (should be in a transaction).
        user_id: The user cancelling.
        host_meeting_id: The host meeting to cancel the guest visit for.

    Returns:
        Success dict with host_group_id and home_group_id.

    Raises:
        ValueError: If no guest attendance found or meeting already started.
    """
    # 1. Find guest attendance
    guest_query = select(
        attendances.c.attendance_id,
        attendances.c.meeting_id,
    ).where(
        and_(
            attendances.c.user_id == user_id,
            attendances.c.meeting_id == host_meeting_id,
            attendances.c.is_guest == True,  # noqa: E712
        )
    )
    guest_result = await conn.execute(guest_query)
    guest = guest_result.mappings().first()

    if not guest:
        raise ValueError("guest attendance not found")

    # 2. Get host meeting details
    host_query = select(
        meetings.c.meeting_id,
        meetings.c.group_id,
        meetings.c.cohort_id,
        meetings.c.meeting_number,
        meetings.c.scheduled_at,
    ).where(meetings.c.meeting_id == host_meeting_id)
    host_result = await conn.execute(host_query)
    host = host_result.mappings().first()

    if not host:
        raise ValueError("meeting not found")

    # 3. Check meeting hasn't started
    now = datetime.now(timezone.utc)
    if host["scheduled_at"] <= now:
        raise ValueError("already started")

    # 4. Delete guest attendance
    delete_stmt = delete(attendances).where(
        and_(
            attendances.c.attendance_id == guest["attendance_id"],
        )
    )
    await conn.execute(delete_stmt)

    # 5. Find home meeting (same cohort, same meeting_number, user's group)
    user_group_query = (
        select(groups_users.c.group_id)
        .where(groups_users.c.user_id == user_id)
        .where(groups_users.c.status == GroupUserStatus.active)
        .join(groups, groups_users.c.group_id == groups.c.group_id)
        .where(groups.c.cohort_id == host["cohort_id"])
    )
    user_group_result = await conn.execute(user_group_query)
    user_group = user_group_result.mappings().first()

    home_group_id = user_group["group_id"] if user_group else None

    if user_group:
        home_meeting_query = select(meetings.c.meeting_id).where(
            and_(
                meetings.c.group_id == user_group["group_id"],
                meetings.c.cohort_id == host["cohort_id"],
                meetings.c.meeting_number == host["meeting_number"],
            )
        )
        home_meeting_result = await conn.execute(home_meeting_query)
        home_meeting = home_meeting_result.mappings().first()

        # 6. Reset home attendance to pending
        if home_meeting:
            reset_stmt = insert(attendances).values(
                meeting_id=home_meeting["meeting_id"],
                user_id=user_id,
                rsvp_status=RSVPStatus.pending,
                rsvp_at=func.now(),
            )
            reset_stmt = reset_stmt.on_conflict_do_update(
                constraint="attendances_meeting_user_unique",
                set_={
                    "rsvp_status": RSVPStatus.pending,
                    "rsvp_at": func.now(),
                },
            )
            await conn.execute(reset_stmt)

    logger.info(
        f"Guest visit cancelled: user {user_id} no longer visiting meeting {host_meeting_id}"
    )

    return {
        "host_group_id": host["group_id"],
        "home_group_id": home_group_id,
    }


async def get_user_guest_visits(
    conn: AsyncConnection,
    user_id: int,
) -> list[dict]:
    """
    Get all guest visits for a user (attending as guest).

    Returns visits with is_past and can_cancel computed fields.

    Args:
        conn: Database connection.
        user_id: The user to get visits for.

    Returns:
        List of guest visit dicts with meeting info, group info, and status flags.
    """
    now = datetime.now(timezone.utc)

    query = (
        select(
            attendances.c.attendance_id,
            meetings.c.meeting_id,
            meetings.c.group_id,
            meetings.c.scheduled_at,
            meetings.c.meeting_number,
            groups.c.group_name,
        )
        .join(meetings, attendances.c.meeting_id == meetings.c.meeting_id)
        .join(groups, meetings.c.group_id == groups.c.group_id)
        .where(
            and_(
                attendances.c.user_id == user_id,
                attendances.c.is_guest == True,  # noqa: E712
                attendances.c.rsvp_status == RSVPStatus.attending,
            )
        )
        .order_by(meetings.c.scheduled_at)
    )

    result = await conn.execute(query)
    visits = []
    for row in result.mappings():
        visit = dict(row)
        scheduled_at = visit["scheduled_at"]
        visit["is_past"] = scheduled_at <= now
        visit["can_cancel"] = scheduled_at > now
        visit["scheduled_at"] = scheduled_at.isoformat()
        visits.append(visit)

    return visits
