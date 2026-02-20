"""
Unified backend entry point.

Architecture:
- One Python process, one asyncio event loop
- Three peer services running concurrently:
  1. FastAPI (HTTP server for web frontend)
  2. Discord bot (WebSocket connection to Discord)
  3. [Future: Scheduler for background tasks like meeting reminders]

We use FastAPI's lifespan to manage startup/shutdown, but at runtime
all services are equal peers in the event loop. The lifespan pattern
gives us uvicorn's signal handling and --reload for free.

Run with: python main.py [--no-bot] [--port PORT]
"""

import asyncio
import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

# Set up import paths before any local imports
# This allows discord_bot cogs to use their relative imports
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))
# Append (not insert at 0) to allow cog loading without shadowing root main.py
sys.path.append(str(project_root / "discord_bot"))

from dotenv import load_dotenv
import sentry_sdk

# Load .env.local first (if exists), then .env as fallback
# .env.local is gitignored and used for local dev overrides
load_dotenv(project_root / ".env.local")  # Local overrides (gitignored)
load_dotenv()  # Fallback to .env

# Initialize Sentry for error tracking
# Detect environment: Railway sets RAILWAY_ENVIRONMENT_NAME automatically
sentry_dsn = os.getenv("SENTRY_DSN")
sentry_environment = (
    os.getenv("RAILWAY_ENVIRONMENT_NAME")  # Railway auto-sets this (e.g., "production")
    or os.getenv("ENVIRONMENT")  # Manual override
    or "development"  # Local dev default
)
if sentry_dsn:
    sentry_sdk.init(
        dsn=sentry_dsn,
        environment=sentry_environment,
        traces_sample_rate=0.1,  # 10% of transactions for performance monitoring
    )
    print(f"✓ Sentry error tracking initialized (environment: {sentry_environment})")
else:
    print("Note: SENTRY_DSN not set, error tracking disabled")

logger = logging.getLogger(__name__)


def fatal_startup_error(
    message: str, hint: str, exception: Exception | None = None
) -> None:
    """
    Log fatal startup error to stderr and Sentry, then exit.

    This ensures startup failures are visible in Railway logs and
    captured in Sentry before the process dies.
    """
    full_message = f"✗ {message}\n  └─ {hint}"

    # Log to stderr (Railway captures this)
    logger.error(full_message)
    # Also print for local dev visibility
    print(full_message)

    # Report to Sentry before dying
    if exception:
        sentry_sdk.capture_exception(exception)
    else:
        sentry_sdk.capture_message(full_message, level="fatal")

    # Flush Sentry events before exit (wait up to 5 seconds)
    sentry_sdk.flush(timeout=5)

    sys.exit(1)


# Parse --dev flag early so DEV_MODE is set before importing auth routes
# (auth.py computes DISCORD_REDIRECT_URI based on DEV_MODE at import time)
if __name__ == "__main__":
    import argparse
    import re

    # Extract workspace number from directory name (e.g., "platform-ws2" → 2)
    # Used to auto-assign ports: ws1 gets 8100/3100, ws2 gets 8200/3200, etc.
    # Offset by 100 so each workspace has a port range that won't collide if
    # a server auto-increments to the next available port.
    # No workspace suffix → 8000/3000 (default)
    _workspace_match = re.search(r"(?:^|-)ws(\d+)$", Path.cwd().name)
    _ws_num = int(_workspace_match.group(1)) if _workspace_match else 0
    _default_api_port = 8000 + _ws_num * 100
    _default_frontend_port = 3000 + _ws_num * 100

    _early_parser = argparse.ArgumentParser(add_help=False)
    _early_parser.add_argument("--dev", action="store_true")
    _early_parser.add_argument("--no-db", action="store_true")
    _early_parser.add_argument(
        "--port", type=int, default=int(os.getenv("API_PORT", str(_default_api_port)))
    )
    _early_args, _ = _early_parser.parse_known_args()
    if _early_args.dev:
        os.environ["DEV_MODE"] = "true"
        os.environ["API_PORT"] = str(_early_args.port)
        os.environ["FRONTEND_PORT"] = str(_default_frontend_port)
    else:
        # Production single-service mode: frontend served from same port as API
        os.environ["API_PORT"] = str(_early_args.port)
    if _early_args.no_db:
        os.environ["SKIP_DB_CHECK"] = "true"

from fastapi import FastAPI, HTTPException

from core.database import close_engine, check_connection
from core import get_allowed_origins, is_dev_mode
from core.config import check_required_env_vars
from core.content import initialize_cache, ContentBranchNotConfiguredError
from core.notifications import init_scheduler, shutdown_scheduler
from core.sync import sync_all_group_rsvps
from core.discord_outbound import set_bot as set_notification_bot
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# Import bot from discord_bot module
from discord_bot.main import bot

# Import routes using full paths (don't add web_api to sys.path to avoid main.py conflict)
from web_api.routes.auth import router as auth_router
from web_api.routes.users import router as users_router
from web_api.routes.module import router as module_router
from web_api.routes.modules import router as modules_router
from web_api.routes.speech import router as speech_router
from web_api.routes.cohorts import router as cohorts_router
from web_api.routes.courses import router as courses_router
from web_api.routes.facilitator import router as facilitator_router
from web_api.routes.content import router as content_router
from web_api.routes.groups import router as groups_router
from web_api.routes.admin import router as admin_router
from web_api.routes.progress import router as progress_router
from web_api.routes.assessments import router as assessments_router

# Track bot task for cleanup
_bot_task: asyncio.Task | None = None


async def start_bot():
    """
    Start Discord bot (non-blocking).

    Uses bot.start() instead of bot.run() so it can run
    alongside FastAPI in the same event loop.
    """
    # Check if bot is disabled via CLI flag (--no-bot)
    if os.getenv("DISABLE_DISCORD_BOT", "").lower() in ("true", "1", "yes"):
        print("Discord bot disabled (--no-bot flag or DISABLE_DISCORD_BOT=true)")
        return

    token = os.getenv("DISCORD_BOT_TOKEN")
    if not token:
        print("Warning: DISCORD_BOT_TOKEN not set, Discord bot will not start")
        return

    try:
        await bot.start(token)
    except Exception as e:
        print(f"Discord bot error: {e}")
        raise


async def stop_bot():
    """Stop Discord bot gracefully."""
    if bot and not bot.is_closed():
        await bot.close()
        print("Discord bot stopped")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    FastAPI lifespan context manager.

    Starts the Discord bot as a background task.
    It runs concurrently with FastAPI in the same event loop.
    """
    global _bot_task

    skip_db = os.getenv("SKIP_DB_CHECK", "").lower() in ("true", "1", "yes")

    # Initialize educational content cache from GitHub
    try:
        await initialize_cache()
    except ContentBranchNotConfiguredError as e:
        fatal_startup_error(
            f"Content cache: {e}",
            "Set EDUCATIONAL_CONTENT_BRANCH=staging (or main for production)",
            e,
        )
    except Exception as e:
        fatal_startup_error(
            f"Content cache failed: {e}",
            "Check GITHUB_TOKEN and network connectivity",
            e,
        )

    # Check database connection (runs in uvicorn's event loop - no issues)
    if not skip_db:
        print("Checking database connection...")
        db_ok, db_msg = await check_connection()
        if not db_ok:
            fatal_startup_error(
                f"Database: {db_msg}",
                "Server cannot start without database. Use --no-db to skip.",
            )
        print(f"✓ Database: {db_msg}")

        # Clean up expired refresh tokens (runs once per deploy)
        from core.database import get_transaction
        from core.queries.refresh_tokens import cleanup_expired_tokens

        async with get_transaction() as conn:
            deleted = await cleanup_expired_tokens(conn)
            if deleted:
                print(f"  Cleaned up {deleted} expired refresh tokens")
    else:
        print("Running in --no-db mode (database operations will fail)")

    # Initialize notification scheduler (skip if no database)
    scheduler = None
    if not skip_db:
        print("Starting notification scheduler...")
        scheduler = init_scheduler()

        # Add periodic RSVP sync job
        if scheduler:
            scheduler.add_job(
                sync_all_group_rsvps,
                trigger="interval",
                hours=6,
                id="sync_calendar_rsvps",
                replace_existing=True,
            )
            print("Scheduled RSVP sync job (every 6 hours)")
    else:
        print("Running in --no-db mode (database operations will fail)")

    # Start peer services as background tasks
    print("Starting Discord bot...")
    _bot_task = asyncio.create_task(start_bot())

    # Set bot reference for notifications once bot is ready
    async def on_bot_ready():
        # Poll until bot is ready (up to 30 seconds)
        for _ in range(30):
            if bot.is_ready():
                set_notification_bot(bot)
                print("Notification system connected to Discord bot")
                return
            await asyncio.sleep(1)
        print("Warning: Discord bot did not become ready within 30 seconds")

    asyncio.create_task(on_bot_ready())

    yield  # FastAPI runs here, bot runs alongside it

    # Graceful shutdown of all peer services
    print("Shutting down peer services...")
    shutdown_scheduler()
    await stop_bot()
    await close_engine()  # Close database connections
    if _bot_task:
        _bot_task.cancel()
        try:
            await _bot_task
        except asyncio.CancelledError:
            pass


# Create FastAPI app with lifespan
app = FastAPI(
    title="AI Safety Course Platform API",
    lifespan=lifespan,
)

# CORS configuration (uses centralized config from core/)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth_router)
app.include_router(users_router)
app.include_router(module_router)
app.include_router(modules_router)
app.include_router(speech_router)
app.include_router(cohorts_router)
app.include_router(courses_router)
app.include_router(facilitator_router)
app.include_router(content_router)
app.include_router(groups_router)
app.include_router(admin_router)
app.include_router(progress_router)
app.include_router(assessments_router)


# New paths for static files
static_path = (
    project_root / "web_frontend" / "static"
)  # Truly static HTML (landing page)
spa_path = project_root / "web_frontend" / "dist"  # React SPA build


@app.get("/")
async def root():
    """Serve landing page or API status."""
    if is_dev_mode():
        return {
            "status": "ok",
            "message": "API-only mode. Run Vite frontend separately.",
            "bot_ready": bot.is_ready() if bot else False,
        }
    # In production, the catch-all route also handles the root path
    # This route takes precedence over the catch-all, but keep for clarity
    landing_file = spa_path / "client" / "index.html"
    if landing_file.exists():
        return FileResponse(landing_file)
    return {"status": "ok", "bot_ready": bot.is_ready() if bot else False}


@app.get("/api/status")
async def api_status():
    """API status endpoint (moved from /)."""
    return {
        "status": "ok",
        "bot_ready": bot.is_ready() if bot else False,
    }


@app.get("/health")
async def health():
    """Health check endpoint with detailed status."""
    return {
        "status": "healthy",
        "bot_connected": bot.is_ready() if bot else False,
        "bot_latency_ms": round(bot.latency * 1000) if bot and bot.is_ready() else None,
    }


# Vike SSG + SPA static file serving (only in production, not dev mode)
if spa_path.exists() and not is_dev_mode():
    # Mount static assets from built frontend
    assets_path = spa_path / "client" / "assets"
    if assets_path.exists():
        app.mount("/assets", StaticFiles(directory=assets_path), name="assets")

    @app.get("/{full_path:path}")
    async def spa_catchall(full_path: str):
        """Serve Vike SSG pages or SPA fallback.

        For SSG pages: Serve pre-rendered HTML directly
        For SPA pages: Serve 200.html (Vike's SPA fallback) or index.html
        API routes (/api/*, /auth/*) are excluded - they 404 if no match.
        """
        # Don't catch API routes - let them 404 properly
        if full_path.startswith("api/") or full_path.startswith("auth/"):
            raise HTTPException(status_code=404, detail="Not found")

        client_path = spa_path / "client"
        client_path_resolved = client_path.resolve()

        def is_safe_path(path: Path) -> bool:
            """Verify path is within client_path to prevent path traversal attacks."""
            try:
                resolved = path.resolve()
                return resolved.is_relative_to(client_path_resolved)
            except (ValueError, RuntimeError):
                return False

        # Try exact file match first (for static assets like favicon, images)
        static_file = client_path / full_path
        if not is_safe_path(static_file):
            raise HTTPException(status_code=404, detail="Not found")
        if static_file.exists() and static_file.is_file():
            return FileResponse(static_file)

        # Try SSG pre-rendered HTML (e.g., /course/default -> /course/default/index.html)
        # Handle both with and without trailing slash
        path_to_check = full_path.rstrip("/")
        if path_to_check == "":
            path_to_check = "index"

        ssg_file = client_path / path_to_check / "index.html"
        if not is_safe_path(ssg_file):
            raise HTTPException(status_code=404, detail="Not found")
        if ssg_file.exists():
            return FileResponse(ssg_file)

        # Check for direct .html file (e.g., /404 -> /404.html)
        direct_html = client_path / f"{path_to_check}.html"
        if not is_safe_path(direct_html):
            raise HTTPException(status_code=404, detail="Not found")
        if direct_html.exists():
            return FileResponse(direct_html)

        # SPA fallback - serve 200/index.html (our pre-rendered SPA shell)
        # or root index.html if 200 doesn't exist
        spa_fallback = client_path / "200" / "index.html"
        if spa_fallback.exists():
            return FileResponse(spa_fallback)

        # Fallback to root index.html (SSG landing page as last resort)
        index_fallback = client_path / "index.html"
        if index_fallback.exists():
            return FileResponse(index_fallback)

        raise HTTPException(status_code=404, detail="Not found")


if __name__ == "__main__":
    import argparse
    import re
    import uvicorn

    # Extract workspace number from directory name (e.g., "platform-ws2" → 2)
    # Used to auto-assign ports: ws1 gets 8001/3001, ws2 gets 8002/3002, etc.
    workspace_match = re.search(r"-ws(\d+)$", Path.cwd().name)
    ws_num = int(workspace_match.group(1)) if workspace_match else 0
    default_api_port = 8000 + ws_num
    default_frontend_port = 3000 + ws_num

    parser = argparse.ArgumentParser(description="AI Safety Course Platform Server")
    parser.add_argument(
        "--no-bot",
        action="store_true",
        help="Disable Discord bot (useful for running multiple dev servers)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.getenv("API_PORT", str(default_api_port))),
        help=f"Port for API server (default: {default_api_port} for ws{ws_num})",
    )
    parser.add_argument(
        "--dev",
        action="store_true",
        help="Enable dev mode (API returns JSON at /, doesn't serve SPA)",
    )
    parser.add_argument(
        "--no-db",
        action="store_true",
        help="Skip database connection check (for frontend-only development)",
    )
    args = parser.parse_args()

    # Set WORKSPACE from directory name (for server identification across workspaces)
    workspace_name = Path.cwd().name
    os.environ["WORKSPACE"] = workspace_name

    # Write server info to temp file for list-servers script
    # (os.environ changes don't appear in /proc/<pid>/environ)
    server_info_dir = Path("/tmp/dev-servers")
    server_info_dir.mkdir(exist_ok=True)
    server_info_file = server_info_dir / f"{os.getpid()}.json"
    import json

    server_info_file.write_text(
        json.dumps(
            {
                "pid": os.getpid(),
                "workspace": workspace_name,
                "api_port": args.port,
                "frontend_port": default_frontend_port if args.dev else None,
            }
        )
    )

    # Register cleanup on exit
    import atexit

    atexit.register(lambda: server_info_file.unlink(missing_ok=True))

    # Set env vars so they persist across uvicorn reloads
    if args.no_bot:
        os.environ["DISABLE_DISCORD_BOT"] = "true"
    if args.dev:
        os.environ["DEV_MODE"] = "true"
        os.environ["API_PORT"] = str(args.port)
        os.environ["FRONTEND_PORT"] = str(default_frontend_port)
        print(
            f"Dev mode enabled (ws{ws_num}): API :{args.port}, Next.js :{default_frontend_port}"
        )

    # Check required environment variables
    print("Checking environment variables...")
    env_ok, env_warnings = check_required_env_vars()
    if not env_ok:
        print("  └─ Missing required environment variables. Server cannot start.")
        sys.exit(1)
    if env_warnings:
        for warning in env_warnings:
            print(warning)
    else:
        print("✓ Environment variables configured")

    # Run with uvicorn
    # Pass app object directly (not string) to avoid module reimport issues
    # Note: --reload requires string import; use `uvicorn main:app --reload` if needed
    print(
        f"Starting server on port {args.port} (PORT env: {os.environ.get('PORT', 'not set')})"
    )
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=args.port,
    )
