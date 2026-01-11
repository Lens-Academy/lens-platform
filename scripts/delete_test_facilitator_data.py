#!/usr/bin/env python
"""
Delete test data created by create_test_facilitator_data.py

Removes all data with the 'fac_test_' prefix:
- Users
- Groups
- Cohorts
- Courses
- Related lesson sessions and heartbeats (via cascade)

Run: python scripts/delete_test_facilitator_data.py
"""

import asyncio
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
load_dotenv('.env.local')

from sqlalchemy import text
from core.database import get_connection

PREFIX = "fac_test_"


async def delete_test_data():
    """Delete all test data with the fac_test_ prefix."""
    async with get_connection() as conn:
        print("Deleting test facilitator data...")

        # Get counts before deletion
        users_count = await conn.execute(
            text(f"SELECT COUNT(*) FROM users WHERE discord_id LIKE '{PREFIX}%'")
        )
        users_n = users_count.scalar()

        groups_count = await conn.execute(
            text(f"SELECT COUNT(*) FROM groups WHERE group_name LIKE '{PREFIX}%'")
        )
        groups_n = groups_count.scalar()

        cohorts_count = await conn.execute(
            text(f"SELECT COUNT(*) FROM cohorts WHERE cohort_name LIKE '{PREFIX}%'")
        )
        cohorts_n = cohorts_count.scalar()

        courses_count = await conn.execute(
            text(f"SELECT COUNT(*) FROM courses WHERE course_name LIKE '{PREFIX}%'")
        )
        courses_n = courses_count.scalar()

        if users_n == 0 and groups_n == 0 and cohorts_n == 0 and courses_n == 0:
            print("  No test data found to delete.")
            return

        print(f"  Found: {users_n} users, {groups_n} groups, {cohorts_n} cohorts, {courses_n} courses")

        # Delete in order (respecting foreign keys)
        # content_events cascade from lesson_sessions
        # lesson_sessions cascade from users
        # groups_users cascade from users and groups

        # 1. Delete content_events for test users
        await conn.execute(
            text(f"""
                DELETE FROM content_events
                WHERE user_id IN (SELECT user_id FROM users WHERE discord_id LIKE '{PREFIX}%')
            """)
        )
        print("  Deleted content_events")

        # 2. Delete lesson_sessions for test users
        await conn.execute(
            text(f"""
                DELETE FROM lesson_sessions
                WHERE user_id IN (SELECT user_id FROM users WHERE discord_id LIKE '{PREFIX}%')
            """)
        )
        print("  Deleted lesson_sessions")

        # 3. Delete groups_users for test users
        await conn.execute(
            text(f"""
                DELETE FROM groups_users
                WHERE user_id IN (SELECT user_id FROM users WHERE discord_id LIKE '{PREFIX}%')
            """)
        )
        print("  Deleted groups_users")

        # 4. Delete test users
        await conn.execute(
            text(f"DELETE FROM users WHERE discord_id LIKE '{PREFIX}%'")
        )
        print(f"  Deleted {users_n} users")

        # 5. Delete test groups
        await conn.execute(
            text(f"DELETE FROM groups WHERE group_name LIKE '{PREFIX}%'")
        )
        print(f"  Deleted {groups_n} groups")

        # 6. Delete test cohorts
        await conn.execute(
            text(f"DELETE FROM cohorts WHERE cohort_name LIKE '{PREFIX}%'")
        )
        print(f"  Deleted {cohorts_n} cohorts")

        # 7. Delete test courses
        await conn.execute(
            text(f"DELETE FROM courses WHERE course_name LIKE '{PREFIX}%'")
        )
        print(f"  Deleted {courses_n} courses")

        await conn.commit()
        print("\nTest data deleted successfully!")


if __name__ == "__main__":
    asyncio.run(delete_test_data())
