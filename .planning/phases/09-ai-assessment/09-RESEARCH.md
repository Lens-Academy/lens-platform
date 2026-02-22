# Phase 9: AI Assessment - Research

**Researched:** 2026-02-19
**Domain:** LLM-based scoring of free-text student answers, async background processing, structured output schemas
**Confidence:** HIGH

## Summary

Phase 9 adds AI-powered assessment scoring to the platform. When a student submits a free-text answer (via the Phase 7 answer box or Phase 8 test section), the system asynchronously calls LiteLLM to score the response against a rubric derived from the question's learning outcome and assessment prompt. The score is stored in the existing `assessment_scores` table (Phase 6) and is never exposed to students.

The infrastructure for this phase is already in place: LiteLLM 1.81.11 is installed and working (used by the chat module), the `assessment_responses` and `assessment_scores` tables exist with the right schema, the assessment API endpoints accept submissions and return `response_id`, and question segments include an `assessmentPrompt` field. The remaining work is: (1) a scoring module in `core/` that builds prompts, calls LiteLLM with structured output, and writes to `assessment_scores`, (2) a mechanism to trigger scoring asynchronously after submission without blocking the API response, and (3) configuration for socratic vs assessment mode per question.

The codebase already has a pattern for async background work: `asyncio.create_task()` with proper error handling (the chat module uses streaming, but for scoring we need a non-streaming `acompletion` call). LiteLLM supports structured JSON output via `response_format` with `json_schema`, which is the right approach for getting consistent score data. The existing `score_data` JSONB column is designed for exactly this flexibility.

**Primary recommendation:** Create a `core/scoring.py` module that uses LiteLLM `acompletion` (non-streaming) with `response_format={"type": "json_schema", ...}` to produce structured scores. Trigger it via `asyncio.create_task()` from the submission endpoint. Track tasks in a module-level set to prevent GC and log errors via Sentry.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| LiteLLM | 1.81.11 (installed) | LLM provider abstraction | Already integrated, used by chat module, supports structured output |
| SQLAlchemy Core | >=2.0.0 (installed) | Database access | Already used throughout codebase |
| asyncpg | >=0.29.0 (installed) | Async PostgreSQL driver | Already used throughout codebase |
| Pydantic | (installed via FastAPI) | Score schema validation | Already a dependency, used for request/response models |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| sentry-sdk | (installed) | Error tracking | Capture scoring failures in background tasks |
| logging | (stdlib) | Structured logging | Log scoring events, latencies, failures |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `asyncio.create_task()` | FastAPI `BackgroundTasks` | BackgroundTasks runs after response but is tied to request lifecycle; `create_task` gives more control and the codebase has no existing BackgroundTasks usage |
| `asyncio.create_task()` | APScheduler (existing) | APScheduler is for scheduled/deferred jobs; scoring should start immediately and APScheduler adds unnecessary complexity for fire-and-forget |
| `asyncio.create_task()` | Celery / Redis queue | Overkill for this use case; adds infrastructure dependency; single Railway instance makes in-process fine |
| `response_format` json_schema | Plain text parsing | Structured output is more reliable and eliminates parsing; LiteLLM supports it across Anthropic/OpenAI/Gemini |

**Installation:**
```bash
# No new dependencies needed - all libraries already installed
```

## Architecture Patterns

### Recommended Project Structure
```
core/
├── scoring.py           # NEW: AI scoring module (prompt building, LLM call, DB write)
├── assessments.py       # EXISTING: Response CRUD (add trigger to score after submit)
├── tables.py            # EXISTING: assessment_scores table already defined
├── modules/
│   └── llm.py           # EXISTING: LiteLLM wrapper (stream_chat) - add non-streaming helper
web_api/
└── routes/
    └── assessments.py   # EXISTING: Submission endpoint (add async scoring trigger)
```

### Pattern 1: Non-Streaming LLM Completion
**What:** The existing `core/modules/llm.py` only has `stream_chat()`. Scoring needs a non-streaming `acompletion` call with structured output.
**When to use:** Any LLM call that needs a complete response (not streamed to a user), especially with structured output.
**Example:**
```python
# core/modules/llm.py - add alongside existing stream_chat
from litellm import acompletion

async def complete(
    messages: list[dict],
    system: str,
    response_format: dict | None = None,
    provider: str | None = None,
    max_tokens: int = 1024,
) -> str:
    """
    Non-streaming completion for structured responses (e.g., scoring).

    Returns the full response content as a string.
    """
    model = provider or DEFAULT_PROVIDER
    llm_messages = [{"role": "system", "content": system}] + messages

    kwargs = {
        "model": model,
        "messages": llm_messages,
        "max_tokens": max_tokens,
    }
    if response_format:
        kwargs["response_format"] = response_format

    response = await acompletion(**kwargs)
    return response.choices[0].message.content
```
**Source:** LiteLLM docs (https://docs.litellm.ai/docs/completion/json_mode), verified against installed v1.81.11

### Pattern 2: Fire-and-Forget Background Scoring
**What:** After a submission is persisted, spawn an async task to score it. The task runs independently of the HTTP response.
**When to use:** When the API must respond immediately (not block on LLM call) but background work is needed.
**Example:**
```python
# core/scoring.py
import asyncio
import logging

import sentry_sdk

logger = logging.getLogger(__name__)

# Track running tasks to prevent GC (asyncio only keeps weak references)
_running_tasks: set[asyncio.Task] = set()


def enqueue_scoring(response_id: int, question_context: dict) -> None:
    """Fire-and-forget: score a response in the background."""
    task = asyncio.create_task(
        _score_response(response_id, question_context),
        name=f"score-response-{response_id}",
    )
    _running_tasks.add(task)
    task.add_done_callback(_task_done)


def _task_done(task: asyncio.Task) -> None:
    """Callback to clean up completed tasks and log errors."""
    _running_tasks.discard(task)
    if task.cancelled():
        return
    exc = task.exception()
    if exc:
        logger.error(f"Scoring task {task.get_name()} failed: {exc}")
        sentry_sdk.capture_exception(exc)
```
**Source:** Python asyncio docs (https://docs.python.org/3/library/asyncio-task.html), FastAPI community patterns

### Pattern 3: Structured Score Schema
**What:** Define the score output as a JSON schema so LiteLLM enforces the structure.
**When to use:** For all scoring calls -- ensures consistent, parseable results.
**Example:**
```python
SCORE_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "assessment_score",
        "schema": {
            "type": "object",
            "properties": {
                "overall_score": {
                    "type": "integer",
                    "description": "Score from 1-5 (1=no understanding, 5=deep understanding)"
                },
                "reasoning": {
                    "type": "string",
                    "description": "Brief explanation of why this score was given"
                },
                "dimensions": {
                    "type": "object",
                    "description": "Per-dimension scores if rubric specifies multiple dimensions",
                    "additionalProperties": {
                        "type": "object",
                        "properties": {
                            "score": {"type": "integer"},
                            "note": {"type": "string"}
                        },
                        "required": ["score"]
                    }
                },
                "key_observations": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Notable strengths or gaps in the response"
                }
            },
            "required": ["overall_score", "reasoning"],
            "additionalProperties": False
        }
    }
}
```
**Source:** LiteLLM structured output docs (https://docs.litellm.ai/docs/completion/json_mode)

### Pattern 4: Socratic vs Assessment Mode
**What:** The AI prompt changes based on question mode. Socratic questions get feedback-oriented scoring. Assessment questions get measurement-oriented scoring.
**When to use:** Configured per question via content structure. The mode affects the system prompt.
**Example:**
```python
def _build_scoring_prompt(
    *,
    answer_text: str,
    user_instruction: str,
    assessment_prompt: str | None,
    learning_outcome_name: str | None,
    mode: str,  # "socratic" or "assessment"
) -> tuple[str, list[dict]]:
    """Build system prompt and messages for scoring."""

    if mode == "socratic":
        system = (
            "You are a supportive educational assessor. "
            "Score this student's response with emphasis on effort, engagement, "
            "and learning progress. Be generous with partial understanding. "
            "The goal is to track learning, not to judge."
        )
    else:  # assessment
        system = (
            "You are a rigorous educational assessor. "
            "Score this student's response against the rubric precisely. "
            "Measure actual understanding demonstrated, not effort."
        )

    # Add learning outcome context if available
    if learning_outcome_name:
        system += f"\n\nLearning Outcome: {learning_outcome_name}"

    # Add custom rubric if provided
    if assessment_prompt:
        system += f"\n\nScoring Rubric:\n{assessment_prompt}"

    messages = [
        {"role": "user", "content": (
            f"Question: {user_instruction}\n\n"
            f"Student's answer: {answer_text}\n\n"
            "Score this response according to the rubric."
        )}
    ]

    return system, messages
```

### Pattern 5: Integration Point -- Trigger After Submission
**What:** The scoring trigger fires from the existing submission code path. When `completed_at` is set (answer finalized), enqueue scoring.
**When to use:** When a response is marked complete (PATCH with `completed_at` set, or POST with immediate completion).
**Trigger point:** In `web_api/routes/assessments.py` after the update/create call succeeds.
**Example:**
```python
# In assessments.py route handler, after successful create/update with completed_at
from core.scoring import enqueue_scoring

# Only score completed responses
if row.get("completed_at"):
    enqueue_scoring(
        response_id=row["response_id"],
        question_context={
            "question_id": row["question_id"],
            "module_slug": row["module_slug"],
            "learning_outcome_id": row.get("learning_outcome_id"),
            "answer_text": row["answer_text"],
        },
    )
```

### Anti-Patterns to Avoid
- **Blocking the submission response on LLM scoring:** The submission must return immediately. LLM calls can take 2-10 seconds and should never block the user.
- **Scoring incomplete/draft answers:** Only score responses with `completed_at` set. Drafts are being auto-saved and should not trigger scoring.
- **Exposing score data to frontend:** Per AI-04, scores are internal. Do not add score fields to any API response returned to clients.
- **Building a custom retry/queue system:** Use `asyncio.create_task` with Sentry error capture. If scoring fails, it fails -- no retry queue needed yet. The score can be re-triggered manually or via a batch job later.
- **Hardcoding the LLM model for scoring:** Use the existing `DEFAULT_PROVIDER` from `llm.py` or a separate `SCORING_PROVIDER` env var. Different models may be better for scoring vs chat.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Structured LLM output | Custom JSON parsing / regex extraction | LiteLLM `response_format` with `json_schema` | LiteLLM handles provider differences; native structured output is more reliable than parsing |
| Background task tracking | Custom task queue / worker pool | `asyncio.create_task()` + task set | Simple, in-process, matches the single-process architecture |
| Score validation | Manual dict checking | Pydantic model + `model_validate_json()` | Already a dependency; handles edge cases like missing fields |
| Error reporting | Custom error logging system | Sentry `capture_exception()` | Already integrated; provides alerting, stack traces, grouping |
| LLM provider abstraction | Direct Anthropic/OpenAI SDK calls | LiteLLM `acompletion` | Already integrated; supports provider switching via env var |

**Key insight:** This phase composes existing infrastructure. The database tables, LLM integration, API endpoints, and error tracking are all in place. The new code is a thin scoring module (~150 lines) that connects them.

## Common Pitfalls

### Pitfall 1: Garbage-Collected Background Tasks
**What goes wrong:** `asyncio.create_task()` returns a task, but if you don't keep a reference, the event loop only holds a weak reference and the task may be garbage collected before completion.
**Why it happens:** Python's asyncio design -- tasks are weak-referenced by the loop.
**How to avoid:** Store tasks in a module-level `set()` and use `task.add_done_callback()` to remove completed tasks. (Pattern 2 above.)
**Warning signs:** Scoring tasks silently disappearing; no score records appearing in DB despite submissions.

### Pitfall 2: Unhandled Exceptions in Background Tasks
**What goes wrong:** If a background task raises an exception and nobody awaits it, Python logs a warning but the error is effectively swallowed.
**Why it happens:** Fire-and-forget tasks are never awaited, so exceptions go nowhere.
**How to avoid:** Use the `_task_done` callback to check `task.exception()` and report to Sentry.
**Warning signs:** "Task exception was never retrieved" warnings in logs; missing scores with no error trail.

### Pitfall 3: Scoring Draft/Incomplete Answers
**What goes wrong:** Auto-save creates and updates responses continuously as the user types. Scoring every save wastes LLM calls and produces meaningless scores.
**Why it happens:** The PATCH endpoint fires on every debounced save, not just on completion.
**How to avoid:** Only trigger scoring when `completed_at` transitions from null to a timestamp. The trigger condition is: response was just marked complete (not already scored).
**Warning signs:** Hundreds of score records per response; high LLM costs.

### Pitfall 4: Missing Context for Scoring
**What goes wrong:** The scoring prompt lacks the learning outcome name, the assessment prompt, or the question text, leading to generic/useless scores.
**Why it happens:** The `assessment_responses` table stores `question_id`, `module_slug`, and `learning_outcome_id`, but not the question text or assessment prompt. These must be looked up from the content cache.
**How to avoid:** At scoring time, load the flattened module from cache, find the matching question segment by position-based ID, and extract `userInstruction`, `assessmentPrompt`, and the section's `learningOutcomeName`.
**Warning signs:** AI scores are all similar or generic; reasoning doesn't mention the specific question.

### Pitfall 5: Score Schema Breaking Changes
**What goes wrong:** Changing the `SCORE_SCHEMA` invalidates old scores. Analytics code that reads `score_data` JSONB breaks on old vs new formats.
**Why it happens:** JSONB has no schema enforcement at the DB level.
**How to avoid:** Version the prompt/schema in `assessment_scores.prompt_version`. When reading scores, check version and handle gracefully. Never delete old fields from the schema.
**Warning signs:** Analytics queries failing on some rows; null scores for old dimensions.

### Pitfall 6: Socratic vs Assessment Mode Not Available in Data
**What goes wrong:** Need to know whether a question is socratic or assessment to build the right prompt, but this distinction isn't in the current content schema or `assessment_responses` table.
**Why it happens:** The `question` segment type currently has `assessmentPrompt` but no explicit mode field. The mode distinction (AI-03) needs a way to be configured.
**How to avoid:** The scoring mode can be determined by context: questions inside `## Test:` sections (section type "test") are assessment mode; questions inline in lens sections are socratic mode. This matches the educational design -- tests measure, inline questions help learn.
**Warning signs:** All questions scored with the same prompt regardless of context.

## Code Examples

### Full Scoring Flow
```python
# core/scoring.py
import asyncio
import json
import logging
from datetime import datetime, timezone

import sentry_sdk

from core.database import get_transaction
from core.modules.llm import complete
from core.tables import assessment_scores

logger = logging.getLogger(__name__)

_running_tasks: set[asyncio.Task] = set()

SCORE_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "assessment_score",
        "schema": {
            "type": "object",
            "properties": {
                "overall_score": {
                    "type": "integer",
                    "description": "1=no understanding, 2=minimal, 3=partial, 4=good, 5=deep"
                },
                "reasoning": {
                    "type": "string",
                    "description": "2-3 sentence explanation"
                },
                "dimensions": {
                    "type": "object",
                    "additionalProperties": {
                        "type": "object",
                        "properties": {
                            "score": {"type": "integer"},
                            "note": {"type": "string"}
                        },
                        "required": ["score"]
                    }
                },
                "key_observations": {
                    "type": "array",
                    "items": {"type": "string"}
                }
            },
            "required": ["overall_score", "reasoning"],
            "additionalProperties": False
        }
    }
}

# Scoring-specific model (may differ from chat model)
SCORING_PROVIDER = os.environ.get("SCORING_PROVIDER") or DEFAULT_PROVIDER
PROMPT_VERSION = "v1"


def enqueue_scoring(response_id: int, question_context: dict) -> None:
    """Fire-and-forget scoring task."""
    task = asyncio.create_task(
        _score_response(response_id, question_context),
        name=f"score-{response_id}",
    )
    _running_tasks.add(task)
    task.add_done_callback(_task_done)


def _task_done(task: asyncio.Task) -> None:
    _running_tasks.discard(task)
    if not task.cancelled() and task.exception():
        logger.error(f"Scoring failed for {task.get_name()}: {task.exception()}")
        sentry_sdk.capture_exception(task.exception())


async def _score_response(response_id: int, ctx: dict) -> None:
    """Score a single response and write to assessment_scores."""
    # Look up question details from content cache
    question_details = _resolve_question_details(
        module_slug=ctx["module_slug"],
        question_id=ctx["question_id"],
    )

    # Determine mode from section type
    mode = question_details.get("mode", "socratic")

    # Build prompt
    system, messages = _build_scoring_prompt(
        answer_text=ctx["answer_text"],
        user_instruction=question_details.get("user_instruction", ""),
        assessment_prompt=question_details.get("assessment_prompt"),
        learning_outcome_name=question_details.get("learning_outcome_name"),
        mode=mode,
    )

    # Call LLM
    raw_response = await complete(
        messages=messages,
        system=system,
        response_format=SCORE_SCHEMA,
        provider=SCORING_PROVIDER,
        max_tokens=512,
    )

    # Parse and validate
    score_data = json.loads(raw_response)

    # Write to DB
    async with get_transaction() as conn:
        await conn.execute(
            assessment_scores.insert().values(
                response_id=response_id,
                score_data=score_data,
                model_id=SCORING_PROVIDER,
                prompt_version=PROMPT_VERSION,
            )
        )

    logger.info(
        f"Scored response {response_id}: "
        f"overall={score_data.get('overall_score')}"
    )
```

### Resolving Question Details from Content Cache
```python
def _resolve_question_details(module_slug: str, question_id: str) -> dict:
    """
    Look up question text, assessment prompt, learning outcome name,
    and scoring mode from the content cache.

    question_id format: "moduleSlug:sectionIndex:segmentIndex"
    """
    from core.modules.loader import load_flattened_module, ModuleNotFoundError

    try:
        module = load_flattened_module(module_slug)
    except ModuleNotFoundError:
        logger.warning(f"Module {module_slug} not found for scoring")
        return {}

    # Parse position from question_id
    parts = question_id.split(":")
    if len(parts) != 3:
        logger.warning(f"Invalid question_id format: {question_id}")
        return {}

    _, section_idx_str, segment_idx_str = parts
    try:
        section_idx = int(section_idx_str)
        segment_idx = int(segment_idx_str)
    except ValueError:
        return {}

    if section_idx >= len(module.sections):
        return {}

    section = module.sections[section_idx]
    segments = section.get("segments", [])
    if segment_idx >= len(segments):
        return {}

    segment = segments[segment_idx]
    if segment.get("type") != "question":
        return {}

    # Determine mode: test sections = assessment, everything else = socratic
    mode = "assessment" if section.get("type") == "test" else "socratic"

    return {
        "user_instruction": segment.get("userInstruction", ""),
        "assessment_prompt": segment.get("assessmentPrompt"),
        "learning_outcome_name": section.get("learningOutcomeName"),
        "mode": mode,
    }
```

### Adding Non-Streaming Completion to llm.py
```python
# Add to core/modules/llm.py alongside existing stream_chat

async def complete(
    messages: list[dict],
    system: str,
    response_format: dict | None = None,
    provider: str | None = None,
    max_tokens: int = 1024,
) -> str:
    """
    Non-streaming completion for structured responses.

    Args:
        messages: List of {"role": "user"|"assistant", "content": str}
        system: System prompt
        response_format: Optional JSON schema for structured output
        provider: Model string (uses DEFAULT_PROVIDER if None)
        max_tokens: Maximum tokens in response

    Returns:
        Full response content as string
    """
    model = provider or DEFAULT_PROVIDER
    llm_messages = [{"role": "system", "content": system}] + messages

    kwargs = {
        "model": model,
        "messages": llm_messages,
        "max_tokens": max_tokens,
    }
    if response_format:
        kwargs["response_format"] = response_format

    response = await acompletion(**kwargs)
    return response.choices[0].message.content
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Parse LLM text output with regex | `response_format` with `json_schema` | LiteLLM 1.40+ / 2024 | Reliable structured output without parsing fragility |
| Direct Anthropic/OpenAI SDK | LiteLLM provider abstraction | Already migrated in this codebase | Can switch scoring model via env var |
| Blocking LLM calls in request handler | `asyncio.create_task` for background scoring | Standard async Python pattern | Submission response is instant; scoring is decoupled |

**Deprecated/outdated:**
- **`{"type": "json_object"}` response format**: Still works but `json_schema` is strictly better -- provides schema validation, not just "output JSON somewhere"
- **Manual JSON extraction prompts** ("respond with JSON in this format..."): Replaced by native structured output support in all major providers via LiteLLM

## Open Questions

1. **Scoring model selection**
   - What we know: The existing `DEFAULT_PROVIDER` is `anthropic/claude-sonnet-4-20250514`. LiteLLM supports any model.
   - What's unclear: Should scoring use the same model as chat, or a cheaper/faster model? Claude Haiku or GPT-4o-mini would be cheaper for scoring.
   - Recommendation: Default to `DEFAULT_PROVIDER` but expose `SCORING_PROVIDER` env var for independent control. Iterate on model choice after seeing initial score quality.

2. **Re-scoring mechanism**
   - What we know: Scores are 1:many (multiple scores per response are possible since there's no unique constraint on `response_id` in `assessment_scores`).
   - What's unclear: When prompts improve, should old responses be re-scored? How is re-scoring triggered?
   - Recommendation: Defer re-scoring to a future batch job. For now, each completion triggers one score. The `prompt_version` field enables future filtering.

3. **Content cache availability at scoring time**
   - What we know: The content cache is populated from GitHub on startup and webhook updates. It's always available at runtime.
   - What's unclear: Could there be a race condition where content updates between submission and scoring, changing the question text?
   - Recommendation: Unlikely in practice (content updates are infrequent). If needed later, snapshot question context at submission time in `answer_metadata`.

4. **Learning outcome definition text**
   - What we know: The LO frontmatter has an optional `learning-outcome::` field, but it's not currently populated in actual content. The LO filename/`learningOutcomeName` is available.
   - What's unclear: Will the `learning-outcome::` field be populated? Is the file name sufficient as a rubric anchor?
   - Recommendation: Use `learningOutcomeName` (the LO file name minus `.md`) plus any `assessmentPrompt` from the question segment. If `learning-outcome::` is populated in the future, add it to the prompt. Start with what's available.

## Sources

### Primary (HIGH confidence)
- **Codebase inspection** - `core/modules/llm.py` (LiteLLM integration), `core/tables.py` (assessment_scores schema), `core/assessments.py` (response CRUD), `web_api/routes/assessments.py` (submission endpoint), `content_processor/src/content-schema.ts` (question segment fields), `content_processor/src/flattener/index.ts` (test section flattening with learningOutcomeId/Name)
- **LiteLLM structured output docs** - https://docs.litellm.ai/docs/completion/json_mode - verified `response_format` with `json_schema` support, Pydantic model support, provider compatibility
- **Python asyncio docs** - https://docs.python.org/3/library/asyncio-task.html - `create_task()` behavior, weak references, done callbacks
- **LiteLLM installed version** - 1.81.11 confirmed via `pip show litellm`

### Secondary (MEDIUM confidence)
- **FastAPI background tasks patterns** - https://fastapi.tiangolo.com/tutorial/background-tasks/ - Comparison of BackgroundTasks vs asyncio.create_task approaches, verified with multiple community sources
- **LLM-as-judge rubric design** - https://www.montecarlodata.com/blog-llm-as-judge/ - Best practices for structured scoring rubrics (chain-of-thought reasoning, categorical scales, dimension-based scoring)
- **Promptfoo LLM rubric** - https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/llm-rubric/ - Rubric design patterns for automated LLM evaluation

### Tertiary (LOW confidence)
- **ACM paper on question-specific rubrics** - https://dl.acm.org/doi/10.1145/3702652.3744220 - Academic research on LLM rubric scoring; principles sound but not verified against this specific use case

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already installed and working; no new dependencies
- Architecture: HIGH - Patterns derived directly from codebase inspection; fire-and-forget async is well-understood
- Pitfalls: HIGH - Identified from both codebase patterns and asyncio documentation
- Score schema: MEDIUM - Schema design follows LLM-as-judge best practices but will need iteration based on actual score quality
- Socratic vs assessment mode: MEDIUM - Inferred from content structure (test sections vs inline questions); no explicit mode field exists yet

**Research date:** 2026-02-19
**Valid until:** 2026-03-19 (stable -- no fast-moving dependencies)
