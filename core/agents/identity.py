from dataclasses import dataclass
from typing import Literal
from core.auth import get_or_create_user


@dataclass(frozen=True)
class PlatformIdentity:
    """A user's identity on a specific messaging platform."""
    type: Literal["discord", "whatsapp", "web"]
    id: int | str
    platform_name: str  # "discord_dm", "whatsapp", "web_coach"


async def resolve_user_id(identity: PlatformIdentity) -> int:
    """Resolve a platform identity to an internal user_id.
    Creates a minimal user record if one doesn't exist.
    Currently only supports Discord; WhatsApp branch is a future addition.
    """
    if identity.type == "discord":
        user, _is_new = await get_or_create_user(discord_id=str(identity.id))
        return user["user_id"]
    raise ValueError(f"Unsupported platform type: {identity.type}")
