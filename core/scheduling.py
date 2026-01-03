"""
Cohort Scheduling - Database-backed scheduling using cohort_scheduler package.

Main entry point: schedule_cohort() - loads users from DB, runs scheduling, persists results.
"""

from dataclasses import dataclass, field

from sqlalchemy import select, update

import cohort_scheduler

from .availability import availability_json_to_intervals
from .database import get_transaction
from .queries.cohorts import get_cohort_by_id
from .queries.groups import create_group, add_user_to_group
from .tables import courses_users, users


# Day code mapping (used by tests)
DAY_MAP = {'M': 0, 'T': 1, 'W': 2, 'R': 3, 'F': 4, 'S': 5, 'U': 6}


@dataclass
class Person:
    """Represents a person for scheduling."""
    id: str
    name: str
    intervals: list  # List of (start_minutes, end_minutes)
    if_needed_intervals: list = field(default_factory=list)
    timezone: str = "UTC"


@dataclass
class CohortSchedulingResult:
    """Result of scheduling a single cohort."""
    cohort_id: int
    cohort_name: str
    groups_created: int
    users_grouped: int
    users_ungroupable: int
    groups: list  # list of dicts with group_id, group_name, member_count, meeting_time


def calculate_total_available_time(person: Person) -> int:
    """Calculate total minutes of availability for a person."""
    total = 0
    for start, end in person.intervals:
        total += (end - start)
    for start, end in person.if_needed_intervals:
        total += (end - start)
    return total


async def schedule_cohort(
    cohort_id: int,
    meeting_length: int = 60,
    min_people: int = 4,
    max_people: int = 8,
    num_iterations: int = 1000,
    balance: bool = True,
    use_if_needed: bool = True,
    progress_callback=None,
) -> CohortSchedulingResult:
    """
    Run scheduling for a specific cohort and persist results to database.

    1. Load users from courses_users WHERE cohort_id=X AND grouping_status='awaiting_grouping'
    2. Get their availability from users table
    3. Run scheduling algorithm
    4. Insert groups into 'groups' table
    5. Insert memberships into 'groups_users' table
    6. Update courses_users.grouping_status to 'grouped' or 'ungroupable'

    Returns: CohortSchedulingResult with summary
    """
    async with get_transaction() as conn:
        # Get cohort info
        cohort = await get_cohort_by_id(conn, cohort_id)
        if not cohort:
            raise ValueError(f"Cohort {cohort_id} not found")

        # Load users awaiting grouping for this cohort
        query = (
            select(
                users.c.user_id,
                users.c.discord_id,
                users.c.nickname,
                users.c.discord_username,
                users.c.timezone,
                users.c.availability_local,
                users.c.if_needed_availability_local,
                courses_users.c.cohort_role,
            )
            .join(courses_users, users.c.user_id == courses_users.c.user_id)
            .where(courses_users.c.cohort_id == cohort_id)
            .where(courses_users.c.grouping_status == "awaiting_grouping")
        )
        result = await conn.execute(query)
        user_rows = [dict(row) for row in result.mappings()]

        if not user_rows:
            return CohortSchedulingResult(
                cohort_id=cohort_id,
                cohort_name=cohort["cohort_name"],
                groups_created=0,
                users_grouped=0,
                users_ungroupable=0,
                groups=[],
            )

        # Convert to Person objects for scheduling
        people = []
        user_id_map = {}  # discord_id -> user_id for later
        facilitator_ids = set()

        for row in user_rows:
            discord_id = row["discord_id"]
            user_id_map[discord_id] = row["user_id"]
            user_timezone = row["timezone"] or "UTC"

            # Parse availability from JSON format, converting from local to UTC
            intervals = availability_json_to_intervals(row["availability_local"], user_timezone)
            if_needed = availability_json_to_intervals(row["if_needed_availability_local"], user_timezone)

            if not intervals and not if_needed:
                continue  # Skip users with no availability

            name = row["nickname"] or row["discord_username"] or f"User {row['user_id']}"
            person = Person(
                id=discord_id,
                name=name,
                intervals=intervals,
                if_needed_intervals=if_needed,
                timezone=user_timezone,
            )
            people.append(person)

            if row["cohort_role"] == "facilitator":
                facilitator_ids.add(discord_id)

        if not people:
            return CohortSchedulingResult(
                cohort_id=cohort_id,
                cohort_name=cohort["cohort_name"],
                groups_created=0,
                users_grouped=0,
                users_ungroupable=len(user_rows),
                groups=[],
            )

        # Run scheduling algorithm
        scheduling_result = cohort_scheduler.schedule(
            people=people,
            meeting_length=meeting_length,
            min_people=min_people,
            max_people=max_people,
            num_iterations=num_iterations,
            facilitator_ids=facilitator_ids if facilitator_ids else None,
            use_if_needed=use_if_needed,
            balance=balance,
            progress_callback=progress_callback,
        )
        solution = scheduling_result.groups

        # Persist groups to database
        created_groups = []
        grouped_user_ids = set()

        if solution:
            for i, group in enumerate(solution, 1):
                # Format meeting time
                if group.selected_time:
                    meeting_time = cohort_scheduler.format_time_range(*group.selected_time)
                else:
                    meeting_time = "TBD"

                # Create group record
                group_record = await create_group(
                    conn,
                    cohort_id=cohort_id,
                    group_name=f"Group {i}",
                    recurring_meeting_time_utc=meeting_time,
                )

                # Add members to group
                for person in group.people:
                    user_id = user_id_map.get(person.id)
                    if user_id:
                        role = "facilitator" if person.id in facilitator_ids else "participant"
                        await add_user_to_group(conn, group_record["group_id"], user_id, role)
                        grouped_user_ids.add(user_id)

                created_groups.append({
                    "group_id": group_record["group_id"],
                    "group_name": group_record["group_name"],
                    "member_count": len(group.people),
                    "meeting_time": meeting_time,
                })

        # Update grouping_status for all users
        all_user_ids = [row["user_id"] for row in user_rows]
        ungroupable_user_ids = [uid for uid in all_user_ids if uid not in grouped_user_ids]

        if grouped_user_ids:
            await conn.execute(
                update(courses_users)
                .where(courses_users.c.cohort_id == cohort_id)
                .where(courses_users.c.user_id.in_(list(grouped_user_ids)))
                .values(grouping_status="grouped")
            )

        if ungroupable_user_ids:
            await conn.execute(
                update(courses_users)
                .where(courses_users.c.cohort_id == cohort_id)
                .where(courses_users.c.user_id.in_(ungroupable_user_ids))
                .values(grouping_status="ungroupable")
            )

        return CohortSchedulingResult(
            cohort_id=cohort_id,
            cohort_name=cohort["cohort_name"],
            groups_created=len(created_groups),
            users_grouped=len(grouped_user_ids),
            users_ungroupable=len(ungroupable_user_ids),
            groups=created_groups,
        )
