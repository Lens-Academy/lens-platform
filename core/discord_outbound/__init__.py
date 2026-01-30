# core/discord_outbound/__init__.py
"""Discord outbound operations - all Discord API calls go through here."""

from .bot import get_bot, get_dm_semaphore, get_or_fetch_member, set_bot
from .channels import (
    create_category,
    create_text_channel,
    create_voice_channel,
    get_or_fetch_channel,
)
from .events import create_scheduled_event
from .messages import send_channel_message, send_dm
from .permissions import (
    get_members_with_access,
    grant_channel_access,
    revoke_channel_access,
)
from .roles import (
    create_role,
    delete_role,
    get_role_member_ids,
    rename_role,
    set_role_channel_permissions,
)

__all__ = [
    "set_bot",
    "get_bot",
    "get_dm_semaphore",
    "get_or_fetch_member",
    "send_dm",
    "send_channel_message",
    "create_category",
    "create_text_channel",
    "create_voice_channel",
    "get_or_fetch_channel",
    "grant_channel_access",
    "revoke_channel_access",
    "get_members_with_access",
    "create_scheduled_event",
    # Role operations
    "create_role",
    "delete_role",
    "rename_role",
    "set_role_channel_permissions",
    "get_role_member_ids",
]
