"""Assessment response and score management.

Handles creating, querying, and claiming assessment responses.
Supports both authenticated users (user_id) and anonymous users (anonymous_token).
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncConnection

from .tables import assessment_responses, assessment_scores


async def submit_response(
    conn: AsyncConnection,
    *,
    user_id: int | None = None,
    anonymous_token: UUID | None = None,
    question_id: str,
    module_slug: str,
    learning_outcome_id: str | None = None,
    content_id: UUID | None = None,
    answer_text: str,
    answer_metadata: dict | None = None,
) -> dict:
    """Submit an assessment response.

    Creates a new record in assessment_responses. Each submission creates a
    separate record (multiple attempts per question are supported).

    Exactly one of user_id or anonymous_token must be provided.

    Returns the created row as a dict.
    """
    if user_id is None and anonymous_token is None:
        raise ValueError("Either user_id or anonymous_token must be provided")
    if user_id is not None and anonymous_token is not None:
        raise ValueError("Only one of user_id or anonymous_token should be provided")

    values = {
        "user_id": user_id,
        "anonymous_token": anonymous_token,
        "question_id": question_id,
        "module_slug": module_slug,
        "learning_outcome_id": learning_outcome_id,
        "content_id": content_id,
        "answer_text": answer_text,
        "answer_metadata": answer_metadata if answer_metadata is not None else {},
    }

    stmt = (
        pg_insert(assessment_responses).values(**values).returning(assessment_responses)
    )

    result = await conn.execute(stmt)
    row = result.fetchone()
    return dict(row._mapping)


async def update_response(
    conn: AsyncConnection,
    *,
    response_id: int,
    user_id: int | None = None,
    anonymous_token: UUID | None = None,
    answer_text: str | None = None,
    answer_metadata: dict | None = None,
    completed_at: str | None = None,
) -> dict | None:
    """Update an existing assessment response (partial update).

    Only updates fields that are explicitly provided (non-None).
    Performs ownership check: the response must belong to the given user_id
    or anonymous_token.

    For completed_at: pass an ISO format string to set, or empty string to clear.

    Returns the updated row as a dict, or None if no matching row found.
    """
    # Build SET clause with only provided fields
    values: dict = {}
    if answer_text is not None:
        values["answer_text"] = answer_text
    if answer_metadata is not None:
        values["answer_metadata"] = answer_metadata
    if completed_at is not None:
        if completed_at == "" or completed_at.lower() == "null":
            values["completed_at"] = None
        else:
            values["completed_at"] = datetime.fromisoformat(completed_at)

    if not values:
        # Nothing to update — just return the existing row
        stmt = select(assessment_responses).where(
            assessment_responses.c.response_id == response_id
        )
        result = await conn.execute(stmt)
        row = result.fetchone()
        return dict(row._mapping) if row else None

    # Ownership check: must match user_id OR anonymous_token
    ownership_conditions = []
    if user_id is not None:
        ownership_conditions.append(assessment_responses.c.user_id == user_id)
    if anonymous_token is not None:
        ownership_conditions.append(
            assessment_responses.c.anonymous_token == anonymous_token
        )
    if not ownership_conditions:
        raise ValueError("Either user_id or anonymous_token must be provided")

    stmt = (
        update(assessment_responses)
        .where(
            and_(
                assessment_responses.c.response_id == response_id,
                or_(*ownership_conditions),
            )
        )
        .values(**values)
        .returning(assessment_responses)
    )

    result = await conn.execute(stmt)
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def get_responses(
    conn: AsyncConnection,
    *,
    user_id: int | None = None,
    anonymous_token: UUID | None = None,
    module_slug: str | None = None,
    question_id: str | None = None,
) -> list[dict]:
    """Query assessment responses with optional filters.

    Must filter by user_id OR anonymous_token (at least one required).
    Optional additional filters: module_slug, question_id.

    Returns list of row dicts, ordered by created_at DESC.
    """
    if user_id is None and anonymous_token is None:
        raise ValueError("Either user_id or anonymous_token must be provided")

    # Build WHERE clauses
    conditions = []
    if user_id is not None:
        conditions.append(assessment_responses.c.user_id == user_id)
    else:
        conditions.append(assessment_responses.c.anonymous_token == anonymous_token)

    if module_slug is not None:
        conditions.append(assessment_responses.c.module_slug == module_slug)
    if question_id is not None:
        conditions.append(assessment_responses.c.question_id == question_id)

    stmt = (
        select(assessment_responses)
        .where(and_(*conditions))
        .order_by(assessment_responses.c.created_at.desc())
    )

    result = await conn.execute(stmt)
    return [dict(row._mapping) for row in result.fetchall()]


async def get_responses_for_question(
    conn: AsyncConnection,
    *,
    user_id: int | None = None,
    anonymous_token: UUID | None = None,
    question_id: str,
) -> list[dict]:
    """Get all responses for a specific question by the current user.

    Convenience wrapper around get_responses with question_id filter.
    """
    return await get_responses(
        conn,
        user_id=user_id,
        anonymous_token=anonymous_token,
        question_id=question_id,
    )


async def claim_assessment_responses(
    conn: AsyncConnection,
    *,
    anonymous_token: UUID,
    user_id: int,
) -> int:
    """Claim anonymous assessment responses for an authenticated user.

    Updates assessment_responses SET user_id=X, anonymous_token=NULL
    WHERE anonymous_token=Y. Skips records where the user already has a
    response for that question_id to avoid issues with duplicate data.

    Follows the same pattern as claim_progress_records in core/modules/progress.py.

    Returns count of records claimed.
    """
    # Subquery to find question_ids where the user already has responses
    existing_question_ids = (
        select(assessment_responses.c.question_id)
        .where(assessment_responses.c.user_id == user_id)
        .scalar_subquery()
    )

    # Only claim anonymous records for questions the user doesn't already have
    result = await conn.execute(
        update(assessment_responses)
        .where(
            and_(
                assessment_responses.c.anonymous_token == anonymous_token,
                ~assessment_responses.c.question_id.in_(existing_question_ids),
            )
        )
        .values(user_id=user_id, anonymous_token=None)
    )
    return result.rowcount


async def get_scores_for_response(
    conn: AsyncConnection,
    *,
    response_id: int,
    user_id: int | None = None,
    anonymous_token: UUID | None = None,
) -> list[dict]:
    """Get assessment scores for a specific response, with ownership check.

    Joins assessment_scores to assessment_responses to verify the caller
    owns the response. Returns list of score dicts, ordered by created_at DESC.

    Returns empty list if response has no scores (scoring may be in progress)
    or if the response doesn't exist / doesn't belong to the caller.
    """
    if user_id is None and anonymous_token is None:
        raise ValueError("Either user_id or anonymous_token must be provided")

    ownership = []
    if user_id is not None:
        ownership.append(assessment_responses.c.user_id == user_id)
    else:
        ownership.append(assessment_responses.c.anonymous_token == anonymous_token)

    stmt = (
        select(assessment_scores)
        .join(
            assessment_responses,
            assessment_scores.c.response_id == assessment_responses.c.response_id,
        )
        .where(
            and_(
                assessment_scores.c.response_id == response_id,
                or_(*ownership),
            )
        )
        .order_by(assessment_scores.c.created_at.desc())
    )

    result = await conn.execute(stmt)
    return [dict(row._mapping) for row in result.fetchall()]
