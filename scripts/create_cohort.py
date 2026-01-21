#!/usr/bin/env python
"""
Create a new cohort.

Run locally:  python scripts/create_cohort.py --name "Feb 2026" --course-slug aisf --start-date 2026-02-01
Run staging:  railway run python scripts/create_cohort.py --name "Feb 2026" --course-slug aisf --start-date 2026-02-01

Example from production:
  cohort_name: "Alpha Cohort"
  course_slug: "default"
  cohort_start_date: "2026-01-26"
  duration_days: 42
  number_of_group_meetings: 6
"""

import argparse
import asyncio
import sys
from datetime import date
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv

load_dotenv(".env.local")

from db_safety import check_database_safety

check_database_safety()

from sqlalchemy import insert
from core.database import get_connection
from core.tables import cohorts


async def create_cohort(
    name: str,
    course_slug: str,
    start_date: date,
    duration_days: int,
    num_meetings: int,
):
    """Create a new cohort."""
    async with get_connection() as conn:
        result = await conn.execute(
            insert(cohorts)
            .values(
                cohort_name=name,
                course_slug=course_slug,
                cohort_start_date=start_date,
                duration_days=duration_days,
                number_of_group_meetings=num_meetings,
                status="active",
            )
            .returning(cohorts)
        )
        cohort = dict(result.mappings().first())
        await conn.commit()

        print("Created cohort:")
        print(f"  ID:            {cohort['cohort_id']}")
        print(f"  Name:          {cohort['cohort_name']}")
        print(f"  Course:        {cohort['course_slug']}")
        print(f"  Start date:    {cohort['cohort_start_date']}")
        print(f"  Duration:      {cohort['duration_days']} days")
        print(f"  Meetings:      {cohort['number_of_group_meetings']}")
        print(
            f"\nTo add test users: python scripts/create_test_scheduling_data.py --cohort-id {cohort['cohort_id']}"
        )


def main():
    parser = argparse.ArgumentParser(description="Create a new cohort")
    parser.add_argument(
        "--name",
        required=True,
        help="Cohort name (e.g., 'Feb 2026 Cohort')",
    )
    parser.add_argument(
        "--course-slug",
        default="default",
        help="Course slug (default: 'default')",
    )
    parser.add_argument(
        "--start-date",
        required=True,
        type=lambda s: date.fromisoformat(s),
        help="Start date in YYYY-MM-DD format",
    )
    parser.add_argument(
        "--duration-days",
        type=int,
        default=42,
        help="Duration in days (default: 42)",
    )
    parser.add_argument(
        "--num-meetings",
        type=int,
        default=6,
        help="Number of group meetings (default: 6)",
    )
    args = parser.parse_args()

    asyncio.run(
        create_cohort(
            name=args.name,
            course_slug=args.course_slug,
            start_date=args.start_date,
            duration_days=args.duration_days,
            num_meetings=args.num_meetings,
        )
    )


if __name__ == "__main__":
    main()
