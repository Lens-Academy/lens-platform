"""
Enrollment and scheduling helpers.

Converts user data to Person objects for scheduling algorithm.
User profile functions are in core/users.py.
"""

from .availability import availability_json_to_intervals
from .database import get_connection
from .queries import users as user_queries
from .scheduling import Person


async def get_people_for_scheduling() -> tuple[list[Person], dict[str, dict]]:
    """
    Get all users with availability as Person objects for scheduling.

    Also returns the raw user data dict for facilitator checking.

    Returns:
        Tuple of (list of Person objects, dict of discord_id -> user data)
    """
    async with get_connection() as conn:
        users = await user_queries.get_all_users_with_availability(conn)
        facilitator_list = await user_queries.get_facilitators(conn)

    # Create set of facilitator discord_ids for quick lookup
    facilitator_discord_ids = {f["discord_id"] for f in facilitator_list}

    people = []
    user_data_dict = {}

    for user in users:
        discord_id = user.get("discord_id")
        if not discord_id:
            continue

        # Parse availability from JSON strings using shared helper
        availability_str = user.get("availability_utc")
        if_needed_str = user.get("if_needed_availability_utc")

        intervals = availability_json_to_intervals(availability_str)
        if_needed_intervals = availability_json_to_intervals(if_needed_str)

        if not intervals and not if_needed_intervals:
            continue

        # Get name
        name = user.get("nickname") or user.get("discord_username") or f"User_{discord_id[:8]}"

        # Create Person object
        person = Person(
            id=discord_id,
            name=name,
            intervals=intervals,
            if_needed_intervals=if_needed_intervals,
            timezone=user.get("timezone", "UTC"),
        )
        people.append(person)

        # Store user data for facilitator checking
        user_data_dict[discord_id] = {
            "name": name,
            "timezone": user.get("timezone", "UTC"),
            "is_facilitator": discord_id in facilitator_discord_ids,
        }

    return people, user_data_dict
