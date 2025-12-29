"""
Core business logic - platform-agnostic.
Can be used by Discord bot, web API, or any other interface.
"""

# Data persistence (courses still on JSON, users migrated to database)
from .data import (
    load_courses, save_courses, get_course
)

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
    Person, Group, DAY_MAP,
    parse_interval_string, calculate_total_available_time,
    is_group_valid, find_cohort_time_options, format_time_range,
    run_greedy_iteration, run_scheduling, balance_cohorts,
    convert_user_data_to_people
)

# Course management
from .courses import (
    get_all_courses, create_course, update_course, delete_course,
    add_course_week, update_course_week,
    mark_week_complete, get_user_progress, get_user_enrolled_courses, is_week_accessible
)

# Enrollment (async functions - must be awaited)
from .enrollment import (
    get_user_profile, save_user_profile,
    get_users_with_availability, get_facilitators, toggle_facilitator, is_facilitator,
    get_people_for_scheduling
)

# Cohorts / Availability
from .cohorts import (
    find_availability_overlap, format_local_time, get_timezone_abbrev
)

# Auth (Discord-to-Web flow)
from .auth import create_auth_code, get_or_create_user

# Stampy chatbot
from core import stampy
from core import lesson_chat

__all__ = [
    # Data (courses still on JSON)
    'load_courses', 'save_courses', 'get_course',
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
    'Person', 'Group', 'DAY_MAP',
    'parse_interval_string', 'calculate_total_available_time',
    'is_group_valid', 'find_cohort_time_options', 'format_time_range',
    'run_greedy_iteration', 'run_scheduling', 'balance_cohorts',
    'convert_user_data_to_people',
    # Course management
    'get_all_courses', 'create_course', 'update_course', 'delete_course',
    'add_course_week', 'update_course_week',
    'mark_week_complete', 'get_user_progress', 'get_user_enrolled_courses', 'is_week_accessible',
    # Enrollment (async)
    'get_user_profile', 'save_user_profile',
    'get_users_with_availability', 'get_facilitators', 'toggle_facilitator', 'is_facilitator',
    'get_people_for_scheduling',
    # Cohorts / Availability
    'find_availability_overlap', 'format_local_time', 'get_timezone_abbrev',
    # Auth
    'create_auth_code', 'get_or_create_user',
    # Stampy
    'stampy',
    'lesson_chat',
]
