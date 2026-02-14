"""Assessment API routes.

Endpoints:
- POST /api/assessments/responses - Submit a student answer
- GET /api/assessments/responses - Get responses for current user
- GET /api/assessments/responses/{question_id} - Get responses for a specific question
"""

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.assessments import (
    get_responses,
    get_responses_for_question,
    submit_response,
    update_response,
)
from core.database import get_connection, get_transaction
from web_api.auth import get_user_or_anonymous

router = APIRouter(prefix="/api/assessments", tags=["assessments"])


# --- Request/Response Models ---


class SubmitResponseRequest(BaseModel):
    question_id: str
    module_slug: str
    learning_outcome_id: str | None = None
    content_id: UUID | None = None
    answer_text: str
    answer_metadata: dict = {}


class SubmitResponseResponse(BaseModel):
    response_id: int
    created_at: str  # ISO format


class UpdateResponseRequest(BaseModel):
    answer_text: str | None = None
    answer_metadata: dict | None = None
    completed_at: str | None = None  # ISO format or empty string to clear


class ResponseItem(BaseModel):
    response_id: int
    question_id: str
    module_slug: str
    learning_outcome_id: str | None
    answer_text: str
    answer_metadata: dict
    created_at: str  # ISO format
    completed_at: str | None  # ISO format or None if in progress


class ResponseListResponse(BaseModel):
    responses: list[ResponseItem]


# --- Endpoints ---


@router.post("/responses", response_model=SubmitResponseResponse, status_code=201)
async def submit_assessment_response(
    body: SubmitResponseRequest,
    auth: tuple = Depends(get_user_or_anonymous),
):
    """Submit an assessment response (student answer).

    Accepts either authenticated user (via session cookie) or anonymous user
    (via X-Anonymous-Token header). Each submission creates a separate record
    (multiple attempts per question are supported).
    """
    user_id, anonymous_token = auth

    # Validate answer_text is non-empty
    if not body.answer_text.strip():
        raise HTTPException(400, "answer_text must be non-empty")

    async with get_transaction() as conn:
        row = await submit_response(
            conn,
            user_id=user_id,
            anonymous_token=anonymous_token,
            question_id=body.question_id,
            module_slug=body.module_slug,
            learning_outcome_id=body.learning_outcome_id,
            content_id=body.content_id,
            answer_text=body.answer_text.strip(),
            answer_metadata=body.answer_metadata,
        )

    created_at = row["created_at"]
    if isinstance(created_at, datetime):
        created_at = created_at.isoformat()

    return SubmitResponseResponse(
        response_id=row["response_id"],
        created_at=created_at,
    )


def _format_response_items(rows: list[dict]) -> list[ResponseItem]:
    """Convert database rows to ResponseItem models."""
    items = []
    for row in rows:
        created_at = row["created_at"]
        if isinstance(created_at, datetime):
            created_at = created_at.isoformat()
        completed_at = row.get("completed_at")
        if isinstance(completed_at, datetime):
            completed_at = completed_at.isoformat()
        items.append(
            ResponseItem(
                response_id=row["response_id"],
                question_id=row["question_id"],
                module_slug=row["module_slug"],
                learning_outcome_id=row.get("learning_outcome_id"),
                answer_text=row["answer_text"],
                answer_metadata=row.get("answer_metadata", {}),
                created_at=created_at,
                completed_at=completed_at,
            )
        )
    return items


@router.get("/responses", response_model=ResponseListResponse)
async def list_assessment_responses(
    module_slug: str | None = None,
    question_id: str | None = None,
    auth: tuple = Depends(get_user_or_anonymous),
):
    """Get assessment responses for the current user.

    Optionally filter by module_slug and/or question_id.
    """
    user_id, anonymous_token = auth

    async with get_connection() as conn:
        rows = await get_responses(
            conn,
            user_id=user_id,
            anonymous_token=anonymous_token,
            module_slug=module_slug,
            question_id=question_id,
        )

    return ResponseListResponse(responses=_format_response_items(rows))


@router.patch("/responses/{response_id}", response_model=SubmitResponseResponse)
async def update_assessment_response(
    response_id: int,
    body: UpdateResponseRequest,
    auth: tuple = Depends(get_user_or_anonymous),
):
    """Update an existing assessment response (partial update).

    Supports updating answer_text, answer_metadata, and/or completed_at.
    Performs ownership check — only the creator can update their response.
    """
    user_id, anonymous_token = auth

    async with get_transaction() as conn:
        row = await update_response(
            conn,
            response_id=response_id,
            user_id=user_id,
            anonymous_token=anonymous_token,
            answer_text=body.answer_text,
            answer_metadata=body.answer_metadata,
            completed_at=body.completed_at,
        )

    if not row:
        raise HTTPException(404, "Response not found")

    created_at = row["created_at"]
    if isinstance(created_at, datetime):
        created_at = created_at.isoformat()

    return SubmitResponseResponse(
        response_id=row["response_id"],
        created_at=created_at,
    )


@router.get("/responses/{question_id}", response_model=ResponseListResponse)
async def get_question_responses(
    question_id: str,
    auth: tuple = Depends(get_user_or_anonymous),
):
    """Get assessment responses for a specific question by the current user."""
    user_id, anonymous_token = auth

    async with get_connection() as conn:
        rows = await get_responses_for_question(
            conn,
            user_id=user_id,
            anonymous_token=anonymous_token,
            question_id=question_id,
        )

    return ResponseListResponse(responses=_format_response_items(rows))
