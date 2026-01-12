"""SendGrid email delivery channel."""

import os
from dataclasses import dataclass

from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail


SENDGRID_API_KEY = os.environ.get("SENDGRID_API_KEY")
FROM_EMAIL = os.environ.get("FROM_EMAIL", "team@lensacademy.org")

_client: SendGridAPIClient | None = None


@dataclass
class EmailMessage:
    """Email message data."""

    to_email: str
    subject: str
    body: str


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

    Args:
        to_email: Recipient email address
        subject: Email subject line
        body: Plain text email body

    Returns:
        True if sent successfully, False otherwise
    """
    client = _get_sendgrid_client()
    if not client:
        print("Warning: SendGrid not configured (SENDGRID_API_KEY not set)")
        return False

    try:
        message = Mail(
            from_email=FROM_EMAIL,
            to_emails=to_email,
            subject=subject,
            plain_text_content=body,
        )

        response = client.send(message)
        return response.status_code in (200, 201, 202)

    except Exception as e:
        print(f"Failed to send email to {to_email}: {e}")
        return False
