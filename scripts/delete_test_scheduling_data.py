#!/usr/bin/env python
"""
Delete test scheduling data created by create_test_scheduling_data.py.

Run locally:  python scripts/delete_test_scheduling_data.py
Run staging:  railway run python scripts/delete_test_scheduling_data.py
            or: DATABASE_URL=<staging-url> python scripts/delete_test_scheduling_data.py
"""

import asyncio
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv

load_dotenv(".env.local")

from db_safety import check_database_safety

check_database_safety()

from sqlalchemy import delete
from core.database import get_connection
from core.tables import users

# Must match create_test_scheduling_data.py
PREFIX = "sched_test_"


async def delete_test_data():
    """Delete all test scheduling data (cascade deletes signups, group memberships, etc.)."""
    async with get_connection() as conn:
        # Delete users with test prefix (cascade deletes signups, groups_users, etc.)
        result = await conn.execute(
            delete(users).where(users.c.discord_id.like(f"{PREFIX}%"))
        )
        count = result.rowcount

        await conn.commit()
        print(f"Deleted {count} test users (and their signups/memberships via cascade)")


if __name__ == "__main__":
    asyncio.run(delete_test_data())
