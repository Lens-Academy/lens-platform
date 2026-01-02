"""Query layer for database operations using SQLAlchemy Core."""

from .auth import create_auth_code, validate_auth_code
from .users import create_user, get_or_create_user, get_user_by_discord_id, update_user
from .cohorts import (
    get_schedulable_cohorts,
    get_realizable_cohorts,
    get_cohort_by_id,
    save_cohort_category_id,
)
from .groups import (
    create_group,
    add_user_to_group,
    get_cohort_groups_for_realization,
    save_discord_channel_ids,
    get_group_welcome_data,
)

__all__ = [
    # Users
    "get_user_by_discord_id",
    "create_user",
    "update_user",
    "get_or_create_user",
    # Auth
    "create_auth_code",
    "validate_auth_code",
    # Cohorts
    "get_schedulable_cohorts",
    "get_realizable_cohorts",
    "get_cohort_by_id",
    "save_cohort_category_id",
    # Groups
    "create_group",
    "add_user_to_group",
    "get_cohort_groups_for_realization",
    "save_discord_channel_ids",
    "get_group_welcome_data",
]
