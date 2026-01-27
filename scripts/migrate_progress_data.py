#!/usr/bin/env python3
"""Migrate existing module_sessions data to new progress tables.

Run with: python scripts/migrate_progress_data.py

Prerequisites:
- New tables must exist (run alembic upgrade head first)
- Content must have UUIDs in frontmatter
"""

import asyncio
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from core.db import get_engine
from core.content.cache import get_cache
from sqlalchemy import text


async def build_module_uuid_lookup() -> dict[str, tuple[str, str]]:
    """Build mapping from module slug to (uuid, title)."""
    cache = await get_cache()
    lookup = {}

    for slug, module in cache.modules.items():
        if module.content_id:
            lookup[slug] = (str(module.content_id), module.title)

    return lookup


def escape_sql_string(s: str) -> str:
    """Escape single quotes in SQL string literals."""
    return s.replace("'", "''")


async def migrate_sessions():
    """Migrate module_sessions to chat_sessions."""
    print("Building module UUID lookup...")
    lookup = await build_module_uuid_lookup()
    print(f"Found {len(lookup)} modules with UUIDs")

    if not lookup:
        print("No modules with UUIDs found. Add UUIDs to content before migrating.")
        return

    engine = get_engine()

    async with engine.begin() as conn:
        # Count existing sessions
        result = await conn.execute(text("SELECT COUNT(*) FROM module_sessions"))
        total = result.scalar()
        print(f"Migrating {total} sessions...")

        # Build VALUES clause with proper escaping
        values_list = [
            f"('{escape_sql_string(slug)}', '{uuid}')"
            for slug, (uuid, _) in lookup.items()
        ]
        values_clause = ",".join(values_list)

        # Migrate to chat_sessions
        # Anonymous sessions get random tokens (unclaimable - acceptable loss)
        await conn.execute(text(f"""
            INSERT INTO chat_sessions (session_token, user_id, content_id, content_type, messages, started_at, last_active_at)
            SELECT
                CASE WHEN ms.user_id IS NULL THEN gen_random_uuid() ELSE NULL END,
                ms.user_id,
                CASE WHEN m.uuid IS NOT NULL THEN m.uuid::uuid ELSE NULL END,
                'module',
                ms.messages,
                ms.started_at,
                ms.last_active_at
            FROM module_sessions ms
            LEFT JOIN (VALUES {values_clause}) AS m(slug, uuid) ON m.slug = ms.module_slug
            WHERE NOT EXISTS (
                SELECT 1 FROM chat_sessions cs
                WHERE cs.user_id = ms.user_id
                AND cs.content_id = m.uuid::uuid
            )
        """))

        # Build VALUES clause with titles (escaped)
        values_with_titles = [
            f"('{escape_sql_string(slug)}', '{uuid}', '{escape_sql_string(title)}')"
            for slug, (uuid, title) in lookup.items()
        ]
        values_clause_with_titles = ",".join(values_with_titles)

        # Migrate completed sessions to user_content_progress
        await conn.execute(text(f"""
            INSERT INTO user_content_progress (user_id, content_id, content_type, content_title, started_at, completed_at)
            SELECT
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
        """))

        print("Migration complete!")


async def rename_old_tables():
    """Rename old tables to _archived suffix."""
    engine = get_engine()

    async with engine.begin() as conn:
        await conn.execute(text("""
            ALTER TABLE IF EXISTS module_sessions RENAME TO module_sessions_archived;
            ALTER TABLE IF EXISTS content_events RENAME TO content_events_archived;

            COMMENT ON TABLE module_sessions_archived IS 'Archived 2026-01-XX. Replaced by chat_sessions and user_content_progress.';
            COMMENT ON TABLE content_events_archived IS 'Archived 2026-01-XX. Replaced by time tracking in user_content_progress.';
        """))

        print("Old tables renamed to *_archived")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", action="store_true", help="Also rename old tables to _archived")
    args = parser.parse_args()

    asyncio.run(migrate_sessions())

    if args.archive:
        asyncio.run(rename_old_tables())
