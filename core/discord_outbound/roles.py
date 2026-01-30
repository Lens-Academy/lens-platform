# core/discord_outbound/roles.py
"""Discord role operations - pure Discord primitives, no DB access."""

import logging

import discord

logger = logging.getLogger(__name__)


async def create_role(
    guild: discord.Guild,
    name: str,
    reason: str = "Group sync",
) -> discord.Role:
    """
    Create a Discord role.

    Args:
        guild: The Discord guild to create the role in.
        name: The name for the role.
        reason: Audit log reason for the action.

    Returns:
        The created Discord role.

    Raises:
        discord.HTTPException: If role creation fails.
    """
    return await guild.create_role(name=name, reason=reason)


async def delete_role(
    role: discord.Role,
    reason: str = "Group sync",
) -> bool:
    """
    Delete a Discord role.

    Args:
        role: The Discord role to delete.
        reason: Audit log reason for the action.

    Returns:
        True if deletion succeeded (or role was already gone), False on error.
    """
    try:
        await role.delete(reason=reason)
        return True
    except discord.NotFound:
        # Role already deleted - that's fine
        return True
    except discord.HTTPException as e:
        logger.error(f"Failed to delete role {role}: {e}")
        return False


async def rename_role(
    role: discord.Role,
    name: str,
    reason: str = "Group sync",
) -> bool:
    """
    Rename a Discord role.

    Args:
        role: The Discord role to rename.
        name: The new name for the role.
        reason: Audit log reason for the action.

    Returns:
        True if rename succeeded, False on error.
    """
    try:
        await role.edit(name=name, reason=reason)
        return True
    except discord.HTTPException as e:
        logger.error(f"Failed to rename role {role} to '{name}': {e}")
        return False


async def set_role_channel_permissions(
    role: discord.Role,
    channel: discord.abc.GuildChannel,
    view_channel: bool = True,
    send_messages: bool | None = None,
    read_message_history: bool | None = None,
    connect: bool | None = None,
    speak: bool | None = None,
    reason: str = "Group sync",
) -> bool:
    """
    Set role permissions on a single channel.

    Args:
        role: The Discord role to set permissions for.
        channel: The channel to set permissions on.
        view_channel: Whether the role can view the channel.
        send_messages: Whether the role can send messages (text channels only).
        read_message_history: Whether the role can read history (text channels only).
        connect: Whether the role can connect (voice channels only).
        speak: Whether the role can speak (voice channels only).
        reason: Audit log reason for the action.

    Returns:
        True if permissions were set successfully, False on error.
    """
    try:
        # Build kwargs with only non-None values
        kwargs: dict = {"view_channel": view_channel, "reason": reason}

        if send_messages is not None:
            kwargs["send_messages"] = send_messages
        if read_message_history is not None:
            kwargs["read_message_history"] = read_message_history
        if connect is not None:
            kwargs["connect"] = connect
        if speak is not None:
            kwargs["speak"] = speak

        await channel.set_permissions(role, **kwargs)
        return True
    except discord.HTTPException as e:
        logger.error(f"Failed to set permissions for role {role} on {channel}: {e}")
        return False


def get_role_member_ids(role: discord.Role) -> set[str]:
    """
    Get Discord IDs (as strings) of all members with this role.

    Args:
        role: The Discord role to get members for.

    Returns:
        Set of Discord IDs as strings.
    """
    return {str(member.id) for member in role.members}
