"""Tests for email channel."""

from unittest.mock import patch, MagicMock

from core.notifications.channels.email import (
    send_email,
    EmailMessage,
    markdown_to_html,
    markdown_to_plain_text,
)


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


class TestMarkdownConversion:
    def test_markdown_to_html_converts_links(self):
        text = "Click [here](https://example.com) to continue."
        html = markdown_to_html(text)

        assert '<a href="https://example.com">here</a>' in html
        assert "[here]" not in html

    def test_markdown_to_html_converts_multiple_links(self):
        text = "[Link 1](https://one.com) and [Link 2](https://two.com)"
        html = markdown_to_html(text)

        assert '<a href="https://one.com">Link 1</a>' in html
        assert '<a href="https://two.com">Link 2</a>' in html

    def test_markdown_to_html_preserves_newlines(self):
        text = "Line 1\nLine 2"
        html = markdown_to_html(text)

        assert "<br>" in html

    def test_markdown_to_html_wraps_in_html_structure(self):
        text = "Hello"
        html = markdown_to_html(text)

        assert "<!DOCTYPE html>" in html
        assert "<html>" in html
        assert "<body" in html

    def test_markdown_to_plain_text_converts_links(self):
        text = "Click [here](https://example.com) to continue."
        plain = markdown_to_plain_text(text)

        assert plain == "Click here (https://example.com) to continue."

    def test_markdown_to_plain_text_converts_multiple_links(self):
        text = "[Link 1](https://one.com) and [Link 2](https://two.com)"
        plain = markdown_to_plain_text(text)

        assert plain == "Link 1 (https://one.com) and Link 2 (https://two.com)"

    def test_markdown_to_plain_text_preserves_non_links(self):
        text = "No links here, just text."
        plain = markdown_to_plain_text(text)

        assert plain == text
