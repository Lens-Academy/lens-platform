#!/usr/bin/env python
"""
Create test data for scheduling/grouping testing.

Creates fake users with realistic availability patterns across various timezones,
then signs them up for a specified cohort.

Run locally:  python scripts/create_test_scheduling_data.py --cohort-id 1
Run staging:  railway run python scripts/create_test_scheduling_data.py --cohort-id 1
            or: DATABASE_URL=<staging-url> python scripts/create_test_scheduling_data.py --cohort-id 1

Delete: python scripts/delete_test_scheduling_data.py
"""

import argparse
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv

load_dotenv(".env.local")

from db_safety import check_database_safety

check_database_safety()

from sqlalchemy import insert, select
from core.database import get_connection
from core.tables import users, signups, cohorts, facilitators

# Test data prefix for easy cleanup
PREFIX = "sched_test_"

# Fake users with realistic availability patterns based on real data
# Format: { "day": ["HH:MM-HH:MM", ...] } in LOCAL time
# These have expanded windows (6-8 hours) to ensure some overlap across timezones


def _make_slots(start_hour: int, end_hour: int) -> list[str]:
    """Generate 30-min slots from start to end hour."""
    slots = []
    for h in range(start_hour, end_hour):
        slots.append(f"{h:02d}:00-{h:02d}:30")
        slots.append(f"{h:02d}:30-{h + 1:02d}:00")
    return slots


FAKE_USERS = [
    {
        "name": "Zurich Morning Person",
        "timezone": "Europe/Zurich",
        "role": "participant",
        "availability": {
            "Monday": _make_slots(8, 16),  # 8am-4pm
            "Tuesday": _make_slots(8, 16),
            "Wednesday": _make_slots(8, 14),
            "Thursday": _make_slots(8, 16),
            "Friday": _make_slots(8, 14),
        },
    },
    {
        "name": "London Facilitator",
        "timezone": "Europe/London",
        "role": "facilitator",
        "availability": {
            "Monday": _make_slots(14, 22),  # 2pm-10pm
            "Tuesday": _make_slots(14, 21),
            "Wednesday": _make_slots(14, 22),
            "Thursday": _make_slots(14, 20),
            "Friday": _make_slots(16, 22),
        },
    },
    {
        "name": "Chicago Afternoon",
        "timezone": "America/Chicago",
        "role": "participant",
        "availability": {
            "Monday": _make_slots(10, 18),  # 10am-6pm
            "Tuesday": _make_slots(10, 18),
            "Wednesday": _make_slots(10, 18),
            "Thursday": _make_slots(10, 18),
            "Friday": _make_slots(10, 16),
        },
    },
    {
        "name": "Denver Flexible",
        "timezone": "America/Denver",
        "role": "participant",
        "availability": {
            "Monday": _make_slots(9, 17),  # 9am-5pm
            "Tuesday": _make_slots(9, 17),
            "Wednesday": _make_slots(9, 17),
            "Thursday": _make_slots(9, 17),
            "Saturday": _make_slots(10, 14),
            "Sunday": _make_slots(10, 14),
        },
    },
    {
        "name": "Paris Flexible",
        "timezone": "Europe/Paris",
        "role": "participant",
        "availability": {
            "Monday": _make_slots(9, 18),  # 9am-6pm
            "Tuesday": _make_slots(9, 18),
            "Wednesday": _make_slots(9, 18),
            "Thursday": _make_slots(14, 20),
            "Friday": _make_slots(9, 15),
        },
    },
    {
        "name": "Indianapolis Worker",
        "timezone": "America/Indianapolis",
        "role": "participant",
        "availability": {
            "Monday": _make_slots(8, 16),  # 8am-4pm
            "Tuesday": _make_slots(8, 16),
            "Wednesday": _make_slots(8, 16),
            "Thursday": _make_slots(8, 16),
            "Friday": _make_slots(8, 14),
        },
    },
    {
        "name": "NYC Facilitator",
        "timezone": "America/New_York",
        "role": "facilitator",
        "availability": {
            "Monday": _make_slots(12, 21),  # noon-9pm
            "Tuesday": _make_slots(12, 21),
            "Wednesday": _make_slots(12, 21),
            "Thursday": _make_slots(12, 21),
            "Friday": _make_slots(14, 20),
        },
    },
    {
        "name": "Auckland Evening",
        "timezone": "Pacific/Auckland",
        "role": "participant",
        "availability": {
            # Auckland evening = US/Europe morning
            "Monday": _make_slots(18, 23),  # 6pm-11pm
            "Tuesday": _make_slots(18, 23),
            "Wednesday": _make_slots(18, 23),
            "Thursday": _make_slots(18, 23),
            "Friday": _make_slots(18, 23),
        },
    },
    {
        "name": "Tbilisi Worker",
        "timezone": "Asia/Tbilisi",
        "role": "participant",
        "availability": {
            # Tbilisi is UTC+4, so 10am-6pm = 6am-2pm UTC
            "Monday": _make_slots(10, 18),
            "Tuesday": _make_slots(10, 18),
            "Wednesday": _make_slots(10, 18),
            "Thursday": _make_slots(10, 18),
            "Friday": _make_slots(10, 16),
        },
    },
    {
        "name": "Buenos Aires Professional",
        "timezone": "America/Buenos_Aires",
        "role": "participant",
        "availability": {
            # Buenos Aires is UTC-3, so 10am-6pm = 1pm-9pm UTC
            "Monday": _make_slots(10, 18),
            "Tuesday": _make_slots(10, 18),
            "Wednesday": _make_slots(10, 18),
            "Thursday": _make_slots(10, 18),
            "Friday": _make_slots(10, 16),
        },
    },
]


async def create_test_data(cohort_id: int):
    """Create test users and sign them up for the specified cohort."""
    async with get_connection() as conn:
        # Verify cohort exists
        cohort_result = await conn.execute(
            select(cohorts).where(cohorts.c.cohort_id == cohort_id)
        )
        cohort = cohort_result.mappings().first()
        if not cohort:
            print(f"Error: Cohort {cohort_id} not found")
            return

        print(f"Creating test scheduling data for cohort: {cohort['cohort_name']}")

        created_users = []
        facilitator_count = 0
        participant_count = 0

        for i, fake_user in enumerate(FAKE_USERS):
            role = fake_user.get("role", "participant")

            # Create user with availability
            user_result = await conn.execute(
                insert(users)
                .values(
                    discord_id=f"{PREFIX}discord_{i}_{cohort_id}",
                    discord_username=f"{PREFIX}{fake_user['name'].lower().replace(' ', '_')}",
                    nickname=fake_user["name"],
                    timezone=fake_user["timezone"],
                    availability_local=json.dumps(fake_user["availability"]),
                    availability_last_updated_at=datetime.now(timezone.utc),
                    tos_accepted_at=datetime.now(timezone.utc),
                )
                .returning(users)
            )
            user = dict(user_result.mappings().first())
            created_users.append(user)

            # If facilitator, create facilitator record
            if role == "facilitator":
                await conn.execute(
                    insert(facilitators).values(
                        user_id=user["user_id"],
                        certified_at=datetime.now(timezone.utc),
                        max_active_groups=2,
                    )
                )
                facilitator_count += 1
                print(
                    f"  Created facilitator: {fake_user['name']} ({fake_user['timezone']})"
                )
            else:
                participant_count += 1
                print(
                    f"  Created participant: {fake_user['name']} ({fake_user['timezone']})"
                )

            # Sign up for cohort
            await conn.execute(
                insert(signups).values(
                    user_id=user["user_id"],
                    cohort_id=cohort_id,
                    role=role,
                )
            )

        await conn.commit()
        print(
            f"\nCreated {len(created_users)} test users ({facilitator_count} facilitators, {participant_count} participants)"
        )
        print(f"Signed up for cohort {cohort_id}")
        print("\nTo run scheduling: Use /schedule command in Discord")
        print("To delete test data: python scripts/delete_test_scheduling_data.py")


def main():
    parser = argparse.ArgumentParser(description="Create test scheduling data")
    parser.add_argument(
        "--cohort-id",
        type=int,
        required=True,
        help="ID of the cohort to sign users up for",
    )
    args = parser.parse_args()

    asyncio.run(create_test_data(args.cohort_id))


if __name__ == "__main__":
    main()
