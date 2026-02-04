#!/usr/bin/env python3
"""
Manual integration test for the APScheduler refactor.

This script:
1. Creates a test meeting 3 minutes from now
2. Schedules a reminder for 1 minute from now (simulating 24h reminder)
3. Waits for it to fire
4. Shows if the notification was sent

Usage:
    python scripts/test_reminder_integration.py --email your@email.com

Requirements:
    - Local database running with DATABASE_URL set
    - SENDGRID_API_KEY set (or it will just log instead of sending)
"""

import argparse
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Load environment variables from .env files
from dotenv import load_dotenv
env_path = Path(__file__).parent.parent
load_dotenv(env_path / ".env")
load_dotenv(env_path / ".env.local", override=True)

# Set up logging to see what's happening
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    force=True,  # Force reconfigure in case other modules set it up
)
# Force flush on every log
for handler in logging.root.handlers:
    handler.flush()
logger = logging.getLogger(__name__)

# Also configure specific loggers we want to see
logging.getLogger("core.notifications").setLevel(logging.DEBUG)
logging.getLogger("apscheduler").setLevel(logging.DEBUG)


async def main(email: str, delay_seconds: int = 60):
    """Run the integration test."""
    from core.database import get_connection, get_transaction
    from core.tables import meetings, groups, users, groups_users, cohorts
    from core.enums import GroupStatus, GroupUserStatus
    import core.notifications.scheduler as scheduler_module
    from core.notifications.scheduler import (
        init_scheduler,
        shutdown_scheduler,
        schedule_reminder,
    )
    from sqlalchemy import select, insert, delete

    print(f"\n{'='*60}")
    print("APScheduler Integration Test")
    print(f"{'='*60}\n")

    # Initialize scheduler
    print("1. Initializing scheduler...")
    sched = init_scheduler(skip_if_db_unavailable=False)
    print(f"   Scheduler running: {sched is not None}")
    print(f"   Current jobs: {len(sched.get_jobs()) if sched else 0}")

    # Find or create test data
    print("\n2. Setting up test data...")

    async with get_connection() as conn:
        # Find your user by email
        user_result = await conn.execute(
            select(users.c.user_id, users.c.email, users.c.nickname)
            .where(users.c.email == email)
        )
        user = user_result.mappings().first()

        if not user:
            print(f"   ERROR: No user found with email {email}")
            print("   Please use an email that exists in your local database.")
            shutdown_scheduler()
            return

        print(f"   Found user: {user['nickname'] or user['email']} (id={user['user_id']})")

        # Find any active group the user is in
        group_result = await conn.execute(
            select(groups.c.group_id, groups.c.group_name, groups.c.discord_text_channel_id)
            .join(groups_users, groups.c.group_id == groups_users.c.group_id)
            .where(groups_users.c.user_id == user['user_id'])
            .where(groups_users.c.status == GroupUserStatus.active)
            .limit(1)
        )
        group = group_result.mappings().first()

        if not group:
            print(f"   ERROR: User is not in any active group")
            shutdown_scheduler()
            return

        print(f"   Found group: {group['group_name']} (id={group['group_id']})")

        # Find or create a test meeting
        meeting_time = datetime.now(timezone.utc) + timedelta(minutes=5)
        meeting_result = await conn.execute(
            select(meetings.c.meeting_id, meetings.c.scheduled_at)
            .where(meetings.c.group_id == group['group_id'])
            .where(meetings.c.scheduled_at > datetime.now(timezone.utc))
            .order_by(meetings.c.scheduled_at)
            .limit(1)
        )
        meeting = meeting_result.mappings().first()

        if meeting:
            print(f"   Using existing meeting: id={meeting['meeting_id']}, scheduled={meeting['scheduled_at']}")
            meeting_id = meeting['meeting_id']
        else:
            print("   No future meeting found - you'll need one in the database")
            shutdown_scheduler()
            return

    # Schedule a test reminder
    print(f"\n3. Scheduling test reminder...")
    run_at = datetime.now(timezone.utc) + timedelta(seconds=delay_seconds)
    print(f"   Meeting ID: {meeting_id}")
    print(f"   Reminder type: reminder_24h (test)")
    print(f"   Will fire at: {run_at.strftime('%H:%M:%S')} (in {delay_seconds} seconds)")

    schedule_reminder(
        meeting_id=meeting_id,
        reminder_type="reminder_24h",
        run_at=run_at,
    )

    # Show scheduled jobs
    print(f"\n4. Current scheduled jobs:")
    for job in sched.get_jobs():
        print(f"   - {job.id}: runs at {job.next_run_time}")

    # Wait for it to fire
    print(f"\n5. Waiting for reminder to fire...")
    print(f"   (This will take about {delay_seconds} seconds)")
    print(f"   Watch for notification logs below...\n")
    print("-" * 60)
    import sys
    sys.stdout.flush()

    try:
        # Wait in smaller chunks to show progress
        wait_total = delay_seconds + 10
        waited = 0
        while waited < wait_total:
            await asyncio.sleep(5)
            waited += 5
            # Check if job still exists (it won't after execution)
            jobs = [j.id for j in sched.get_jobs() if j.id.startswith("meeting_1_")]
            print(f"   [{waited}s] Jobs remaining: {jobs}")
            sys.stdout.flush()
    except KeyboardInterrupt:
        print("\n\nInterrupted by user")

    print("-" * 60)
    print("\n6. Test complete!")
    print(f"   Check your email ({email}) for the reminder.")
    print(f"   Also check the logs above for any errors.")

    # Cleanup
    shutdown_scheduler()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Test APScheduler reminder integration")
    parser.add_argument("--email", required=True, help="Your email address in the local DB")
    parser.add_argument("--delay", type=int, default=60, help="Seconds until reminder fires (default: 60)")
    args = parser.parse_args()

    asyncio.run(main(args.email, args.delay))
