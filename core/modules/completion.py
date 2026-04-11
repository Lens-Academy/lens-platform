"""Completion propagation for multi-level progress tracking.

When a lens is completed, checks if the parent LO and module should
also be marked complete (all current required lenses done).
"""

from uuid import UUID
from datetime import datetime, timezone

from sqlalchemy import select, update, and_
from sqlalchemy.ext.asyncio import AsyncConnection

from core.tables import user_content_progress
from core.modules.progress import get_or_create_progress


async def propagate_completion(
    conn: AsyncConnection,
    *,
    user_id: int | None,
    anonymous_token: UUID | None,
    module_sections: list[dict],
    module_content_id: UUID,
    completed_lens_id: UUID,
) -> None:
    """After a lens is completed, check and auto-complete parent LO and module.

    Args:
        conn: Database connection (within a transaction)
        user_id: Authenticated user ID (or None)
        anonymous_token: Anonymous token (or None)
        module_sections: The flattened module sections list
        module_content_id: The module's content UUID
        completed_lens_id: The lens that was just completed
    """
    # Find the completed lens's section
    completed_section = None
    for section in module_sections:
        cid = section.get("contentId")
        if cid and UUID(cid) == completed_lens_id:
            completed_section = section
            break

    if not completed_section:
        return

    lo_id_str = completed_section.get("learningOutcomeId")

    # Collect all required lens IDs, and those sharing the same LO
    required_lens_ids = []
    lo_lens_ids = []
    for section in module_sections:
        cid = section.get("contentId")
        if not cid or section.get("optional", False):
            continue
        required_lens_ids.append(UUID(cid))
        if lo_id_str and section.get("learningOutcomeId") == lo_id_str:
            lo_lens_ids.append(UUID(cid))

    # Query completion status for all required lenses
    all_ids = list(set(required_lens_ids))
    if user_id is not None:
        where = and_(
            user_content_progress.c.user_id == user_id,
            user_content_progress.c.content_id.in_(all_ids),
        )
    elif anonymous_token is not None:
        where = and_(
            user_content_progress.c.anonymous_token == anonymous_token,
            user_content_progress.c.content_id.in_(all_ids),
        )
    else:
        return

    result = await conn.execute(select(user_content_progress).where(where))
    progress_map = {row.content_id: dict(row._mapping) for row in result.fetchall()}

    now = datetime.now(timezone.utc)

    # Check LO completion
    if lo_id_str and lo_lens_ids:
        lo_all_complete = all(
            progress_map.get(lid, {}).get("completed_at") is not None
            for lid in lo_lens_ids
        )
        if lo_all_complete:
            await _mark_complete_if_not_already(
                conn,
                user_id=user_id,
                anonymous_token=anonymous_token,
                content_id=UUID(lo_id_str),
                content_type="lo",
                now=now,
            )

    # Check module completion
    module_all_complete = all(
        progress_map.get(lid, {}).get("completed_at") is not None
        for lid in required_lens_ids
    )
    if module_all_complete and module_content_id:
        await _mark_complete_if_not_already(
            conn,
            user_id=user_id,
            anonymous_token=anonymous_token,
            content_id=module_content_id,
            content_type="module",
            now=now,
        )


async def _mark_complete_if_not_already(
    conn: AsyncConnection,
    *,
    user_id: int | None,
    anonymous_token: UUID | None,
    content_id: UUID,
    content_type: str,
    now: datetime,
) -> None:
    """Mark content complete only if not already completed. Idempotent."""
    progress = await get_or_create_progress(
        conn,
        user_id=user_id,
        anonymous_token=anonymous_token,
        content_id=content_id,
        content_type=content_type,
        content_title="",
    )

    if progress.get("completed_at"):
        return  # Already complete, preserve historical record

    await conn.execute(
        update(user_content_progress)
        .where(user_content_progress.c.id == progress["id"])
        .values(
            completed_at=now,
            time_to_complete_s=progress["total_time_spent_s"],
        )
    )
