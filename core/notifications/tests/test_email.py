"""Tests for email channel."""

from unittest.mock import patch

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
    @patch("core.notifications.channels.email.resend.Emails.send")
    @patch("core.notifications.channels.email.RESEND_API_KEY", "re_test_key")
    def test_sends_email_via_resend(self, mock_send):
        mock_send.return_value = {"id": "email_123"}

        result = send_email(
            to_email="alice@example.com",
            subject="Test Subject",
            body="Test body with [a link](https://example.com)",
        )

        assert result is True
        mock_send.assert_called_once()
        params = mock_send.call_args[0][0]
        assert params["to"] == ["alice@example.com"]
        assert params["subject"] == "Test Subject"
        assert '<a href="https://example.com">a link</a>' in params["html"]
        assert "a link (https://example.com)" in params["text"]
        assert "reply_to" in params
        assert "from" in params

    @patch("core.notifications.channels.email.resend.Emails.send")
    @patch("core.notifications.channels.email.RESEND_API_KEY", "re_test_key")
    def test_sends_email_with_overrides(self, mock_send):
        mock_send.return_value = {"id": "email_123"}

        result = send_email(
            to_email="alice@example.com",
            subject="Test",
            body="Test",
            from_email="luc@mail.lensacademy.org",
            from_name="Luc from Lens Academy",
            reply_to="luc@lensacademy.org",
        )

        assert result is True
        params = mock_send.call_args[0][0]
        assert params["from"] == "Luc from Lens Academy <luc@mail.lensacademy.org>"
        assert params["reply_to"] == "luc@lensacademy.org"

    @patch("core.notifications.channels.email.resend.Emails.send")
    @patch("core.notifications.channels.email.RESEND_API_KEY", "re_test_key")
    def test_returns_false_on_failure(self, mock_send):
        mock_send.side_effect = Exception("API error")

        result = send_email(
            to_email="alice@example.com",
            subject="Test",
            body="Test",
        )

        assert result is False

    def test_returns_false_when_not_configured(self):
        with patch("core.notifications.channels.email.RESEND_API_KEY", None):
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
