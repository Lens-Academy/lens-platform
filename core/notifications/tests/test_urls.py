"""Tests for URL builder utilities."""

from unittest.mock import patch


class TestBuildUrls:
    def test_builds_lesson_url(self):
        from core.notifications.urls import build_lesson_url

        with patch(
            "core.notifications.urls.get_frontend_url",
            return_value="https://aisafety.com",
        ):
            url = build_lesson_url("lesson-123")

        assert url == "https://aisafety.com/lesson/lesson-123"

    def test_builds_profile_url(self):
        from core.notifications.urls import build_profile_url

        with patch(
            "core.notifications.urls.get_frontend_url",
            return_value="https://aisafety.com",
        ):
            url = build_profile_url()

        assert url == "https://aisafety.com/signup"

    def test_builds_discord_channel_url(self):
        from core.notifications.urls import build_discord_channel_url

        url = build_discord_channel_url(
            server_id="111111",
            channel_id="222222",
        )

        assert url == "https://discord.com/channels/111111/222222"
