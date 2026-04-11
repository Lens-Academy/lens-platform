#!/usr/bin/env python3
"""Migrate existing module_sessions data to new progress tables.

Run with: python scripts/migrate_progress_data.py [--dry-run] [--archive]

Prerequisites:
- New tables must exist (run alembic upgrade head first)
- Content must have UUIDs in frontmatter
"""

import asyncio
import re
import sys
from datetime import date
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from core.database import get_engine
from core.content.cache import get_cache
from core.content.github_fetcher import initialize_cache
from sqlalchemy import text

# UUID validation pattern
UUID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE
)


async def build_module_uuid_lookup() -> dict[str, tuple[str, str]]:
    """Build mapping from module slug to (uuid, title)."""
    await initialize_cache()
    cache = get_cache()
    lookup = {}

    for slug, module in cache.flattened_modules.items():
        if module.content_id:
            uuid_str = str(module.content_id)
            # Validate UUID format to prevent SQL injection
            if not UUID_PATTERN.match(uuid_str):
                print(f"WARNING: Invalid UUID format for module '{slug}': {uuid_str}")
                continue
            lookup[slug] = (uuid_str, module.title)

    return lookup


def escape_sql_string(s: str) -> str:
    """Escape single quotes in SQL string literals."""
    return s.replace("'", "''")


async def check_source_table_exists(conn) -> bool:
    """Check if module_sessions table exists."""
    result = await conn.execute(
        text("""
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'module_sessions'
        )
    """)
    )
    return result.scalar()


async def get_unmapped_slugs(conn, lookup: dict) -> list[tuple[str, int]]:
    """Find module_slugs in database that aren't in our lookup."""
    result = await conn.execute(
        text("""
        SELECT module_slug, COUNT(*) as count
        FROM module_sessions
        GROUP BY module_slug
    """)
    )
    rows = result.fetchall()

    unmapped = []
    for slug, count in rows:
        if slug not in lookup:
            unmapped.append((slug, count))
    return unmapped


async def migrate_sessions(dry_run: bool = False):
    """Migrate module_sessions to chat_sessions.

    Args:
        dry_run: If True, only show what would be migrated without making changes.
    """
    print("Building module UUID lookup...")
    lookup = await build_module_uuid_lookup()
    print(f"Found {len(lookup)} modules with UUIDs")

    if not lookup:
        print(
            "ERROR: No modules with UUIDs found. Add UUIDs to content before migrating."
        )
        return False

    engine = get_engine()

    async with engine.begin() as conn:
        # Check source table exists
        if not await check_source_table_exists(conn):
            print("ERROR: module_sessions table not found. Already migrated/archived?")
            return False

        # Check for unmapped slugs
        unmapped = await get_unmapped_slugs(conn, lookup)
        if unmapped:
            print(
                f"\nWARNING: Found {len(unmapped)} module slugs without UUID mappings:"
            )
            for slug, count in unmapped:
                print(f"  - '{slug}' ({count} sessions)")
            print("\nThese sessions will be SKIPPED (not migrated).")
            if not dry_run:
                response = input("Continue anyway? [y/N] ")
                if response.lower() != "y":
                    print("Aborted.")
                    return False

        # Get migration statistics
        result = await conn.execute(text("SELECT COUNT(*) FROM module_sessions"))
        total = result.scalar()

        result = await conn.execute(
            text("SELECT COUNT(*) FROM module_sessions WHERE user_id IS NOT NULL")
        )
        authenticated_sessions = result.scalar()

        result = await conn.execute(
            text(
                "SELECT COUNT(*) FROM module_sessions WHERE completed_at IS NOT NULL AND user_id IS NOT NULL"
            )
        )
        completed_sessions = result.scalar()

        # Count how many have UUID mappings
        values_list = [f"('{escape_sql_string(slug)}')" for slug in lookup.keys()]
        values_clause_slugs = ",".join(values_list)
        result = await conn.execute(
            text(f"""
            SELECT COUNT(*) FROM module_sessions ms
            WHERE EXISTS (SELECT 1 FROM (VALUES {values_clause_slugs}) AS m(slug) WHERE m.slug = ms.module_slug)
        """)
        )
        sessions_with_mapping = result.scalar()

        print(f"\n{'[DRY RUN] ' if dry_run else ''}Migration summary:")
        print(f"  Total sessions in module_sessions: {total}")
        print(f"  Sessions with UUID mapping: {sessions_with_mapping}")
        print(
            f"  Sessions without mapping (will skip): {total - sessions_with_mapping}"
        )
        print(f"  Authenticated sessions: {authenticated_sessions}")
        print(f"  Anonymous sessions (will skip): {total - authenticated_sessions}")
        print(f"  Completed sessions (for progress): {completed_sessions}")

        if dry_run:
            print("\n[DRY RUN] No changes made.")
            return True

        # Build VALUES clause with proper escaping
        values_list = [
            f"('{escape_sql_string(slug)}', '{uuid}')"
            for slug, (uuid, _) in lookup.items()
        ]
        values_clause = ",".join(values_list)

        # Migrate to chat_sessions (only authenticated sessions with UUID mapping)
        # Use DISTINCT ON to pick one session per user+module (most recent by last_active_at)
        result = await conn.execute(
            text(f"""
            INSERT INTO chat_sessions (user_id, content_id, content_type, messages, started_at, last_active_at)
            SELECT DISTINCT ON (ms.user_id, m.uuid)
                ms.user_id,
                m.uuid::uuid,
                'module',
                ms.messages,
                ms.started_at,
                ms.last_active_at
            FROM module_sessions ms
            JOIN (VALUES {values_clause}) AS m(slug, uuid) ON m.slug = ms.module_slug
            WHERE ms.user_id IS NOT NULL
            AND NOT EXISTS (
                SELECT 1 FROM chat_sessions cs
                WHERE cs.user_id = ms.user_id
                AND cs.content_id = m.uuid::uuid
            )
            ORDER BY ms.user_id, m.uuid, ms.last_active_at DESC
        """)
        )
        chat_sessions_created = result.rowcount
        print(f"\nCreated {chat_sessions_created} chat_sessions records")

        # Build VALUES clause with titles (escaped)
        values_with_titles = [
            f"('{escape_sql_string(slug)}', '{uuid}', '{escape_sql_string(title)}')"
            for slug, (uuid, title) in lookup.items()
        ]
        values_clause_with_titles = ",".join(values_with_titles)

        # Migrate completed sessions to user_content_progress
        # Use DISTINCT ON to pick one completion per user+module (most recent)
        result = await conn.execute(
            text(f"""
            INSERT INTO user_content_progress (user_id, content_id, content_type, content_title, started_at, completed_at)
            SELECT DISTINCT ON (ms.user_id, m.uuid)
                ms.user_id,
                m.uuid::uuid,
                'module',
                m.title,
                ms.started_at,
                ms.completed_at
            FROM module_sessions ms
            JOIN (VALUES {values_clause_with_titles}) AS m(slug, uuid, title) ON m.slug = ms.module_slug
            WHERE ms.completed_at IS NOT NULL
            AND ms.user_id IS NOT NULL
            AND NOT EXISTS (
                SELECT 1 FROM user_content_progress ucp
                WHERE ucp.user_id = ms.user_id
                AND ucp.content_id = m.uuid::uuid
            )
            ORDER BY ms.user_id, m.uuid, ms.completed_at DESC
        """)
        )
        progress_records_created = result.rowcount
        print(f"Created {progress_records_created} user_content_progress records")

        print("\nMigration complete!")
        return True


async def rename_old_tables():
    """Rename old tables to _archived suffix."""
    engine = get_engine()
    archive_date = date.today().isoformat()

    async with engine.begin() as conn:
        await conn.execute(
            text(
                "ALTER TABLE IF EXISTS module_sessions RENAME TO module_sessions_archived"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE IF EXISTS content_events RENAME TO content_events_archived"
            )
        )
        await conn.execute(
            text(
                f"COMMENT ON TABLE module_sessions_archived IS 'Archived {archive_date}. Replaced by chat_sessions and user_content_progress.'"
            )
        )
        await conn.execute(
            text(
                f"COMMENT ON TABLE content_events_archived IS 'Archived {archive_date}. Replaced by time tracking in user_content_progress.'"
            )
        )

        print(f"Old tables renamed to *_archived (dated {archive_date})")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Migrate module_sessions data to new progress tables."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be migrated without making changes",
    )
    parser.add_argument(
        "--archive",
        action="store_true",
        help="Also rename old tables to _archived suffix",
    )
    args = parser.parse_args()

    success = asyncio.run(migrate_sessions(dry_run=args.dry_run))

    if success and args.archive and not args.dry_run:
        asyncio.run(rename_old_tables())
    elif args.archive and args.dry_run:
        print("[DRY RUN] Would rename module_sessions and content_events to *_archived")
