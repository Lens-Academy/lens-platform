"""Query layer for database operations using SQLAlchemy Core."""

from .refresh_tokens import (
    store_refresh_token,
    get_refresh_token_by_hash,
    revoke_token,
    revoke_family,
    revoke_all_user_tokens,
    cleanup_expired_tokens,
)
from .users import (
    create_user,
    get_or_create_user,
    get_user_by_discord_id,
    get_user_admin_details,
    update_user,
    search_users,
)
from .cohorts import (
    get_schedulable_cohorts,
    get_realizable_cohorts,
    get_cohort_by_id,
    save_cohort_category_id,
)
from .groups import (
    create_group,
    add_user_to_group,
    remove_user_from_group,
    get_cohort_groups_for_realization,
    get_cohort_group_ids,
    get_cohort_preview_group_ids,
    get_group_welcome_data,
    get_cohort_groups_summary,
)
from .facilitator import (
    is_admin,
    get_facilitator_group_ids,
    get_accessible_groups,
    can_access_group,
)

# NOTE: progress.py removed - old progress tracking system deleted
# The following functions need to be reimplemented using the new user_content_progress tables:
# - get_group_members_summary
# - get_user_progress_for_group
# - get_user_chat_sessions
from .meetings import (
    create_meeting,
    get_meetings_for_group,
    get_meeting,
    reschedule_meeting,
    get_group_member_emails,
    get_group_member_user_ids,
)

__all__ = [
    # Users
    "get_user_by_discord_id",
    "get_user_admin_details",
    "create_user",
    "update_user",
    "get_or_create_user",
    "search_users",
    # Cohorts
    "get_schedulable_cohorts",
    "get_realizable_cohorts",
    "get_cohort_by_id",
    "save_cohort_category_id",
    # Groups
    "create_group",
    "add_user_to_group",
    "remove_user_from_group",
    "get_cohort_groups_for_realization",
    "get_cohort_group_ids",
    "get_cohort_preview_group_ids",
    "get_group_welcome_data",
    "get_cohort_groups_summary",
    # Facilitator
    "is_admin",
    "get_facilitator_group_ids",
    "get_accessible_groups",
    "can_access_group",
    # Progress - removed, needs reimplementation with new tables
    # Refresh tokens
    "store_refresh_token",
    "get_refresh_token_by_hash",
    "revoke_token",
    "revoke_family",
    "revoke_all_user_tokens",
    "cleanup_expired_tokens",
    # Meetings
    "create_meeting",
    "get_meetings_for_group",
    "get_meeting",
    "reschedule_meeting",
    "get_group_member_emails",
    "get_group_member_user_ids",
]
