"""Tests for Google Calendar batch operations."""

from unittest.mock import MagicMock, patch


class TestBatchGetEvents:
    """Test batch fetching of calendar events."""

    def test_returns_empty_dict_when_no_event_ids(self):
        """Should return empty dict for empty input."""
        from core.calendar.client import batch_get_events

        result = batch_get_events([])
        assert result == {}

    def test_returns_none_when_calendar_not_configured(self):
        """Should return None if calendar service unavailable."""
        from core.calendar.client import batch_get_events

        with patch("core.calendar.client.get_calendar_service", return_value=None):
            result = batch_get_events(["event1", "event2"])
            assert result is None

    def test_fetches_multiple_events_in_single_batch(self):
        """Should fetch all events in one batch request."""
        from core.calendar.client import batch_get_events

        mock_service = MagicMock()
        mock_batch = MagicMock()
        mock_service.new_batch_http_request.return_value = mock_batch

        callbacks = []

        def mock_add(request, callback, request_id):
            callbacks.append((request_id, callback))

        def mock_execute():
            for request_id, callback in callbacks:
                callback(request_id, {"id": request_id, "attendees": []}, None)

        mock_batch.add = mock_add
        mock_batch.execute = mock_execute

        with patch(
            "core.calendar.client.get_calendar_service", return_value=mock_service
        ):
            result = batch_get_events(["event1", "event2", "event3"])

        assert len(callbacks) == 3
        assert set(result.keys()) == {"event1", "event2", "event3"}

    def test_handles_partial_failures(self):
        """Should return successful events and log failures."""
        from core.calendar.client import batch_get_events

        mock_service = MagicMock()
        mock_batch = MagicMock()
        mock_service.new_batch_http_request.return_value = mock_batch

        callbacks = []

        def mock_add(request, callback, request_id):
            callbacks.append((request_id, callback))

        def mock_execute():
            callbacks[0][1]("event1", {"id": "event1", "attendees": []}, None)
            callbacks[1][1]("event2", None, Exception("Not found"))

        mock_batch.add = mock_add
        mock_batch.execute = mock_execute

        with patch(
            "core.calendar.client.get_calendar_service", return_value=mock_service
        ):
            with patch("core.calendar.client.sentry_sdk"):
                result = batch_get_events(["event1", "event2"])

        assert "event1" in result
        assert "event2" not in result


class TestBatchCreateEvents:
    """Test batch creation of calendar events."""

    def test_returns_empty_dict_when_no_events(self):
        """Should return empty dict for empty input."""
        from core.calendar.client import batch_create_events

        result = batch_create_events([])
        assert result == {}

    def test_returns_none_when_calendar_not_configured(self):
        """Should return None if calendar service unavailable."""
        from core.calendar.client import batch_create_events

        with patch("core.calendar.client.get_calendar_service", return_value=None):
            events = [
                {
                    "meeting_id": 1,
                    "title": "Test",
                    "start": "2024-01-01T10:00:00Z",
                    "attendees": [],
                }
            ]
            result = batch_create_events(events)
            assert result is None

    def test_creates_multiple_events_in_single_batch(self):
        """Should create all events in one batch request."""
        from core.calendar.client import batch_create_events
        from datetime import datetime, timezone

        mock_service = MagicMock()
        mock_batch = MagicMock()
        mock_service.new_batch_http_request.return_value = mock_batch

        callbacks = []

        def mock_add(request, callback, request_id):
            callbacks.append((request_id, callback))

        def mock_execute():
            for request_id, callback in callbacks:
                callback(request_id, {"id": f"gcal_{request_id}"}, None)

        mock_batch.add = mock_add
        mock_batch.execute = mock_execute

        events = [
            {
                "meeting_id": 1,
                "title": "Group A - Meeting 1",
                "description": "Study group",
                "start": datetime(2024, 1, 1, 10, 0, tzinfo=timezone.utc),
                "duration_minutes": 60,
                "attendees": ["a@test.com", "b@test.com"],
            },
            {
                "meeting_id": 2,
                "title": "Group A - Meeting 2",
                "description": "Study group",
                "start": datetime(2024, 1, 8, 10, 0, tzinfo=timezone.utc),
                "duration_minutes": 60,
                "attendees": ["a@test.com", "b@test.com"],
            },
        ]

        with patch(
            "core.calendar.client.get_calendar_service", return_value=mock_service
        ):
            result = batch_create_events(events)

        assert len(callbacks) == 2
        assert result[1]["success"] is True
        assert result[1]["event_id"] == "gcal_1"
        assert result[2]["success"] is True
        assert result[2]["event_id"] == "gcal_2"

    def test_handles_partial_failures(self):
        """Should return success/failure status for each event."""
        from core.calendar.client import batch_create_events
        from datetime import datetime, timezone

        mock_service = MagicMock()
        mock_batch = MagicMock()
        mock_service.new_batch_http_request.return_value = mock_batch

        callbacks = []

        def mock_add(request, callback, request_id):
            callbacks.append((request_id, callback))

        def mock_execute():
            callbacks[0][1]("1", {"id": "gcal_1"}, None)
            callbacks[1][1]("2", None, Exception("Quota exceeded"))

        mock_batch.add = mock_add
        mock_batch.execute = mock_execute

        events = [
            {
                "meeting_id": 1,
                "title": "Meeting 1",
                "description": "",
                "start": datetime(2024, 1, 1, 10, 0, tzinfo=timezone.utc),
                "duration_minutes": 60,
                "attendees": [],
            },
            {
                "meeting_id": 2,
                "title": "Meeting 2",
                "description": "",
                "start": datetime(2024, 1, 2, 10, 0, tzinfo=timezone.utc),
                "duration_minutes": 60,
                "attendees": [],
            },
        ]

        with patch(
            "core.calendar.client.get_calendar_service", return_value=mock_service
        ):
            with patch("core.calendar.client.sentry_sdk"):
                result = batch_create_events(events)

        assert result[1]["success"] is True
        assert result[2]["success"] is False
        assert "Quota exceeded" in result[2]["error"]


class TestBatchPatchEvents:
    """Test batch patching of calendar events."""

    def test_returns_empty_dict_when_no_updates(self):
        """Should return empty dict for empty input."""
        from core.calendar.client import batch_patch_events

        result = batch_patch_events([])
        assert result == {}

    def test_patches_multiple_events_with_per_event_send_updates(self):
        """Should patch events with correct per-event sendUpdates."""
        from core.calendar.client import batch_patch_events

        mock_service = MagicMock()
        mock_batch = MagicMock()
        mock_service.new_batch_http_request.return_value = mock_batch

        patch_calls = []

        def mock_patch(**kwargs):
            patch_calls.append(kwargs)
            return MagicMock()

        mock_service.events.return_value.patch = mock_patch

        callbacks = []

        def mock_add(request, callback, request_id):
            callbacks.append((request_id, callback))

        def mock_execute():
            for request_id, callback in callbacks:
                callback(request_id, {"id": request_id}, None)

        mock_batch.add = mock_add
        mock_batch.execute = mock_execute

        updates = [
            {"event_id": "event1", "body": {"attendees": []}, "send_updates": "all"},
            {"event_id": "event2", "body": {"attendees": []}, "send_updates": "none"},
        ]

        with patch(
            "core.calendar.client.get_calendar_service", return_value=mock_service
        ):
            result = batch_patch_events(updates)

        assert patch_calls[0]["sendUpdates"] == "all"
        assert patch_calls[1]["sendUpdates"] == "none"
        assert result["event1"]["success"] is True
        assert result["event2"]["success"] is True
