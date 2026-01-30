"""Tests for meeting service (create, reminders)."""

import pytest
from datetime import datetime, timezone
from unittest.mock import Mock, patch, AsyncMock

from core.meetings import create_meetings_for_group


class TestCreateMeetingsForGroup:
    """Test meeting record creation."""

    @pytest.mark.asyncio
    async def test_creates_correct_number_of_meetings(self):
        """Should create one meeting per week."""
        with patch("core.meetings.get_transaction") as mock_tx:
            mock_conn = AsyncMock()
            mock_conn.execute = AsyncMock(
                return_value=Mock(scalar_one=Mock(side_effect=[1, 2, 3]))
            )
            mock_tx.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_tx.return_value.__aexit__ = AsyncMock()

            meeting_ids = await create_meetings_for_group(
                group_id=1,
                cohort_id=1,
                group_name="Test Group",
                first_meeting=datetime.now(timezone.utc),
                num_meetings=3,
                discord_voice_channel_id="123456",
            )

            assert len(meeting_ids) == 3
            assert mock_conn.execute.call_count == 3
