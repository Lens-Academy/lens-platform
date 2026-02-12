"""
Centralized configuration for the AI Safety Course Platform.

Provides environment-aware settings and eliminates duplicate config
logic across main.py and web_api/routes/auth.py.
"""

import os
import re
from pathlib import Path


def _get_workspace_num() -> int:
    """Detect workspace number from CWD (e.g., 'ws2' -> 2, 'platform-ws1' -> 1)."""
    match = re.search(r"(?:^|-)ws(\d+)$", Path.cwd().name)
    return int(match.group(1)) if match else 0


def is_dev_mode() -> bool:
    """Check if running in development mode (--dev flag or DEV_MODE env)."""
    return os.getenv("DEV_MODE", "").lower() in ("true", "1", "yes")


def is_production() -> bool:
    """Check if running on Railway (production environment)."""
    return bool(os.environ.get("RAILWAY_ENVIRONMENT"))


def get_api_port() -> int:
    """Get API server port from env or workspace-aware default."""
    if os.getenv("API_PORT"):
        return int(os.getenv("API_PORT"))
    return 8000 + _get_workspace_num() * 100


def get_frontend_port() -> int:
    """Get frontend dev server port from env or workspace-aware default."""
    if os.getenv("FRONTEND_PORT"):
        return int(os.getenv("FRONTEND_PORT"))
    return 3000 + _get_workspace_num() * 100


def get_dev_host() -> str:
    """Get hostname for dev URLs (e.g., 'dev.vps' for remote access)."""
    return os.getenv("DEV_HOST", "localhost")


def get_frontend_url() -> str:
    """Get frontend URL based on mode."""
    if is_dev_mode():
        # Allow env var override, otherwise auto-detect from workspace + DEV_HOST
        return os.environ.get(
            "FRONTEND_URL", f"http://{get_dev_host()}:{get_frontend_port()}"
        ).rstrip("/")
    if is_production():
        return os.environ.get("FRONTEND_URL", f"http://localhost:{get_api_port()}")
    return f"http://localhost:{get_api_port()}"


def get_allowed_origins() -> list[str]:
    """
    Get list of allowed CORS origins.

    Includes localhost variants for dev and the production frontend URL.
    """
    # Base ports + workspace ports (offset by 100: ws1=8100, ws2=8200, etc.)
    workspace_api_ports = [8000 + i * 100 for i in range(4)]
    workspace_frontend_ports = [3000 + i * 100 for i in range(4)]
    all_ports = workspace_api_ports + workspace_frontend_ports
    # Include DEV_HOST for remote development access (e.g., dev.vps)
    dev_host = get_dev_host()
    hosts = ["localhost", "127.0.0.1"]
    if dev_host not in hosts:
        hosts.append(dev_host)
    origins = [f"http://{host}:{port}" for host in hosts for port in all_ports]

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
