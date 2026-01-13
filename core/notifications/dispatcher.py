"""
Notification dispatcher - routes messages to channels based on user preferences.
"""

from core.notifications.templates import get_message, load_templates
from core.notifications.channels.email import send_email
from core.notifications.channels.discord import send_discord_dm, send_discord_channel_message


async def log_notification(
    user_id: int | None,
    channel_id: str | None,
    message_type: str,
    channel: str,
    success: bool,
    error_message: str | None = None,
) -> None:
    """
    Log a notification to the database.

    Args:
        user_id: Database user ID (None for channel-only messages)
        channel_id: Discord channel ID (for channel messages)
        message_type: Message type key from messages.yaml
        channel: "email", "discord_dm", or "discord_channel"
        success: Whether the notification was sent successfully
        error_message: Error details if failed
    """
    from sqlalchemy import insert
    from core.database import get_connection
    from core.tables import notification_log

    try:
        async with get_connection() as conn:
            await conn.execute(
                insert(notification_log).values(
                    user_id=user_id,
                    channel_id=channel_id,
                    message_type=message_type,
                    channel=channel,
                    status="sent" if success else "failed",
                    error_message=error_message,
                )
            )
            await conn.commit()
    except Exception as e:
        # Don't let logging failures break notification sending
        print(f"Warning: Failed to log notification: {e}")


async def get_user_by_id(user_id: int) -> dict | None:
    """Fetch user data from database."""
    from sqlalchemy import select
    from core.database import get_connection
    from core.tables import users

    async with get_connection() as conn:
        result = await conn.execute(
            select(users).where(users.c.user_id == user_id)
        )
        row = result.mappings().first()
        return dict(row) if row else None


async def send_notification(
    user_id: int,
    message_type: str,
    context: dict,
    channel_id: str | None = None,
) -> dict:
    """
    Send a notification to a user via their preferred channels.

    Args:
        user_id: Database user ID
        message_type: Message type key from messages.yaml (e.g., "welcome")
        context: Template variables
        channel_id: Optional Discord channel ID (for channel messages instead of DMs)

    Returns:
        Dict with delivery status: {"email": bool, "discord": bool}
    """
    user = await get_user_by_id(user_id)
    if not user:
        print(f"Warning: User {user_id} not found for notification")
        return {"email": False, "discord": False}

    # Add user info to context
    full_context = {
        "name": user.get("nickname") or user.get("discord_username") or "there",
        "email": user.get("email", ""),
        **context,
    }

    templates = load_templates()
    message_templates = templates.get(message_type, {})

    result = {"email": False, "discord": False}

    # Send email if enabled and user has email
    if user.get("email_notifications_enabled", True) and user.get("email"):
        if "email_subject" in message_templates and "email_body" in message_templates:
            subject = get_message(message_type, "email_subject", full_context)
            body = get_message(message_type, "email_body", full_context)
            result["email"] = send_email(
                to_email=user["email"],
                subject=subject,
                body=body,
            )
            await log_notification(
                user_id=user_id,
                channel_id=None,
                message_type=message_type,
                channel="email",
                success=result["email"],
            )

    # Send Discord message if enabled
    if user.get("dm_notifications_enabled", True) and user.get("discord_id"):
        # Use channel message if channel_id provided, otherwise DM
        if channel_id and "discord_channel" in message_templates:
            message = get_message(message_type, "discord_channel", full_context)
            result["discord"] = await send_discord_channel_message(channel_id, message)
            await log_notification(
                user_id=user_id,
                channel_id=channel_id,
                message_type=message_type,
                channel="discord_channel",
                success=result["discord"],
            )
        elif "discord" in message_templates:
            message = get_message(message_type, "discord", full_context)
            result["discord"] = await send_discord_dm(user["discord_id"], message)
            await log_notification(
                user_id=user_id,
                channel_id=None,
                message_type=message_type,
                channel="discord_dm",
                success=result["discord"],
            )

    return result


async def send_channel_notification(
    channel_id: str,
    message_type: str,
    context: dict,
) -> bool:
    """
    Send a notification to a Discord channel (not tied to a specific user).

    Args:
        channel_id: Discord channel ID
        message_type: Message type key from messages.yaml
        context: Template variables

    Returns:
        True if sent successfully
    """
    templates = load_templates()
    message_templates = templates.get(message_type, {})

    if "discord_channel" not in message_templates:
        print(f"Warning: No discord_channel template for {message_type}")
        return False

    message = get_message(message_type, "discord_channel", context)
    success = await send_discord_channel_message(channel_id, message)

    await log_notification(
        user_id=None,
        channel_id=channel_id,
        message_type=message_type,
        channel="discord_channel",
        success=success,
    )

    return success
