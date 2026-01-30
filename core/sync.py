"""
Sync operations for group membership.

Provides functions to sync external systems (Discord, Google Calendar,
APScheduler reminders, RSVPs) with the current group membership state.

All sync functions are diff-based and idempotent - they compare desired
state with actual state and only make changes for differences.

Main entry points:
- sync_group(group_id) - Sync all systems for a single group
- sync_after_group_change(group_id, previous_group_id) - Sync after membership change

Individual sync functions:
- sync_group_discord_permissions(group_id) - Discord channel access
- sync_group_calendar(group_id) - Google Calendar event attendees
- sync_group_reminders(group_id) - APScheduler reminder jobs
- sync_group_rsvps(group_id) - RSVP records from calendar
"""

import logging
from datetime import datetime
from typing import Any

import sentry_sdk

logger = logging.getLogger(__name__)


# ============================================================================
# SYNC FUNCTIONS - Diff-based, used for both normal flow and recovery
# ============================================================================


async def _ensure_cohort_category(cohort_id: int) -> dict:
    """
    Ensure cohort has a Discord category. Check if exists, create if missing.

    Returns:
        {"status": "existed"|"created"|"channel_missing"|"failed", "id": str|None, "error"?: str}
    """
    from .database import get_connection, get_transaction
    from .discord_outbound import get_bot
    from .tables import cohorts
    from .modules.course_loader import load_course
    from sqlalchemy import select, update

    _bot = get_bot()
    if not _bot:
        return {"status": "failed", "error": "bot_unavailable", "id": None}

    async with get_connection() as conn:
        result = await conn.execute(
            select(
                cohorts.c.cohort_id,
                cohorts.c.cohort_name,
                cohorts.c.course_slug,
                cohorts.c.discord_category_id,
            ).where(cohorts.c.cohort_id == cohort_id)
        )
        cohort = result.mappings().first()

    if not cohort:
        return {"status": "failed", "error": "cohort_not_found", "id": None}

    # Check if category already exists
    if cohort["discord_category_id"]:
        category = _bot.get_channel(int(cohort["discord_category_id"]))
        if category:
            return {"status": "existed", "id": cohort["discord_category_id"]}
        else:
            # DB has ID but Discord doesn't have the channel - flag for review
            return {"status": "channel_missing", "id": cohort["discord_category_id"]}

    # No category ID in DB - need to create
    # Get guild from bot (assumes single guild)
    guilds = list(_bot.guilds)
    if not guilds:
        return {"status": "failed", "error": "no_guild", "id": None}
    guild = guilds[0]

    # Build category name
    course = load_course(cohort["course_slug"])
    category_name = f"{course.title} - {cohort['cohort_name']}"[:100]

    try:
        category = await guild.create_category(
            name=category_name,
            reason=f"Realizing cohort {cohort_id}",
        )
        # Hide from everyone by default
        await category.set_permissions(guild.default_role, view_channel=False)

        # Save category ID to database
        async with get_transaction() as conn:
            await conn.execute(
                update(cohorts)
                .where(cohorts.c.cohort_id == cohort_id)
                .values(discord_category_id=str(category.id))
            )

        return {"status": "created", "id": str(category.id)}
    except Exception as e:
        logger.error(f"Failed to create category for cohort {cohort_id}: {e}")
        sentry_sdk.capture_exception(e)
        return {"status": "failed", "error": str(e), "id": None}


async def _ensure_group_channels(group_id: int, category) -> dict:
    """
    Ensure group has text and voice channels. Create if missing.

    Args:
        group_id: The group to check/create channels for
        category: Discord category to create channels in (required for creation)

    Returns:
        {
            "text_channel": {"status": "existed"|"created"|"channel_missing"|"failed", "id": str|None},
            "voice_channel": {"status": "existed"|"created"|"channel_missing"|"failed", "id": str|None},
            "welcome_message_sent": bool,
        }
    """
    from .database import get_connection, get_transaction
    from .discord_outbound import get_bot
    from .tables import groups
    from sqlalchemy import select, update

    _bot = get_bot()
    result = {
        "text_channel": {"status": "skipped", "id": None},
        "voice_channel": {"status": "skipped", "id": None},
        "welcome_message_sent": False,
    }

    if not _bot:
        result["text_channel"] = {
            "status": "failed",
            "error": "bot_unavailable",
            "id": None,
        }
        result["voice_channel"] = {
            "status": "failed",
            "error": "bot_unavailable",
            "id": None,
        }
        return result

    async with get_connection() as conn:
        group_result = await conn.execute(
            select(
                groups.c.group_id,
                groups.c.group_name,
                groups.c.discord_text_channel_id,
                groups.c.discord_voice_channel_id,
                groups.c.cohort_id,
            ).where(groups.c.group_id == group_id)
        )
        group = group_result.mappings().first()

    if not group:
        result["text_channel"] = {
            "status": "failed",
            "error": "group_not_found",
            "id": None,
        }
        result["voice_channel"] = {
            "status": "failed",
            "error": "group_not_found",
            "id": None,
        }
        return result

    group_name = group["group_name"]
    text_channel = None
    voice_channel = None
    text_created = False

    # Check/create text channel
    if group["discord_text_channel_id"]:
        text_channel = _bot.get_channel(int(group["discord_text_channel_id"]))
        if text_channel:
            result["text_channel"] = {
                "status": "existed",
                "id": group["discord_text_channel_id"],
            }
        else:
            result["text_channel"] = {
                "status": "channel_missing",
                "id": group["discord_text_channel_id"],
            }
    elif category:
        try:
            text_channel = await category.guild.create_text_channel(
                name=group_name.lower().replace(" ", "-"),
                category=category,
                reason=f"Group channel for {group_name}",
            )
            result["text_channel"] = {"status": "created", "id": str(text_channel.id)}
            text_created = True
        except Exception as e:
            logger.error(f"Failed to create text channel for group {group_id}: {e}")
            sentry_sdk.capture_exception(e)
            result["text_channel"] = {"status": "failed", "error": str(e), "id": None}

    # Check/create voice channel
    if group["discord_voice_channel_id"]:
        voice_channel = _bot.get_channel(int(group["discord_voice_channel_id"]))
        if voice_channel:
            result["voice_channel"] = {
                "status": "existed",
                "id": group["discord_voice_channel_id"],
            }
        else:
            result["voice_channel"] = {
                "status": "channel_missing",
                "id": group["discord_voice_channel_id"],
            }
    elif category:
        try:
            voice_channel = await category.guild.create_voice_channel(
                name=f"{group_name} Voice",
                category=category,
                reason=f"Voice channel for {group_name}",
            )
            result["voice_channel"] = {"status": "created", "id": str(voice_channel.id)}
        except Exception as e:
            logger.error(f"Failed to create voice channel for group {group_id}: {e}")
            sentry_sdk.capture_exception(e)
            result["voice_channel"] = {"status": "failed", "error": str(e), "id": None}

    # Save channel IDs to database if any were created
    text_id = (
        result["text_channel"].get("id")
        if result["text_channel"]["status"] in ("created", "existed")
        else None
    )
    voice_id = (
        result["voice_channel"].get("id")
        if result["voice_channel"]["status"] in ("created", "existed")
        else None
    )

    if text_id or voice_id:
        update_values = {}
        if text_id and result["text_channel"]["status"] == "created":
            update_values["discord_text_channel_id"] = text_id
        if voice_id and result["voice_channel"]["status"] == "created":
            update_values["discord_voice_channel_id"] = voice_id

        if update_values:
            async with get_transaction() as conn:
                await conn.execute(
                    update(groups)
                    .where(groups.c.group_id == group_id)
                    .values(**update_values)
                )

    # Send welcome message if text channel was just created
    if text_created and text_channel:
        try:
            await _send_channel_welcome_message(text_channel, group_id)
            result["welcome_message_sent"] = True
        except Exception as e:
            logger.error(f"Failed to send welcome message for group {group_id}: {e}")

    return result


async def _send_channel_welcome_message(channel, group_id: int) -> None:
    """Send welcome message to newly created group channel."""
    from .database import get_connection
    from .queries.groups import get_group_welcome_data

    async with get_connection() as conn:
        data = await get_group_welcome_data(conn, group_id)

    if not data:
        return

    member_lines = []
    for member in data["members"]:
        discord_id = member.get("discord_id")
        role = member.get("role", "participant")
        role_badge = " (Facilitator)" if role == "facilitator" else ""
        if discord_id:
            member_lines.append(f"- <@{discord_id}>{role_badge}")
        else:
            member_lines.append(f"- {member.get('name', 'Unknown')}{role_badge}")

    meeting_time = data.get("meeting_time_utc", "TBD")

    message = f"""**Welcome to {data["group_name"]}!**

**Course:** {data.get("cohort_name", "AI Safety")}

**Your group:**
{chr(10).join(member_lines)}

**Meeting time (UTC):** {meeting_time}
**Number of meetings:** {data.get("number_of_group_meetings", 8)}

**Getting started:**
1. Introduce yourself!
2. Check your scheduled events
3. Prepare for Week 1

Questions? Ask in this channel. We're here to help each other learn!
"""
    await channel.send(message)


async def _ensure_group_meetings(group_id: int) -> dict:
    """
    Ensure meeting records exist for the group. Create if missing.

    Returns:
        {"created": int, "existed": int, "error"?: str}
    """
    from .database import get_connection
    from .tables import groups, meetings, cohorts
    from .meetings import create_meetings_for_group
    from sqlalchemy import select, func

    async with get_connection() as conn:
        # Get group info
        group_result = await conn.execute(
            select(
                groups.c.group_id,
                groups.c.group_name,
                groups.c.recurring_meeting_time_utc,
                groups.c.cohort_id,
                groups.c.discord_voice_channel_id,
            ).where(groups.c.group_id == group_id)
        )
        group = group_result.mappings().first()

        if not group:
            return {"created": 0, "existed": 0, "error": "group_not_found"}

        # Count existing meetings
        count_result = await conn.execute(
            select(func.count())
            .select_from(meetings)
            .where(meetings.c.group_id == group_id)
        )
        existing_count = count_result.scalar() or 0

        if existing_count > 0:
            return {"created": 0, "existed": existing_count}

        # No meetings - need to create them
        # Get cohort info for start date and meeting count
        cohort_result = await conn.execute(
            select(
                cohorts.c.cohort_start_date,
                cohorts.c.number_of_group_meetings,
            ).where(cohorts.c.cohort_id == group["cohort_id"])
        )
        cohort = cohort_result.mappings().first()

        if not cohort:
            return {"created": 0, "existed": 0, "error": "cohort_not_found"}

    # Parse meeting time to calculate first meeting
    meeting_time_str = group.get("recurring_meeting_time_utc", "")
    if not meeting_time_str or meeting_time_str == "TBD":
        return {"created": 0, "existed": 0, "error": "no_meeting_time"}

    first_meeting = _calculate_first_meeting(
        cohort["cohort_start_date"],
        meeting_time_str,
    )

    if not first_meeting:
        return {"created": 0, "existed": 0, "error": "invalid_meeting_time"}

    num_meetings = cohort.get("number_of_group_meetings", 8)

    # Create meeting records
    try:
        meeting_ids = await create_meetings_for_group(
            group_id=group_id,
            cohort_id=group["cohort_id"],
            group_name=group["group_name"],
            first_meeting=first_meeting,
            num_meetings=num_meetings,
            discord_voice_channel_id=group.get("discord_voice_channel_id") or "",
        )
        return {"created": len(meeting_ids), "existed": 0}
    except Exception as e:
        logger.error(f"Failed to create meetings for group {group_id}: {e}")
        sentry_sdk.capture_exception(e)
        return {"created": 0, "existed": 0, "error": str(e)}


def _calculate_first_meeting(start_date, meeting_time_str: str) -> datetime | None:
    """Calculate first meeting datetime from cohort start date and meeting time string."""
    from datetime import datetime, timedelta
    import pytz

    if isinstance(start_date, str):
        start_date = datetime.fromisoformat(start_date).date()

    day_names = [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
    ]
    day_num = None
    hour = None
    minute = 0

    for i, day in enumerate(day_names):
        if day in meeting_time_str:
            day_num = i
            parts = meeting_time_str.split()
            for part in parts:
                if ":" in part:
                    time_parts = part.split(":")
                    hour = int(time_parts[0])
                    minute = int(
                        time_parts[1].split("-")[0]
                    )  # Handle "15:00-16:00" format
                    break
            break

    if day_num is None or hour is None:
        return None

    first_meeting = datetime.combine(start_date, datetime.min.time())
    first_meeting = first_meeting.replace(hour=hour, minute=minute, tzinfo=pytz.UTC)

    days_ahead = day_num - first_meeting.weekday()
    if days_ahead < 0:
        days_ahead += 7
    first_meeting += timedelta(days=days_ahead)

    return first_meeting


async def _ensure_meeting_discord_events(group_id: int, voice_channel) -> dict:
    """
    Ensure Discord scheduled events exist for all future meetings.

    Args:
        group_id: The group to create events for
        voice_channel: Discord voice channel for the events (None to skip)

    Returns:
        {"created": int, "existed": int, "skipped": int, "failed": int}
    """
    from .database import get_connection, get_transaction
    from .tables import meetings, groups
    from datetime import datetime, timezone, timedelta
    from sqlalchemy import select, update
    import discord

    result = {"created": 0, "existed": 0, "skipped": 0, "failed": 0}

    if not voice_channel:
        # Can't create events without voice channel
        return result

    async with get_connection() as conn:
        # Get group name for event titles
        group_result = await conn.execute(
            select(groups.c.group_name).where(groups.c.group_id == group_id)
        )
        group_row = group_result.mappings().first()
        group_name = group_row["group_name"] if group_row else f"Group {group_id}"

        # Get all future meetings
        now = datetime.now(timezone.utc)
        meetings_result = await conn.execute(
            select(
                meetings.c.meeting_id,
                meetings.c.discord_event_id,
                meetings.c.scheduled_at,
                meetings.c.meeting_number,
            )
            .where(meetings.c.group_id == group_id)
            .where(meetings.c.scheduled_at > now)
            .order_by(meetings.c.scheduled_at)
        )
        meeting_rows = list(meetings_result.mappings())

    if not meeting_rows:
        return result

    guild = voice_channel.guild

    for meeting in meeting_rows:
        if meeting["discord_event_id"]:
            result["existed"] += 1
            continue

        # Skip if meeting is in the past (edge case)
        if meeting["scheduled_at"] < datetime.now(timezone.utc):
            result["skipped"] += 1
            continue

        try:
            event = await guild.create_scheduled_event(
                name=f"{group_name} - Week {meeting['meeting_number']}",
                start_time=meeting["scheduled_at"],
                end_time=meeting["scheduled_at"] + timedelta(hours=1),
                channel=voice_channel,
                description=f"Weekly meeting for {group_name}",
                entity_type=discord.EntityType.voice,
                privacy_level=discord.PrivacyLevel.guild_only,
            )

            # Save event ID to database
            async with get_transaction() as conn:
                await conn.execute(
                    update(meetings)
                    .where(meetings.c.meeting_id == meeting["meeting_id"])
                    .values(discord_event_id=str(event.id))
                )

            result["created"] += 1
        except Exception as e:
            logger.error(
                f"Failed to create event for meeting {meeting['meeting_id']}: {e}"
            )
            sentry_sdk.capture_exception(e)
            result["failed"] += 1

    return result


def _is_fully_realized(infrastructure: dict, discord_result: dict) -> bool:
    """Check if group is fully realized and ready to be active."""
    required = ["category", "text_channel", "voice_channel"]
    for key in required:
        info = infrastructure.get(key, {})
        if info.get("status") not in ("existed", "created"):
            return False

    meetings = infrastructure.get("meetings", {})
    if meetings.get("created", 0) + meetings.get("existed", 0) == 0:
        return False

    # At least one member must have access
    granted = discord_result.get("granted", 0)
    unchanged = discord_result.get("unchanged", 0)
    if granted + unchanged == 0:
        return False

    return True


async def _update_group_status(group_id: int, status: str) -> None:
    """Update group status in database."""
    from .database import get_transaction
    from .tables import groups
    from .enums import GroupStatus
    from datetime import datetime, timezone
    from sqlalchemy import update

    status_enum = GroupStatus(status)
    async with get_transaction() as conn:
        await conn.execute(
            update(groups)
            .where(groups.c.group_id == group_id)
            .values(status=status_enum, updated_at=datetime.now(timezone.utc))
        )


async def _get_notification_context(
    group_id: int, discord_channel_id: str | None = None
) -> dict:
    """
    Fetch all data needed for notifications.

    Returns:
        {
            "group_name": str,
            "meeting_time_utc": str,
            "discord_channel_id": str,
            "members": [{"name": str, "discord_id": str, "user_id": int}, ...],
            "member_names": [str, ...],
        }
    """
    from .database import get_connection
    from .queries.groups import get_group_welcome_data
    from .tables import groups, users, groups_users
    from .enums import GroupUserStatus
    from sqlalchemy import select

    async with get_connection() as conn:
        # Get group welcome data (has most of what we need)
        welcome_data = await get_group_welcome_data(conn, group_id)

        if not welcome_data:
            return {}

        # Also need user_ids for the granted users
        # Get user_id -> discord_id mapping for members
        member_query = (
            select(
                users.c.user_id,
                users.c.discord_id,
                users.c.nickname,
                users.c.discord_username,
            )
            .join(groups_users, users.c.user_id == groups_users.c.user_id)
            .where(groups_users.c.group_id == group_id)
            .where(groups_users.c.status == GroupUserStatus.active)
        )
        result = await conn.execute(member_query)
        member_rows = list(result.mappings())

        # If no discord_channel_id provided, try to get from DB
        if not discord_channel_id:
            channel_result = await conn.execute(
                select(groups.c.discord_text_channel_id).where(
                    groups.c.group_id == group_id
                )
            )
            row = channel_result.scalar()
            discord_channel_id = row or ""

    # Build member list with user_ids
    members_with_ids = []
    for row in member_rows:
        members_with_ids.append(
            {
                "user_id": row["user_id"],
                "discord_id": row["discord_id"],
                "name": row.get("nickname") or row.get("discord_username") or "Unknown",
            }
        )

    return {
        "group_name": welcome_data["group_name"],
        "meeting_time_utc": welcome_data.get("meeting_time_utc")
        or welcome_data.get("recurring_meeting_time_utc")
        or "TBD",
        "discord_channel_id": discord_channel_id,
        "members": members_with_ids,
        "member_names": [m["name"] for m in members_with_ids],
    }


async def _send_sync_notifications(
    group_id: int,
    granted_discord_ids: list[int],
    revoked_discord_ids: list[int],
    is_initial_realization: bool,
    notification_context: dict,
) -> dict:
    """
    Send notifications based on sync results.

    Args:
        group_id: The group being synced
        granted_discord_ids: Discord user IDs (from Discord API) who were granted access
        revoked_discord_ids: Discord user IDs who were revoked access (unused, for future)
        is_initial_realization: True if this is the group's first realization
        notification_context: Dict with group_name, meeting_time_utc, discord_channel_id, members
    """
    from .notifications.dispatcher import was_notification_sent
    from .notifications.actions import notify_group_assigned, notify_member_joined
    from .discord_outbound import send_channel_message
    from .enums import NotificationReferenceType

    result = {"sent": 0, "skipped": 0, "channel_announcements": 0}

    if not notification_context:
        logger.warning(
            f"No notification context for group {group_id}, skipping notifications"
        )
        return result

    group_name = notification_context.get("group_name", "Unknown Group")
    meeting_time_utc = notification_context.get("meeting_time_utc", "TBD")
    discord_channel_id = notification_context.get("discord_channel_id", "")
    member_names = notification_context.get("member_names", [])
    members_by_discord_id = {
        int(m["discord_id"]): m
        for m in notification_context.get("members", [])
        if m.get("discord_id")
    }

    for discord_id in granted_discord_ids:
        member_info = members_by_discord_id.get(discord_id, {})
        user_id = member_info.get("user_id")

        if not user_id:
            logger.warning(
                f"No user_id found for discord_id {discord_id}, skipping notification"
            )
            continue

        already_notified = await was_notification_sent(
            user_id=user_id,
            message_type="group_assigned",
            reference_type=NotificationReferenceType.group_id,
            reference_id=group_id,
        )

        if already_notified:
            result["skipped"] += 1
            continue

        discord_user_id = str(member_info.get("discord_id", ""))

        try:
            if is_initial_realization:
                # Long welcome message for initial realization
                await notify_group_assigned(
                    user_id=user_id,
                    group_name=group_name,
                    meeting_time_utc=meeting_time_utc,
                    member_names=member_names,
                    discord_channel_id=discord_channel_id,
                    reference_type=NotificationReferenceType.group_id,
                    reference_id=group_id,
                )
            else:
                # Short "you joined" message for late join (DM to user)
                await notify_member_joined(
                    user_id=user_id,
                    group_name=group_name,
                    meeting_time_utc=meeting_time_utc,
                    member_names=member_names,
                    discord_channel_id=discord_channel_id,
                    discord_user_id=discord_user_id,
                )

                # Also send channel announcement for late joins
                if discord_channel_id and discord_user_id:
                    try:
                        user_name = member_info.get("name", "Someone")
                        await send_channel_message(
                            channel_id=discord_channel_id,
                            message=f"**Welcome {user_name}!** <@{discord_user_id}> has joined the group.",
                        )
                        result["channel_announcements"] += 1
                    except Exception as e:
                        logger.warning(
                            f"Failed to send channel announcement for user {user_id}: {e}"
                        )

            result["sent"] += 1
        except Exception as e:
            logger.error(f"Failed to send notification to user {user_id}: {e}")
            sentry_sdk.capture_exception(e)

    return result


async def _get_group_for_sync(group_id: int) -> dict | None:
    """Fetch group data needed for sync decisions."""
    from .database import get_connection
    from .tables import groups
    from sqlalchemy import select

    async with get_connection() as conn:
        result = await conn.execute(
            select(
                groups.c.group_id,
                groups.c.status,
                groups.c.discord_text_channel_id,
                groups.c.discord_voice_channel_id,
                groups.c.cohort_id,
            ).where(groups.c.group_id == group_id)
        )
        row = result.mappings().first()
        return dict(row) if row else None


async def _get_group_member_count(group_id: int) -> int:
    """Get count of active members in a group."""
    from .database import get_connection
    from .tables import groups_users
    from .enums import GroupUserStatus
    from sqlalchemy import select, func

    async with get_connection() as conn:
        result = await conn.execute(
            select(func.count())
            .select_from(groups_users)
            .where(groups_users.c.group_id == group_id)
            .where(groups_users.c.status == GroupUserStatus.active)
        )
        return result.scalar() or 0


async def sync_group_discord_permissions(group_id: int) -> dict:
    """
    Sync Discord channel permissions with DB membership (diff-based).

    Syncs BOTH text and voice channels:
    1. Reads current permission overwrites from Discord
    2. Compares with active members from DB
    3. Only grants/revokes for the diff

    Idempotent and efficient - no API calls if nothing changed.

    Returns dict with counts: {"granted": N, "revoked": N, "unchanged": N, "failed": N}
    """
    from .database import get_connection
    from .discord_outbound import (
        get_bot,
        get_or_fetch_member,
        get_members_with_access,
        grant_channel_access,
        revoke_channel_access,
    )
    from .tables import groups, groups_users, users
    from .enums import GroupUserStatus
    from sqlalchemy import select

    _bot = get_bot()
    if not _bot:
        logger.warning("Bot not available for Discord sync")
        return {"error": "bot_unavailable"}

    async with get_connection() as conn:
        # Get group's Discord channels (both text and voice)
        group_result = await conn.execute(
            select(
                groups.c.discord_text_channel_id,
                groups.c.discord_voice_channel_id,
            ).where(groups.c.group_id == group_id)
        )
        group_row = group_result.mappings().first()
        if not group_row or not group_row.get("discord_text_channel_id"):
            logger.warning(f"Group {group_id} has no Discord channel")
            return {"error": "no_channel"}

        text_channel_id = int(group_row["discord_text_channel_id"])
        voice_channel_id = (
            int(group_row["discord_voice_channel_id"])
            if group_row.get("discord_voice_channel_id")
            else None
        )

        # Get all active members' Discord IDs from DB (who SHOULD have access)
        members_result = await conn.execute(
            select(users.c.discord_id)
            .join(groups_users, users.c.user_id == groups_users.c.user_id)
            .where(groups_users.c.group_id == group_id)
            .where(groups_users.c.status == GroupUserStatus.active)
            .where(users.c.discord_id.isnot(None))
        )
        expected_discord_ids = {row["discord_id"] for row in members_result.mappings()}

    # Get text channel
    text_channel = _bot.get_channel(text_channel_id)
    if not text_channel:
        logger.warning(f"Text channel {text_channel_id} not found in Discord")
        return {"error": "channel_not_found"}

    # Get voice channel (optional)
    voice_channel = _bot.get_channel(voice_channel_id) if voice_channel_id else None

    # Get current permission overwrites from text channel (who CURRENTLY has access)
    current_discord_ids = get_members_with_access(text_channel)

    # Calculate diff
    to_grant = expected_discord_ids - current_discord_ids
    to_revoke = current_discord_ids - expected_discord_ids
    unchanged = expected_discord_ids & current_discord_ids

    granted, revoked, failed = 0, 0, 0
    granted_discord_ids = []
    revoked_discord_ids = []
    guild = text_channel.guild

    # Grant access to new members (both text and voice)
    for discord_id in to_grant:
        member = await get_or_fetch_member(guild, int(discord_id))
        if not member:
            logger.info(f"Member {discord_id} not in guild, skipping grant")
            continue
        success = await grant_channel_access(member, text_channel, voice_channel)
        if success:
            granted += 1
            granted_discord_ids.append(int(discord_id))
        else:
            failed += 1

    # Revoke access from removed members (both text and voice)
    for discord_id in to_revoke:
        member = await get_or_fetch_member(guild, int(discord_id))
        if not member:
            # Member left the server, no need to revoke
            continue
        success = await revoke_channel_access(member, text_channel, voice_channel)
        if success:
            revoked += 1
            revoked_discord_ids.append(int(discord_id))
        else:
            failed += 1

    return {
        "granted": granted,
        "revoked": revoked,
        "unchanged": len(unchanged),
        "failed": failed,
        "granted_discord_ids": granted_discord_ids,
        "revoked_discord_ids": revoked_discord_ids,
    }


async def sync_group_calendar(group_id: int) -> dict:
    """
    Sync calendar for a group using recurring events.

    Idempotent and self-healing:
    - Creates recurring event if none exists
    - Recreates if event was deleted in Google Calendar
    - Patches attendees if changed
    - Uses row locking to prevent duplicate event creation

    Returns dict with sync results.
    """
    import asyncio
    from .database import get_transaction
    from .tables import meetings, groups
    from .calendar.events import create_recurring_event
    from .calendar.client import batch_get_events, batch_patch_events
    from datetime import datetime, timezone
    from sqlalchemy import select, update

    result = {
        "meetings": 0,
        "created_recurring": False,
        "recurring_event_id": None,
        "patched": 0,
        "failed": 0,
    }

    # Use transaction with row lock to prevent race conditions.
    # CRITICAL: The SELECT FOR UPDATE lock is essential here - it prevents two concurrent
    # sync operations from both seeing gcal_recurring_event_id=None and creating duplicate
    # recurring events. The lock is held until the transaction commits.
    async with get_transaction() as conn:
        # Lock the group row to prevent concurrent event creation
        group_result = await conn.execute(
            select(
                groups.c.group_id,
                groups.c.group_name,
                groups.c.gcal_recurring_event_id,
                groups.c.cohort_id,
            )
            .where(groups.c.group_id == group_id)
            .with_for_update()
        )
        group = group_result.mappings().first()

        if not group:
            return {"error": "group_not_found", **result}

        # Get expected attendees
        expected_emails = await _get_group_member_emails(conn, group_id)

        if not expected_emails:
            return {"error": "no_members", **result}

        # Get future meetings to determine first meeting and count
        now = datetime.now(timezone.utc)
        meetings_result = await conn.execute(
            select(
                meetings.c.meeting_id,
                meetings.c.scheduled_at,
                meetings.c.meeting_number,
            )
            .where(meetings.c.group_id == group_id)
            .where(meetings.c.scheduled_at > now)
            .order_by(meetings.c.scheduled_at)
        )
        meeting_rows = list(meetings_result.mappings())

        if not meeting_rows:
            return {"reason": "no_future_meetings", **result}

        result["meetings"] = len(meeting_rows)
        result["recurring_event_id"] = group["gcal_recurring_event_id"]

        # --- Check if existing event still exists in Google Calendar ---
        events = None  # Initialize for use in PATCH section below
        if group["gcal_recurring_event_id"]:
            events = await asyncio.to_thread(
                batch_get_events, [group["gcal_recurring_event_id"]]
            )

            if events is None:
                # Calendar service not configured
                return {"error": "calendar_unavailable", **result}

            # Note: batch_get_events returns {} if event not found (vs None if service unavailable)
            if group["gcal_recurring_event_id"] not in events:
                # Event was deleted in Google Calendar - clear and recreate
                logger.warning(
                    f"Recurring event {group['gcal_recurring_event_id']} not found, "
                    f"clearing and recreating for group {group_id}"
                )
                await conn.execute(
                    update(groups)
                    .where(groups.c.group_id == group_id)
                    .values(gcal_recurring_event_id=None, calendar_invite_sent_at=None)
                )
                # Fall through to creation logic below
                group = {**group, "gcal_recurring_event_id": None}

        # --- CREATE recurring event if none exists ---
        if not group["gcal_recurring_event_id"]:
            first_meeting = meeting_rows[0]["scheduled_at"]
            num_meetings = len(meeting_rows)

            event_id = await create_recurring_event(
                title=f"{group['group_name']} - Weekly Meeting",
                description="AI Safety study group meeting",
                first_meeting=first_meeting,
                duration_minutes=60,
                num_occurrences=num_meetings,
                attendee_emails=list(expected_emails),
            )

            if event_id:
                await conn.execute(
                    update(groups)
                    .where(groups.c.group_id == group_id)
                    .values(
                        gcal_recurring_event_id=event_id,
                        calendar_invite_sent_at=datetime.now(timezone.utc),
                    )
                )
                result["created_recurring"] = True
                result["recurring_event_id"] = event_id
            else:
                result["failed"] = 1
                result["error"] = "calendar_create_failed"

            return result

        # --- PATCH existing recurring event if attendees changed ---
        event_id = group["gcal_recurring_event_id"]
        event_data = events[event_id]

        current_emails = {
            a.get("email", "").lower()
            for a in event_data.get("attendees", [])
            if a.get("email")
        }

        to_add = expected_emails - current_emails
        to_remove = current_emails - expected_emails

        if to_add or to_remove:
            new_attendees = [
                {"email": email} for email in (current_emails | to_add) - to_remove
            ]
            patch_results = await asyncio.to_thread(
                batch_patch_events,
                [
                    {
                        "event_id": event_id,
                        "body": {"attendees": new_attendees},
                        "send_updates": "all" if to_add else "none",
                    }
                ],
            )

            if patch_results and patch_results.get(event_id, {}).get("success"):
                result["patched"] = 1
            else:
                result["failed"] = 1

        return result


async def _get_group_member_emails(conn, group_id: int) -> set[str]:
    """Get email addresses of all active group members, normalized to lowercase."""
    from .tables import groups_users, users
    from .enums import GroupUserStatus
    from sqlalchemy import select

    result = await conn.execute(
        select(users.c.email)
        .join(groups_users, users.c.user_id == groups_users.c.user_id)
        .where(groups_users.c.group_id == group_id)
        .where(groups_users.c.status == GroupUserStatus.active)
        .where(users.c.email.isnot(None))
    )
    return {row["email"].lower() for row in result.mappings()}


async def sync_group_reminders(group_id: int) -> dict:
    """
    Sync reminder jobs for all future meetings of a group.

    Calls sync_meeting_reminders for each future meeting.

    Returns dict with counts.
    """
    from .database import get_connection
    from .tables import meetings
    from .notifications.scheduler import sync_meeting_reminders
    from datetime import datetime, timezone
    from sqlalchemy import select

    async with get_connection() as conn:
        now = datetime.now(timezone.utc)
        meetings_result = await conn.execute(
            select(meetings.c.meeting_id)
            .where(meetings.c.group_id == group_id)
            .where(meetings.c.scheduled_at > now)
        )
        meeting_ids = [row["meeting_id"] for row in meetings_result.mappings()]

    if not meeting_ids:
        return {"meetings": 0}

    synced = 0
    for meeting_id in meeting_ids:
        await sync_meeting_reminders(meeting_id)
        synced += 1

    return {"meetings": synced}


async def sync_group_rsvps(group_id: int) -> dict:
    """
    Sync RSVP records for all meetings of a group using recurring event instances.

    Returns dict with counts.
    """
    from .database import get_connection
    from .tables import groups
    from .calendar.rsvp import sync_group_rsvps_from_recurring
    from sqlalchemy import select

    async with get_connection() as conn:
        result = await conn.execute(
            select(groups.c.gcal_recurring_event_id).where(
                groups.c.group_id == group_id
            )
        )
        row = result.first()

    if not row or not row.gcal_recurring_event_id:
        return {"error": "no_recurring_event", "synced": 0}

    return await sync_group_rsvps_from_recurring(
        group_id=group_id,
        recurring_event_id=row.gcal_recurring_event_id,
    )


async def sync_group(group_id: int, allow_create: bool = False) -> dict[str, Any]:
    """
    Sync all external systems for a group.

    This is the unified sync function that should be called whenever
    group membership changes. It syncs:
    - Discord channel permissions
    - Google Calendar event attendees
    - Meeting reminder jobs
    - RSVP records

    When allow_create=True, also creates missing infrastructure:
    - Discord category (cohort level)
    - Discord text/voice channels
    - Meeting records
    - Discord scheduled events

    Errors are captured in the results dict, not raised. Failed syncs
    are automatically scheduled for retry.

    Args:
        group_id: The group to sync
        allow_create: If True, create missing infrastructure. If False, return
                      needs_infrastructure=True if infrastructure is missing.

    Returns:
        Dict with results from each sync operation:
        {
            "infrastructure": {...},
            "discord": {...},
            "calendar": {...},
            "reminders": {...},
            "rsvps": {...},
        }
    """
    from .notifications.scheduler import schedule_sync_retry
    from .discord_outbound import get_bot

    _bot = get_bot()
    results: dict[str, Any] = {
        "infrastructure": {
            "category": {"status": "skipped"},
            "text_channel": {"status": "skipped"},
            "voice_channel": {"status": "skipped"},
            "meetings": {"created": 0, "existed": 0},
            "discord_events": {"created": 0, "existed": 0, "skipped": 0, "failed": 0},
        },
    }

    # Get group data
    group = await _get_group_for_sync(group_id)
    if not group:
        return {"error": "group_not_found", **results}

    initial_status = group["status"]
    has_channels = bool(group.get("discord_text_channel_id"))

    # Check if infrastructure is needed
    if not has_channels:
        if not allow_create:
            results["needs_infrastructure"] = True
            return results

        # Check precondition: group must have members
        member_count = await _get_group_member_count(group_id)
        if member_count == 0:
            results["needs_infrastructure"] = True
            results["error"] = "no_members"
            return results

        # Create infrastructure
        # 1. Ensure cohort category
        category_result = await _ensure_cohort_category(group["cohort_id"])
        results["infrastructure"]["category"] = category_result

        # Get category object for channel creation
        category = None
        if category_result.get("id") and _bot:
            category = _bot.get_channel(int(category_result["id"]))

        # 2. Ensure group channels (needs category)
        if category:
            channels_result = await _ensure_group_channels(group_id, category)
            results["infrastructure"]["text_channel"] = channels_result["text_channel"]
            results["infrastructure"]["voice_channel"] = channels_result[
                "voice_channel"
            ]
            results["infrastructure"]["welcome_message_sent"] = channels_result.get(
                "welcome_message_sent", False
            )
        else:
            results["infrastructure"]["text_channel"] = {
                "status": "skipped",
                "error": "no_category",
            }
            results["infrastructure"]["voice_channel"] = {
                "status": "skipped",
                "error": "no_category",
            }

        # 3. Ensure meeting records
        meetings_result = await _ensure_group_meetings(group_id)
        results["infrastructure"]["meetings"] = meetings_result

        # 4. Ensure Discord events (needs voice channel)
        voice_channel = None
        voice_id = results["infrastructure"]["voice_channel"].get("id")
        if voice_id and _bot:
            voice_channel = _bot.get_channel(int(voice_id))

        events_result = await _ensure_meeting_discord_events(group_id, voice_channel)
        results["infrastructure"]["discord_events"] = events_result

        # Refresh group data after infrastructure creation
        group = await _get_group_for_sync(group_id)
        has_channels = bool(group.get("discord_text_channel_id")) if group else False

    # If still no channels after creation attempt, can't sync
    if not has_channels:
        results["needs_infrastructure"] = True
        return results

    # Sync Discord permissions
    try:
        results["discord"] = await sync_group_discord_permissions(group_id)
        if results["discord"].get("failed", 0) > 0 or results["discord"].get("error"):
            schedule_sync_retry(sync_type="discord", group_id=group_id, attempt=0)
    except Exception as e:
        logger.error(f"Discord sync failed for group {group_id}: {e}")
        sentry_sdk.capture_exception(e)
        results["discord"] = {"error": str(e)}
        schedule_sync_retry(sync_type="discord", group_id=group_id, attempt=0)

    # Sync Calendar
    try:
        results["calendar"] = await sync_group_calendar(group_id)
        if results["calendar"].get("failed", 0) > 0 or results["calendar"].get("error"):
            schedule_sync_retry(sync_type="calendar", group_id=group_id, attempt=0)
    except Exception as e:
        logger.error(f"Calendar sync failed for group {group_id}: {e}")
        sentry_sdk.capture_exception(e)
        results["calendar"] = {"error": str(e)}
        schedule_sync_retry(sync_type="calendar", group_id=group_id, attempt=0)

    # Sync Reminders
    try:
        results["reminders"] = await sync_group_reminders(group_id)
    except Exception as e:
        logger.error(f"Reminders sync failed for group {group_id}: {e}")
        sentry_sdk.capture_exception(e)
        results["reminders"] = {"error": str(e)}
        schedule_sync_retry(sync_type="reminders", group_id=group_id, attempt=0)

    # Sync RSVPs
    try:
        results["rsvps"] = await sync_group_rsvps(group_id)
    except Exception as e:
        logger.error(f"RSVPs sync failed for group {group_id}: {e}")
        sentry_sdk.capture_exception(e)
        results["rsvps"] = {"error": str(e)}
        schedule_sync_retry(sync_type="rsvps", group_id=group_id, attempt=0)

    # Check if we should transition to active
    transitioned_to_active = False
    if initial_status == "preview" and allow_create:
        if _is_fully_realized(results["infrastructure"], results.get("discord", {})):
            await _update_group_status(group_id, "active")
            transitioned_to_active = True

    # Send notifications
    discord_result = results.get("discord", {})
    granted_discord_ids = discord_result.get("granted_discord_ids", [])

    if granted_discord_ids:
        # Get channel ID from infrastructure result or group data
        text_channel_id = results["infrastructure"].get("text_channel", {}).get("id")
        if not text_channel_id:
            refreshed_group = await _get_group_for_sync(group_id)
            text_channel_id = (
                refreshed_group.get("discord_text_channel_id")
                if refreshed_group
                else None
            )

        # Fetch notification context
        notification_context = await _get_notification_context(
            group_id, text_channel_id
        )

        results["notifications"] = await _send_sync_notifications(
            group_id=group_id,
            granted_discord_ids=granted_discord_ids,
            revoked_discord_ids=discord_result.get("revoked_discord_ids", []),
            is_initial_realization=transitioned_to_active,
            notification_context=notification_context,
        )

    return results


async def sync_after_group_change(
    group_id: int,
    previous_group_id: int | None = None,
    user_id: int | None = None,  # Kept for backwards compatibility but not used
) -> dict[str, Any]:
    """
    Sync external systems after a group membership change.

    Call this AFTER the database transaction is committed.
    Syncs both the new group and the previous group (if switching).

    Notifications are handled inside sync_group() based on diff detection.

    Args:
        group_id: The group the user joined
        previous_group_id: The group the user left (if switching)
        user_id: Deprecated - kept for backwards compatibility

    Returns:
        Dict with results for new group (and old group if switching):
        {
            "new_group": {...},
            "old_group": {...} | None,
        }
    """
    results: dict[str, Any] = {
        "new_group": None,
        "old_group": None,
    }

    # Sync old group first (if switching) - revokes permissions, removes from calendar
    if previous_group_id:
        logger.info(f"Syncing old group {previous_group_id} after membership change")
        results["old_group"] = await sync_group(previous_group_id, allow_create=False)

    # Sync new group - grants permissions, adds to calendar
    logger.info(f"Syncing new group {group_id} after membership change")
    results["new_group"] = await sync_group(group_id, allow_create=False)

    return results
