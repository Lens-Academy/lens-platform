"""Tests for voice attendance tracking."""

import pytest

from core.attendance import record_voice_attendance


class TestRecordVoiceAttendance:
    """Test record_voice_attendance().

    After the Zoom migration, record_voice_attendance always returns None
    because meetings no longer store discord_voice_channel_id.
    """

    @pytest.mark.asyncio
    async def test_always_returns_none_after_zoom_migration(self):
        """Voice attendance is disabled after Zoom migration."""
        result = await record_voice_attendance(
            discord_id="123456", voice_channel_id="999999"
        )
        assert result is None
