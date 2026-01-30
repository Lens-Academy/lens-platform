"""
Integration tests for email notification flow.

Uses real DB, real template rendering, real markdown conversion.
Mocks only SendGrid (external service).
"""

import pytest
from unittest.mock import patch, MagicMock

from core.notifications.templates import render_message
from core.notifications.channels.email import markdown_to_html, markdown_to_plain_text


# =============================================================================
# Test Fixtures - Sample emails in same format as production
# =============================================================================

SIMPLE_EMAIL_FIXTURE = """Hi {name},

Your meeting is {meeting_time}.

[Join Discord]({discord_url})
"""

SIMPLE_EMAIL_EXPECTED_HTML = """<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.5; color: #333;">
Hi Alice,<br>
<br>
Your meeting is Wednesday at 4:00 PM (UTC+1).<br>
<br>
<a href="https://discord.gg/abc123">Join Discord</a><br>

</body>
</html>"""

SIMPLE_EMAIL_EXPECTED_PLAIN = """Hi Alice,

Your meeting is Wednesday at 4:00 PM (UTC+1).

Join Discord (https://discord.gg/abc123)
"""

# -----------------------------------------------------------------------------

MULTI_LINK_EMAIL_FIXTURE = """Hi {name},

Your group meets {meeting_time}.

Prepare for the meeting:
{module_list}

[Continue the course]({course_url})

Questions? [Chat with your group]({discord_url})

Best,
Luc
"""

MULTI_LINK_EMAIL_EXPECTED_HTML = """<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.5; color: #333;">
Hi Bob,<br>
<br>
Your group meets Thursday at 10:00 AM (UTC-5).<br>
<br>
Prepare for the meeting:<br>
- Module 1: Introduction<br>
- Module 2: Deep Dive<br>
<br>
<a href="https://example.com/course">Continue the course</a><br>
<br>
Questions? <a href="https://discord.com/channels/123/456">Chat with your group</a><br>
<br>
Best,<br>
Luc<br>

</body>
</html>"""

MULTI_LINK_EMAIL_EXPECTED_PLAIN = """Hi Bob,

Your group meets Thursday at 10:00 AM (UTC-5).

Prepare for the meeting:
- Module 1: Introduction
- Module 2: Deep Dive

Continue the course (https://example.com/course)

Questions? Chat with your group (https://discord.com/channels/123/456)

Best,
Luc
"""


# =============================================================================
# Unit Tests - Template rendering + markdown conversion
# =============================================================================


class TestMarkdownToHtmlExact:
    """Test markdown to HTML conversion with exact output matching."""

    def test_simple_email_converts_to_exact_html(self):
        body = render_message(
            SIMPLE_EMAIL_FIXTURE,
            {
                "name": "Alice",
                "meeting_time": "Wednesday at 4:00 PM (UTC+1)",
                "discord_url": "https://discord.gg/abc123",
            },
        )
        html = markdown_to_html(body)

        assert html == SIMPLE_EMAIL_EXPECTED_HTML

    def test_simple_email_converts_to_exact_plain_text(self):
        body = render_message(
            SIMPLE_EMAIL_FIXTURE,
            {
                "name": "Alice",
                "meeting_time": "Wednesday at 4:00 PM (UTC+1)",
                "discord_url": "https://discord.gg/abc123",
            },
        )
        plain = markdown_to_plain_text(body)

        assert plain == SIMPLE_EMAIL_EXPECTED_PLAIN

    def test_multi_link_email_converts_to_exact_html(self):
        body = render_message(
            MULTI_LINK_EMAIL_FIXTURE,
            {
                "name": "Bob",
                "meeting_time": "Thursday at 10:00 AM (UTC-5)",
                "module_list": "- Module 1: Introduction\n- Module 2: Deep Dive",
                "course_url": "https://example.com/course",
                "discord_url": "https://discord.com/channels/123/456",
            },
        )
        html = markdown_to_html(body)

        assert html == MULTI_LINK_EMAIL_EXPECTED_HTML

    def test_multi_link_email_converts_to_exact_plain_text(self):
        body = render_message(
            MULTI_LINK_EMAIL_FIXTURE,
            {
                "name": "Bob",
                "meeting_time": "Thursday at 10:00 AM (UTC-5)",
                "module_list": "- Module 1: Introduction\n- Module 2: Deep Dive",
                "course_url": "https://example.com/course",
                "discord_url": "https://discord.com/channels/123/456",
            },
        )
        plain = markdown_to_plain_text(body)

        assert plain == MULTI_LINK_EMAIL_EXPECTED_PLAIN


# =============================================================================
# Integration Tests - Full flow with real DB
# =============================================================================


class TestNotificationFlowIntegration:
    """
    Integration tests for the full notification flow.

    Uses real DB, real timezone formatting, real URL builders.
    Mocks only SendGrid.
    """

    @pytest.fixture(autouse=True)
    def reset_db_engine(self):
        """Reset DB engine before each test to avoid event loop issues."""
        from core.database import reset_engine

        reset_engine()
        yield
        reset_engine()

    @pytest.fixture
    async def test_user(self):
        """Create a test user in the DB, rollback after test."""
        from sqlalchemy import insert, delete
        from core.database import get_connection
        from core.tables import users

        user_data = {
            "discord_id": "999888777666",
            "discord_username": "testuser",
            "nickname": "Alice",
            "email": "alice@example.com",
            "timezone": "Europe/Amsterdam",
            "email_notifications_enabled": True,
            "dm_notifications_enabled": True,
        }

        async with get_connection() as conn:
            result = await conn.execute(
                insert(users).values(**user_data).returning(users.c.user_id)
            )
            user_id = result.scalar()
            await conn.commit()

        yield {"user_id": user_id, **user_data}

        # Cleanup
        async with get_connection() as conn:
            await conn.execute(delete(users).where(users.c.user_id == user_id))
            await conn.commit()

    @pytest.mark.asyncio
    async def test_send_notification_uses_real_timezone_formatting(self, test_user):
        """Verify meeting time is formatted in user's timezone."""
        from core.notifications.dispatcher import send_notification

        with patch("core.notifications.channels.email._get_sendgrid_client") as mock_sg:
            # Setup mock
            mock_client = MagicMock()
            mock_sg.return_value = mock_client
            mock_client.send.return_value = MagicMock(status_code=202)

            # Send notification with UTC time
            # 15:00 UTC = 16:00 Amsterdam (UTC+1)
            await send_notification(
                user_id=test_user["user_id"],
                message_type="meeting_reminder_1h",
                context={
                    "group_name": "Test Group",
                    "meeting_time_utc": "2024-02-07T15:00:00+00:00",
                    "discord_channel_url": "https://discord.com/channels/111/222",
                },
            )

            # Verify SendGrid was called
            assert mock_client.send.called

            # Extract the email that was sent
            sent_mail = mock_client.send.call_args[0][0]

            # Get HTML content (second content item after plain text)
            html_content = None
            for content in sent_mail.contents:
                if content.mime_type == "text/html":
                    html_content = content.content
                    break

            assert html_content is not None
            # Verify time was converted to Amsterdam timezone (UTC+1)
            assert "4:00 PM (UTC+1)" in html_content

    @pytest.mark.asyncio
    async def test_send_notification_uses_real_url_builders(self, test_user):
        """Verify URLs are built correctly using real URL builder functions."""
        from core.notifications.dispatcher import send_notification
        from core.notifications.urls import build_discord_channel_url

        discord_channel_url = build_discord_channel_url(
            server_id="111222333",
            channel_id="444555666",
        )

        with patch("core.notifications.channels.email._get_sendgrid_client") as mock_sg:
            mock_client = MagicMock()
            mock_sg.return_value = mock_client
            mock_client.send.return_value = MagicMock(status_code=202)

            await send_notification(
                user_id=test_user["user_id"],
                message_type="meeting_reminder_1h",
                context={
                    "group_name": "Test Group",
                    "meeting_time_utc": "2024-02-07T15:00:00+00:00",
                    "discord_channel_url": discord_channel_url,
                },
            )

            sent_mail = mock_client.send.call_args[0][0]

            html_content = None
            for content in sent_mail.contents:
                if content.mime_type == "text/html":
                    html_content = content.content
                    break

            # Verify the Discord URL appears as a proper HTML link
            assert (
                '<a href="https://discord.com/channels/111222333/444555666">'
                in html_content
            )

    @pytest.mark.asyncio
    async def test_send_notification_respects_email_disabled(self, test_user):
        """Verify no email is sent when user has email notifications disabled."""
        from sqlalchemy import update
        from core.database import get_connection
        from core.tables import users
        from core.notifications.dispatcher import send_notification

        # Disable email notifications for this user
        async with get_connection() as conn:
            await conn.execute(
                update(users)
                .where(users.c.user_id == test_user["user_id"])
                .values(email_notifications_enabled=False)
            )
            await conn.commit()

        with patch("core.notifications.channels.email._get_sendgrid_client") as mock_sg:
            mock_client = MagicMock()
            mock_sg.return_value = mock_client

            result = await send_notification(
                user_id=test_user["user_id"],
                message_type="meeting_reminder_1h",
                context={
                    "group_name": "Test Group",
                    "meeting_time_utc": "2024-02-07T15:00:00+00:00",
                    "discord_channel_url": "https://discord.com/channels/111/222",
                },
            )

            # Email should not have been sent
            assert result["email"] is False
            assert not mock_client.send.called

    @pytest.mark.asyncio
    async def test_send_notification_logs_to_database(self, test_user):
        """Verify notification is recorded in notification_log table."""
        from sqlalchemy import select, delete
        from core.database import get_connection
        from core.tables import notification_log
        from core.notifications.dispatcher import send_notification

        # Clean up any existing logs for this user
        async with get_connection() as conn:
            await conn.execute(
                delete(notification_log).where(
                    notification_log.c.user_id == test_user["user_id"]
                )
            )
            await conn.commit()

        with patch("core.notifications.channels.email._get_sendgrid_client") as mock_sg:
            mock_client = MagicMock()
            mock_sg.return_value = mock_client
            mock_client.send.return_value = MagicMock(status_code=202)

            await send_notification(
                user_id=test_user["user_id"],
                message_type="meeting_reminder_1h",
                context={
                    "group_name": "Test Group",
                    "meeting_time_utc": "2024-02-07T15:00:00+00:00",
                    "discord_channel_url": "https://discord.com/channels/111/222",
                },
            )

        # Verify notification was logged
        async with get_connection() as conn:
            result = await conn.execute(
                select(notification_log).where(
                    notification_log.c.user_id == test_user["user_id"]
                )
            )
            log_entry = result.mappings().first()

        assert log_entry is not None
        assert log_entry["message_type"] == "meeting_reminder_1h"
        assert log_entry["channel"] == "email"
        assert log_entry["status"] == "sent"
