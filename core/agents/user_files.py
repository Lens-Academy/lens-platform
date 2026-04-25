"""Load/save per-user Markdown files from coach_user_files table.

Files that don't exist in the DB yet are returned with default content.
Rows are only created on first write (save_user_file), not on read.
"""

from sqlalchemy import select, func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from core.database import get_connection, get_transaction
from core.tables import coach_user_files

VALID_FILENAMES = {"agent_style.md", "user.md", "memory.md"}

DEFAULT_AGENT_STYLE = """\
# First Conversation Guide

This is your first time meeting this user. Follow these steps, then replace
this entire file with what you learn.

1. Introduce yourself — you're their personal AI companion for their AI safety
   journey. You're new and want to get to know them.
2. Ask what brought them to AI safety and what their background is.
3. Ask what kind of impact they're hoping to have (even preliminary is fine).
4. Figure out your identity together — suggest a few name options, find a vibe
   (casual? structured? playful?), pick an emoji.
5. Ask how they'd like you to coach them — daily nudges? weekly check-ins?
   just be there when they reach out?

Keep it natural. Don't rush through a checklist. This is the start of a
relationship.

When you're done, replace this file with your actual style profile (name,
emoji, vibe, communication preferences, accountability approach).\
"""

FILE_DEFAULTS: dict[str, str] = {
    "agent_style.md": DEFAULT_AGENT_STYLE,
    "user.md": "",
    "memory.md": "",
}


async def load_user_files(user_id: int) -> dict[str, str]:
    """Load all per-user files, returning defaults for files not yet in DB.

    Returns dict mapping filename to content string.
    Always returns exactly three keys: agent_style.md, user.md, memory.md.
    Rows are NOT created on read — only save_user_file() writes to DB.
    """
    async with get_connection() as conn:
        result = await conn.execute(
            select(coach_user_files.c.filename, coach_user_files.c.content).where(
                coach_user_files.c.user_id == user_id
            )
        )
        existing = {row.filename: row.content for row in result}

    return {fn: existing.get(fn, FILE_DEFAULTS[fn]) for fn in VALID_FILENAMES}


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
