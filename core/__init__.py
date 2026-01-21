"""
Core business logic - platform-agnostic.
Can be used by Discord bot, web API, or any other interface.
"""

# Database (SQLAlchemy) - user data migrated to database, courses removed
from .database import (
    get_connection,
    get_transaction,
    get_engine,
    close_engine,
    is_configured,
)

# Constants
from .constants import DAY_CODES, DAY_NAMES, TIMEZONES

# Timezone utilities
from .timezone import local_to_utc_time, utc_to_local_time

# Google Docs integration
from .google_docs import extract_doc_id, fetch_google_doc, parse_doc_tabs, make_tab_url

# Cohort name generation
from .cohort_names import CohortNameGenerator, COHORT_NAMES

# Scheduling algorithm
import cohort_scheduler
from .scheduling import (
    Person,
    DAY_MAP,
    CohortSchedulingResult,
    UngroupableReason,
    UngroupableDetail,
    calculate_total_available_time,
    analyze_ungroupable_users,
    schedule_cohort,
)


# User management (async functions - must be awaited)
from .users import (
    get_user_profile,
    save_user_profile,
    update_user_profile,
    get_users_with_availability,
    get_facilitators,
    toggle_facilitator,
    is_facilitator,
    become_facilitator,
    enroll_in_cohort,
)

# Nickname sync (async functions)
from .nickname import get_user_nickname, update_user_nickname
from .nickname_sync import (
    register_nickname_callback,
    unregister_nickname_callback,
    update_nickname_in_discord,
)

# Cohorts / Availability
from .cohorts import find_availability_overlap, format_local_time, get_timezone_abbrev

# Availability format conversion
from .availability import (
    merge_adjacent_slots,
    availability_json_to_intervals,
    availability_json_to_interval_string,
)

# Auth (Discord-to-Web flow)
from .auth import create_auth_code, get_or_create_user, validate_and_use_auth_code

# Stampy chatbot
from . import stampy

# Configuration
from .config import (
    is_dev_mode,
    is_production,
    get_api_port,
    get_frontend_port,
    get_frontend_url,
    get_allowed_origins,
)

# Notifications
from .notifications import (
    notify_welcome,
    notify_group_assigned,
    schedule_meeting_reminders,
    cancel_meeting_reminders,
)

# Meetings
from .meetings import (
    create_meetings_for_group,
    send_calendar_invites_for_group,
    schedule_reminders_for_group,
    reschedule_meeting,
)

__all__ = [
    # Database (SQLAlchemy)
    "get_connection",
    "get_transaction",
    "get_engine",
    "close_engine",
    "is_configured",
    # Constants
    "DAY_CODES",
    "DAY_NAMES",
    "TIMEZONES",
    # Timezone
    "local_to_utc_time",
    "utc_to_local_time",
    # Google Docs
    "extract_doc_id",
    "fetch_google_doc",
    "parse_doc_tabs",
    "make_tab_url",
    # Cohort names
    "CohortNameGenerator",
    "COHORT_NAMES",
    # Scheduling (cohort_scheduler package for Group, parse_interval_string, etc.)
    "cohort_scheduler",
    # Scheduling (platform-specific)
    "Person",
    "DAY_MAP",
    "CohortSchedulingResult",
    "UngroupableReason",
    "UngroupableDetail",
    "calculate_total_available_time",
    "analyze_ungroupable_users",
    "schedule_cohort",
    # User management (async)
    "get_user_profile",
    "save_user_profile",
    "update_user_profile",
    "get_users_with_availability",
    "get_facilitators",
    "toggle_facilitator",
    "is_facilitator",
    "become_facilitator",
    "enroll_in_cohort",
    # Nickname sync (async)
    "get_user_nickname",
    "update_user_nickname",
    "register_nickname_callback",
    "unregister_nickname_callback",
    "update_nickname_in_discord",
    # Cohorts / Availability
    "find_availability_overlap",
    "format_local_time",
    "get_timezone_abbrev",
    # Availability format conversion
    "merge_adjacent_slots",
    "availability_json_to_intervals",
    "availability_json_to_interval_string",
    # Auth
    "create_auth_code",
    "get_or_create_user",
    "validate_and_use_auth_code",
    # Stampy
    "stampy",
    # Configuration
    "is_dev_mode",
    "is_production",
    "get_api_port",
    "get_frontend_port",
    "get_frontend_url",
    "get_allowed_origins",
    # Notifications
    "notify_welcome",
    "notify_group_assigned",
    "schedule_meeting_reminders",
    "cancel_meeting_reminders",
    # Meetings
    "create_meetings_for_group",
    "send_calendar_invites_for_group",
    "schedule_reminders_for_group",
    "reschedule_meeting",
]
