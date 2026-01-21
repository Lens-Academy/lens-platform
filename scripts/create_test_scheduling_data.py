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
from core.tables import users, signups, cohorts

# Test data prefix for easy cleanup
PREFIX = "sched_test_"

# Fake users with realistic availability patterns based on real data
# Format: { "day": ["HH:MM-HH:MM", ...] } in LOCAL time
FAKE_USERS = [
    {
        "name": "Zurich Morning Person",
        "timezone": "Europe/Zurich",
        "availability": {
            "Monday": ["09:30-10:00", "10:00-10:30", "10:30-11:00", "11:00-11:30"],
            "Tuesday": ["09:30-10:00", "10:00-10:30", "10:30-11:00", "11:00-11:30"],
            "Wednesday": ["09:30-10:00", "10:00-10:30", "10:30-11:00"],
            "Thursday": ["09:30-10:00", "10:00-10:30", "10:30-11:00", "11:00-11:30"],
            "Friday": ["09:30-10:00", "10:00-10:30", "10:30-11:00"],
        },
    },
    {
        "name": "London Evening Worker",
        "timezone": "Europe/London",
        "availability": {
            "Monday": [
                "18:00-18:30",
                "18:30-19:00",
                "19:00-19:30",
                "19:30-20:00",
                "20:00-20:30",
            ],
            "Tuesday": ["18:00-18:30", "18:30-19:00", "19:00-19:30", "19:30-20:00"],
            "Wednesday": [
                "18:00-18:30",
                "18:30-19:00",
                "19:00-19:30",
                "19:30-20:00",
                "20:00-20:30",
            ],
            "Thursday": ["18:00-18:30", "18:30-19:00", "19:00-19:30"],
        },
    },
    {
        "name": "Chicago Afternoon",
        "timezone": "America/Chicago",
        "availability": {
            "Monday": ["14:00-14:30", "14:30-15:00", "15:00-15:30", "15:30-16:00"],
            "Wednesday": ["14:00-14:30", "14:30-15:00", "15:00-15:30", "15:30-16:00"],
            "Friday": [
                "14:00-14:30",
                "14:30-15:00",
                "15:00-15:30",
                "15:30-16:00",
                "16:00-16:30",
            ],
        },
    },
    {
        "name": "Denver Weekend Only",
        "timezone": "America/Denver",
        "availability": {
            "Saturday": [
                "10:00-10:30",
                "10:30-11:00",
                "11:00-11:30",
                "11:30-12:00",
                "12:00-12:30",
            ],
            "Sunday": ["10:00-10:30", "10:30-11:00", "11:00-11:30", "11:30-12:00"],
        },
    },
    {
        "name": "Paris Flexible",
        "timezone": "Europe/Paris",
        "availability": {
            "Monday": ["10:00-10:30", "10:30-11:00", "17:00-17:30", "17:30-18:00"],
            "Tuesday": [
                "10:00-10:30",
                "10:30-11:00",
                "17:00-17:30",
                "17:30-18:00",
                "18:00-18:30",
            ],
            "Wednesday": ["10:00-10:30", "10:30-11:00", "17:00-17:30", "17:30-18:00"],
            "Thursday": ["17:00-17:30", "17:30-18:00", "18:00-18:30"],
            "Friday": ["10:00-10:30", "10:30-11:00", "11:00-11:30"],
        },
    },
    {
        "name": "Indianapolis Mornings",
        "timezone": "America/Indianapolis",
        "availability": {
            "Monday": ["08:00-08:30", "08:30-09:00", "09:00-09:30"],
            "Tuesday": ["08:00-08:30", "08:30-09:00", "09:00-09:30"],
            "Wednesday": ["08:00-08:30", "08:30-09:00", "09:00-09:30", "09:30-10:00"],
            "Thursday": ["08:00-08:30", "08:30-09:00", "09:00-09:30"],
            "Friday": ["08:00-08:30", "08:30-09:00", "09:00-09:30"],
        },
    },
    {
        "name": "NYC Late Night",
        "timezone": "America/New_York",
        "availability": {
            "Monday": ["20:00-20:30", "20:30-21:00", "21:00-21:30", "21:30-22:00"],
            "Tuesday": ["20:00-20:30", "20:30-21:00", "21:00-21:30"],
            "Wednesday": ["20:00-20:30", "20:30-21:00", "21:00-21:30", "21:30-22:00"],
            "Thursday": ["20:00-20:30", "20:30-21:00", "21:00-21:30", "21:30-22:00"],
        },
    },
    {
        "name": "Auckland Early Bird",
        "timezone": "Pacific/Auckland",
        "availability": {
            "Monday": ["07:00-07:30", "07:30-08:00", "08:00-08:30"],
            "Tuesday": ["07:00-07:30", "07:30-08:00", "08:00-08:30", "08:30-09:00"],
            "Wednesday": ["07:00-07:30", "07:30-08:00", "08:00-08:30"],
            "Thursday": ["07:00-07:30", "07:30-08:00", "08:00-08:30"],
            "Friday": ["07:00-07:30", "07:30-08:00", "08:00-08:30", "08:30-09:00"],
        },
    },
    {
        "name": "Tbilisi Mixed",
        "timezone": "Asia/Tbilisi",
        "availability": {
            "Monday": ["11:00-11:30", "11:30-12:00", "19:00-19:30", "19:30-20:00"],
            "Tuesday": ["11:00-11:30", "11:30-12:00"],
            "Wednesday": ["19:00-19:30", "19:30-20:00", "20:00-20:30"],
            "Thursday": ["11:00-11:30", "11:30-12:00", "19:00-19:30", "19:30-20:00"],
            "Saturday": ["14:00-14:30", "14:30-15:00", "15:00-15:30"],
        },
    },
    {
        "name": "Buenos Aires Noon",
        "timezone": "America/Buenos_Aires",
        "availability": {
            "Monday": ["12:00-12:30", "12:30-13:00", "13:00-13:30"],
            "Tuesday": ["12:00-12:30", "12:30-13:00", "13:00-13:30", "13:30-14:00"],
            "Wednesday": ["12:00-12:30", "12:30-13:00", "13:00-13:30"],
            "Thursday": ["12:00-12:30", "12:30-13:00", "13:00-13:30"],
            "Friday": ["12:00-12:30", "12:30-13:00", "13:00-13:30", "13:30-14:00"],
        },
    },
]


async def create_test_data(cohort_id: int, role: str = "participant"):
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
        for i, fake_user in enumerate(FAKE_USERS):
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
            print(f"  Created user: {fake_user['name']} ({fake_user['timezone']})")

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
            f"\nCreated {len(created_users)} test users and signed them up for cohort {cohort_id}"
        )
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
    parser.add_argument(
        "--role",
        choices=["participant", "facilitator"],
        default="participant",
        help="Role for signups (default: participant)",
    )
    args = parser.parse_args()

    asyncio.run(create_test_data(args.cohort_id, args.role))


if __name__ == "__main__":
    main()
