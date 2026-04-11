#!/usr/bin/env python
"""
Delete test groups created by create_test_groups.py.

Run: python scripts/delete_test_groups.py
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

from sqlalchemy import delete, select
from core.database import get_connection
from core.tables import users, groups

# Test data prefix
PREFIX = "group_test_"


async def delete_test_groups():
    """Delete all test groups and their associated users."""
    async with get_connection() as conn:
        # Delete groups (cascades to groups_users and meetings)
        result = await conn.execute(
            select(groups).where(groups.c.group_name.like(f"{PREFIX}%"))
        )
        group_count = len(result.fetchall())

        await conn.execute(delete(groups).where(groups.c.group_name.like(f"{PREFIX}%")))

        # Delete test users
        result = await conn.execute(
            select(users).where(users.c.discord_id.like(f"{PREFIX}%"))
        )
        user_count = len(result.fetchall())

        await conn.execute(delete(users).where(users.c.discord_id.like(f"{PREFIX}%")))

        await conn.commit()

        print(f"Deleted {group_count} test groups")
        print(f"Deleted {user_count} test users")


def main():
    asyncio.run(delete_test_groups())


if __name__ == "__main__":
    main()
