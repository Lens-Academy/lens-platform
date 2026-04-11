import pytest
from datetime import datetime, timezone
from unittest.mock import patch, AsyncMock, MagicMock

from core.calendar.rsvp import sync_group_rsvps_from_recurring


class TestSyncGroupRsvpsFromRecurring:
    @pytest.mark.asyncio
    async def test_syncs_rsvps_from_all_instances(self):
        """Fetches instances and syncs RSVPs to meetings by datetime."""
        # Mock: instances API returns 2 instances with different RSVPs
        mock_instances = [
            {
                "id": "recurring123_20260201T180000Z",
                "start": {"dateTime": "2026-02-01T18:00:00Z"},
                "attendees": [
                    {"email": "user@example.com", "responseStatus": "accepted"},
                ],
            },
            {
                "id": "recurring123_20260208T180000Z",
                "start": {"dateTime": "2026-02-08T18:00:00Z"},
                "attendees": [
                    {"email": "user@example.com", "responseStatus": "declined"},
                ],
            },
        ]

        with patch(
            "core.calendar.rsvp.get_event_instances", return_value=mock_instances
        ):
            with patch("core.calendar.rsvp.get_connection") as mock_conn:
                conn = AsyncMock()
                mock_conn.return_value.__aenter__.return_value = conn

                # Track execute calls to return different results
                meetings_data = [
                    {
                        "meeting_id": 1,
                        "scheduled_at": datetime(
                            2026, 2, 1, 18, 0, tzinfo=timezone.utc
                        ),
                    },
                    {
                        "meeting_id": 2,
                        "scheduled_at": datetime(
                            2026, 2, 8, 18, 0, tzinfo=timezone.utc
                        ),
                    },
                ]

                # First call returns meetings, subsequent calls return no user (no DB update)
                call_count = [0]

                async def mock_execute(query):
                    call_count[0] += 1
                    result = MagicMock()
                    if call_count[0] == 1:
                        # First call: meetings query - returns iterable
                        result.mappings.return_value = iter(meetings_data)
                    else:
                        # Subsequent calls: user query - returns None (user not found)
                        result.first.return_value = None
                    return result

                conn.execute = mock_execute

                result = await sync_group_rsvps_from_recurring(
                    group_id=1,
                    recurring_event_id="recurring123",
                )

        assert result["synced"] == 2
        assert result["instances_fetched"] == 2
