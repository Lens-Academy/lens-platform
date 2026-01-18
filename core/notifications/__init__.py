"""
Notification system for sending emails and Discord messages.

Public API:
    send_notification(user_id, message_type, context) - Send immediately
    schedule_reminder(job_id, run_at, ...) - Schedule for later
    cancel_reminders(pattern) - Cancel scheduled jobs

High-level actions:
    notify_welcome(user_id) - Send welcome notification
    notify_group_assigned(...) - Send group assignment + calendar invite
    schedule_meeting_reminders(...) - Schedule meeting reminders
    cancel_meeting_reminders(meeting_id) - Cancel meeting reminders
    reschedule_meeting_reminders(...) - Reschedule meeting reminders
"""

from .dispatcher import send_notification
from .scheduler import (
    schedule_reminder,
    cancel_reminders,
    init_scheduler,
    shutdown_scheduler,
)
from .actions import (
    notify_welcome,
    notify_group_assigned,
    schedule_meeting_reminders,
    cancel_meeting_reminders,
    reschedule_meeting_reminders,
)

__all__ = [
    # Low-level
    "send_notification",
    "schedule_reminder",
    "cancel_reminders",
    "init_scheduler",
    "shutdown_scheduler",
    # High-level actions
    "notify_welcome",
    "notify_group_assigned",
    "schedule_meeting_reminders",
    "cancel_meeting_reminders",
    "reschedule_meeting_reminders",
]
