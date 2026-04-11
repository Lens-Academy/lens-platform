#!/usr/bin/env python3
"""
One-time script to fix Discord usernames in the database.

The bug was that discord_username was getting set to the nickname (global_name)
instead of the actual Discord username. This script fetches the correct usernames
from Discord and updates the database.

Usage:
    python scripts/fix_discord_usernames.py [--dry-run]

Options:
    --dry-run    Show what would be updated without making changes
"""

import asyncio
import os
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

import discord
from dotenv import load_dotenv
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import create_async_engine, AsyncConnection

from core.tables import users


async def get_all_users_with_discord_ids(conn: AsyncConnection) -> list[dict]:
    """Get all users that have a discord_id."""
    result = await conn.execute(
        select(
            users.c.user_id,
            users.c.discord_id,
            users.c.discord_username,
            users.c.nickname,
        ).where(users.c.discord_id.isnot(None))
    )
    return [dict(row._mapping) for row in result.fetchall()]


async def update_discord_username(
    conn: AsyncConnection, user_id: int, new_username: str
) -> None:
    """Update the discord_username for a user."""
    await conn.execute(
        update(users)
        .where(users.c.user_id == user_id)
        .values(discord_username=new_username)
    )


async def main():
    load_dotenv()

    dry_run = "--dry-run" in sys.argv

    # Get database URL from environment or command line
    database_url = os.getenv("DATABASE_URL")
    if len(sys.argv) > 1 and sys.argv[1].startswith("postgresql"):
        database_url = sys.argv[1]

    if not database_url:
        print("Error: DATABASE_URL environment variable not set")
        print(
            "Usage: python scripts/fix_discord_usernames.py <database_url> [--dry-run]"
        )
        sys.exit(1)

    # Convert to async URL if needed
    if database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+asyncpg://", 1)

    # Get Discord token
    discord_token = os.getenv("DISCORD_BOT_TOKEN")
    if not discord_token:
        print("Error: DISCORD_BOT_TOKEN environment variable not set")
        sys.exit(1)

    print(f"{'DRY RUN - ' if dry_run else ''}Connecting to database...")

    # Create database engine with pgbouncer-compatible settings
    # (Supabase uses pgbouncer in transaction mode)
    engine = create_async_engine(
        database_url,
        connect_args={"statement_cache_size": 0},
        pool_pre_ping=True,
    )

    # Create Discord client (minimal intents, just need to fetch users)
    intents = discord.Intents.default()
    client = discord.Client(intents=intents)

    # Track stats
    stats = {
        "total": 0,
        "updated": 0,
        "already_correct": 0,
        "not_found": 0,
        "errors": 0,
    }

    @client.event
    async def on_ready():
        print(f"Discord bot connected as {client.user}")
        print("Fetching users from database...")

        # Fetch all users in a short-lived read transaction
        async with engine.begin() as conn:
            db_users = await get_all_users_with_discord_ids(conn)

        stats["total"] = len(db_users)
        print(f"Found {len(db_users)} users with Discord IDs")
        print()

        for i, db_user in enumerate(db_users, 1):
            user_id = db_user["user_id"]
            discord_id = db_user["discord_id"]
            current_username = db_user["discord_username"]
            nickname = db_user["nickname"]

            try:
                # Validate discord_id can be converted to int
                try:
                    discord_id_int = int(discord_id)
                except (ValueError, TypeError):
                    print(
                        f"[{i}/{len(db_users)}] ✗ User {user_id}: "
                        f"Invalid discord_id '{discord_id}'"
                    )
                    stats["errors"] += 1
                    continue

                # Fetch user from Discord API with retry for rate limits
                discord_user = None
                max_retries = 3
                for attempt in range(max_retries):
                    try:
                        discord_user = await client.fetch_user(discord_id_int)
                        break
                    except discord.HTTPException as e:
                        if e.status == 429 and attempt < max_retries - 1:
                            retry_after = getattr(e, "retry_after", 2.0)
                            print(
                                f"[{i}/{len(db_users)}] ⏳ Rate limited, "
                                f"waiting {retry_after}s..."
                            )
                            await asyncio.sleep(retry_after)
                        else:
                            raise

                actual_username = discord_user.name

                # Validate username is not empty
                if not actual_username or not actual_username.strip():
                    print(
                        f"[{i}/{len(db_users)}] ⚠ User {user_id}: "
                        f"Discord returned empty username, skipping"
                    )
                    stats["errors"] += 1
                    continue

                if current_username == actual_username:
                    print(
                        f"[{i}/{len(db_users)}] ✓ User {user_id}: "
                        f"'{current_username}' is correct"
                    )
                    stats["already_correct"] += 1
                else:
                    print(
                        f"[{i}/{len(db_users)}] ✏ User {user_id}: "
                        f"'{current_username}' → '{actual_username}' "
                        f"(nickname: '{nickname}')"
                    )
                    if not dry_run:
                        # Each update in its own transaction - commits immediately
                        async with engine.begin() as conn:
                            await update_discord_username(
                                conn, user_id, actual_username
                            )
                        stats["updated"] += 1
                    else:
                        stats["updated"] += 1  # Count what would be updated

            except discord.NotFound:
                print(
                    f"[{i}/{len(db_users)}] ⚠ User {user_id}: "
                    f"Discord user {discord_id} not found"
                )
                stats["not_found"] += 1

            except Exception as e:
                print(
                    f"[{i}/{len(db_users)}] ✗ User {user_id}: "
                    f"Error fetching {discord_id}: {e}"
                )
                stats["errors"] += 1

            # Rate limit protection - Discord allows 50 requests per second
            # but let's be conservative
            if i % 10 == 0:
                await asyncio.sleep(0.5)

        print()
        print("=" * 50)
        print("Summary:")
        print(f"  Total users:      {stats['total']}")
        print(f"  Already correct:  {stats['already_correct']}")
        print(f"  Updated:          {stats['updated']}")
        print(f"  Not found:        {stats['not_found']}")
        print(f"  Errors:           {stats['errors']}")

        if dry_run:
            print()
            print("This was a DRY RUN. No changes were made.")
            print("Run without --dry-run to apply changes.")

        await engine.dispose()
        await client.close()

    # Run the Discord client
    await client.start(discord_token)


if __name__ == "__main__":
    asyncio.run(main())
