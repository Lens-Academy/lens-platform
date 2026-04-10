"""Resend email delivery channel."""

import os
import re
from dataclasses import dataclass

import resend


RESEND_API_KEY = os.environ.get("RESEND_API_KEY")
FROM_EMAIL = os.environ.get("FROM_EMAIL", "team@mail.lensacademy.org")
FROM_NAME = os.environ.get("FROM_NAME", "Lens Academy")
REPLY_TO = os.environ.get("REPLY_TO", "team@lensacademy.org")

MARKDOWN_LINK_PATTERN = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")


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
    html_body = MARKDOWN_LINK_PATTERN.sub(r'<a href="\2">\1</a>', text)
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


def send_email(
    to_email: str,
    subject: str,
    body: str,
    from_email: str | None = None,
    from_name: str | None = None,
    reply_to: str | None = None,
) -> bool:
    """
    Send an email via Resend.

    The body can contain markdown-style links [text](url) which will be
    converted to HTML links. Both plain text and HTML versions are sent.

    Args:
        to_email: Recipient email address
        subject: Email subject line
        body: Email body (may contain markdown links)
        from_email: Override sender email (defaults to FROM_EMAIL env var)
        from_name: Override sender name (defaults to FROM_NAME env var)
        reply_to: Override reply-to address (defaults to REPLY_TO env var)

    Returns:
        True if sent successfully, False otherwise
    """
    if not RESEND_API_KEY:
        print("Warning: Resend not configured (RESEND_API_KEY not set)")
        return False

    resend.api_key = RESEND_API_KEY

    sender_email = from_email or FROM_EMAIL
    sender_name = from_name or FROM_NAME
    reply_to_addr = reply_to or REPLY_TO

    try:
        plain_text = markdown_to_plain_text(body)
        html_content = markdown_to_html(body)

        params: resend.Emails.SendParams = {
            "from": f"{sender_name} <{sender_email}>",
            "to": [to_email],
            "subject": subject,
            "html": html_content,
            "text": plain_text,
            "reply_to": reply_to_addr,
        }

        resend.Emails.send(params)
        return True

    except Exception as e:
        print(f"Failed to send email to {to_email}: {e}")
        return False
