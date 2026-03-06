#!/usr/bin/env python3
"""Fix meeting dates for Online 1 and Moscow local groups, add meeting 7 for all groups.

Usage: DATABASE_URL='...' .venv/bin/python scripts/fix_meeting_dates.py [--dry-run]

Context:
- Online 1 and Moscow local each skipped a week, so meetings 5-6 are dated 1 week early
- All 4 groups need a 7th meeting added (cohort originally had 6)
- Updates DB, prints curl commands for Discord/reminder sync
- Google Calendar left for manual update
"""

import argparse
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv

if not os.environ.get("DATABASE_URL"):
    load_dotenv()
    load_dotenv(".env.local", override=True)

# Support reading DATABASE_URL from a file (avoids shell quoting issues with special chars)
db_url_file = os.environ.get("DATABASE_URL_FILE")
if db_url_file:
    with open(db_url_file) as f:
        os.environ["DATABASE_URL"] = f.read().strip()

from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine


def utc(*args):
    return datetime(*args, tzinfo=timezone.utc)


# --- Configuration ---

MEETING_SHIFTS = {
    5: utc(2026, 3, 5, 17, 0),  # Online 1, meeting 5
    6: utc(2026, 3, 12, 17, 0),  # Online 1, meeting 6
    23: utc(2026, 3, 7, 10, 0),  # Moscow local, meeting 5
    24: utc(2026, 3, 14, 10, 0),  # Moscow local, meeting 6
}

MEETING_7 = {
    12: utc(2026, 3, 19, 17, 0),  # Online 1
    13: utc(2026, 3, 9, 20, 0),  # Online 2
    14: utc(2026, 3, 12, 20, 30),  # Online 3
    15: utc(2026, 3, 21, 10, 0),  # Moscow local
}

ALL_GROUP_IDS = [12, 13, 14, 15]
SHIFTED_MEETING_IDS = list(MEETING_SHIFTS.keys())

API_PORT = 8200


def make_engine():
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("ERROR: DATABASE_URL not set")
        sys.exit(1)
    if database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return create_async_engine(
        database_url,
        connect_args={"statement_cache_size": 0},
        pool_pre_ping=True,
    )


async def print_current_state(conn):
    result = await conn.execute(
        text("""
        SELECT m.meeting_id, m.group_id, g.group_name, m.meeting_number,
               m.scheduled_at, m.discord_event_id
        FROM meetings m
        JOIN groups g ON g.group_id = m.group_id
        WHERE m.group_id IN (12, 13, 14, 15)
        ORDER BY m.group_id, m.meeting_number
    """)
    )
    rows = result.fetchall()

    print("\n=== Current meetings ===")
    current_group = None
    for mid, gid, gname, mnum, sched, devt in rows:
        if gid != current_group:
            current_group = gid
            print(f"\n  Group {gid} ({gname}):")
        marker = " <-- SHIFT" if mid in MEETING_SHIFTS else ""
        print(f"    meeting {mnum} (id={mid}): {sched}  discord_event={devt}{marker}")

    result = await conn.execute(
        text("""
        SELECT c.cohort_id, c.cohort_name, c.number_of_group_meetings
        FROM cohorts c
        JOIN groups g ON g.cohort_id = c.cohort_id
        WHERE g.group_id = 12
        LIMIT 1
    """)
    )
    row = result.fetchone()
    if row:
        print(f"\n  Cohort {row[0]} ({row[1]}): number_of_group_meetings = {row[2]}")


async def main(dry_run: bool):
    engine = make_engine()

    for attempt in range(3):
        try:
            async with engine.begin() as conn:
                await print_current_state(conn)

                if dry_run:
                    print("\n[DRY RUN] Would make the following changes:")
                    print("  1. Set cohort number_of_group_meetings = 7")
                    print(f"  2. Shift meeting dates: {SHIFTED_MEETING_IDS}")
                    for mid, new_date in MEETING_SHIFTS.items():
                        print(f"     meeting_id={mid} -> {new_date}")
                    print("  3. Insert meeting 7 for groups:", ALL_GROUP_IDS)
                    for gid, sched in MEETING_7.items():
                        print(f"     group {gid} -> {sched}")
                    print(
                        f"  4. NULL discord_event_id for meeting_ids: {SHIFTED_MEETING_IDS}"
                    )
                    print("\n[DRY RUN] No changes made.")
                    return

                # Step 1: Update cohort number_of_group_meetings
                cohort_result = await conn.execute(
                    text("""
                    UPDATE cohorts SET number_of_group_meetings = 7
                    WHERE cohort_id = (SELECT cohort_id FROM groups WHERE group_id = 12)
                    RETURNING cohort_id, number_of_group_meetings
                """)
                )
                row = cohort_result.fetchone()
                print(
                    f"\n--- Step 1: Updated cohort {row[0]} number_of_group_meetings = {row[1]}"
                )

                # Step 2: Shift meeting dates
                for meeting_id, new_date in MEETING_SHIFTS.items():
                    result = await conn.execute(
                        text("""
                        UPDATE meetings SET scheduled_at = :new_date
                        WHERE meeting_id = :mid
                        RETURNING meeting_id, meeting_number, group_id, scheduled_at
                    """),
                        {"mid": meeting_id, "new_date": new_date},
                    )
                    row = result.fetchone()
                    print(
                        f"--- Step 2: Shifted meeting_id={row[0]} (group {row[2]}, meeting {row[1]}) -> {row[3]}"
                    )

                # Step 3: Insert meeting 7 for all groups
                for group_id, scheduled_at in MEETING_7.items():
                    result = await conn.execute(
                        text("""
                        INSERT INTO meetings (group_id, cohort_id, discord_voice_channel_id, meeting_number, scheduled_at)
                        SELECT :group_id, cohort_id, discord_voice_channel_id, 7, :scheduled_at
                        FROM meetings
                        WHERE group_id = :group_id
                        LIMIT 1
                        RETURNING meeting_id, group_id, meeting_number, scheduled_at
                    """),
                        {"group_id": group_id, "scheduled_at": scheduled_at},
                    )
                    row = result.fetchone()
                    print(
                        f"--- Step 3: Inserted meeting_id={row[0]} (group {row[1]}, meeting {row[2]}) -> {row[3]}"
                    )

                # Step 4: NULL discord_event_id for shifted meetings
                result = await conn.execute(
                    text("""
                    UPDATE meetings SET discord_event_id = NULL
                    WHERE meeting_id = ANY(:ids)
                    RETURNING meeting_id
                """),
                    {"ids": SHIFTED_MEETING_IDS},
                )
                nulled = [r[0] for r in result.fetchall()]
                print(f"--- Step 4: NULLed discord_event_id for meeting_ids: {nulled}")

                # Show final state
                await print_current_state(conn)

            break  # success
        except Exception as e:
            if attempt < 2 and "password authentication" in str(e):
                print(f"Connection failed (attempt {attempt + 1}/3), retrying...")
                await asyncio.sleep(1)
                continue
            raise

    await engine.dispose()

    print("\n=== Sync commands ===")
    print("Run these to sync Discord events and reminders:\n")
    for gid in ALL_GROUP_IDS:
        print(f"  curl -X POST http://localhost:{API_PORT}/api/admin/groups/{gid}/sync")
    print()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fix meeting dates and add meeting 7")
    parser.add_argument(
        "--dry-run", action="store_true", help="Preview changes without modifying DB"
    )
    args = parser.parse_args()
    asyncio.run(main(dry_run=args.dry_run))
