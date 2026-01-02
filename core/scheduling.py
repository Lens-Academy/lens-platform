"""
Cohort Scheduling Algorithm

Implements stochastic greedy scheduling algorithm for matching people into cohorts.

Algorithm: Runs many iterations of greedy assignment, keeps best solution.
- Each iteration sorts people by available time (with randomness)
- Places each person in valid existing group or creates new group
- Group is valid if all members share at least one meeting time slot
"""

import random
import asyncio
from dataclasses import dataclass, field
from typing import Optional

from sqlalchemy import select, update

from .constants import DAY_CODES
from .database import get_transaction
from .queries.cohorts import get_cohort_by_id
from .queries.groups import create_group, add_user_to_group
from .tables import courses_users, users


# Day code mapping (single letter -> day index)
DAY_MAP = {'M': 0, 'T': 1, 'W': 2, 'R': 3, 'F': 4, 'S': 5, 'U': 6}
DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']


@dataclass
class Person:
    """Represents a person for scheduling."""
    id: str
    name: str
    intervals: list  # List of (start_minutes, end_minutes)
    if_needed_intervals: list = field(default_factory=list)
    timezone: str = "UTC"
    courses: list = field(default_factory=list)
    experience: str = ""


@dataclass
class Group:
    """Represents a scheduled group/cohort."""
    id: str
    name: str
    people: list
    facilitator_id: Optional[str] = None
    selected_time: Optional[tuple] = None  # (start_minutes, end_minutes)


@dataclass
class CourseSchedulingResult:
    """Result of scheduling a single course."""
    course_name: str
    groups: list  # list of Group
    score: int  # number of people scheduled
    unassigned: list  # list of Person


@dataclass
class MultiCourseSchedulingResult:
    """Result of scheduling across all courses."""
    course_results: dict  # course_name -> CourseSchedulingResult
    total_scheduled: int
    total_cohorts: int
    total_balance_moves: int
    total_people: int


@dataclass
class CohortSchedulingResult:
    """Result of scheduling a single cohort."""
    cohort_id: int
    cohort_name: str
    groups_created: int
    users_grouped: int
    users_ungroupable: int
    groups: list  # list of dicts with group_id, group_name, member_count, meeting_time


# Exceptions
class SchedulingError(Exception):
    """Base exception for scheduling errors."""
    pass


class NoUsersError(SchedulingError):
    """No users have availability set."""
    pass


class NoFacilitatorsError(SchedulingError):
    """Facilitator mode enabled but no facilitators marked."""
    pass


def parse_interval_string(interval_str: str) -> list:
    """
    Parse availability string into intervals.
    Format: "M09:00 M10:00, T14:00 T15:00"
    Returns list of (start_minutes, end_minutes) tuples.
    """
    if not interval_str:
        return []

    intervals = []
    parts = interval_str.split(',')

    for part in parts:
        trimmed = part.strip()
        if not trimmed:
            continue

        tokens = trimmed.split()
        if len(tokens) < 2:
            continue

        start_token = tokens[0]
        end_token = tokens[1]

        # Parse start
        start_day = DAY_MAP.get(start_token[0], 0)
        start_time = start_token[1:].split(':')
        start_minutes = start_day * 24 * 60 + int(start_time[0]) * 60 + int(start_time[1])

        # Parse end
        end_day = DAY_MAP.get(end_token[0], 0)
        end_time = end_token[1:].split(':')
        end_minutes = end_day * 24 * 60 + int(end_time[0]) * 60 + int(end_time[1])

        # Handle wrap-around
        if end_minutes <= start_minutes:
            end_minutes += 7 * 24 * 60

        intervals.append((start_minutes, end_minutes))

    return intervals


def calculate_total_available_time(person: Person) -> int:
    """Calculate total minutes of availability for a person."""
    total = 0
    for start, end in person.intervals:
        total += (end - start)
    for start, end in person.if_needed_intervals:
        total += (end - start)
    return total


def is_group_valid(group: Group, meeting_length: int, time_increment: int = 30,
                   use_if_needed: bool = True, facilitator_ids: set = None) -> bool:
    """
    Check if group has at least one valid meeting time for all members.
    """
    if len(group.people) == 0:
        return True

    # Check facilitator constraint
    if facilitator_ids:
        facilitators_in_group = [p for p in group.people if p.id in facilitator_ids]
        if len(facilitators_in_group) != 1:
            return False

    # Check each possible time slot in the week
    for time_in_minutes in range(0, 7 * 24 * 60, time_increment):
        block_is_valid = True

        # Check if there's a continuous block of meeting_length starting at this time
        for offset in range(0, meeting_length, time_increment):
            check_time = time_in_minutes + offset

            # Check if ALL group members are available at this time
            all_available = True
            for person in group.people:
                regular_available = any(
                    start <= check_time < end
                    for start, end in person.intervals
                )

                if_needed_available = use_if_needed and any(
                    start <= check_time < end
                    for start, end in person.if_needed_intervals
                )

                if not (regular_available or if_needed_available):
                    all_available = False
                    break

            if not all_available:
                block_is_valid = False
                break

        if block_is_valid:
            return True

    return False


def find_cohort_time_options(people: list, meeting_length: int, time_increment: int = 30,
                              use_if_needed: bool = True) -> list:
    """Find all possible meeting time slots for a group of people."""
    options = []

    for time_in_minutes in range(0, 7 * 24 * 60, time_increment):
        block_is_valid = True

        for offset in range(0, meeting_length, time_increment):
            check_time = time_in_minutes + offset

            all_available = all(
                any(start <= check_time < end for start, end in person.intervals) or
                (use_if_needed and any(start <= check_time < end for start, end in person.if_needed_intervals))
                for person in people
            )

            if not all_available:
                block_is_valid = False
                break

        if block_is_valid:
            options.append((time_in_minutes, time_in_minutes + meeting_length))

    return options


def format_time_range(start_minutes: int, end_minutes: int) -> str:
    """Format time range as human-readable string."""
    start_day = start_minutes // (24 * 60)
    start_hour = (start_minutes % (24 * 60)) // 60
    start_min = start_minutes % 60

    end_day = end_minutes // (24 * 60)
    end_hour = (end_minutes % (24 * 60)) // 60
    end_min = end_minutes % 60

    def fmt_time(h, m):
        return f"{h:02d}:{m:02d}"

    if start_day == end_day:
        return f"{DAY_NAMES[start_day % 7]} {fmt_time(start_hour, start_min)}-{fmt_time(end_hour, end_min)}"
    else:
        return f"{DAY_NAMES[start_day % 7]} {fmt_time(start_hour, start_min)} - {DAY_NAMES[end_day % 7]} {fmt_time(end_hour, end_min)}"


def group_people_by_course(people: list) -> dict:
    """
    Group people by course.

    People enrolled in multiple courses appear in multiple groups.
    People with no courses go into "Uncategorized".

    Returns: dict mapping course_name -> list of Person
    """
    people_by_course = {}
    for person in people:
        if person.courses:
            for course in person.courses:
                if course not in people_by_course:
                    people_by_course[course] = []
                people_by_course[course].append(person)
        else:
            if "Uncategorized" not in people_by_course:
                people_by_course["Uncategorized"] = []
            people_by_course["Uncategorized"].append(person)
    return people_by_course


def remove_blocked_intervals(person: Person, blocked_times: list) -> Person:
    """
    Return new Person with intervals that conflict with blocked_times removed.

    Args:
        person: The person to adjust
        blocked_times: List of (start, end) tuples representing already-assigned times

    Returns:
        New Person with conflicting intervals removed
    """
    if not blocked_times:
        return person

    new_intervals = []
    for start, end in person.intervals:
        conflicts = False
        for b_start, b_end in blocked_times:
            if start < b_end and end > b_start:
                conflicts = True
                break
        if not conflicts:
            new_intervals.append((start, end))

    new_if_needed = []
    for start, end in person.if_needed_intervals:
        conflicts = False
        for b_start, b_end in blocked_times:
            if start < b_end and end > b_start:
                conflicts = True
                break
        if not conflicts:
            new_if_needed.append((start, end))

    return Person(
        id=person.id,
        name=person.name,
        intervals=new_intervals,
        if_needed_intervals=new_if_needed,
        timezone=person.timezone,
        courses=person.courses,
        experience=person.experience
    )


def run_greedy_iteration(people: list, meeting_length: int, min_people: int,
                         max_people: int, time_increment: int = 30,
                         randomness: float = 0.5, facilitator_ids: set = None,
                         facilitator_max_cohorts: dict = None,
                         use_if_needed: bool = True) -> list:
    """
    Single iteration of greedy scheduling algorithm.
    Returns list of Group objects.
    """
    if facilitator_ids and len(facilitator_ids) > 0:
        # Facilitator mode
        facilitators = [p for p in people if p.id in facilitator_ids]
        non_facilitators = [p for p in people if p.id not in facilitator_ids]

        # Sort non-facilitators by available time with randomness
        non_facilitators_sorted = sorted(non_facilitators, key=lambda p: (
            calculate_total_available_time(p) * (1.0 - randomness * 0.1 + random.random() * randomness * 0.2)
        ))

        new_groups = []
        facilitator_assignments = {f.id: 0 for f in facilitators}

        for person in non_facilitators_sorted:
            placed = False

            # Find groups that could accept this person
            valid_group_indices = []
            for i, group in enumerate(new_groups):
                if len(group.people) < max_people:
                    test_people = group.people + [person]
                    test_group = Group(id="test", name="test", people=test_people)
                    if is_group_valid(test_group, meeting_length, time_increment, use_if_needed, facilitator_ids):
                        valid_group_indices.append(i)

            # Pick a valid group
            if valid_group_indices:
                if randomness == 0 or random.random() > randomness:
                    selected_index = valid_group_indices[0]
                else:
                    selected_index = random.choice(valid_group_indices)
                new_groups[selected_index].people.append(person)
                placed = True

            # Create new group with facilitator if needed
            if not placed:
                for facilitator in facilitators:
                    max_cohorts = facilitator_max_cohorts.get(facilitator.id, 1) if facilitator_max_cohorts else 1
                    current_count = facilitator_assignments[facilitator.id]

                    if current_count < max_cohorts:
                        test_group = Group(id="test", name="test", people=[facilitator, person])
                        if is_group_valid(test_group, meeting_length, time_increment, use_if_needed, facilitator_ids):
                            new_group = Group(
                                id=f"group-{len(new_groups)}",
                                name=f"Group {len(new_groups) + 1}",
                                people=[facilitator, person],
                                facilitator_id=facilitator.id
                            )
                            new_groups.append(new_group)
                            facilitator_assignments[facilitator.id] = current_count + 1
                            placed = True
                            break

        # Filter out groups that are too small
        valid_groups = [g for g in new_groups if len(g.people) >= min_people]
        return valid_groups

    else:
        # Non-facilitator mode
        people_sorted = sorted(people, key=lambda p: (
            calculate_total_available_time(p) * (1.0 - randomness * 0.1 + random.random() * randomness * 0.2)
        ))

        new_groups = []

        for person in people_sorted:
            placed = False

            # Find valid groups
            valid_group_indices = []
            for i, group in enumerate(new_groups):
                if len(group.people) < max_people:
                    test_people = group.people + [person]
                    test_group = Group(id="test", name="test", people=test_people)
                    if is_group_valid(test_group, meeting_length, time_increment, use_if_needed):
                        valid_group_indices.append(i)

            # Pick a group
            if valid_group_indices:
                if randomness == 0 or random.random() > randomness:
                    selected_index = valid_group_indices[0]
                else:
                    selected_index = random.choice(valid_group_indices)
                new_groups[selected_index].people.append(person)
                placed = True

            # Create new group
            if not placed:
                new_group = Group(
                    id=f"group-{len(new_groups)}",
                    name=f"Group {len(new_groups) + 1}",
                    people=[person]
                )
                new_groups.append(new_group)

        # Filter out groups that are too small
        valid_groups = [g for g in new_groups if len(g.people) >= min_people]
        return valid_groups


async def run_scheduling(people: list, meeting_length: int = 60, min_people: int = 4,
                         max_people: int = 8, num_iterations: int = 1000,
                         time_increment: int = 30, randomness: float = 0.5,
                         facilitator_ids: set = None, facilitator_max_cohorts: dict = None,
                         use_if_needed: bool = True, progress_callback=None) -> tuple:
    """
    Run the full stochastic greedy scheduling algorithm.
    Returns (best_solution, best_score, best_iteration, total_iterations)
    """
    best_solution = None
    best_score = -1
    best_iteration = -1

    for iteration in range(num_iterations):
        solution = run_greedy_iteration(
            people, meeting_length, min_people, max_people,
            time_increment, randomness, facilitator_ids, facilitator_max_cohorts,
            use_if_needed
        )

        score = sum(len(g.people) for g in solution)

        if score > best_score:
            best_score = score
            best_solution = solution
            best_iteration = iteration

            # Stop if we've scheduled everyone
            if best_score == len(people):
                break

        # Progress callback every 100 iterations
        if progress_callback and iteration % 100 == 0:
            await progress_callback(iteration, num_iterations, best_score, len(people))

        # Yield to event loop occasionally
        if iteration % 50 == 0:
            await asyncio.sleep(0)

    # Assign meeting times to groups
    if best_solution:
        for group in best_solution:
            options = find_cohort_time_options(group.people, meeting_length, time_increment)
            if options:
                group.selected_time = options[0]

    return best_solution, best_score, best_iteration, iteration + 1


def balance_cohorts(groups: list, meeting_length: int, time_increment: int = 30,
                    use_if_needed: bool = True) -> int:
    """
    Balance cohort sizes by moving people from larger to smaller groups.
    Only moves people if they're still compatible with the target group.
    Returns the number of moves made.
    """
    if len(groups) < 2:
        return 0

    move_count = 0
    improved = True

    # Keep trying to balance until no more improvements
    while improved:
        improved = False

        # Sort groups by size (descending)
        groups.sort(key=lambda g: len(g.people), reverse=True)

        largest_group = groups[0]
        smallest_group = groups[-1]

        # Stop if groups are reasonably balanced (within 1 person)
        if len(largest_group.people) - len(smallest_group.people) <= 1:
            break

        # Try all possible moves from larger groups to smaller groups
        found_move = False

        for source_idx in range(len(groups)):
            if found_move:
                break

            source_group = groups[source_idx]

            for target_idx in range(len(groups) - 1, source_idx, -1):
                if found_move:
                    break

                target_group = groups[target_idx]

                # Only try if source is larger than target
                if len(source_group.people) <= len(target_group.people):
                    continue

                # Try to move a person from source to target
                for i, person in enumerate(source_group.people):
                    # Check if this person is compatible with the target group
                    test_people = target_group.people + [person]
                    test_group = Group(id="test", name="test", people=test_people)

                    if is_group_valid(test_group, meeting_length, time_increment, use_if_needed):
                        # Move the person
                        source_group.people.pop(i)
                        target_group.people.append(person)
                        move_count += 1
                        improved = True
                        found_move = True
                        break

        # Prevent infinite loops
        if not found_move:
            break

    return move_count


async def schedule_people(
    all_people: list,
    meeting_length: int = 60,
    min_people: int = 4,
    max_people: int = 8,
    num_iterations: int = 1000,
    balance: bool = True,
    use_if_needed: bool = True,
    facilitator_ids: set = None,
    progress_callback=None
) -> MultiCourseSchedulingResult:
    """
    Run scheduling across multiple courses, handling cross-course conflicts.

    People enrolled in multiple courses are scheduled for each course,
    with later courses seeing reduced availability (blocked by earlier assignments).

    Args:
        all_people: List of Person objects to schedule
        meeting_length: Meeting duration in minutes
        min_people: Minimum people per cohort
        max_people: Maximum people per cohort
        num_iterations: Scheduling algorithm iterations per course
        balance: Whether to balance cohort sizes after scheduling
        use_if_needed: Include "if needed" availability slots
        facilitator_ids: Set of person IDs who are facilitators (or None)
        progress_callback: Optional async fn(course_name, iteration, total, best_score, people_count)

    Returns:
        MultiCourseSchedulingResult with all course results and totals
    """
    # Group people by course
    people_by_course = group_people_by_course(all_people)

    # Track results
    course_results = {}
    total_scheduled = 0
    total_cohorts = 0
    total_balance_moves = 0

    # Track assigned times for each person across courses (for conflict prevention)
    # person_id -> list of (start, end) tuples
    assigned_times = {}

    for course_name, people in people_by_course.items():
        if len(people) < min_people:
            # Not enough people for this course
            course_results[course_name] = CourseSchedulingResult(
                course_name=course_name,
                groups=[],
                score=0,
                unassigned=people
            )
            continue

        # Get facilitators for this course
        course_facilitator_ids = None
        if facilitator_ids:
            course_facilitator_ids = {p.id for p in people if p.id in facilitator_ids}
            if not course_facilitator_ids:
                # No facilitators in this course, skip if facilitator mode
                course_results[course_name] = CourseSchedulingResult(
                    course_name=course_name,
                    groups=[],
                    score=0,
                    unassigned=people
                )
                continue

        # Remove already-assigned times from people's availability
        adjusted_people = [
            remove_blocked_intervals(person, assigned_times.get(person.id, []))
            for person in people
        ]

        # Create course-specific progress callback
        async def course_progress(iteration, total, best_score, people_count):
            if progress_callback:
                await progress_callback(course_name, iteration, total, best_score, people_count)

        # Run scheduling for this course
        solution, score, best_iter, total_iter = await run_scheduling(
            people=adjusted_people,
            meeting_length=meeting_length,
            min_people=min_people,
            max_people=max_people,
            num_iterations=num_iterations,
            facilitator_ids=course_facilitator_ids,
            use_if_needed=use_if_needed,
            progress_callback=course_progress
        )

        # Balance cohorts if enabled
        moves = 0
        if balance and solution and len(solution) >= 2:
            moves = balance_cohorts(solution, meeting_length, use_if_needed=use_if_needed)
            total_balance_moves += moves

        # Track assigned times for multi-course users
        if solution:
            for group in solution:
                if group.selected_time:
                    for person in group.people:
                        if person.id not in assigned_times:
                            assigned_times[person.id] = []
                        assigned_times[person.id].append(group.selected_time)

        # Compute unassigned
        if solution:
            assigned_ids = {p.id for g in solution for p in g.people}
            unassigned = [p for p in people if p.id not in assigned_ids]
            total_scheduled += score
            total_cohorts += len(solution)
        else:
            unassigned = people
            solution = []

        course_results[course_name] = CourseSchedulingResult(
            course_name=course_name,
            groups=solution,
            score=score,
            unassigned=unassigned
        )

    return MultiCourseSchedulingResult(
        course_results=course_results,
        total_scheduled=total_scheduled,
        total_cohorts=total_cohorts,
        total_balance_moves=total_balance_moves,
        total_people=len(all_people)
    )


def convert_user_data_to_people(user_data: dict, day_codes: dict = None) -> list:
    """
    Convert stored user data dict to Person objects for scheduling.

    Args:
        user_data: Dict mapping user_id -> user profile dict
        day_codes: Dict mapping day names to single-letter codes (optional, uses DAY_CODES if not provided)

    Returns:
        List of Person objects ready for scheduling
    """
    if day_codes is None:
        day_codes = DAY_CODES

    people = []

    for user_id, data in user_data.items():
        # Include users with either availability or if_needed times
        if not data.get("availability") and not data.get("if_needed"):
            continue

        # Convert availability dict to interval string format
        intervals = []
        for day, slots in data.get("availability", {}).items():
            day_code = day_codes.get(day, day[0])

            for slot in sorted(slots):
                # Create 1-hour blocks from each slot
                hour = int(slot.split(":")[0])
                end_hour = hour + 1
                interval_str = f"{day_code}{slot} {day_code}{end_hour:02d}:00"
                intervals.append(interval_str)

        availability_str = ", ".join(intervals)
        parsed_intervals = parse_interval_string(availability_str)

        # Convert if_needed dict to interval string format
        if_needed_intervals = []
        for day, slots in data.get("if_needed", {}).items():
            day_code = day_codes.get(day, day[0])

            for slot in sorted(slots):
                hour = int(slot.split(":")[0])
                end_hour = hour + 1
                interval_str = f"{day_code}{slot} {day_code}{end_hour:02d}:00"
                if_needed_intervals.append(interval_str)

        if_needed_str = ", ".join(if_needed_intervals)
        parsed_if_needed = parse_interval_string(if_needed_str)

        person = Person(
            id=user_id,
            name=data.get("name", f"User {user_id}"),
            intervals=parsed_intervals,
            if_needed_intervals=parsed_if_needed,
            timezone=data.get("timezone", "UTC"),
            courses=data.get("courses", []),
            experience=data.get("experience", "")
        )
        people.append(person)

    return people


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
                users.c.availability_utc,
                users.c.if_needed_availability_utc,
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

            # Parse availability
            intervals = parse_interval_string(row["availability_utc"] or "")
            if_needed = parse_interval_string(row["if_needed_availability_utc"] or "")

            if not intervals and not if_needed:
                continue  # Skip users with no availability

            name = row["nickname"] or row["discord_username"] or f"User {row['user_id']}"
            person = Person(
                id=discord_id,
                name=name,
                intervals=intervals,
                if_needed_intervals=if_needed,
                timezone=row["timezone"] or "UTC",
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
        facilitator_ids_param = facilitator_ids if facilitator_ids else None
        solution, score, best_iter, total_iter = await run_scheduling(
            people=people,
            meeting_length=meeting_length,
            min_people=min_people,
            max_people=max_people,
            num_iterations=num_iterations,
            facilitator_ids=facilitator_ids_param,
            use_if_needed=use_if_needed,
            progress_callback=progress_callback,
        )

        # Balance if requested
        if balance and solution and len(solution) >= 2:
            balance_cohorts(solution, meeting_length, use_if_needed=use_if_needed)

        # Persist groups to database
        created_groups = []
        grouped_user_ids = set()

        if solution:
            for i, group in enumerate(solution, 1):
                # Format meeting time
                if group.selected_time:
                    meeting_time = format_time_range(*group.selected_time)
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


async def schedule(
    meeting_length: int = 60,
    min_people: int = 4,
    max_people: int = 8,
    num_iterations: int = 1000,
    balance: bool = True,
    use_if_needed: bool = True,
    facilitator_mode: bool = False,
    progress_callback=None
) -> MultiCourseSchedulingResult:
    """
    Load users from database and run scheduling across all courses.

    This is the main entry point for scheduling - handles data loading,
    facilitator extraction, and runs the scheduling algorithm.

    Args:
        meeting_length: Meeting duration in minutes
        min_people: Minimum people per cohort
        max_people: Maximum people per cohort
        num_iterations: Scheduling algorithm iterations per course
        balance: Whether to balance cohort sizes after scheduling
        use_if_needed: Include "if needed" availability slots
        facilitator_mode: Require each cohort to have one facilitator
        progress_callback: Optional async fn(course_name, iteration, total, best_score, people_count)

    Returns:
        MultiCourseSchedulingResult with all course results and totals

    Raises:
        NoUsersError: If no users have availability set
        NoFacilitatorsError: If facilitator_mode=True but no facilitators marked
    """
    # Local import to avoid circular dependency (enrollment imports from scheduling)
    from .enrollment import get_people_for_scheduling

    # Load from database
    all_people, user_data = await get_people_for_scheduling()

    if not all_people:
        raise NoUsersError("No users have set their availability yet")

    # Extract facilitators if needed
    facilitator_ids = None
    if facilitator_mode:
        facilitator_ids = {
            user_id for user_id, data in user_data.items()
            if data.get("is_facilitator", False)
        }
        if not facilitator_ids:
            raise NoFacilitatorsError("No facilitators are marked")

    # Run scheduling
    return await schedule_people(
        all_people=all_people,
        meeting_length=meeting_length,
        min_people=min_people,
        max_people=max_people,
        num_iterations=num_iterations,
        balance=balance,
        use_if_needed=use_if_needed,
        facilitator_ids=facilitator_ids,
        progress_callback=progress_callback
    )
