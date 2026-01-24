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
from typing import Any

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


async def sync_group_calendar(group_id: int) -> dict:
    """
    Sync calendar events for all future meetings of a group.

    Handles both creation and updates in one unified function:
    1. Fetches all future meetings from DB
    2. Batch CREATES events for meetings without calendar IDs
    3. Batch GETS existing events to check attendees
    4. Batch PATCHES events with attendee changes

    Returns dict with counts.
    """
    from .database import get_connection, get_transaction
    from .tables import meetings, groups
    from .calendar.client import (
        batch_create_events,
        batch_get_events,
        batch_patch_events,
    )
    from datetime import datetime, timezone
    from sqlalchemy import select, update

    async with get_connection() as conn:
        now = datetime.now(timezone.utc)

        # Get all future meetings with group info
        meetings_result = await conn.execute(
            select(
                meetings.c.meeting_id,
                meetings.c.google_calendar_event_id,
                meetings.c.scheduled_at,
                groups.c.group_name,
            )
            .join(groups, meetings.c.group_id == groups.c.group_id)
            .where(meetings.c.group_id == group_id)
            .where(meetings.c.scheduled_at > now)
        )
        meeting_rows = list(meetings_result.mappings())

        if not meeting_rows:
            return {
                "meetings": 0,
                "created": 0,
                "patched": 0,
                "unchanged": 0,
                "failed": 0,
            }

        # Get expected attendees
        expected_emails = await _get_group_member_emails(conn, group_id)

    # Split meetings by whether they have calendar events
    meetings_to_create = [m for m in meeting_rows if not m["google_calendar_event_id"]]
    meetings_with_events = [m for m in meeting_rows if m["google_calendar_event_id"]]

    created = 0
    patched = 0
    failed = 0

    # --- BATCH CREATE for meetings without calendar events ---
    if meetings_to_create:
        create_data = [
            {
                "meeting_id": m["meeting_id"],
                "title": f"{m['group_name']} - Meeting",
                "description": "Study group meeting",
                "start": m["scheduled_at"],
                "duration_minutes": 60,
                "attendees": list(expected_emails),
            }
            for m in meetings_to_create
        ]

        create_results = batch_create_events(create_data)
        if create_results:
            # Save new event IDs to database
            async with get_transaction() as conn:
                for meeting_id, result in create_results.items():
                    if result["success"]:
                        await conn.execute(
                            update(meetings)
                            .where(meetings.c.meeting_id == meeting_id)
                            .values(google_calendar_event_id=result["event_id"])
                        )
                        created += 1
                    else:
                        failed += 1
                        logger.error(
                            f"Failed to create event for meeting {meeting_id}: {result['error']}"
                        )

    # --- BATCH GET + PATCH for existing events ---
    if meetings_with_events:
        event_ids = [m["google_calendar_event_id"] for m in meetings_with_events]

        # Batch fetch current attendees
        events = batch_get_events(event_ids)
        if events is None:
            return {
                "meetings": len(meeting_rows),
                "created": created,
                "patched": 0,
                "unchanged": 0,
                "failed": failed,
                "error": "calendar_unavailable",
            }

        # Calculate which events need updates
        updates_to_make = []
        for event_id in event_ids:
            if event_id not in events:
                failed += 1
                continue

            event = events[event_id]
            current_emails = {
                a.get("email", "").lower()
                for a in event.get("attendees", [])
                if a.get("email")
            }

            to_add = expected_emails - current_emails
            to_remove = current_emails - expected_emails

            if to_add or to_remove:
                new_attendees = [
                    {"email": email} for email in (current_emails | to_add) - to_remove
                ]
                updates_to_make.append(
                    {
                        "event_id": event_id,
                        "body": {"attendees": new_attendees},
                        "send_updates": "all" if to_add else "none",
                    }
                )

        # Batch patch
        if updates_to_make:
            patch_results = batch_patch_events(updates_to_make)
            if patch_results:
                for event_id, result in patch_results.items():
                    if result["success"]:
                        patched += 1
                    else:
                        failed += 1

    unchanged = len(meeting_rows) - created - patched - failed

    return {
        "meetings": len(meeting_rows),
        "created": created,
        "patched": patched,
        "unchanged": unchanged,
        "failed": failed,
    }


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


async def sync_group(group_id: int) -> dict[str, Any]:
    """
    Sync all external systems for a group.

    This is the unified sync function that should be called whenever
    group membership changes. It syncs:
    - Discord channel permissions
    - Google Calendar event attendees
    - Meeting reminder jobs
    - RSVP records

    Errors are captured in the results dict, not raised. Failed syncs
    are automatically scheduled for retry.

    Args:
        group_id: The group to sync

    Returns:
        Dict with results from each sync operation:
        {
            "discord": {...},
            "calendar": {...},
            "reminders": {...},
            "rsvps": {...},
        }
    """
    from .notifications.scheduler import schedule_sync_retry

    results: dict[str, Any] = {}

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

    return results


async def sync_after_group_change(
    group_id: int,
    previous_group_id: int | None = None,
    user_id: int | None = None,
) -> dict[str, Any]:
    """
    Sync external systems after a group membership change.

    Call this AFTER the database transaction is committed.
    Syncs both the new group and the previous group (if switching).

    When user_id is provided (direct join via API), also sends
    a notification to the user and welcome message to the channel.

    Args:
        group_id: The group the user joined
        previous_group_id: The group the user left (if switching)
        user_id: The user who joined (for direct join notifications)

    Returns:
        Dict with results for new group (and old group if switching):
        {
            "new_group": {...},
            "old_group": {...} | None,
            "notification": {...} | None,
        }
    """
    from .database import get_connection
    from .notifications.actions import notify_member_joined, notify_member_left
    from .queries.groups import get_group_member_names, get_group_with_details
    from .tables import users
    from sqlalchemy import select

    results: dict[str, Any] = {
        "new_group": None,
        "old_group": None,
        "notification": None,
        "left_notification": None,
    }

    # Sync old group first (if switching) - revokes permissions, removes from calendar
    if previous_group_id:
        logger.info(f"Syncing old group {previous_group_id} after membership change")
        results["old_group"] = await sync_group(previous_group_id)

    # Sync new group - grants permissions, adds to calendar
    logger.info(f"Syncing new group {group_id} after membership change")
    results["new_group"] = await sync_group(group_id)

    # Send notifications for direct joins (when user_id is provided)
    if user_id:
        try:
            async with get_connection() as conn:
                # Get user's Discord ID (needed for both notifications)
                user_result = await conn.execute(
                    select(users.c.discord_id).where(users.c.user_id == user_id)
                )
                user_row = user_result.mappings().first()
                discord_user_id = user_row.get("discord_id") if user_row else None

                if discord_user_id:
                    # Send "left" notification to old group (if switching)
                    if previous_group_id:
                        old_group_details = await get_group_with_details(
                            conn, previous_group_id
                        )
                        if old_group_details and old_group_details.get(
                            "discord_text_channel_id"
                        ):
                            results["left_notification"] = await notify_member_left(
                                discord_channel_id=old_group_details[
                                    "discord_text_channel_id"
                                ],
                                discord_user_id=discord_user_id,
                            )

                    # Send "joined" notification to new group
                    group_details = await get_group_with_details(conn, group_id)
                    if group_details and group_details.get("discord_text_channel_id"):
                        member_names = await get_group_member_names(conn, group_id)
                        results["notification"] = await notify_member_joined(
                            user_id=user_id,
                            group_name=group_details["group_name"],
                            meeting_time_utc=group_details["recurring_meeting_time_utc"]
                            or "TBD",
                            member_names=member_names,
                            discord_channel_id=group_details["discord_text_channel_id"],
                            discord_user_id=discord_user_id,
                        )
        except Exception as e:
            logger.error(f"Failed to send direct join notification: {e}")
            sentry_sdk.capture_exception(e)
            results["notification"] = {"error": str(e)}

    return results
