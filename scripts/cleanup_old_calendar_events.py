#!/usr/bin/env python3
"""
Delete old individual calendar events from Google Calendar.

Run BEFORE the migration that removes google_calendar_event_id column.

Usage:
    python scripts/cleanup_old_calendar_events.py [--dry-run]
"""

import asyncio
import argparse

from core.database import get_connection
from core.calendar.client import batch_delete_events
from sqlalchemy import select


async def cleanup_old_events(dry_run: bool = True):
    """Delete all individual meeting calendar events."""

    # Import here to avoid circular imports
    from core.tables import meetings

    async with get_connection() as conn:
        # Find all meetings with individual calendar events
        result = await conn.execute(
            select(meetings.c.meeting_id, meetings.c.google_calendar_event_id).where(
                meetings.c.google_calendar_event_id.isnot(None)
            )
        )
        rows = list(result.mappings())

    if not rows:
        print("No individual calendar events found.")
        return

    event_ids = [row["google_calendar_event_id"] for row in rows]
    print(f"Found {len(event_ids)} individual calendar events to delete.")

    if dry_run:
        print("DRY RUN - would delete these events:")
        for eid in event_ids[:10]:
            print(f"  - {eid}")
        if len(event_ids) > 10:
            print(f"  ... and {len(event_ids) - 10} more")
        return

    # Delete in batches of 50 (Google API limit)
    BATCH_SIZE = 50
    deleted = 0
    failed = 0

    for i in range(0, len(event_ids), BATCH_SIZE):
        batch = event_ids[i : i + BATCH_SIZE]
        results = batch_delete_events(batch)

        if results:
            for event_id, result in results.items():
                if result["success"]:
                    deleted += 1
                else:
                    failed += 1
                    print(f"  Failed to delete {event_id}: {result['error']}")

        print(f"Progress: {i + len(batch)}/{len(event_ids)}")

    print(f"\nDeleted: {deleted}, Failed: {failed}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", default=True)
    parser.add_argument("--execute", action="store_true", help="Actually delete events")
    args = parser.parse_args()

    asyncio.run(cleanup_old_events(dry_run=not args.execute))
