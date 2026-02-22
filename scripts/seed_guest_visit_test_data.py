"""Seed test data for manual guest visit testing.

Resets the dev database, creates a cohort with 4 groups, adds you as
a participant, then realizes all groups via the running dev server
(creating Discord channels/roles).

Prerequisites:
  - Dev server running with bot: python main.py --dev --port 8100
  - .env and .env.local sourced

Usage:
    set -a && source .env && source .env.local && set +a
    PYTHONPATH=. .venv/bin/python scripts/seed_guest_visit_test_data.py
"""

import argparse
import asyncio
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import insert, text

from core.database import get_connection, get_engine
from core.tables import attendances, cohorts, groups, groups_users, meetings, metadata, users
from web_api.auth import create_jwt

DISCORD_ID = "1256932695297101936"
DISCORD_USERNAME = "lucbrinkman"


async def reset_schema():
    """Drop and recreate all tables."""
    print("[1/5] Resetting schema...")
    async with get_connection() as conn:
        await conn.execute(text("DROP SCHEMA public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
        await conn.commit()

    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(metadata.create_all)
    print("  Done")


async def seed_data():
    """Create cohort, groups, meetings, users."""
    print("[2/5] Creating admin user...")
    async with get_connection() as conn:
        result = await conn.execute(
            insert(users)
            .values(
                discord_id=DISCORD_ID,
                discord_username=DISCORD_USERNAME,
                nickname="Luc Brinkman",
                email="luc.brinkman@outlook.com",
                timezone="Europe/Amsterdam",
                is_admin=True,
                tos_accepted_at=datetime.now(timezone.utc),
            )
            .returning(users.c.user_id)
        )
        admin_id = result.scalar()
        await conn.commit()
    print(f"  Admin user_id={admin_id}")

    print("[3/5] Creating cohort and groups...")
    start_date = date.today() + timedelta(days=5)

    async with get_connection() as conn:
        result = await conn.execute(
            insert(cohorts)
            .values(
                cohort_name="Guest Visit Test Cohort",
                course_slug="default",
                cohort_start_date=start_date,
                duration_days=42,
                number_of_group_meetings=6,
                status="active",
            )
            .returning(cohorts.c.cohort_id)
        )
        cohort_id = result.scalar()
        await conn.commit()
    print(f"  Cohort id={cohort_id}")

    test_groups = [
        {"name": "Wednesday Afternoon", "time": "Wednesday 15:00", "members": 3},
        {"name": "Thursday Evening", "time": "Thursday 19:00", "members": 4},
        {"name": "Friday Morning", "time": "Friday 10:00", "members": 3},
        {"name": "Saturday Brunch", "time": "Saturday 11:00", "members": 3},
    ]

    group_ids = []
    async with get_connection() as conn:
        for gdata in test_groups:
            result = await conn.execute(
                insert(groups)
                .values(
                    group_name=gdata["name"],
                    cohort_id=cohort_id,
                    recurring_meeting_time_utc=gdata["time"],
                    status="preview",
                )
                .returning(groups.c.group_id)
            )
            group_id = result.scalar()
            group_ids.append(group_id)

            # Calculate first meeting time
            now = datetime.now(timezone.utc)
            day_name = gdata["time"].split()[0]
            hour = int(gdata["time"].split()[1].split(":")[0])
            days = [
                "Monday", "Tuesday", "Wednesday", "Thursday",
                "Friday", "Saturday", "Sunday",
            ]
            target_day = days.index(day_name)
            days_until = (target_day - now.weekday()) % 7
            if days_until == 0:
                days_until = 7
            first_meeting = now.replace(
                hour=hour, minute=0, second=0, microsecond=0
            ) + timedelta(days=days_until)

            # Create 6 weekly meetings
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

            # Create fake members (first one is facilitator)
            for i in range(gdata["members"]):
                user_result = await conn.execute(
                    insert(users)
                    .values(
                        discord_id=str(1000000000000000000 + group_id * 100 + i),
                        discord_username=f"testuser_{group_id}_{i}",
                        nickname=f"Test Member {i + 1}",
                        timezone="UTC",
                        tos_accepted_at=datetime.now(timezone.utc),
                    )
                    .returning(users.c.user_id)
                )
                uid = user_result.scalar()
                await conn.execute(
                    insert(groups_users).values(
                        user_id=uid,
                        group_id=group_id,
                        role="facilitator" if i == 0 else "participant",
                        status="active",
                    )
                )

            print(f"  Group {group_id}: {gdata['name']} ({gdata['members']} members, 6 meetings)")

        # Add admin as participant in the first group
        await conn.execute(
            insert(groups_users).values(
                user_id=admin_id,
                group_id=group_ids[0],
                role="participant",
                status="active",
            )
        )
        await conn.commit()
    print(f"  You (user_id={admin_id}) added as participant in group {group_ids[0]}")

    return cohort_id, group_ids


async def stamp_alembic():
    """Stamp alembic to head so future migrations work."""
    print("[4/5] Stamping alembic to head...")
    proc = await asyncio.create_subprocess_exec(
        ".venv/bin/alembic", "stamp", "head",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    await proc.wait()
    print("  Done")


async def realize_groups(group_ids: list[int], api_port: int):
    """Call the admin realize endpoint for each group on the running dev server."""
    print(f"[5/5] Realizing {len(group_ids)} groups via API (port {api_port})...")
    token = create_jwt(discord_user_id=DISCORD_ID, discord_username=DISCORD_USERNAME)

    async with httpx.AsyncClient(timeout=120) as client:
        for gid in group_ids:
            print(f"  Realizing group {gid}...", end=" ", flush=True)
            resp = await client.post(
                f"http://localhost:{api_port}/api/admin/groups/{gid}/realize",
                cookies={"session": token},
            )
            if resp.status_code != 200:
                print(f"ERROR: {resp.status_code} {resp.text}")
                continue

            data = resp.json()
            infra = data.get("infrastructure", {})
            text_ch = infra.get("text_channel", {}).get("status", "?")
            voice_ch = infra.get("voice_channel", {}).get("status", "?")
            print(f"text={text_ch}, voice={voice_ch}")


async def main(api_port: int, skip_realize: bool):
    await reset_schema()
    cohort_id, group_ids = await seed_data()
    await stamp_alembic()

    if skip_realize:
        print("\n[5/5] Skipping realize (--skip-realize)")
        print("  Groups are in 'preview' status. Realize from admin UI or rerun without --skip-realize.")
    else:
        await realize_groups(group_ids, api_port)

    print("\n" + "=" * 50)
    print("SETUP COMPLETE")
    print("=" * 50)
    print(f"  Cohort: {cohort_id}")
    print(f"  Groups: {group_ids}")
    print(f"  Your group: {group_ids[0]} (Wednesday Afternoon)")
    print(f"  Alternatives: {group_ids[1:]}")
    print()
    print("Test at: /reschedule")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed guest visit test data")
    parser.add_argument("--port", type=int, default=8100, help="API port (default: 8100)")
    parser.add_argument("--skip-realize", action="store_true", help="Skip Discord realize step")
    args = parser.parse_args()

    asyncio.run(main(args.port, args.skip_realize))
