# core/discord_outbound/permissions.py
import logging

import discord

logger = logging.getLogger(__name__)


async def grant_channel_access(
    member: discord.Member,
    text_channel: discord.TextChannel,
    voice_channel: discord.VoiceChannel | None = None,
    reason: str = "Group sync",
) -> bool:
    """Grant a member access to group channels."""
    try:
        await text_channel.set_permissions(
            member,
            view_channel=True,
            send_messages=True,
            read_message_history=True,
            reason=reason,
        )
        if voice_channel:
            await voice_channel.set_permissions(
                member,
                view_channel=True,
                connect=True,
                speak=True,
                reason=reason,
            )
        return True
    except Exception as e:
        logger.error(f"Failed to grant access to {member}: {e}")
        return False


async def revoke_channel_access(
    member: discord.Member,
    text_channel: discord.TextChannel,
    voice_channel: discord.VoiceChannel | None = None,
    reason: str = "Group sync",
) -> bool:
    """Revoke a member's access to group channels."""
    try:
        await text_channel.set_permissions(member, overwrite=None, reason=reason)
        if voice_channel:
            await voice_channel.set_permissions(member, overwrite=None, reason=reason)
        return True
    except Exception as e:
        logger.error(f"Failed to revoke access from {member}: {e}")
        return False


def get_members_with_access(channel: discord.TextChannel) -> set[str]:
    """Get Discord IDs of members who have view_channel permission."""
    member_ids = set()
    for target, perms in channel.overwrites.items():
        if isinstance(target, discord.Member) and perms.view_channel:
            member_ids.add(str(target.id))
    return member_ids
