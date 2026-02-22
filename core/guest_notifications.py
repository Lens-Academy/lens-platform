"""Guest visit channel notifications."""

import logging

from sqlalchemy import select, func
from core.database import get_connection
from core.tables import attendances, meetings, users, groups
from core.discord_outbound import send_channel_message

logger = logging.getLogger(__name__)


async def notify_guest_role_changes(group_id: int, sync_result: dict) -> None:
    """Post channel messages when guests are granted or revoked Discord roles."""
    granted = set(sync_result.get("granted_discord_ids", []))
    revoked = set(sync_result.get("revoked_discord_ids", []))

    if not granted and not revoked:
        return

    async with get_connection() as conn:
        # Get text channel for this group
        group_result = await conn.execute(
            select(groups.c.discord_text_channel_id).where(
                groups.c.group_id == group_id
            )
        )
        group_row = group_result.mappings().first()
        if not group_row or not group_row.get("discord_text_channel_id"):
            return

        text_channel_id = group_row["discord_text_channel_id"]

        # Find which changed discord_ids are guests for this group
        all_changed = granted | revoked
        guest_result = await conn.execute(
            select(
                users.c.discord_id,
                func.coalesce(users.c.nickname, users.c.discord_username).label("name"),
            )
            .join(attendances, users.c.user_id == attendances.c.user_id)
            .join(meetings, attendances.c.meeting_id == meetings.c.meeting_id)
            .where(meetings.c.group_id == group_id)
            .where(attendances.c.is_guest.is_(True))
            .where(users.c.discord_id.in_(all_changed))
            .distinct()
        )
        guest_info = {row["discord_id"]: row["name"] for row in guest_result.mappings()}

        guest_grants = granted & set(guest_info.keys())
        guest_revokes = revoked & set(guest_info.keys())

        # Send grant messages
        for discord_id in guest_grants:
            name = guest_info[discord_id]
            await send_channel_message(
                text_channel_id,
                f"{name} is joining this week's meeting because they can't make it to their regular group's meeting. They've been added to this channel.",
            )

        # Send revoke messages
        for discord_id in guest_revokes:
            name = guest_info.get(discord_id, "A guest")
            await send_channel_message(
                text_channel_id,
                f"{name} joined as a guest for last week's meeting and will now be removed from this channel again.",
            )
