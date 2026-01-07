"""
SQLAlchemy async database client for the AI Safety Course Platform.

Provides async connection management using SQLAlchemy Core with asyncpg.
"""

import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, create_async_engine

from .tables import metadata  # noqa: F401 - exported for Alembic

# Module-level engine (created on first use)
_engine: AsyncEngine | None = None


def _get_database_url() -> str:
    """
    Construct async database URL from environment variables.

    Supabase connection string format:
        postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres

    For asyncpg, we need:
        postgresql+asyncpg://...
    """
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise ValueError(
            "DATABASE_URL environment variable must be set. "
            "Get your connection string from Supabase Dashboard > Settings > Database > Connection string"
        )

    # Convert postgresql:// to postgresql+asyncpg://
    if database_url.startswith("postgresql://"):
        return database_url.replace("postgresql://", "postgresql+asyncpg://", 1)

    return database_url


def get_engine() -> AsyncEngine:
    """Get or create the async SQLAlchemy engine singleton."""
    global _engine
    if _engine is None:
        database_url = _get_database_url()
        _engine = create_async_engine(
            database_url,
            echo=os.environ.get("SQL_ECHO", "").lower() == "true",
            # Connection pool settings
            pool_size=5,
            max_overflow=10,
            pool_timeout=30,
            pool_recycle=1800,  # Recycle connections every 30 minutes
            # Disable prepared statement cache for Supabase pooler compatibility
            # (pgbouncer in transaction mode doesn't support prepared statements)
            connect_args={"statement_cache_size": 0},
        )
    return _engine


@asynccontextmanager
async def get_connection() -> AsyncGenerator[AsyncConnection, None]:
    """
    Get an async database connection from the pool.

    Usage:
        async with get_connection() as conn:
            result = await conn.execute(select(users))
            row = result.mappings().first()
    """
    engine = get_engine()
    async with engine.connect() as conn:
        yield conn


@asynccontextmanager
async def get_transaction() -> AsyncGenerator[AsyncConnection, None]:
    """
    Get an async database connection with automatic transaction management.
    Commits on success, rolls back on exception.

    Usage:
        async with get_transaction() as conn:
            await conn.execute(insert(users).values(...))
            # Auto-commits if no exception
    """
    engine = get_engine()
    async with engine.begin() as conn:
        yield conn


async def close_engine() -> None:
    """Close the engine and all connections. Call on shutdown."""
    global _engine
    if _engine is not None:
        await _engine.dispose()
        _engine = None


def is_configured() -> bool:
    """Check if database credentials are configured."""
    return bool(os.environ.get("DATABASE_URL"))


async def check_connection() -> tuple[bool, str]:
    """
    Test database connectivity. Returns (success, message).

    Call this at startup to warn developers if the database is unreachable.
    """
    if not is_configured():
        return False, "DATABASE_URL not set"

    try:
        from sqlalchemy import text
        async with get_connection() as conn:
            await conn.execute(text("SELECT 1"))
        return True, "Connected"
    except Exception as e:
        error_msg = str(e)
        # Simplify common error messages
        if "Connection refused" in error_msg:
            return False, "Connection refused - is the database running?"
        if "timeout" in error_msg.lower():
            return False, "Connection timeout - check database host/port"
        if "authentication" in error_msg.lower() or "password" in error_msg.lower():
            return False, "Authentication failed - check credentials"
        return False, f"Connection failed: {error_msg[:100]}"


def get_sync_database_url() -> str:
    """
    Get synchronous database URL for Alembic migrations.

    Alembic runs migrations synchronously, so we need a psycopg2 URL.
    """
    database_url = os.environ.get("DATABASE_URL", "")

    # Use psycopg2 driver for sync operations
    if "postgresql+asyncpg://" in database_url:
        return database_url.replace("postgresql+asyncpg://", "postgresql://")
    if database_url.startswith("postgresql://"):
        return database_url

    raise ValueError("DATABASE_URL must be set for migrations")
