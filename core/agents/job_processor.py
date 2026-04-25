"""Coach scheduled job processor.

Scans coach_scheduled_jobs for due jobs and fires full coach turns.
Called periodically by APScheduler (every 15 minutes).
"""

import logging
from datetime import datetime, timezone

from litellm import acompletion
from sqlalchemy import select, update, func

from core.database import get_connection, get_transaction
from core.tables import coach_scheduled_jobs, users
from core.agents.user_files import load_user_files
from core.agents.coach.persona import COACH_SYSTEM_PROMPT
from core.agents.tools import COACH_TOOL_SCHEMAS
from core.agents.tools.transfer import build_all_transfer_tools
from core.discord_outbound.messages import send_dm
from core.modules.llm import DEFAULT_PROVIDER

logger = logging.getLogger(__name__)

BATCH_SIZE = 50
JOB_TRIGGER_PROMPT = (
    "A scheduled job has fired. Reason: {reason}. "
    "Decide whether to message the user and what to say. "
    "You have access to your usual tools (progress, deadlines, memory). "
    "If you decide not to message, respond with exactly '[NO_MESSAGE]'."
)


async def process_due_coach_jobs() -> None:
    """Scan for due jobs and fire them. Called by APScheduler every 15 min."""
    now = datetime.now(timezone.utc)

    async with get_connection() as conn:
        result = await conn.execute(
            select(coach_scheduled_jobs)
            .where(
                coach_scheduled_jobs.c.status == "pending",
                coach_scheduled_jobs.c.fire_at <= now,
            )
            .order_by(coach_scheduled_jobs.c.fire_at)
            .limit(BATCH_SIZE)
        )
        jobs = [dict(row) for row in result.mappings()]

    if not jobs:
        return

    logger.info("processing_coach_jobs", extra={"count": len(jobs)})

    for job in jobs:
        try:
            await _fire_coach_job(job)
        except Exception:
            logger.exception("coach_job_failed", extra={"job_id": str(job["job_id"])})
            await _update_job_status(job["job_id"], "failed")


async def _fire_coach_job(job: dict) -> None:
    """Fire a single coach job: run LLM, optionally send DM."""
    user_id = job["user_id"]
    reason = job["reason"]

    async with get_connection() as conn:
        result = await conn.execute(
            select(users.c.discord_id).where(users.c.user_id == user_id)
        )
        row = result.first()

    if not row or not row.discord_id:
        logger.warning("coach_job_no_discord", extra={"user_id": user_id})
        await _update_job_status(job["job_id"], "failed")
        return

    discord_id = row.discord_id

    user_files = await load_user_files(user_id)
    system_parts = [COACH_SYSTEM_PROMPT]
    system_parts.append(
        "\nYou have a personal workspace for this user with three files that persist "
        "across sessions. Use them to remember things and adapt your behavior."
    )
    for filename in ("agent_style.md", "user.md", "memory.md"):
        content = user_files.get(filename, "")
        display = content if content else "(empty)"
        label = {
            "agent_style.md": "agent_style.md (your style adjustments for this user)",
            "user.md": "user.md (what you know about this user)",
            "memory.md": "memory.md (your running notes about this user)",
        }[filename]
        system_parts.append(f"\n## {label}\n{display}")

    system_prompt = "\n".join(system_parts)

    trigger_content = JOB_TRIGGER_PROMPT.format(reason=reason)
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": trigger_content},
    ]

    tools = list(COACH_TOOL_SCHEMAS) + build_all_transfer_tools()

    try:
        response = await acompletion(
            model=DEFAULT_PROVIDER,
            messages=messages,
            tools=tools if tools else None,
            max_tokens=2048,
        )
    except Exception:
        logger.exception("coach_job_llm_failed", extra={"job_id": str(job["job_id"])})
        await _update_job_status(job["job_id"], "failed")
        return

    reply = response.choices[0].message.content

    if not reply or "[NO_MESSAGE]" in reply:
        await _update_job_status(job["job_id"], "skipped")
        return

    msg_id = await send_dm(discord_id, reply)
    if msg_id:
        await _update_job_status(job["job_id"], "sent")
    else:
        logger.warning("coach_job_dm_failed", extra={"job_id": str(job["job_id"]), "user_id": user_id})
        await _update_job_status(job["job_id"], "failed")


async def _update_job_status(job_id, status: str) -> None:
    async with get_transaction() as conn:
        await conn.execute(
            update(coach_scheduled_jobs)
            .where(coach_scheduled_jobs.c.job_id == job_id)
            .values(status=status, resolved_at=func.now())
        )
