"""
Utility modules for the bot.
Re-exports from core/ for backward compatibility.
All business logic has been moved to core/.

NOTE: User data functions (get_user_data, save_user_data, etc.) have been
migrated to async database functions in core/enrollment.py.
Use get_user_profile(), save_user_profile(), etc. instead.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

# Re-export from core for backward compatibility
from core import (
    # Constants
    DAY_CODES, DAY_NAMES, TIMEZONES,
    # Timezone
    local_to_utc_time, utc_to_local_time,
    # Group names (formerly cohort names)
    COHORT_NAMES, CohortNameGenerator,
    # Google docs
    extract_doc_id, fetch_google_doc, parse_doc_tabs,
)

__all__ = [
    'DAY_CODES',
    'DAY_NAMES',
    'TIMEZONES',
    'local_to_utc_time',
    'utc_to_local_time',
    'COHORT_NAMES',
    'CohortNameGenerator',
    'extract_doc_id',
    'fetch_google_doc',
    'parse_doc_tabs',
]
