#!/usr/bin/env python3
"""
Send test emails using the actual notification template pipeline.

Usage:
    python scripts/send_test_emails.py <email_address> [message_type]

Examples:
    python scripts/send_test_emails.py test@example.com welcome
    python scripts/send_test_emails.py test@example.com  # sends all types
"""

import sys
from datetime import datetime, timedelta
from pathlib import Path

import pytz

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from core.notifications.templates import get_message
from core.notifications.channels.email import send_email
from core.notifications.urls import (
    build_discord_invite_url,
    build_discord_channel_url,
    build_course_url,
)
from core.timezone import format_datetime_in_timezone


# Test timezone (simulate a user in Amsterdam)
TEST_TIMEZONE = "Europe/Amsterdam"


# Create a sample meeting time (next Wednesday at 15:00 UTC)
def get_sample_meeting_time() -> str:
    """Get a sample meeting datetime formatted in the test timezone."""
    # Find next Wednesday
    now = datetime.now(pytz.UTC)
    days_until_wednesday = (2 - now.weekday()) % 7
    if days_until_wednesday == 0:
        days_until_wednesday = 7
    next_wednesday = now + timedelta(days=days_until_wednesday)
    meeting_utc = next_wednesday.replace(hour=15, minute=0, second=0, microsecond=0)

    return format_datetime_in_timezone(meeting_utc, TEST_TIMEZONE)


def build_test_contexts() -> dict:
    """Build test contexts using the actual shared formatting functions."""
    meeting_time = get_sample_meeting_time()
    discord_channel = build_discord_channel_url(
        server_id="123456789", channel_id="987654321"
    )

    return {
        "welcome": {
            "name": "Test User",
            "discord_invite_url": build_discord_invite_url(),
        },
        "group_assigned": {
            "name": "Test User",
            "group_name": "Alpha Testers",
            "meeting_time": meeting_time,
            "member_names": "Alice, Bob, Charlie",
            "discord_channel_url": discord_channel,
        },
        "member_joined": {
            "name": "Test User",
            "group_name": "Alpha Testers",
            "meeting_time": meeting_time,
            "member_names": "Alice, Bob, Charlie, Test User",
            "discord_channel_url": discord_channel,
        },
        "meeting_reminder_24h": {
            "name": "Test User",
            "group_name": "Alpha Testers",
            "meeting_time": meeting_time,
            "module_list": "- Module 1: Introduction to AI Safety\n- Module 2: Alignment Problem",
            "module_url": build_course_url(),
            "discord_channel_url": discord_channel,
        },
        "meeting_reminder_1h": {
            "name": "Test User",
            "group_name": "Alpha Testers",
            "meeting_time": meeting_time,
            "discord_channel_url": discord_channel,
        },
        "module_nudge": {
            "name": "Test User",
            "meeting_time": meeting_time,
            "modules_remaining": "2",
            "module_list": "- Module 3: Technical Approaches\n- Module 4: Governance",
            "module_url": build_course_url(),
            "discord_channel_url": discord_channel,
        },
    }


def send_test_email(to_email: str, message_type: str, contexts: dict) -> bool:
    """Send a test email for a specific message type."""
    context = contexts.get(message_type)
    if not context:
        print(f"Unknown message type: {message_type}")
        return False

    try:
        subject = get_message(message_type, "email_subject", context)
        body = get_message(message_type, "email_body", context)
    except KeyError as e:
        print(f"Missing template for {message_type}: {e}")
        return False

    # Add [TEST] prefix to subject
    subject = f"[TEST] {subject}"

    print(f"\n{'=' * 60}")
    print(f"Sending: {message_type}")
    print(f"To: {to_email}")
    print(f"Subject: {subject}")
    print(f"{'=' * 60}")
    print(body[:500] + "..." if len(body) > 500 else body)
    print(f"{'=' * 60}")

    result = send_email(to_email, subject, body)
    print(f"Result: {'✓ Sent' if result else '✗ Failed'}")
    return result


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    to_email = sys.argv[1]
    contexts = build_test_contexts()
    message_types = sys.argv[2:] if len(sys.argv) > 2 else list(contexts.keys())

    print(f"Sending test emails to: {to_email}")
    print(f"Using timezone: {TEST_TIMEZONE}")
    print(f"Message types: {', '.join(message_types)}")

    results = {}
    for msg_type in message_types:
        results[msg_type] = send_test_email(to_email, msg_type, contexts)

    print(f"\n{'=' * 60}")
    print("Summary:")
    for msg_type, success in results.items():
        status = "✓" if success else "✗"
        print(f"  {status} {msg_type}")


if __name__ == "__main__":
    main()
