# Phase 10: Score Retrieval API - Research

**Researched:** 2026-02-20
**Domain:** FastAPI endpoint + SQLAlchemy query for assessment_scores table
**Confidence:** HIGH

## Summary

Phase 10 is a straightforward CRUD completion: the assessment_scores table already exists (created in Phase 9), scores are written by the background scoring pipeline (`core/scoring.py`), but there is no read path. This phase adds a GET endpoint to retrieve scores for a given response_id, following the exact same patterns already established in the assessments route file.

The existing codebase provides extremely clear patterns to follow. The assessments router (`web_api/routes/assessments.py`) already has GET endpoints, Pydantic response models, and the `get_user_or_anonymous` auth dependency. The core layer (`core/assessments.py`) already has query functions following the SQLAlchemy Core + asyncpg pattern. The test file (`web_api/tests/test_assessments_scoring.py`) shows the mocking patterns. This phase requires adding: (1) a query function in `core/assessments.py` to join `assessment_scores` with `assessment_responses` for ownership checking, (2) Pydantic response models, and (3) a GET endpoint in the existing assessments router.

**Primary recommendation:** Add a `get_scores_for_response` function to `core/assessments.py` that joins `assessment_scores` to `assessment_responses` (for ownership check), then add `GET /api/assessments/scores?response_id={id}` to the existing assessments router. Follow the identical auth, query, and test patterns already in the file.

## Standard Stack

### Core (already in use -- no new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| FastAPI | (existing) | API framework | Already the web framework for the entire platform |
| Pydantic | (existing) | Request/response validation | Already used in all route files |
| SQLAlchemy Core | (existing) | Database queries | Already used in `core/assessments.py` and all query modules |
| asyncpg | (existing) | Async PostgreSQL driver | Already the DB driver |
| pytest + FastAPI TestClient | (existing) | Testing | Already used in `web_api/tests/test_assessments_scoring.py` |

### Supporting

No new libraries needed. This phase uses only existing dependencies.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Query param `?response_id=X` | Path param `/scores/{response_id}` | Query param is better because: (a) scores belong to a response, not a top-level resource; (b) allows future expansion to batch queries; (c) consistent with existing `GET /responses?module_slug=X&question_id=Y` pattern |
| Join in SQL | Two sequential queries | Join is cleaner -- single round-trip, ownership check built in |

**Installation:** No new packages needed.

## Architecture Patterns

### Where New Code Goes

```
core/
  assessments.py          # ADD: get_scores_for_response() function
web_api/
  routes/
    assessments.py        # ADD: ScoreItem model, ScoreResponse model, GET /scores endpoint
  tests/
    test_score_retrieval.py  # NEW: Tests for the GET /scores endpoint
```

### Pattern 1: Ownership-Checked Query (JOIN pattern)

**What:** Query `assessment_scores` joined to `assessment_responses` so the ownership check (user_id/anonymous_token) is enforced at the SQL level.

**When to use:** Whenever reading child data (scores) that belongs to a parent (response) owned by a user.

**Example:**
```python
# Source: Derived from existing core/assessments.py patterns
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncConnection
from .tables import assessment_responses, assessment_scores

async def get_scores_for_response(
    conn: AsyncConnection,
    *,
    response_id: int,
    user_id: int | None = None,
    anonymous_token: UUID | None = None,
) -> list[dict]:
    """Get scores for a specific response, with ownership check."""
    # Ownership filter on the response (parent)
    ownership = []
    if user_id is not None:
        ownership.append(assessment_responses.c.user_id == user_id)
    if anonymous_token is not None:
        ownership.append(assessment_responses.c.anonymous_token == anonymous_token)
    if not ownership:
        raise ValueError("Either user_id or anonymous_token must be provided")

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
```

### Pattern 2: Pydantic Response Models (from existing assessments.py)

**What:** Typed response models that serialize database rows to JSON.

**Example:**
```python
# Source: Following pattern from web_api/routes/assessments.py ResponseItem
class ScoreItem(BaseModel):
    score_id: int
    response_id: int
    overall_score: int | None  # Extracted from score_data JSONB
    reasoning: str | None
    dimensions: dict | None
    key_observations: list[str] | None
    model_id: str | None
    prompt_version: str | None
    created_at: str  # ISO format

class ScoreResponse(BaseModel):
    scores: list[ScoreItem]
```

### Pattern 3: Auth Dependency Reuse

**What:** Reuse `get_user_or_anonymous` for consistent auth behavior.

**Example:**
```python
# Source: Existing pattern in web_api/routes/assessments.py
@router.get("/scores", response_model=ScoreResponse)
async def get_assessment_scores(
    response_id: int,
    auth: tuple = Depends(get_user_or_anonymous),
):
    user_id, anonymous_token = auth
    async with get_connection() as conn:
        rows = await get_scores_for_response(
            conn, response_id=response_id,
            user_id=user_id, anonymous_token=anonymous_token,
        )
    return ScoreResponse(scores=_format_score_items(rows))
```

### Anti-Patterns to Avoid

- **Exposing raw score_data JSONB:** Don't return the raw JSONB blob. Extract the expected fields (overall_score, reasoning, dimensions, key_observations) and handle missing keys gracefully. The JSONB schema is flexible by design, so fields may be absent.
- **Separate ownership query:** Don't do a SELECT on assessment_responses first to check ownership, then a second SELECT on assessment_scores. Use a JOIN to do it in one query.
- **Forgetting anonymous_token support:** The existing assessment system supports both authenticated users and anonymous users. The score retrieval must too.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Auth/ownership check | Custom middleware or decorator | `get_user_or_anonymous` dependency from `web_api/auth.py` | Already handles JWT cookie + X-Anonymous-Token header with user_id lookup |
| Response serialization | Manual dict building | Pydantic `BaseModel` with `response_model=` | FastAPI auto-validates and generates OpenAPI docs |
| DB connection management | Manual engine.connect() | `get_connection()` from `core/database.py` | Handles pool, timeouts, pre-ping |

**Key insight:** Every infrastructure piece needed already exists. This phase is pure "wire it together" work.

## Common Pitfalls

### Pitfall 1: JSONB Field Access

**What goes wrong:** The `score_data` column is a JSONB blob. Accessing `.get("overall_score")` on it could fail if the scoring LLM returned unexpected structure, or if the schema evolves.

**Why it happens:** JSONB flexibility means the schema is not enforced at the DB level.

**How to avoid:** Use `.get()` with defaults when extracting fields from `score_data`. The Pydantic model should use `| None` for all score_data-derived fields.

**Warning signs:** KeyError or TypeError in score formatting code.

### Pitfall 2: Empty Results vs 404

**What goes wrong:** Returning 404 when a response has no scores yet (scoring is async and may not have completed).

**Why it happens:** Confusing "response not found / not yours" with "response exists but has no scores yet."

**How to avoid:** Return 200 with `{"scores": []}` when the response exists but has no scores. Only return 404 if the response_id doesn't exist or doesn't belong to the user. This matches the existing pattern: `GET /responses` returns `{"responses": []}` for empty results, not 404.

**Warning signs:** Frontend receiving 404 immediately after completing a response (before scoring finishes).

### Pitfall 3: Route Ordering Conflict

**What goes wrong:** FastAPI matches routes in order. The existing `GET /responses/{question_id}` uses a path parameter. If `/scores` is added as a sibling, it could conflict.

**Why it happens:** `/scores` is under `/api/assessments/` prefix, separate from `/responses/{question_id}`.

**How to avoid:** Use `GET /api/assessments/scores?response_id=X` (query param) to avoid any path conflict with the existing `/responses/{question_id}` endpoint. The path `/scores` is distinct from `/responses/...` so there is no actual conflict, but query params are cleaner for this use case anyway.

### Pitfall 4: Missing Test Mocks for get_connection vs get_transaction

**What goes wrong:** Tests fail because the mock targets the wrong import path.

**Why it happens:** The route file imports `get_connection` from `core.database`, but mocks must target `web_api.routes.assessments.get_connection` (the name in the module's namespace).

**How to avoid:** Follow the exact mock pattern from `test_assessments_scoring.py`: mock at the route module level, not at the core module level.

## Code Examples

### Core Query Function

```python
# core/assessments.py -- add this function
# Source: Follows existing get_responses() pattern in same file

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

    Returns empty list if response has no scores (scoring may be in progress).
    """
    if user_id is None and anonymous_token is None:
        raise ValueError("Either user_id or anonymous_token must be provided")

    from .tables import assessment_scores

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
```

### Route Endpoint

```python
# web_api/routes/assessments.py -- add these models and endpoint
# Source: Follows existing ResponseItem/ResponseListResponse pattern in same file

class ScoreItem(BaseModel):
    score_id: int
    response_id: int
    overall_score: int | None = None
    reasoning: str | None = None
    dimensions: dict | None = None
    key_observations: list[str] | None = None
    model_id: str | None = None
    prompt_version: str | None = None
    created_at: str  # ISO format


class ScoreResponse(BaseModel):
    scores: list[ScoreItem]


def _format_score_items(rows: list[dict]) -> list[ScoreItem]:
    """Convert database rows to ScoreItem models, extracting from score_data JSONB."""
    items = []
    for row in rows:
        score_data = row.get("score_data", {}) or {}
        created_at = row["created_at"]
        if isinstance(created_at, datetime):
            created_at = created_at.isoformat()
        items.append(
            ScoreItem(
                score_id=row["score_id"],
                response_id=row["response_id"],
                overall_score=score_data.get("overall_score"),
                reasoning=score_data.get("reasoning"),
                dimensions=score_data.get("dimensions"),
                key_observations=score_data.get("key_observations"),
                model_id=row.get("model_id"),
                prompt_version=row.get("prompt_version"),
                created_at=created_at,
            )
        )
    return items


@router.get("/scores", response_model=ScoreResponse)
async def get_assessment_scores(
    response_id: int,
    auth: tuple = Depends(get_user_or_anonymous),
):
    """Get assessment scores for a specific response.

    Returns scores generated by the AI scoring pipeline. May return empty
    list if scoring hasn't completed yet (scoring runs asynchronously).

    Ownership check: only the creator of the response can view its scores.
    """
    user_id, anonymous_token = auth

    async with get_connection() as conn:
        rows = await get_scores_for_response(
            conn,
            response_id=response_id,
            user_id=user_id,
            anonymous_token=anonymous_token,
        )

    return ScoreResponse(scores=_format_score_items(rows))
```

### Test Pattern

```python
# web_api/tests/test_score_retrieval.py
# Source: Follows exact pattern from test_assessments_scoring.py

MOCK_USER = (42, None)  # (user_id, anonymous_token)

MOCK_SCORE_ROW = {
    "score_id": 1,
    "response_id": 42,
    "score_data": {
        "overall_score": 4,
        "reasoning": "Good answer",
        "dimensions": {"accuracy": {"score": 4, "note": "Mostly correct"}},
        "key_observations": ["Shows understanding"],
    },
    "model_id": "gpt-4o-mini",
    "prompt_version": "v1",
    "created_at": "2026-01-01T00:00:00",
}

@patch("web_api.routes.assessments.get_connection", return_value=mock_connection())
@patch("web_api.routes.assessments.get_scores_for_response", new_callable=AsyncMock)
def test_get_scores_returns_extracted_fields(mock_get_scores, mock_conn, client):
    mock_get_scores.return_value = [MOCK_SCORE_ROW]
    response = client.get("/api/assessments/scores?response_id=42")
    assert response.status_code == 200
    data = response.json()
    assert len(data["scores"]) == 1
    assert data["scores"][0]["overall_score"] == 4
    assert data["scores"][0]["reasoning"] == "Good answer"
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| N/A (no read path existed) | GET /scores?response_id=X with ownership check | Phase 10 | Completes CRUD layer for assessment_scores |

**Note:** The `score_data` JSONB schema (`SCORE_SCHEMA` in `core/scoring.py`) defines the expected structure: `overall_score` (int, required), `reasoning` (string, required), `dimensions` (object, optional), `key_observations` (array, optional). The API should extract these fields but treat them as nullable since the schema may evolve.

## Open Questions

1. **Should the endpoint also verify the response exists (return 404) or just return empty scores?**
   - What we know: The current GET /responses endpoints return `{"responses": []}` for no matches, not 404. The ownership-checked JOIN will return empty if the response doesn't exist OR doesn't belong to the caller.
   - What's unclear: Whether the caller needs to distinguish "response not found" from "no scores yet."
   - Recommendation: Return `{"scores": []}` in both cases. The caller can check if the response exists separately via the existing GET /responses endpoint. This is simpler and avoids leaking information about whether a response_id exists for another user.

2. **Should there be a batch endpoint (scores for multiple responses at once)?**
   - What we know: The success criteria only require scores for "a given response_id" (singular).
   - Recommendation: Implement single-response lookup first. Batch can be added later if needed. YAGNI.

## Sources

### Primary (HIGH confidence)
- `core/tables.py` lines 470-493 -- `assessment_scores` table definition (score_id, response_id FK, score_data JSONB, model_id, prompt_version, created_at)
- `core/assessments.py` -- existing query functions with ownership patterns (get_responses, get_responses_for_question, update_response)
- `core/scoring.py` -- SCORE_SCHEMA defining the JSONB structure (overall_score, reasoning, dimensions, key_observations)
- `web_api/routes/assessments.py` -- existing route patterns, auth dependency usage, Pydantic models
- `web_api/auth.py` -- `get_user_or_anonymous` dependency (lines 206-249)
- `web_api/tests/test_assessments_scoring.py` -- test/mock patterns for assessments routes
- `core/database.py` -- `get_connection()` and `get_transaction()` context managers
- Phase 9 verification report -- confirms scoring pipeline writes to assessment_scores correctly

### Secondary (MEDIUM confidence)
- None needed -- all information comes from the existing codebase

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, everything is already in the codebase
- Architecture: HIGH -- follows exact patterns from the same files being modified
- Pitfalls: HIGH -- identified from reading the actual code and understanding the JSONB flexibility + async scoring timing
- Code examples: HIGH -- derived directly from existing code in the same files

**Research date:** 2026-02-20
**Valid until:** Indefinite (codebase patterns are stable; no external dependencies to check)
