"""Tests for Zoom host assignment."""

import pytest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

from core.zoom.hosts import find_available_host


@pytest.fixture
def mock_zoom_users():
    """Two licensed Zoom users returned by the API."""
    return {
        "users": [
            {
                "id": "u1",
                "email": "host1@lensacademy.org",
                "type": 2,
                "status": "active",
            },
            {
                "id": "u2",
                "email": "host2@lensacademy.org",
                "type": 2,
                "status": "active",
            },
        ]
    }


@pytest.mark.asyncio
async def test_find_available_host_no_conflicts(mock_zoom_users):
    """With no existing meetings, any host is available."""
    with patch(
        "core.zoom.hosts.zoom_request",
        new_callable=AsyncMock,
        return_value=mock_zoom_users,
    ):
        with patch(
            "core.zoom.hosts._get_busy_host_emails",
            new_callable=AsyncMock,
            return_value=set(),
        ):
            host = await find_available_host(
                start_time=datetime(2026, 5, 1, 15, 0, tzinfo=timezone.utc),
                duration_minutes=60,
            )
    assert host is not None
    assert host["email"] in ("host1@lensacademy.org", "host2@lensacademy.org")


@pytest.mark.asyncio
async def test_find_available_host_with_conflict(mock_zoom_users):
    """When one host has a conflicting meeting, assign the other."""
    with patch(
        "core.zoom.hosts.zoom_request",
        new_callable=AsyncMock,
        return_value=mock_zoom_users,
    ):
        with patch(
            "core.zoom.hosts._get_busy_host_emails",
            new_callable=AsyncMock,
            return_value={"host1@lensacademy.org"},
        ):
            host = await find_available_host(
                start_time=datetime(2026, 5, 1, 15, 0, tzinfo=timezone.utc),
                duration_minutes=60,
            )
    assert host is not None
    assert host["email"] == "host2@lensacademy.org"


@pytest.mark.asyncio
async def test_find_available_host_all_busy(mock_zoom_users):
    """When all hosts have conflicts, return None."""
    with patch(
        "core.zoom.hosts.zoom_request",
        new_callable=AsyncMock,
        return_value=mock_zoom_users,
    ):
        with patch(
            "core.zoom.hosts._get_busy_host_emails",
            new_callable=AsyncMock,
            return_value={"host1@lensacademy.org", "host2@lensacademy.org"},
        ):
            host = await find_available_host(
                start_time=datetime(2026, 5, 1, 15, 0, tzinfo=timezone.utc),
                duration_minutes=60,
            )
    assert host is None


@pytest.mark.asyncio
async def test_find_available_host_filters_unlicensed():
    """Only licensed (type=2) and active users are considered."""
    users_with_basic = {
        "users": [
            {"id": "u1", "email": "basic@test.com", "type": 1, "status": "active"},
            {"id": "u2", "email": "licensed@test.com", "type": 2, "status": "active"},
            {"id": "u3", "email": "inactive@test.com", "type": 2, "status": "inactive"},
        ]
    }
    with patch(
        "core.zoom.hosts.zoom_request",
        new_callable=AsyncMock,
        return_value=users_with_basic,
    ):
        with patch(
            "core.zoom.hosts._get_busy_host_emails",
            new_callable=AsyncMock,
            return_value=set(),
        ):
            host = await find_available_host(
                start_time=datetime(2026, 5, 1, 15, 0, tzinfo=timezone.utc),
                duration_minutes=60,
            )
    assert host is not None
    assert host["email"] == "licensed@test.com"
