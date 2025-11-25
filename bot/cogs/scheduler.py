"""
Cohort Scheduler Cog
Implements stochastic greedy scheduling algorithm for matching people into cohorts.

Algorithm: Runs many iterations of greedy assignment, keeps best solution.
- Each iteration sorts people by available time (with randomness)
- Places each person in valid existing group or creates new group
- Group is valid if all members share at least one meeting time slot
"""

import discord
from discord import app_commands
from discord.ext import commands
import random
from dataclasses import dataclass, field
from typing import Optional
import asyncio

from utils import load_data, DAY_CODES


# Day code mapping
DAY_MAP = {'M': 0, 'T': 1, 'W': 2, 'R': 3, 'F': 4, 'S': 5, 'U': 6}
DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']


@dataclass
class Person:
    id: str
    name: str
    intervals: list  # List of (start_minutes, end_minutes)
    if_needed_intervals: list = field(default_factory=list)
    timezone: str = "UTC"
    courses: list = field(default_factory=list)  # List of courses
    experience: str = ""


@dataclass
class Group:
    id: str
    name: str
    people: list
    facilitator_id: Optional[str] = None
    selected_time: Optional[tuple] = None  # (start_minutes, end_minutes)


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


class SchedulerCog(commands.Cog):
    """Cog for cohort scheduling functionality."""

    def __init__(self, bot):
        self.bot = bot

    def load_user_data(self) -> dict:
        """Load user data from JSON file."""
        return load_data()

    def convert_users_to_people(self, user_data: dict) -> list:
        """Convert stored user data to Person objects for scheduling."""
        people = []

        for user_id, data in user_data.items():
            # Include users with either availability or if_needed times
            if not data.get("availability") and not data.get("if_needed"):
                continue

            day_code_map = DAY_CODES

            # Convert availability dict to interval string format
            intervals = []
            for day, slots in data.get("availability", {}).items():
                day_code = day_code_map.get(day, day[0])

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
                day_code = day_code_map.get(day, day[0])

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

    @app_commands.command(name="schedule", description="Run the cohort scheduling algorithm")
    @app_commands.checks.has_permissions(administrator=True)
    @app_commands.describe(
        meeting_length="Meeting length in minutes (default: 60)",
        min_people="Minimum people per cohort (default: 4)",
        max_people="Maximum people per cohort (default: 8)",
        iterations="Number of iterations to run (default: 1000)",
        balance="Balance cohort sizes after scheduling (default: True)",
        use_if_needed="Include 'if needed' times in scheduling (default: True)",
        facilitator_mode="Require each cohort to have one facilitator (default: False)"
    )
    async def schedule(self, interaction: discord.Interaction,
                       meeting_length: int = 60,
                       min_people: int = 4,
                       max_people: int = 8,
                       iterations: int = 1000,
                       balance: bool = True,
                       use_if_needed: bool = True,
                       facilitator_mode: bool = False):
        """Run the scheduling algorithm on all registered users."""

        await interaction.response.defer()

        # Load and convert user data
        user_data = self.load_user_data()
        all_people = self.convert_users_to_people(user_data)

        if not all_people:
            await interaction.followup.send(
                "No users have set their availability yet!",
                ephemeral=True
            )
            return

        # Collect facilitator IDs if facilitator mode is enabled
        facilitator_ids = None
        if facilitator_mode:
            facilitator_ids = {
                user_id for user_id, data in user_data.items()
                if data.get("is_facilitator", False)
            }
            if not facilitator_ids:
                await interaction.followup.send(
                    "Facilitator mode is enabled but no facilitators are marked!\n"
                    "Use `/toggle-facilitator` to mark people as facilitators.",
                    ephemeral=True
                )
                return

        # Group people by course (people can appear in multiple courses)
        people_by_course = {}
        for person in all_people:
            if person.courses:
                for course in person.courses:
                    if course not in people_by_course:
                        people_by_course[course] = []
                    people_by_course[course].append(person)
            else:
                # Handle uncategorized
                if "Uncategorized" not in people_by_course:
                    people_by_course["Uncategorized"] = []
                people_by_course["Uncategorized"].append(person)

        # Progress message
        progress_msg = await interaction.followup.send(
            f"🔄 Running scheduling algorithm...\n"
            f"Courses: {len(people_by_course)} | Total people: {len(all_people)}",
            ephemeral=False
        )

        # Run scheduling for each course
        all_solutions = {}  # course -> (solution, score, unassigned)
        total_scheduled = 0
        total_cohorts = 0
        total_moves = 0

        # Track assigned times for each person across courses
        # person_id -> list of (start, end) tuples
        assigned_times = {}

        for course_name, people in people_by_course.items():
            if len(people) < min_people:
                # Not enough people for this course
                all_solutions[course_name] = ([], 0, people)
                continue

            # Get facilitators for this course
            course_facilitator_ids = None
            if facilitator_ids:
                course_facilitator_ids = {p.id for p in people if p.id in facilitator_ids}
                if not course_facilitator_ids:
                    # No facilitators in this course, skip if facilitator mode
                    all_solutions[course_name] = ([], 0, people)
                    continue

            # Remove already-assigned times from people's availability
            adjusted_people = []
            for person in people:
                if person.id in assigned_times:
                    # Create new person with blocked times removed
                    blocked = assigned_times[person.id]
                    new_intervals = []
                    for start, end in person.intervals:
                        # Check if this interval conflicts with any blocked time
                        conflicts = False
                        for b_start, b_end in blocked:
                            if start < b_end and end > b_start:
                                conflicts = True
                                break
                        if not conflicts:
                            new_intervals.append((start, end))

                    new_if_needed = []
                    for start, end in person.if_needed_intervals:
                        conflicts = False
                        for b_start, b_end in blocked:
                            if start < b_end and end > b_start:
                                conflicts = True
                                break
                        if not conflicts:
                            new_if_needed.append((start, end))

                    adjusted_person = Person(
                        id=person.id,
                        name=person.name,
                        intervals=new_intervals,
                        if_needed_intervals=new_if_needed,
                        timezone=person.timezone,
                        courses=person.courses,
                        experience=person.experience
                    )
                    adjusted_people.append(adjusted_person)
                else:
                    adjusted_people.append(person)

            async def update_progress(current, total, best_score, total_people):
                try:
                    await progress_msg.edit(
                        content=f"🔄 Scheduling **{course_name}**...\n"
                                f"Iteration: {current}/{total} | "
                                f"Best: {best_score}/{total_people}"
                    )
                except:
                    pass

            # Run scheduling for this course
            solution, score, best_iter, total_iter = await run_scheduling(
                people=adjusted_people,
                meeting_length=meeting_length,
                min_people=min_people,
                max_people=max_people,
                num_iterations=iterations,
                facilitator_ids=course_facilitator_ids,
                use_if_needed=use_if_needed,
                progress_callback=update_progress
            )

            # Balance cohorts if enabled
            if balance and solution and len(solution) >= 2:
                moves = balance_cohorts(solution, meeting_length, use_if_needed=use_if_needed)
                total_moves += moves

            # Track assigned times for multi-course users
            if solution:
                for group in solution:
                    if group.selected_time:
                        for person in group.people:
                            if person.id not in assigned_times:
                                assigned_times[person.id] = []
                            assigned_times[person.id].append(group.selected_time)

            # Track unassigned
            if solution:
                assigned_ids = {p.id for g in solution for p in g.people}
                unassigned = [p for p in people if p.id not in assigned_ids]
                total_scheduled += score
                total_cohorts += len(solution)
            else:
                unassigned = people
                solution = []

            all_solutions[course_name] = (solution, score, unassigned)

        # Build results embed
        placement_rate = total_scheduled * 100 // len(all_people) if all_people else 0

        embed = discord.Embed(
            title="📅 Scheduling Complete!",
            color=discord.Color.green() if placement_rate >= 80 else discord.Color.yellow()
        )

        balance_info = f"\n**Balance moves:** {total_moves}" if total_moves > 0 else ""
        embed.add_field(
            name="Summary",
            value=f"**Courses:** {len(people_by_course)}\n"
                  f"**Total cohorts:** {total_cohorts}\n"
                  f"**People scheduled:** {total_scheduled}/{len(all_people)} ({placement_rate}%){balance_info}",
            inline=False
        )

        # List cohorts by course
        cohort_num = 1
        for course_name, (solution, score, unassigned) in all_solutions.items():
            if solution:
                embed.add_field(
                    name=f"📚 {course_name}",
                    value=f"{len(solution)} cohort(s), {score} people",
                    inline=False
                )

                for group in solution:
                    members = [p.name for p in group.people]
                    time_str = format_time_range(*group.selected_time) if group.selected_time else "No common time"

                    embed.add_field(
                        name=f"Cohort {cohort_num} ({len(group.people)} people)",
                        value=f"**Time (UTC):** {time_str}\n"
                              f"**Members:** {', '.join(members)}",
                        inline=False
                    )
                    cohort_num += 1

            # Show unassigned for this course
            if unassigned:
                unassigned_names = [p.name for p in unassigned]
                embed.add_field(
                    name=f"⚠️ {course_name} - Unassigned ({len(unassigned)})",
                    value=", ".join(unassigned_names[:10]) + ("..." if len(unassigned_names) > 10 else ""),
                    inline=False
                )

        await progress_msg.edit(content=None, embed=embed)

    @app_commands.command(name="list-users", description="List all users with availability")
    async def list_users(self, interaction: discord.Interaction):
        """List all users who have set their availability."""

        user_data = self.load_user_data()
        people = self.convert_users_to_people(user_data)

        if not people:
            await interaction.response.send_message(
                "No users have set their availability yet. Use `/signup` to register!",
                ephemeral=True
            )
            return

        embed = discord.Embed(
            title=f"📋 Registered Users ({len(people)})",
            color=discord.Color.blue()
        )

        for person in people[:25]:  # Show max 25
            total_time = calculate_total_available_time(person)
            hours = total_time // 60

            # Check facilitator status
            is_facilitator = user_data.get(person.id, {}).get("is_facilitator", False)
            facilitator_badge = " ⭐" if is_facilitator else ""

            courses_str = ", ".join(person.courses) if person.courses else "N/A"
            embed.add_field(
                name=f"{person.name}{facilitator_badge}",
                value=f"Available: {hours}h/week\n"
                      f"Courses: {courses_str}",
                inline=True
            )

        if len(people) > 25:
            embed.set_footer(text=f"... and {len(people) - 25} more")

        await interaction.response.send_message(embed=embed, ephemeral=True)


async def setup(bot):
    await bot.add_cog(SchedulerCog(bot))
