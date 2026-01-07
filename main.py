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

# Load .env.local first (if exists), then .env as fallback
# .env.local is gitignored and used for local dev overrides
load_dotenv(project_root / ".env.local")  # Local overrides (gitignored)
load_dotenv()  # Fallback to .env

# Parse --dev flag early so DEV_MODE is set before importing auth routes
# (auth.py computes DISCORD_REDIRECT_URI based on DEV_MODE at import time)
if __name__ == "__main__":
    import argparse
    _early_parser = argparse.ArgumentParser(add_help=False)
    _early_parser.add_argument("--dev", action="store_true")
    _early_parser.add_argument("--port", type=int, default=int(os.getenv("API_PORT", "8000")))
    _early_parser.add_argument("--vite-port", type=int, default=int(os.getenv("VITE_PORT", "5173")))
    _early_args, _ = _early_parser.parse_known_args()
    if _early_args.dev:
        os.environ["DEV_MODE"] = "true"
        os.environ["API_PORT"] = str(_early_args.port)
        os.environ["VITE_PORT"] = str(_early_args.vite_port)
    else:
        # Production single-service mode: frontend served from same port as API
        os.environ["API_PORT"] = str(_early_args.port)

from fastapi import FastAPI

from core.database import close_engine, check_connection
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

    # Check database connection
    db_ok, db_msg = await check_connection()
    if db_ok:
        print(f"✓ Database: {db_msg}")
    else:
        print(f"✗ Database: {db_msg}")
        print("  └─ API will fail on database operations until this is fixed")

    # Start peer services as background tasks
    print("Starting Discord bot...")
    _bot_task = asyncio.create_task(start_bot())

    # Start Vite dev server if in dev mode
    await start_vite_dev()

    yield  # FastAPI runs here, bot runs alongside it

    # Graceful shutdown of all peer services
    print("Shutting down peer services...")
    await stop_vite_dev()
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

# CORS configuration
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        FRONTEND_URL,
        "http://localhost:5173",
        "http://localhost:8000",
        "http://localhost:8001",
        "http://localhost:8002",
        "http://localhost:8003",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:8000",
        "http://127.0.0.1:8001",
        "http://127.0.0.1:8002",
        "http://127.0.0.1:8003",
    ],
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


# New paths for static files
static_path = project_root / "web_frontend" / "static"  # Truly static HTML (landing page)
spa_path = project_root / "web_frontend" / "dist"  # React SPA build


@app.get("/")
async def root():
    """Serve landing page if it exists, otherwise return API status."""
    dev_mode = os.getenv("DEV_MODE", "").lower() in ("true", "1", "yes")
    if dev_mode:
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


# SPA routes - serve React app for frontend routes (only in production, not dev mode)
dev_mode = os.getenv("DEV_MODE", "").lower() in ("true", "1", "yes")
if spa_path.exists() and not dev_mode:

    @app.get("/signup")
    @app.get("/auth/code")
    @app.get("/prototype/interactive-lesson")
    async def spa():
        """Serve React SPA for frontend routes."""
        return FileResponse(spa_path / "index.html")

    @app.get("/lesson/{lesson_id}")
    async def spa_lesson(lesson_id: str):
        """Serve React SPA for lesson page."""
        return FileResponse(spa_path / "index.html")

    # Mount static assets from built SPA
    assets_path = spa_path / "assets"
    if assets_path.exists():
        app.mount("/assets", StaticFiles(directory=assets_path), name="assets")


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
    server_info_file.write_text(json.dumps({
        "pid": os.getpid(),
        "workspace": workspace_name,
        "api_port": args.port,
        "vite_port": args.vite_port if args.dev else None,
    }))

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

    # Run with uvicorn
    # Pass app object directly (not string) to avoid module reimport issues
    # Note: --reload requires string import; use `uvicorn main:app --reload` if needed
    print(f"Starting server on port {args.port} (PORT env: {os.environ.get('PORT', 'not set')})")
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=args.port,
    )
