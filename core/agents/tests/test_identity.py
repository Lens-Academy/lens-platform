import pytest
from core.agents.identity import PlatformIdentity, resolve_user_id

def test_platform_identity_discord():
    identity = PlatformIdentity(type="discord", id=123456789, platform_name="discord_dm")
    assert identity.type == "discord"
    assert identity.platform_name == "discord_dm"

def test_platform_identity_is_frozen():
    identity = PlatformIdentity(type="discord", id=123, platform_name="discord_dm")
    with pytest.raises(AttributeError):
        identity.type = "whatsapp"

@pytest.mark.asyncio
async def test_resolve_user_id_creates_user_if_missing():
    identity = PlatformIdentity(type="discord", id=999999999999, platform_name="discord_dm")
    user_id = await resolve_user_id(identity)
    assert isinstance(user_id, int)
    assert user_id > 0
    # Second call returns same user_id (idempotent)
    user_id_2 = await resolve_user_id(identity)
    assert user_id_2 == user_id
