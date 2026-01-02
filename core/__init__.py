"""
Core business logic - platform-agnostic.
Can be used by Discord bot, web API, or any other interface.
"""

# Database (SQLAlchemy) - user data migrated to database, courses removed

# Database (SQLAlchemy)
from .database import get_connection, get_transaction, get_engine, close_engine, is_configured

# Constants
from .constants import DAY_CODES, DAY_NAMES, TIMEZONES

# Timezone utilities
from .timezone import local_to_utc_time, utc_to_local_time

# Google Docs integration
from .google_docs import extract_doc_id, fetch_google_doc, parse_doc_tabs, make_tab_url

# Cohort name generation
from .cohort_names import CohortNameGenerator, COHORT_NAMES

# Scheduling algorithm
from .scheduling import (
    Person, Group, CourseSchedulingResult, MultiCourseSchedulingResult, DAY_MAP,
    CohortSchedulingResult,  # New: DB-backed cohort scheduling
    SchedulingError, NoUsersError, NoFacilitatorsError,
    parse_interval_string, calculate_total_available_time,
    is_group_valid, find_cohort_time_options, format_time_range,
    group_people_by_course, remove_blocked_intervals,
    run_greedy_iteration, run_scheduling, balance_cohorts,
    schedule_people, schedule, convert_user_data_to_people,
    schedule_cohort,  # New: DB-backed cohort scheduling
)


# User management (async functions - must be awaited)
from .users import (
    get_user_profile, save_user_profile, update_user_profile,
    get_users_with_availability, get_facilitators, toggle_facilitator, is_facilitator,
)

# Nickname sync (async functions)
from .nickname import get_user_nickname, update_user_nickname

# Enrollment/scheduling helpers (async)
from .enrollment import get_people_for_scheduling

# Cohorts / Availability
from .cohorts import (
    find_availability_overlap, format_local_time, get_timezone_abbrev
)

# Auth (Discord-to-Web flow)
from .auth import create_auth_code, get_or_create_user, validate_and_use_auth_code

# Stampy chatbot
from core import stampy
from core import lesson_chat

__all__ = [
    # Database (SQLAlchemy)
    'get_connection', 'get_transaction', 'get_engine', 'close_engine', 'is_configured',
    # Constants
    'DAY_CODES', 'DAY_NAMES', 'TIMEZONES',
    # Timezone
    'local_to_utc_time', 'utc_to_local_time',
    # Google Docs
    'extract_doc_id', 'fetch_google_doc', 'parse_doc_tabs', 'make_tab_url',
    # Cohort names
    'CohortNameGenerator', 'COHORT_NAMES',
    # Scheduling
    'Person', 'Group', 'CourseSchedulingResult', 'MultiCourseSchedulingResult', 'DAY_MAP',
    'CohortSchedulingResult',  # New: DB-backed cohort scheduling
    'SchedulingError', 'NoUsersError', 'NoFacilitatorsError',
    'parse_interval_string', 'calculate_total_available_time',
    'is_group_valid', 'find_cohort_time_options', 'format_time_range',
    'group_people_by_course', 'remove_blocked_intervals',
    'run_greedy_iteration', 'run_scheduling', 'balance_cohorts',
    'schedule_people', 'schedule', 'convert_user_data_to_people',
    'schedule_cohort',  # New: DB-backed cohort scheduling
    # User management (async)
    'get_user_profile', 'save_user_profile', 'update_user_profile',
    'get_users_with_availability', 'get_facilitators', 'toggle_facilitator', 'is_facilitator',
    # Nickname sync (async)
    'get_user_nickname', 'update_user_nickname',
    # Enrollment/scheduling (async)
    'get_people_for_scheduling',
    # Cohorts / Availability
    'find_availability_overlap', 'format_local_time', 'get_timezone_abbrev',
    # Auth
    'create_auth_code', 'get_or_create_user', 'validate_and_use_auth_code',
    # Stampy
    'stampy',
    'lesson_chat',
]
