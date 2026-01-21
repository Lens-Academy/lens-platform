"""
Cohort Scheduling - Database-backed scheduling using cohort_scheduler package.

Main entry point: schedule_cohort() - loads users from DB, runs scheduling, persists results.
"""

from dataclasses import dataclass, field
from enum import Enum

from sqlalchemy import select, update

import cohort_scheduler

from .availability import availability_json_to_intervals, check_dst_warnings
from .database import get_transaction
from .enums import UngroupableReason as DBUngroupableReason
from .queries.cohorts import get_cohort_by_id
from .queries.groups import create_group, add_user_to_group
from .tables import signups, users, facilitators, groups, groups_users


# Day code mapping (used by tests)
DAY_MAP = {"M": 0, "T": 1, "W": 2, "R": 3, "F": 4, "S": 5, "U": 6}


@dataclass
class Person:
    """Represents a person for scheduling."""

    id: str
    name: str
    intervals: list  # List of (start_minutes, end_minutes)
    if_needed_intervals: list = field(default_factory=list)
    timezone: str = "UTC"


class UngroupableReason(str, Enum):
    """Reasons why a user couldn't be grouped."""

    NO_AVAILABILITY = "no_availability"  # User has no availability slots
    NO_OVERLAP_WITH_OTHERS = (
        "no_overlap_with_others"  # Availability doesn't overlap with enough other users
    )
    NO_FACILITATOR_OVERLAP = (
        "no_facilitator_overlap"  # No facilitator available for user's time slots
    )
    FACILITATOR_CAPACITY = (
        "facilitator_capacity"  # Facilitators at max groups, but user has overlap
    )
    INSUFFICIENT_GROUP_SIZE = (
        "insufficient_group_size"  # Could form group but not enough people
    )


@dataclass
class UngroupableDetail:
    """Details about why a user couldn't be grouped."""

    user_id: int
    discord_id: str
    name: str
    reason: UngroupableReason
    details: dict = field(default_factory=dict)  # Additional context


@dataclass
class CohortSchedulingResult:
    """Result of scheduling a single cohort."""

    cohort_id: int
    cohort_name: str
    groups_created: int
    users_grouped: int
    users_ungroupable: int
    groups: list  # list of dicts with group_id, group_name, member_count, meeting_time
    warnings: list = field(default_factory=list)  # DST warnings, etc.
    ungroupable_details: list = field(default_factory=list)  # List of UngroupableDetail


def calculate_total_available_time(person: Person) -> int:
    """Calculate total minutes of availability for a person."""
    total = 0
    for start, end in person.intervals:
        total += end - start
    for start, end in person.if_needed_intervals:
        total += end - start
    return total


def _intervals_overlap(
    intervals1: list, intervals2: list, min_overlap: int = 60
) -> bool:
    """Check if two sets of intervals have sufficient overlap."""
    for start1, end1 in intervals1:
        for start2, end2 in intervals2:
            overlap_start = max(start1, start2)
            overlap_end = min(end1, end2)
            if overlap_end - overlap_start >= min_overlap:
                return True
    return False


def _get_all_intervals(person: Person, use_if_needed: bool = True) -> list:
    """Get all intervals for a person, optionally including if-needed."""
    intervals = list(person.intervals)
    if use_if_needed:
        intervals.extend(person.if_needed_intervals)
    return intervals


def analyze_ungroupable_users(
    unassigned: list,
    all_people: list,
    facilitator_ids: set,
    facilitator_max_groups: dict,
    groups_created: int,
    meeting_length: int,
    min_people: int,
    user_id_map: dict,
) -> list[UngroupableDetail]:
    """
    Analyze why users couldn't be grouped and return detailed reasons.

    Args:
        unassigned: List of Person objects who weren't grouped
        all_people: All Person objects that were considered for scheduling
        facilitator_ids: Set of discord_ids who are facilitators
        facilitator_max_groups: Dict of facilitator discord_id -> max groups
        groups_created: Number of groups that were created
        meeting_length: Required meeting length in minutes
        min_people: Minimum people required per group
        user_id_map: Dict of discord_id -> user_id

    Returns:
        List of UngroupableDetail with reasons for each unassigned user
    """
    details = []

    # Build facilitator list
    facilitators = [p for p in all_people if p.id in facilitator_ids]

    # Calculate how many groups each facilitator is leading
    # (based on groups_created and facilitator count)
    facilitator_groups_used = {}
    if facilitator_ids and groups_created > 0:
        # Assume facilitators are distributed across groups
        # In reality, we'd need the actual group membership, but this is a heuristic
        for fac_id in facilitator_ids:
            max_groups = facilitator_max_groups.get(fac_id, 999)
            facilitator_groups_used[fac_id] = min(groups_created, max_groups)

    for person in unassigned:
        all_intervals = _get_all_intervals(person)

        # Check if user has any availability
        if not all_intervals:
            details.append(
                UngroupableDetail(
                    user_id=user_id_map.get(person.id, 0),
                    discord_id=person.id,
                    name=person.name,
                    reason=UngroupableReason.NO_AVAILABILITY,
                    details={"total_slots": 0},
                )
            )
            continue

        # If we have facilitators, check facilitator-related reasons
        if facilitator_ids:
            # Check overlap with any facilitator
            has_facilitator_overlap = False
            facilitators_with_overlap = []
            facilitators_at_capacity = []

            for fac in facilitators:
                fac_intervals = _get_all_intervals(fac)
                if _intervals_overlap(all_intervals, fac_intervals, meeting_length):
                    has_facilitator_overlap = True
                    facilitators_with_overlap.append(fac.id)

                    # Check if this facilitator is at capacity
                    max_groups = facilitator_max_groups.get(fac.id, 999)
                    used = facilitator_groups_used.get(fac.id, 0)
                    if used >= max_groups:
                        facilitators_at_capacity.append(fac.id)

            if not has_facilitator_overlap:
                details.append(
                    UngroupableDetail(
                        user_id=user_id_map.get(person.id, 0),
                        discord_id=person.id,
                        name=person.name,
                        reason=UngroupableReason.NO_FACILITATOR_OVERLAP,
                        details={
                            "user_slots": len(all_intervals),
                            "facilitator_count": len(facilitators),
                        },
                    )
                )
                continue

            # Has facilitator overlap but all overlapping facilitators at capacity
            if facilitators_with_overlap and len(facilitators_at_capacity) == len(
                facilitators_with_overlap
            ):
                details.append(
                    UngroupableDetail(
                        user_id=user_id_map.get(person.id, 0),
                        discord_id=person.id,
                        name=person.name,
                        reason=UngroupableReason.FACILITATOR_CAPACITY,
                        details={
                            "facilitators_with_overlap": len(facilitators_with_overlap),
                            "all_at_capacity": True,
                        },
                    )
                )
                continue

        # Check overlap with other unassigned users
        # (could they form a group if there was a facilitator?)
        overlapping_unassigned = 0
        for other in unassigned:
            if other.id == person.id:
                continue
            other_intervals = _get_all_intervals(other)
            if _intervals_overlap(all_intervals, other_intervals, meeting_length):
                overlapping_unassigned += 1

        if overlapping_unassigned + 1 < min_people:  # +1 for self
            details.append(
                UngroupableDetail(
                    user_id=user_id_map.get(person.id, 0),
                    discord_id=person.id,
                    name=person.name,
                    reason=UngroupableReason.INSUFFICIENT_GROUP_SIZE,
                    details={
                        "overlapping_users": overlapping_unassigned + 1,
                        "min_required": min_people,
                    },
                )
            )
            continue

        # If we get here, it's likely a complex scheduling issue
        # (e.g., could form group but scheduling algorithm didn't find optimal solution)
        details.append(
            UngroupableDetail(
                user_id=user_id_map.get(person.id, 0),
                discord_id=person.id,
                name=person.name,
                reason=UngroupableReason.NO_OVERLAP_WITH_OTHERS,
                details={
                    "overlapping_unassigned": overlapping_unassigned,
                    "note": "Complex scheduling constraint - user has availability but couldn't be optimally placed",
                },
            )
        )

    return details


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

    1. Load users from signups WHERE cohort_id=X (excluding already-grouped users)
    2. Get their availability from users table
    3. Run scheduling algorithm
    4. Insert groups into 'groups' table (with status='preview')
    5. Insert memberships into 'groups_users' table
    6. Keep signups for all users, set ungroupable_reason for ungroupable users

    Returns: CohortSchedulingResult with summary
    """
    async with get_transaction() as conn:
        # Get cohort info
        cohort = await get_cohort_by_id(conn, cohort_id)
        if not cohort:
            raise ValueError(f"Cohort {cohort_id} not found")

        # Load users awaiting grouping for this cohort
        # (row exists in signups = awaiting grouping, no ungroupable_reason = first attempt)

        # Subquery: users already in groups for this cohort
        already_grouped = (
            select(groups_users.c.user_id)
            .join(groups, groups_users.c.group_id == groups.c.group_id)
            .where(groups.c.cohort_id == cohort_id)
        )

        query = (
            select(
                users.c.user_id,
                users.c.discord_id,
                users.c.nickname,
                users.c.discord_username,
                users.c.timezone,
                users.c.availability_local,
                users.c.if_needed_availability_local,
                signups.c.role,
            )
            .join(signups, users.c.user_id == signups.c.user_id)
            .where(signups.c.cohort_id == cohort_id)
            .where(
                signups.c.ungroupable_reason.is_(None)
            )  # Only users not yet marked ungroupable
            .where(users.c.user_id.notin_(already_grouped))
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
        user_timezones = []  # Collect for DST warning check

        for row in user_rows:
            discord_id = row["discord_id"]
            user_id_map[discord_id] = row["user_id"]
            user_timezone = row["timezone"] or "UTC"

            # Parse availability from JSON format, converting from local to UTC
            intervals = availability_json_to_intervals(
                row["availability_local"], user_timezone
            )
            if_needed = availability_json_to_intervals(
                row["if_needed_availability_local"], user_timezone
            )

            if not intervals and not if_needed:
                continue  # Skip users with no availability

            name = (
                row["nickname"] or row["discord_username"] or f"User {row['user_id']}"
            )
            person = Person(
                id=discord_id,
                name=name,
                intervals=intervals,
                if_needed_intervals=if_needed,
                timezone=user_timezone,
            )
            people.append(person)
            user_timezones.append(user_timezone)

            if row["role"] == "facilitator":
                facilitator_ids.add(discord_id)

        # Query facilitator max_active_groups from facilitators table
        facilitator_max_groups = {}
        if facilitator_ids:
            # Get user_ids for facilitators in this cohort
            facilitator_user_ids = [
                user_id_map[discord_id]
                for discord_id in facilitator_ids
                if discord_id in user_id_map
            ]
            if facilitator_user_ids:
                fac_query = select(
                    facilitators.c.user_id, facilitators.c.max_active_groups
                ).where(facilitators.c.user_id.in_(facilitator_user_ids))
                fac_result = await conn.execute(fac_query)
                fac_rows = {
                    row.user_id: row.max_active_groups for row in fac_result.fetchall()
                }

                # Build mapping: discord_id -> max_active_groups
                for discord_id in facilitator_ids:
                    user_id = user_id_map.get(discord_id)
                    if user_id and user_id in fac_rows:
                        facilitator_max_groups[discord_id] = (
                            fac_rows[user_id] or 999
                        )  # Default to unlimited if NULL

        if not people:
            return CohortSchedulingResult(
                cohort_id=cohort_id,
                cohort_name=cohort["cohort_name"],
                groups_created=0,
                users_grouped=0,
                users_ungroupable=len(user_rows),
                groups=[],
            )

        # Check for DST transitions that may affect scheduled meetings
        dst_warnings = check_dst_warnings(user_timezones)

        # Run scheduling algorithm
        scheduling_result = cohort_scheduler.schedule(
            people=people,
            meeting_length=meeting_length,
            min_people=min_people,
            max_people=max_people,
            num_iterations=num_iterations,
            facilitator_ids=facilitator_ids if facilitator_ids else None,
            facilitator_max_cohorts=facilitator_max_groups
            if facilitator_max_groups
            else None,
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
                    meeting_time = cohort_scheduler.format_time_range(
                        *group.selected_time
                    )
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
                        role = (
                            "facilitator"
                            if person.id in facilitator_ids
                            else "participant"
                        )
                        await add_user_to_group(
                            conn, group_record["group_id"], user_id, role
                        )
                        grouped_user_ids.add(user_id)

                created_groups.append(
                    {
                        "group_id": group_record["group_id"],
                        "group_name": group_record["group_name"],
                        "member_count": len(group.people),
                        "meeting_time": meeting_time,
                    }
                )

        # Mark ungroupable users (signups are kept for all users)
        all_user_ids = [row["user_id"] for row in user_rows]
        ungroupable_user_ids = [
            uid for uid in all_user_ids if uid not in grouped_user_ids
        ]

        # Analyze why users couldn't be grouped (do this before updating DB)
        ungroupable_details = []
        if scheduling_result.unassigned:
            ungroupable_details = analyze_ungroupable_users(
                unassigned=scheduling_result.unassigned,
                all_people=people,
                facilitator_ids=facilitator_ids,
                facilitator_max_groups=facilitator_max_groups,
                groups_created=len(created_groups),
                meeting_length=meeting_length,
                min_people=min_people,
                user_id_map=user_id_map,
            )

        # Update ungroupable users with their specific reasons
        if ungroupable_details:
            # Build mapping of user_id -> reason for efficient lookup
            reason_by_user_id = {d.user_id: d.reason for d in ungroupable_details}

            for user_id in ungroupable_user_ids:
                reason = reason_by_user_id.get(user_id)
                # Map internal enum value to DB enum
                db_reason = DBUngroupableReason(reason.value) if reason else None
                await conn.execute(
                    update(signups)
                    .where(signups.c.cohort_id == cohort_id)
                    .where(signups.c.user_id == user_id)
                    .values(ungroupable_reason=db_reason)
                )
        elif ungroupable_user_ids:
            # Fallback: mark as ungroupable without specific reason
            # (use a generic reason since the column requires a value to indicate ungroupable)
            await conn.execute(
                update(signups)
                .where(signups.c.cohort_id == cohort_id)
                .where(signups.c.user_id.in_(ungroupable_user_ids))
                .values(ungroupable_reason=DBUngroupableReason.no_overlap_with_others)
            )

        return CohortSchedulingResult(
            cohort_id=cohort_id,
            cohort_name=cohort["cohort_name"],
            groups_created=len(created_groups),
            users_grouped=len(grouped_user_ids),
            users_ungroupable=len(ungroupable_user_ids),
            groups=created_groups,
            warnings=dst_warnings,
            ungroupable_details=ungroupable_details,
        )
