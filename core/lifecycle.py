"""
Lifecycle operations for group membership changes.

Handles Discord permissions, calendar invites, and meeting reminders
when users join or leave groups.

Error handling: Best-effort with Sentry reporting. Failures don't block
the database update. Use sync commands to recover from failures.
"""

import logging
import sentry_sdk

logger = logging.getLogger(__name__)


# ============================================================================
# SYNC FUNCTIONS - Diff-based, used for both normal flow and recovery
# ============================================================================


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
    from .notifications.channels.discord import _bot
    from .tables import groups, groups_users, users
    from .enums import GroupUserStatus
    from sqlalchemy import select
    import discord

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
    current_discord_ids = set()
    for target, perms in text_channel.overwrites.items():
        if isinstance(target, discord.Member) and perms.view_channel:
            current_discord_ids.add(str(target.id))

    # Calculate diff
    to_grant = expected_discord_ids - current_discord_ids
    to_revoke = current_discord_ids - expected_discord_ids
    unchanged = expected_discord_ids & current_discord_ids

    granted, revoked, failed = 0, 0, 0
    guild = text_channel.guild

    # Grant access to new members (both text and voice)
    for discord_id in to_grant:
        try:
            member = guild.get_member(int(discord_id))
            if member:
                # Grant text channel permissions
                await text_channel.set_permissions(
                    member,
                    view_channel=True,
                    send_messages=True,
                    read_message_history=True,
                    reason="Group sync",
                )
                # Grant voice channel permissions
                if voice_channel:
                    await voice_channel.set_permissions(
                        member,
                        view_channel=True,
                        connect=True,
                        speak=True,
                        reason="Group sync",
                    )
                granted += 1
            else:
                logger.info(f"Member {discord_id} not in guild, skipping grant")
        except Exception as e:
            logger.error(f"Error granting access to {discord_id}: {e}")
            sentry_sdk.capture_exception(e)
            failed += 1

    # Revoke access from removed members (both text and voice)
    for discord_id in to_revoke:
        try:
            member = guild.get_member(int(discord_id))
            if member:
                await text_channel.set_permissions(
                    member, overwrite=None, reason="Group sync"
                )
                if voice_channel:
                    await voice_channel.set_permissions(
                        member, overwrite=None, reason="Group sync"
                    )
                revoked += 1
        except Exception as e:
            logger.error(f"Error revoking access from {discord_id}: {e}")
            sentry_sdk.capture_exception(e)
            failed += 1

    return {
        "granted": granted,
        "revoked": revoked,
        "unchanged": len(unchanged),
        "failed": failed,
    }


async def sync_meeting_calendar(meeting_id: int) -> dict:
    """
    Sync a meeting's calendar event with DB membership (diff-based).

    1. Creates calendar event if it doesn't exist
    2. Gets current attendees from Google Calendar
    3. Compares with active group members from DB
    4. Only adds/removes for the diff

    Idempotent - safe to run multiple times.

    Returns dict with counts: {"added": N, "removed": N, "unchanged": N, "created": bool}
    """
    from .database import get_connection, get_transaction
    from .tables import meetings, groups, groups_users, users
    from .enums import GroupUserStatus
    from .calendar.client import get_calendar_service, get_calendar_email
    from .calendar.events import create_meeting_event
    from sqlalchemy import select, update

    service = get_calendar_service()
    if not service:
        logger.warning("Calendar service not available")
        return {"error": "calendar_unavailable"}

    async with get_connection() as conn:
        # Get meeting and group details
        meeting_result = await conn.execute(
            select(meetings, groups.c.group_name, groups.c.discord_text_channel_id)
            .join(groups, meetings.c.group_id == groups.c.group_id)
            .where(meetings.c.meeting_id == meeting_id)
        )
        meeting = meeting_result.mappings().first()
        if not meeting:
            return {"error": "meeting_not_found"}

        group_id = meeting["group_id"]

        # Get all active members' emails from DB (who SHOULD be invited)
        members_result = await conn.execute(
            select(users.c.email)
            .join(groups_users, users.c.user_id == groups_users.c.user_id)
            .where(groups_users.c.group_id == group_id)
            .where(groups_users.c.status == GroupUserStatus.active)
            .where(users.c.email.isnot(None))
        )
        expected_emails = {row["email"].lower() for row in members_result.mappings()}

    event_id = meeting.get("google_calendar_event_id")

    # Create calendar event if it doesn't exist
    if not event_id:
        try:
            # create_meeting_event is synchronous - construct title/description
            meeting_title = f"{meeting['group_name']} - Meeting"
            meeting_description = "Study group meeting"

            event_id = create_meeting_event(
                title=meeting_title,
                description=meeting_description,
                start=meeting["scheduled_at"],
                attendee_emails=list(expected_emails),
            )
            # Save event_id to database
            async with get_transaction() as conn:
                await conn.execute(
                    update(meetings)
                    .where(meetings.c.meeting_id == meeting_id)
                    .values(google_calendar_event_id=event_id)
                )
            return {
                "created": True,
                "added": len(expected_emails),
                "removed": 0,
                "unchanged": 0,
            }
        except Exception as e:
            logger.error(f"Error creating calendar event: {e}")
            sentry_sdk.capture_exception(e)
            return {"error": "event_creation_failed"}

    # Get current attendees from Google Calendar
    calendar_email = get_calendar_email()
    try:
        event = (
            service.events()
            .get(
                calendarId=calendar_email,
                eventId=event_id,
            )
            .execute()
        )
        current_emails = {
            a.get("email", "").lower()
            for a in event.get("attendees", [])
            if a.get("email")
        }
    except Exception as e:
        logger.error(f"Error fetching calendar event: {e}")
        sentry_sdk.capture_exception(e)
        return {"error": "event_fetch_failed"}

    # Calculate diff
    to_add = expected_emails - current_emails
    to_remove = current_emails - expected_emails
    unchanged = expected_emails & current_emails

    # Apply changes if any
    if to_add or to_remove:
        new_attendees = [
            {"email": email} for email in (current_emails | to_add) - to_remove
        ]
        try:
            service.events().patch(
                calendarId=calendar_email,
                eventId=event_id,
                body={"attendees": new_attendees},
                sendUpdates="all" if to_add else "none",  # Only notify new attendees
            ).execute()
        except Exception as e:
            logger.error(f"Error updating calendar attendees: {e}")
            sentry_sdk.capture_exception(e)
            return {"error": "attendee_update_failed"}

    return {
        "created": False,
        "added": len(to_add),
        "removed": len(to_remove),
        "unchanged": len(unchanged),
    }


async def sync_group_calendar(group_id: int) -> dict:
    """
    Sync calendar events for all future meetings of a group.

    Calls sync_meeting_calendar for each future meeting.

    Returns dict with aggregate counts.
    """
    from .database import get_connection
    from .tables import meetings
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
        return {"meetings": 0, "error": "no_future_meetings"}

    total = {
        "meetings": len(meeting_ids),
        "created": 0,
        "added": 0,
        "removed": 0,
        "failed": 0,
    }

    for meeting_id in meeting_ids:
        result = await sync_meeting_calendar(meeting_id)
        if "error" in result:
            total["failed"] += 1
        else:
            if result.get("created"):
                total["created"] += 1
            total["added"] += result.get("added", 0)
            total["removed"] += result.get("removed", 0)

    return total


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
    Sync RSVP records for all future meetings of a group.

    Calls sync_meeting_rsvps for each future meeting.

    Returns dict with counts.
    """
    from .database import get_connection
    from .tables import meetings
    from .calendar.rsvp import sync_meeting_rsvps
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
        await sync_meeting_rsvps(meeting_id)
        synced += 1

    return {"meetings": synced}
