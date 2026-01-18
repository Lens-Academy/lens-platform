"""Tests for email channel."""

from unittest.mock import patch, MagicMock

from core.notifications.channels.email import send_email, EmailMessage


class TestEmailMessage:
    def test_creates_message(self):
        msg = EmailMessage(
            to_email="alice@example.com",
            subject="Test Subject",
            body="Test body",
        )
        assert msg.to_email == "alice@example.com"
        assert msg.subject == "Test Subject"
        assert msg.body == "Test body"


class TestSendEmail:
    @patch("core.notifications.channels.email._get_sendgrid_client")
    def test_sends_email_via_sendgrid(self, mock_get_client):
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        mock_response = MagicMock()
        mock_response.status_code = 202
        mock_client.send.return_value = mock_response

        result = send_email(
            to_email="alice@example.com",
            subject="Test Subject",
            body="Test body",
        )

        assert result is True
        mock_client.send.assert_called_once()

    @patch("core.notifications.channels.email._get_sendgrid_client")
    def test_returns_false_on_failure(self, mock_get_client):
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        mock_client.send.side_effect = Exception("API error")

        result = send_email(
            to_email="alice@example.com",
            subject="Test",
            body="Test",
        )

        assert result is False

    def test_returns_false_when_not_configured(self):
        with patch.dict("os.environ", {}, clear=True):
            with patch("core.notifications.channels.email.SENDGRID_API_KEY", None):
                result = send_email(
                    to_email="alice@example.com",
                    subject="Test",
                    body="Test",
                )
                assert result is False
