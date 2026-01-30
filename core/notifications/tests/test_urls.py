"""Tests for URL builder utilities."""

from unittest.mock import patch


class TestBuildUrls:
    def test_builds_module_url(self):
        from core.notifications.urls import build_module_url

        with patch(
            "core.notifications.urls.get_frontend_url",
            return_value="https://aisafety.com",
        ):
            url = build_module_url("module-123")

        assert url == "https://aisafety.com/module/module-123"

    def test_builds_profile_url(self):
        from core.notifications.urls import build_profile_url

        with patch(
            "core.notifications.urls.get_frontend_url",
            return_value="https://aisafety.com",
        ):
            url = build_profile_url()

        assert url == "https://aisafety.com/enroll"

    def test_builds_course_url(self):
        from core.notifications.urls import build_course_url

        with patch(
            "core.notifications.urls.get_frontend_url",
            return_value="https://aisafety.com",
        ):
            url = build_course_url()

        assert url == "https://aisafety.com/course"

    def test_builds_discord_channel_url(self):
        from core.notifications.urls import build_discord_channel_url

        url = build_discord_channel_url(
            server_id="111111",
            channel_id="222222",
        )

        assert url == "https://discord.com/channels/111111/222222"
