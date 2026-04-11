#!/usr/bin/env python
"""
Create test groups for testing the group selection UI.

Creates groups with varying member counts to test badge logic and UI.
Groups are created with status="preview" so they can be realized via
the /realize_groups Discord command to create channels.

Run locally:  python scripts/create_test_groups.py --cohort-id 1
Realize:      Use /realize_groups in Discord (creates channels)
Delete:       python scripts/delete_test_groups.py

Groups created:
- Group with 3 members (best_size badge)
- Group with 4 members (best_size badge)
- Group with 5 members (no badge)
- Group with 6 members (no badge)
- Group with 7 members (at capacity, still shown)
- Group with 8 members (full, hidden from UI)
"""

import argparse
import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv

load_dotenv(".env.local")

from db_safety import check_database_safety

check_database_safety()

from sqlalchemy import insert, select
from core.database import get_connection
from core.tables import users, groups, groups_users, meetings, cohorts

# Test data prefix for easy cleanup
PREFIX = "group_test_"

# Groups with different meeting times (UTC)
TEST_GROUPS = [
    {"name": "Wednesday Afternoon", "time": "Wednesday 15:00", "target_members": 3},
    {"name": "Thursday Evening", "time": "Thursday 19:00", "target_members": 4},
    {"name": "Friday Morning", "time": "Friday 10:00", "target_members": 5},
    {"name": "Saturday Brunch", "time": "Saturday 11:00", "target_members": 6},
    {"name": "Sunday Study", "time": "Sunday 14:00", "target_members": 7},
    {"name": "Monday Night (Full)", "time": "Monday 20:00", "target_members": 8},
]


async def create_test_groups(cohort_id: int):
    """Create test groups with fake members."""
    async with get_connection() as conn:
        # Verify cohort exists
        cohort_result = await conn.execute(
            select(cohorts).where(cohorts.c.cohort_id == cohort_id)
        )
        cohort = cohort_result.mappings().first()
        if not cohort:
            print(f"Error: Cohort {cohort_id} not found")
            return

        print(f"Creating test groups for cohort: {cohort['cohort_name']}")

        # Calculate first meeting date (next occurrence of each day)
        now = datetime.now(timezone.utc)

        for group_data in TEST_GROUPS:
            # Create the group
            group_result = await conn.execute(
                insert(groups)
                .values(
                    group_name=f"{PREFIX}{group_data['name']}",
                    cohort_id=cohort_id,
                    recurring_meeting_time_utc=group_data["time"],
                    status="preview",  # Preview so they can be realized
                )
                .returning(groups)
            )
            group = dict(group_result.mappings().first())
            group_id = group["group_id"]

            # Calculate first meeting time
            day_name = group_data["time"].split()[0]
            hour = int(group_data["time"].split()[1].split(":")[0])
            days = [
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
                "Sunday",
            ]
            target_day = days.index(day_name)
            current_day = now.weekday()
            days_until = (target_day - current_day) % 7
            if days_until == 0:
                days_until = 7  # Next week

            first_meeting = now.replace(
                hour=hour, minute=0, second=0, microsecond=0
            ) + timedelta(days=days_until)

            # Create 8 meetings (one per week)
            for week in range(8):
                meeting_time = first_meeting + timedelta(weeks=week)
                await conn.execute(
                    insert(meetings).values(
                        group_id=group_id,
                        cohort_id=cohort_id,
                        scheduled_at=meeting_time,
                        meeting_number=week + 1,
                    )
                )

            # Create fake members
            for i in range(group_data["target_members"]):
                # Create a fake user
                user_result = await conn.execute(
                    insert(users)
                    .values(
                        discord_id=f"{PREFIX}member_{group_id}_{i}",
                        discord_username=f"{PREFIX}user_{group_id}_{i}",
                        nickname=f"Test Member {i + 1}",
                        timezone="UTC",
                        tos_accepted_at=datetime.now(timezone.utc),
                    )
                    .returning(users)
                )
                user = dict(user_result.mappings().first())

                # Add to group
                await conn.execute(
                    insert(groups_users).values(
                        user_id=user["user_id"],
                        group_id=group_id,
                        role="facilitator" if i == 0 else "participant",
                        status="active",
                    )
                )

            badge = "best_size" if 3 <= group_data["target_members"] <= 4 else "none"
            visibility = "hidden" if group_data["target_members"] >= 8 else "visible"
            print(
                f"  Created: {group_data['name']} - {group_data['target_members']} members "
                f"(badge: {badge}, {visibility})"
            )

        await conn.commit()
        print(f"\nCreated {len(TEST_GROUPS)} test groups (status=preview)")
        print("\nNext steps:")
        print("  1. Use /realize_groups in Discord to create channels")
        print("  2. Sign in via Discord OAuth")
        print("  3. Go to /group or enroll in the cohort")
        print("\nTo delete test data: python scripts/delete_test_groups.py")


def main():
    parser = argparse.ArgumentParser(description="Create test groups")
    parser.add_argument(
        "--cohort-id",
        type=int,
        required=True,
        help="ID of the cohort to create groups for",
    )
    args = parser.parse_args()

    asyncio.run(create_test_groups(args.cohort_id))


if __name__ == "__main__":
    main()
