"""
Database safety checks for scripts.

Ensures scripts only run against known databases, with explicit
protection against accidentally running on production.
"""

import os
import sys

# Whitelist of allowed database identifiers
ALLOWED_DBS = {
    "zsidzfnw": "staging",
}

# Patterns that indicate a local database (any dev machine)
LOCAL_PATTERNS = [
    "localhost",
    "127.0.0.1",
    "host.docker.internal",
    "0.0.0.0",
    "::1",
]

# Explicitly blocked databases
BLOCKED_DBS = {
    "xnlxdi": "PRODUCTION",
}


def check_database_safety() -> str:
    """
    Check that we're connected to an allowed database.

    Returns the environment name (e.g., "staging", "local") if allowed.
    Exits with error if blocked or unknown.
    """
    db_url = os.environ.get("DATABASE_URL", "")

    if not db_url:
        print("ERROR: DATABASE_URL not set")
        sys.exit(1)

    # Check for blocked databases first
    for identifier, env_name in BLOCKED_DBS.items():
        if identifier in db_url:
            print(f"ERROR: This script cannot run on {env_name}!")
            print("This database is explicitly blocked for safety.")
            sys.exit(1)

    # Check for local databases
    for pattern in LOCAL_PATTERNS:
        if pattern in db_url:
            print("Database: local")
            return "local"

    # Check for allowed remote databases
    for identifier, env_name in ALLOWED_DBS.items():
        if identifier in db_url:
            print(f"Database: {env_name}")
            return env_name

    # Unknown database
    print("ERROR: Unknown database URL")
    print("This script only runs against whitelisted databases.")
    print("Add the database identifier to scripts/db_safety.py if this is intentional.")
    sys.exit(1)
