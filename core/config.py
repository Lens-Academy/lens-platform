"""
Centralized configuration for the AI Safety Course Platform.

Provides environment-aware settings and eliminates duplicate config
logic across main.py and web_api/routes/auth.py.
"""

import os


def is_dev_mode() -> bool:
    """Check if running in development mode (--dev flag or DEV_MODE env)."""
    return os.getenv("DEV_MODE", "").lower() in ("true", "1", "yes")


def is_production() -> bool:
    """Check if running on Railway (production environment)."""
    return bool(os.environ.get("RAILWAY_ENVIRONMENT"))


def get_api_port() -> int:
    """Get API server port from env or default."""
    return int(os.getenv("API_PORT", "8000"))


def get_frontend_port() -> int:
    """Get frontend dev server port from env or default."""
    return int(os.getenv("FRONTEND_PORT", "3000"))


def get_frontend_url() -> str:
    """Get frontend URL based on mode."""
    if is_dev_mode():
        # Next.js dev server runs on separate port (auto-assigned by workspace)
        return f"http://localhost:{get_frontend_port()}"
    if is_production():
        return os.environ.get("FRONTEND_URL", f"http://localhost:{get_api_port()}")
    return f"http://localhost:{get_api_port()}"


def get_allowed_origins() -> list[str]:
    """
    Get list of allowed CORS origins.

    Includes localhost variants for dev and the production frontend URL.
    """
    origins = [
        "http://localhost:5173",
        "http://localhost:8000",
        "http://localhost:8001",
        "http://localhost:8002",
        "http://localhost:8003",
        "http://localhost:3000",  # Next.js dev
        "http://localhost:3001",  # Next.js dev (alternate port)
        "http://127.0.0.1:5173",
        "http://127.0.0.1:8000",
        "http://127.0.0.1:8001",
        "http://127.0.0.1:8002",
        "http://127.0.0.1:8003",
        "http://127.0.0.1:3000",  # Next.js dev
        "http://127.0.0.1:3001",  # Next.js dev (alternate port)
    ]

    # Add production frontend URL if not already in list
    frontend_url = get_frontend_url()
    if frontend_url not in origins:
        origins.append(frontend_url)

    # Add explicit FRONTEND_URL env var if set
    env_frontend = os.environ.get("FRONTEND_URL")
    if env_frontend and env_frontend not in origins:
        origins.append(env_frontend)

    return origins


# Required environment variables for production
# Format: (name, description, required_in_dev)
REQUIRED_ENV_VARS = [
    ("DATABASE_URL", "PostgreSQL connection string", True),
    ("JWT_SECRET", "Secret key for JWT tokens", True),
    (
        "DISCORD_SERVER_ID",
        "Discord server ID for notifications and nickname sync",
        False,
    ),
    ("DISCORD_BOT_TOKEN", "Discord bot token", False),
]


def check_required_env_vars() -> tuple[bool, list[str]]:
    """
    Check that required environment variables are set.

    Returns:
        (all_ok, warnings): Tuple of success flag and list of warning messages
    """
    warnings = []
    errors = []
    in_dev = is_dev_mode()

    for name, description, required_in_dev in REQUIRED_ENV_VARS:
        value = os.environ.get(name)

        if not value:
            if is_production():
                errors.append(f"  ✗ {name}: Not set ({description})")
            elif required_in_dev or not in_dev:
                warnings.append(f"  ⚠ {name}: Not set ({description})")

    if errors:
        for error in errors:
            print(error)
        return False, warnings

    return True, warnings
