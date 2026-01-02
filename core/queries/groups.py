"""Group-related database queries using SQLAlchemy Core."""

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from ..tables import cohorts, courses, groups, groups_users, users
from ..enums import GroupUserRole


async def create_group(
    conn: AsyncConnection,
    cohort_id: int,
    group_name: str,
    recurring_meeting_time_utc: str,
) -> dict[str, Any]:
    """
    Create a new group and return the created record.

    Args:
        cohort_id: The cohort this group belongs to
        group_name: Display name (e.g., "Group 1")
        recurring_meeting_time_utc: Meeting time (e.g., "Wednesday 15:00")
    """
    result = await conn.execute(
        insert(groups)
        .values(
            cohort_id=cohort_id,
            group_name=group_name,
            recurring_meeting_time_utc=recurring_meeting_time_utc,
            status="forming",
        )
        .returning(groups)
    )
    row = result.mappings().first()
    return dict(row)


async def add_user_to_group(
    conn: AsyncConnection,
    group_id: int,
    user_id: int,
    role: str = "participant",
) -> dict[str, Any]:
    """Add a user to a group with specified role."""
    result = await conn.execute(
        insert(groups_users)
        .values(
            group_id=group_id,
            user_id=user_id,
            role=role,
            status="active",
        )
        .returning(groups_users)
    )
    row = result.mappings().first()
    return dict(row)


async def get_cohort_groups_for_realization(
    conn: AsyncConnection,
    cohort_id: int,
) -> dict[str, Any] | None:
    """
    Get structured data for realizing a cohort's groups in Discord.

    Returns:
        {
            "cohort_id": 1,
            "cohort_name": "AI Safety - Jan 2025",
            "course_name": "AI Safety Fundamentals",
            "cohort_start_date": date,
            "number_of_group_meetings": 8,
            "discord_category_id": None,  # or existing ID
            "groups": [
                {
                    "group_id": 1,
                    "group_name": "Group 1",
                    "recurring_meeting_time_utc": "Wednesday 15:00",
                    "discord_text_channel_id": None,
                    "discord_voice_channel_id": None,
                    "members": [
                        {"user_id": 1, "discord_id": "123", "nickname": "Alice", "role": "facilitator", "timezone": "UTC"},
                        ...
                    ]
                },
                ...
            ]
        }
    """
    # Get cohort info
    cohort_query = (
        select(cohorts, courses.c.course_name)
        .join(courses, cohorts.c.course_id == courses.c.course_id)
        .where(cohorts.c.cohort_id == cohort_id)
    )
    cohort_result = await conn.execute(cohort_query)
    cohort_row = cohort_result.mappings().first()

    if not cohort_row:
        return None

    # Get groups for this cohort
    groups_query = (
        select(groups)
        .where(groups.c.cohort_id == cohort_id)
        .order_by(groups.c.group_id)
    )
    groups_result = await conn.execute(groups_query)
    groups_list = []

    for group_row in groups_result.mappings():
        group_data = dict(group_row)

        # Get members for this group
        members_query = (
            select(
                users.c.user_id,
                users.c.discord_id,
                users.c.nickname,
                users.c.discord_username,
                users.c.timezone,
                groups_users.c.role,
            )
            .join(groups_users, users.c.user_id == groups_users.c.user_id)
            .where(groups_users.c.group_id == group_data["group_id"])
            .where(groups_users.c.status == "active")
        )
        members_result = await conn.execute(members_query)
        members = []
        for member_row in members_result.mappings():
            member = dict(member_row)
            # Use nickname if set, otherwise discord_username
            member["name"] = member.get("nickname") or member.get("discord_username") or f"User {member['user_id']}"
            members.append(member)

        groups_list.append({
            "group_id": group_data["group_id"],
            "group_name": group_data["group_name"],
            "recurring_meeting_time_utc": group_data["recurring_meeting_time_utc"],
            "discord_text_channel_id": group_data["discord_text_channel_id"],
            "discord_voice_channel_id": group_data["discord_voice_channel_id"],
            "members": members,
        })

    return {
        "cohort_id": cohort_row["cohort_id"],
        "cohort_name": cohort_row["cohort_name"],
        "course_name": cohort_row["course_name"],
        "cohort_start_date": cohort_row["cohort_start_date"],
        "number_of_group_meetings": cohort_row["number_of_group_meetings"],
        "discord_category_id": cohort_row["discord_category_id"],
        "groups": groups_list,
    }


async def save_discord_channel_ids(
    conn: AsyncConnection,
    group_id: int,
    text_channel_id: str,
    voice_channel_id: str,
) -> None:
    """Update group with Discord channel IDs after realization."""
    await conn.execute(
        update(groups)
        .where(groups.c.group_id == group_id)
        .values(
            discord_text_channel_id=text_channel_id,
            discord_voice_channel_id=voice_channel_id,
            updated_at=datetime.now(timezone.utc),
        )
    )


async def get_realized_groups_for_discord_user(
    conn: AsyncConnection,
    discord_id: str,
) -> list[dict[str, Any]]:
    """
    Get all realized groups (with Discord channels) for a user by their Discord ID.

    Used by on_member_join to grant channel permissions when a user joins the guild.

    Returns:
        [
            {
                "group_id": 1,
                "group_name": "Group 1",
                "discord_text_channel_id": "123456789",
                "discord_voice_channel_id": "987654321",
            },
            ...
        ]
    """
    # Find user by discord_id
    user_query = select(users.c.user_id).where(users.c.discord_id == discord_id)
    user_result = await conn.execute(user_query)
    user_row = user_result.first()

    if not user_row:
        return []

    user_id = user_row[0]

    # Get groups where user is a member AND group has been realized
    query = (
        select(
            groups.c.group_id,
            groups.c.group_name,
            groups.c.discord_text_channel_id,
            groups.c.discord_voice_channel_id,
        )
        .join(groups_users, groups.c.group_id == groups_users.c.group_id)
        .where(groups_users.c.user_id == user_id)
        .where(groups_users.c.status == "active")
        .where(groups.c.discord_text_channel_id.isnot(None))  # Only realized groups
    )
    result = await conn.execute(query)

    return [dict(row) for row in result.mappings()]


async def get_group_welcome_data(
    conn: AsyncConnection,
    group_id: int,
) -> dict[str, Any] | None:
    """
    Get structured data for welcome message.

    Returns:
        {
            "group_name": "Group 1",
            "cohort_name": "AI Safety - Jan 2025",
            "course_name": "AI Safety Fundamentals",
            "meeting_time_utc": "Wednesday 15:00",
            "cohort_start_date": date,
            "number_of_group_meetings": 8,
            "members": [
                {"name": "Alice", "discord_id": "123", "role": "facilitator", "timezone": "America/New_York"},
                ...
            ]
        }
    """
    # Get group with cohort and course info
    query = (
        select(
            groups.c.group_id,
            groups.c.group_name,
            groups.c.recurring_meeting_time_utc,
            cohorts.c.cohort_name,
            cohorts.c.cohort_start_date,
            cohorts.c.number_of_group_meetings,
            courses.c.course_name,
        )
        .join(cohorts, groups.c.cohort_id == cohorts.c.cohort_id)
        .join(courses, cohorts.c.course_id == courses.c.course_id)
        .where(groups.c.group_id == group_id)
    )
    result = await conn.execute(query)
    row = result.mappings().first()

    if not row:
        return None

    # Get members
    members_query = (
        select(
            users.c.discord_id,
            users.c.nickname,
            users.c.discord_username,
            users.c.timezone,
            groups_users.c.role,
        )
        .join(groups_users, users.c.user_id == groups_users.c.user_id)
        .where(groups_users.c.group_id == group_id)
        .where(groups_users.c.status == "active")
    )
    members_result = await conn.execute(members_query)
    members = []
    for member_row in members_result.mappings():
        member = dict(member_row)
        member["name"] = member.get("nickname") or member.get("discord_username") or "Unknown"
        members.append(member)

    return {
        "group_name": row["group_name"],
        "cohort_name": row["cohort_name"],
        "course_name": row["course_name"],
        "meeting_time_utc": row["recurring_meeting_time_utc"],
        "cohort_start_date": row["cohort_start_date"],
        "number_of_group_meetings": row["number_of_group_meetings"],
        "members": members,
    }
