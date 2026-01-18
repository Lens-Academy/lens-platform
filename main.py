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
sentry_dsn = os.getenv("SENTRY_DSN")
if sentry_dsn:
    sentry_sdk.init(
        dsn=sentry_dsn,
        environment=os.getenv("ENVIRONMENT", "development"),
        traces_sample_rate=0.1,  # 10% of transactions for performance monitoring
    )
    print("✓ Sentry error tracking initialized")
else:
    print("Note: SENTRY_DSN not set, error tracking disabled")

# Parse --dev flag early so DEV_MODE is set before importing auth routes
# (auth.py computes DISCORD_REDIRECT_URI based on DEV_MODE at import time)
if __name__ == "__main__":
    import argparse

    _early_parser = argparse.ArgumentParser(add_help=False)
    _early_parser.add_argument("--dev", action="store_true")
    _early_parser.add_argument("--no-db", action="store_true")
    _early_parser.add_argument(
        "--port", type=int, default=int(os.getenv("API_PORT", "8000"))
    )
    _early_parser.add_argument(
        "--vite-port", type=int, default=int(os.getenv("VITE_PORT", "5173"))
    )
    _early_args, _ = _early_parser.parse_known_args()
    if _early_args.dev:
        os.environ["DEV_MODE"] = "true"
        os.environ["API_PORT"] = str(_early_args.port)
        os.environ["VITE_PORT"] = str(_early_args.vite_port)
    else:
        # Production single-service mode: frontend served from same port as API
        os.environ["API_PORT"] = str(_early_args.port)
    if _early_args.no_db:
        os.environ["SKIP_DB_CHECK"] = "true"

from fastapi import FastAPI

from core.database import close_engine, check_connection
from core import get_allowed_origins, is_dev_mode
from core.config import check_required_env_vars
from core.content import initialize_cache, ContentBranchNotConfiguredError
from core.notifications import init_scheduler, shutdown_scheduler
from core.calendar.rsvp import sync_upcoming_meeting_rsvps
from core.notifications.channels.discord import set_bot as set_notification_bot
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# Import bot from discord_bot module
from discord_bot.main import bot

# Import routes using full paths (don't add web_api to sys.path to avoid main.py conflict)
from web_api.routes.auth import router as auth_router
from web_api.routes.users import router as users_router
from web_api.routes.lesson import router as lesson_router
from web_api.routes.lessons import router as lessons_router
from web_api.routes.speech import router as speech_router
from web_api.routes.cohorts import router as cohorts_router
from web_api.routes.courses import router as courses_router
from web_api.routes.facilitator import router as facilitator_router
from web_api.routes.content import router as content_router

# Track bot task for cleanup
_bot_task: asyncio.Task | None = None
_vite_process: asyncio.subprocess.Process | None = None


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


async def start_vite_dev():
    """
    Start Vite dev server as subprocess.

    Only runs when DEV_MODE is enabled (via --dev flag).
    The Vite server provides HMR for frontend development.
    Port is read from VITE_PORT env var (default: 5173).
    """
    global _vite_process

    if os.getenv("DEV_MODE", "").lower() not in ("true", "1", "yes"):
        return

    port = int(os.getenv("VITE_PORT", "5173"))

    try:
        _vite_process = await asyncio.create_subprocess_exec(
            "npm",
            "run",
            "dev",
            "--",
            "--port",
            str(port),
            "--strictPort",  # Fail if port is busy instead of auto-escalating
            cwd=project_root / "web_frontend",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        print(f"Vite dev server started on port {port} (PID {_vite_process.pid})")

        # Stream Vite output (don't await - let it run in background)
        asyncio.create_task(_stream_vite_output())
    except Exception as e:
        print(f"Failed to start Vite dev server: {e}")


async def _stream_vite_output():
    """Stream Vite subprocess output to console."""
    if _vite_process and _vite_process.stdout:
        async for line in _vite_process.stdout:
            print(f"[vite] {line.decode().rstrip()}")


async def stop_vite_dev():
    """Stop Vite dev server gracefully."""
    global _vite_process

    if _vite_process:
        try:
            _vite_process.terminate()
            await asyncio.wait_for(_vite_process.wait(), timeout=5.0)
            print("Vite dev server stopped")
        except ProcessLookupError:
            # Process already exited
            print("Vite dev server already stopped")
        except asyncio.TimeoutError:
            _vite_process.kill()
            print("Vite dev server killed (timeout)")
        _vite_process = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    FastAPI lifespan context manager.

    Starts peer services (Discord bot, Vite dev server) as background tasks.
    They run concurrently with FastAPI in the same event loop.
    """
    global _bot_task

    skip_db = os.getenv("SKIP_DB_CHECK", "").lower() in ("true", "1", "yes")

    # Initialize educational content cache from GitHub
    try:
        await initialize_cache()
    except ContentBranchNotConfiguredError as e:
        print(f"✗ Content cache: {e}")
        print("  └─ Set EDUCATIONAL_CONTENT_BRANCH=staging (or main for production)")
        sys.exit(1)
    except Exception as e:
        print(f"✗ Content cache failed: {e}")
        print("  └─ Check GITHUB_TOKEN and network connectivity")
        sys.exit(1)

    # Check database connection (runs in uvicorn's event loop - no issues)
    if not skip_db:
        print("Checking database connection...")
        db_ok, db_msg = await check_connection()
        if not db_ok:
            print(f"✗ Database: {db_msg}")
            print("  └─ Server cannot start without database. Use --no-db to skip.")
            sys.exit(1)
        print(f"✓ Database: {db_msg}")
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
                sync_upcoming_meeting_rsvps,
                trigger="interval",
                hours=6,
                id="sync_calendar_rsvps",
                replace_existing=True,
                kwargs={"days_ahead": 7},
            )
            print("Scheduled RSVP sync job (every 6 hours)")
    else:
        print("Running in --no-db mode (database operations will fail)")

    # Start peer services as background tasks
    print("Starting Discord bot...")
    _bot_task = asyncio.create_task(start_bot())

    # Set bot reference for notifications once bot is ready
    async def on_bot_ready():
        await asyncio.sleep(2)  # Wait for bot to be ready
        if bot.is_ready():
            set_notification_bot(bot)
            print("Notification system connected to Discord bot")

    asyncio.create_task(on_bot_ready())

    # Start Vite dev server if in dev mode
    await start_vite_dev()

    yield  # FastAPI runs here, bot runs alongside it

    # Graceful shutdown of all peer services
    print("Shutting down peer services...")
    await stop_vite_dev()
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
app.include_router(lesson_router)
app.include_router(lessons_router)
app.include_router(speech_router)
app.include_router(cohorts_router)
app.include_router(courses_router)
app.include_router(facilitator_router)
app.include_router(content_router)


# New paths for static files
static_path = (
    project_root / "web_frontend" / "static"
)  # Truly static HTML (landing page)
spa_path = project_root / "web_frontend" / "dist"  # React SPA build


@app.get("/")
async def root():
    """Serve landing page if it exists, otherwise return API status."""
    if is_dev_mode():
        return {
            "status": "ok",
            "message": "API-only mode. Access frontend at Vite dev server.",
            "bot_ready": bot.is_ready() if bot else False,
        }
    landing_file = static_path / "landing.html"
    if landing_file.exists():
        return FileResponse(landing_file)
    return {
        "status": "ok",
        "bot_ready": bot.is_ready() if bot else False,
    }


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


# SPA catch-all - serve React app for frontend routes (only in production, not dev mode)
if spa_path.exists() and not is_dev_mode():
    # Mount static assets from built SPA first (before catch-all)
    assets_path = spa_path / "assets"
    if assets_path.exists():
        app.mount("/assets", StaticFiles(directory=assets_path), name="assets")

    @app.get("/{full_path:path}")
    async def spa_catchall(full_path: str):
        """Serve React SPA for all frontend routes.

        API routes (/api/*, /auth/*) are excluded - they 404 if no match.
        Static files (favicon, images, etc.) are served directly.
        Everything else serves index.html and React Router handles it.
        """
        # Don't catch API routes - let them 404 properly
        if full_path.startswith("api/") or full_path.startswith("auth/"):
            raise HTTPException(status_code=404, detail="Not found")

        # Serve static files from dist if they exist (favicon, images, etc.)
        static_file = spa_path / full_path
        if static_file.exists() and static_file.is_file():
            return FileResponse(static_file)

        return FileResponse(spa_path / "index.html")


if __name__ == "__main__":
    import argparse
    import uvicorn

    parser = argparse.ArgumentParser(description="AI Safety Course Platform Server")
    parser.add_argument(
        "--no-bot",
        action="store_true",
        help="Disable Discord bot (useful for running multiple dev servers)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.getenv("API_PORT", "8000")),
        help="Port for API server (default: from API_PORT env or 8000)",
    )
    parser.add_argument(
        "--dev",
        action="store_true",
        help="Enable dev mode: spawns Vite dev server with HMR",
    )
    parser.add_argument(
        "--vite-port",
        type=int,
        default=int(os.getenv("VITE_PORT", "5173")),
        help="Port for Vite dev server (default: from VITE_PORT env or 5173)",
    )
    parser.add_argument(
        "--no-db",
        action="store_true",
        help="Skip database connection check (for frontend-only development)",
    )
    args = parser.parse_args()

    # Log when using default ports (helps Claude understand port configuration)
    api_port_from_env = os.getenv("API_PORT")
    vite_port_from_env = os.getenv("VITE_PORT")
    if not api_port_from_env or not vite_port_from_env:
        print("Note: Ports not fully configured in .env.local")
        if not api_port_from_env:
            print(f"  API_PORT not set, using default: {args.port}")
        if not vite_port_from_env:
            print(f"  VITE_PORT not set, using default: {args.vite_port}")

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
                "vite_port": args.vite_port if args.dev else None,
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
        os.environ["VITE_PORT"] = str(args.vite_port)
        os.environ["API_PORT"] = str(args.port)  # For Vite proxy
        print(f"Dev mode enabled - Vite will run on port {args.vite_port}")
        print(f"Access frontend at: http://localhost:{args.vite_port}")

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
