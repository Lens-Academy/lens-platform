"""Load/save per-user Markdown files from coach_user_files table."""

from sqlalchemy import select, func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from core.database import get_connection, get_transaction
from core.tables import coach_user_files

VALID_FILENAMES = {"agent_style.md", "user.md", "memory.md"}


async def load_user_files(user_id: int) -> dict[str, str]:
    """Load all per-user files, creating empty ones if they don't exist.

    Returns dict mapping filename to content string.
    Always returns exactly three keys: agent_style.md, user.md, memory.md.
    """
    async with get_connection() as conn:
        result = await conn.execute(
            select(coach_user_files.c.filename, coach_user_files.c.content).where(
                coach_user_files.c.user_id == user_id
            )
        )
        existing = {row.filename: row.content for row in result}

    missing = VALID_FILENAMES - existing.keys()
    if missing:
        async with get_transaction() as conn:
            for filename in missing:
                await conn.execute(
                    pg_insert(coach_user_files)
                    .values(user_id=user_id, filename=filename, content="")
                    .on_conflict_do_nothing()
                )
        # Re-read to get consistent state
        async with get_connection() as conn:
            result = await conn.execute(
                select(coach_user_files.c.filename, coach_user_files.c.content).where(
                    coach_user_files.c.user_id == user_id
                )
            )
            existing = {row.filename: row.content for row in result}

    return {fn: existing.get(fn, "") for fn in VALID_FILENAMES}


async def save_user_file(user_id: int, filename: str, content: str) -> None:
    """Save content to a per-user file. Raises ValueError for unknown filenames."""
    if filename not in VALID_FILENAMES:
        raise ValueError(
            f"Unknown file: {filename}. Valid files: {', '.join(sorted(VALID_FILENAMES))}"
        )

    async with get_transaction() as conn:
        await conn.execute(
            pg_insert(coach_user_files)
            .values(user_id=user_id, filename=filename, content=content)
            .on_conflict_do_update(
                index_elements=["user_id", "filename"],
                set_={"content": content, "updated_at": func.now()},
            )
        )
