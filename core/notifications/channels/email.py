"""SendGrid email delivery channel."""

import os
import re
from dataclasses import dataclass

from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail


SENDGRID_API_KEY = os.environ.get("SENDGRID_API_KEY")
FROM_EMAIL = os.environ.get("FROM_EMAIL", "team@lensacademy.org")
FROM_NAME = os.environ.get("FROM_NAME", "Lens Academy")

# Regex to match markdown links: [text](url)
MARKDOWN_LINK_PATTERN = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")

_client: SendGridAPIClient | None = None


@dataclass
class EmailMessage:
    """Email message data."""

    to_email: str
    subject: str
    body: str


def markdown_to_html(text: str) -> str:
    """
    Convert markdown-style links to HTML and wrap in basic HTML structure.

    Converts [text](url) to <a href="url">text</a> and preserves line breaks.
    """
    # Convert markdown links to HTML links
    html_body = MARKDOWN_LINK_PATTERN.sub(r'<a href="\2">\1</a>', text)

    # Convert newlines to <br> for proper formatting
    html_body = html_body.replace("\n", "<br>\n")

    return f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.5; color: #333;">
{html_body}
</body>
</html>"""


def markdown_to_plain_text(text: str) -> str:
    """
    Convert markdown-style links to plain text with URL in parentheses.

    Converts [text](url) to text (url) for plain text email fallback.
    """
    return MARKDOWN_LINK_PATTERN.sub(r"\1 (\2)", text)


def _get_sendgrid_client() -> SendGridAPIClient | None:
    """Get or create SendGrid client singleton."""
    global _client
    if _client is None and SENDGRID_API_KEY:
        _client = SendGridAPIClient(SENDGRID_API_KEY)
    return _client


def send_email(
    to_email: str,
    subject: str,
    body: str,
) -> bool:
    """
    Send an email via SendGrid.

    The body can contain markdown-style links [text](url) which will be
    converted to HTML links. Both plain text and HTML versions are sent.

    Args:
        to_email: Recipient email address
        subject: Email subject line
        body: Email body (may contain markdown links)

    Returns:
        True if sent successfully, False otherwise
    """
    client = _get_sendgrid_client()
    if not client:
        print("Warning: SendGrid not configured (SENDGRID_API_KEY not set)")
        return False

    try:
        # Convert markdown links to appropriate formats
        plain_text = markdown_to_plain_text(body)
        html_content = markdown_to_html(body)

        message = Mail(
            from_email=(FROM_EMAIL, FROM_NAME),
            to_emails=to_email,
            subject=subject,
            plain_text_content=plain_text,
            html_content=html_content,
        )

        response = client.send(message)
        return response.status_code in (200, 201, 202)

    except Exception as e:
        print(f"Failed to send email to {to_email}: {e}")
        return False
