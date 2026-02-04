#!/usr/bin/env python
"""
Reset local dev database with fresh test data.

This script:
1. Drops all tables and recreates schema via Alembic
2. Creates an admin user
3. Creates a test cohort with groups

Usage:
    python scripts/reset_dev_database.py --discord-id YOUR_DISCORD_ID

Example:
    python scripts/reset_dev_database.py --discord-id 1256932695297101936
"""

import argparse
import asyncio
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv

load_dotenv(".env.local")

from db_safety import check_database_safety

env = check_database_safety()

if env != "local":
    print("ERROR: This script only runs on local databases!")
    print("It will DELETE ALL DATA. Use only for development.")
    sys.exit(1)


async def reset_database(discord_id: str, discord_username: str = "admin"):
    """Reset database with fresh test data."""
    from sqlalchemy import insert, text
    from core.database import get_connection
    from core.tables import users, cohorts, groups, groups_users, meetings

    # Import text for raw SQL

    print("\n" + "=" * 60)
    print("RESETTING LOCAL DEV DATABASE")
    print("=" * 60)

    # Step 1: Drop and recreate schema
    print("\n[1/4] Dropping and recreating schema...")

    # Use raw SQL to drop everything and recreate
    async with get_connection() as conn:
        # Drop all tables with CASCADE (handles dependencies)
        await conn.execute(text("DROP SCHEMA public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
        await conn.commit()
        print("  ✓ Dropped all tables")

    # Use SQLAlchemy to create current schema (faster than alembic for fresh DB)
    from core.tables import metadata
    from core.database import get_engine

    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(metadata.create_all)
    print("  ✓ Schema created from SQLAlchemy models")

    # Step 2: Create admin user
    print("\n[2/4] Creating admin user...")
    async with get_connection() as conn:
        result = await conn.execute(
            insert(users)
            .values(
                discord_id=discord_id,
                discord_username=discord_username,
                nickname="Admin",
                timezone="UTC",
                is_admin=True,
                tos_accepted_at=datetime.now(timezone.utc),
            )
            .returning(users.c.user_id)
        )
        admin_user_id = result.scalar()
        await conn.commit()
        print(f"  ✓ Created admin user (ID: {admin_user_id}, Discord: {discord_id})")

    # Step 3: Create test cohort
    print("\n[3/4] Creating test cohort...")
    start_date = date.today() + timedelta(days=7)  # Start next week

    async with get_connection() as conn:
        result = await conn.execute(
            insert(cohorts)
            .values(
                cohort_name="Dev Test Cohort",
                course_slug="default",
                cohort_start_date=start_date,
                duration_days=42,
                number_of_group_meetings=6,
                status="active",
                # No Discord IDs - will be created fresh on realize
            )
            .returning(cohorts.c.cohort_id)
        )
        cohort_id = result.scalar()
        await conn.commit()
        print(f"  ✓ Created cohort (ID: {cohort_id}, starts: {start_date})")

    # Step 4: Create test groups with fake members
    print("\n[4/4] Creating test groups...")

    test_groups = [
        {"name": "Wednesday Afternoon", "time": "Wednesday 15:00", "members": 3},
        {"name": "Thursday Evening", "time": "Thursday 19:00", "members": 4},
        {"name": "Friday Morning", "time": "Friday 10:00", "members": 5},
        {"name": "Saturday Brunch", "time": "Saturday 11:00", "members": 2},
    ]

    async with get_connection() as conn:
        for group_data in test_groups:
            # Create group
            result = await conn.execute(
                insert(groups)
                .values(
                    group_name=group_data["name"],
                    cohort_id=cohort_id,
                    recurring_meeting_time_utc=group_data["time"],
                    status="preview",  # Ready to be realized
                )
                .returning(groups.c.group_id)
            )
            group_id = result.scalar()

            # Calculate first meeting
            now = datetime.now(timezone.utc)
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
            days_until = (target_day - now.weekday()) % 7
            if days_until == 0:
                days_until = 7
            first_meeting = now.replace(
                hour=hour, minute=0, second=0, microsecond=0
            ) + timedelta(days=days_until)

            # Create meetings
            for week in range(6):
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
            for i in range(group_data["members"]):
                user_result = await conn.execute(
                    insert(users)
                    .values(
                        discord_id=f"fake_{group_id}_{i}",
                        discord_username=f"testuser_{group_id}_{i}",
                        nickname=f"Test Member {i + 1}",
                        timezone="UTC",
                        tos_accepted_at=datetime.now(timezone.utc),
                    )
                    .returning(users.c.user_id)
                )
                user_id = user_result.scalar()

                await conn.execute(
                    insert(groups_users).values(
                        user_id=user_id,
                        group_id=group_id,
                        role="facilitator" if i == 0 else "participant",
                        status="active",
                    )
                )

            print(
                f"  ✓ {group_data['name']}: {group_data['members']} members (status=preview)"
            )

        await conn.commit()

    print("\n" + "=" * 60)
    print("DEV DATABASE RESET COMPLETE")
    print("=" * 60)
    print(f"""
Next steps:
  1. Start the server: python main.py --dev
  2. Go to: http://localhost:3002/admin
  3. Sign in with Discord
  4. Groups tab → Select 'Dev Test Cohort'
  5. Click 'Realize All Preview' to test verbose feedback

Admin user:
  Discord ID: {discord_id}
  is_admin: True

Test cohort:
  Name: Dev Test Cohort
  Groups: {len(test_groups)} (all status=preview)
""")


def main():
    parser = argparse.ArgumentParser(description="Reset local dev database")
    parser.add_argument(
        "--discord-id",
        required=True,
        help="Your Discord user ID (for admin account)",
    )
    parser.add_argument(
        "--discord-username",
        default="admin",
        help="Your Discord username (default: 'admin')",
    )
    args = parser.parse_args()

    asyncio.run(reset_database(args.discord_id, args.discord_username))


if __name__ == "__main__":
    main()
