#!/usr/bin/env python3
"""Backfill default referral links for existing users who don't have one."""

import asyncio
from dotenv import load_dotenv

load_dotenv(".env.local")

from core.database import get_transaction, get_connection
from core.tables import users, referral_links
from core.referrals import create_default_link
from sqlalchemy import select


async def backfill():
    async with get_connection() as conn:
        # Find users without a default referral link
        result = await conn.execute(
            select(
                users.c.user_id,
                users.c.nickname,
                users.c.discord_username,
                users.c.discord_id,
            ).where(
                ~users.c.user_id.in_(
                    select(referral_links.c.user_id).where(
                        referral_links.c.is_default.is_(True)
                    )
                )
            )
        )
        users_without_links = list(result.mappings())

    print(f"Found {len(users_without_links)} users without default referral links")

    for u in users_without_links:
        display_name = u["nickname"] or u["discord_username"] or u["discord_id"]
        async with get_transaction() as conn:
            link = await create_default_link(conn, u["user_id"], display_name)
        print(f"  Created /ref/{link['slug']} for user {u['user_id']} ({display_name})")

    print("Done!")


if __name__ == "__main__":
    asyncio.run(backfill())
