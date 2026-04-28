"""
Prompt Lab API routes.

Endpoints:
- GET /api/promptlab/fixtures - List available fixtures
- GET /api/promptlab/fixtures/{name} - Load a specific fixture
- POST /api/promptlab/score - Score a student answer (assessment fixtures)
- POST /api/promptlab/tutor-turn - Run one turn through the real tutor pipeline
- POST /api/promptlab/inspect - Return the assembled LLM request without invoking

All endpoints require facilitator/admin authentication.
No database writes occur in any Prompt Lab code path.
"""

import dataclasses
import json
import sys
import urllib.parse
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.database import get_connection
from core.modules import ModuleNotFoundError
from core.modules.chat import assemble_llm_request
from core.modules.llm import DEFAULT_PROVIDER, MODEL_CHOICES
from core.modules.prompts import DEFAULT_BASE_PROMPT
from core.modules.tutor_scenario import ScenarioTurn, build_scenario_turn
from core.promptlab import (
    InvalidFixtureNameError,
    delete_fixture,
    fixture_section_to_scenario,
    list_fixtures,
    load_fixture,
    run_tutor_turn,
    save_fixture,
    score_response,
)
from core.queries.facilitator import get_facilitator_group_ids, is_admin
from core.queries.users import get_user_by_discord_id
from web_api.auth import get_current_user

router = APIRouter(prefix="/api/promptlab", tags=["promptlab"])


async def get_facilitator_user(user: dict = Depends(get_current_user)) -> dict:
    """Get database user, raise 403 if not found or not facilitator/admin."""
    discord_id = user["sub"]
    async with get_connection() as conn:
        db_user = await get_user_by_discord_id(conn, discord_id)
        if not db_user:
            raise HTTPException(403, "User not found in database")

        admin = await is_admin(conn, db_user["user_id"])
        facilitator_groups = await get_facilitator_group_ids(conn, db_user["user_id"])

        if not admin and not facilitator_groups:
            raise HTTPException(403, "Access denied: not an admin or facilitator")

    return db_user


# --- Request models ---


class ScoreRequest(BaseModel):
    baseSystemPrompt: str  # Assessment persona prompt (editable in UI)
    assessmentInstructions: str  # Rubric for this question
    questionText: str  # The question shown to the student
    answerText: str  # The student's response
    model: str | None = None  # Optional model override


class TutorTurnRequest(BaseModel):
    """One tutor turn through the real pipeline, minus DB.

    `scenarioSource` discriminates between two ways to get a ScenarioTurn:
    - `live_module`: synthesize from a live module via `build_scenario_turn`
      — requires `moduleSlug` (plus section/segment indices + optional course).
    - `fixture`: load a saved fixture and convert via
      `fixture_section_to_scenario` — requires `fixtureKey` +
      `fixtureSectionIndex`. The fixture is routed through the identical
      downstream pipeline, so fixtures and live modules are parity-tested.

    Override fields apply before LLM invocation. `systemPromptOverride` and
    `basePromptOverride` target system-prompt assembly in
    `send_module_message`; the others target scenario assembly in
    `build_scenario_turn` (and are ignored for `fixture` source, since the
    ScenarioTurn is prebuilt — use `llmMessagesOverride` instead there).
    """

    scenarioSource: Literal["live_module", "fixture"] = "live_module"

    # live_module source
    moduleSlug: str | None = None
    sectionIndex: int = 0
    segmentIndex: int = 0
    courseSlug: str | None = None

    # fixture source
    fixtureKey: str | None = None
    fixtureSectionIndex: int = 0

    # shared
    messages: list[dict]
    basePromptOverride: str | None = None
    systemPromptOverride: str | None = None
    instructionsOverride: str | None = None
    contentContextOverride: str | None = None
    courseOverviewOverride: str | None = None
    llmMessagesOverride: list[dict] | None = None
    enableTools: bool = True
    enableThinking: bool = True
    effort: str = "low"
    enableCourseOverview: bool = True
    model: str | None = None


def _resolve_scenario(body: TutorTurnRequest) -> tuple[ScenarioTurn | None, dict]:
    """Resolve `body.scenarioSource` to either (prebuilt_scenario, {}) for
    fixture mode or (None, live_module_kwargs) for live-module mode.

    For live_module, returns kwargs that run_tutor_turn will feed into
    build_scenario_turn. For fixture, returns a prebuilt ScenarioTurn and
    an empty kwargs dict (live-module kwargs are ignored).
    """
    if body.scenarioSource == "fixture":
        if not body.fixtureKey:
            raise HTTPException(400, "fixture source requires fixtureKey")
        fixture = load_fixture(body.fixtureKey)
        if not fixture:
            raise HTTPException(404, "Fixture not found")
        scenario = fixture_section_to_scenario(
            fixture, body.fixtureSectionIndex, body.messages
        )
        return scenario, {}

    if body.scenarioSource == "live_module":
        if not body.moduleSlug:
            raise HTTPException(400, "live_module source requires moduleSlug")
        try:
            from core.modules.loader import load_flattened_module

            load_flattened_module(body.moduleSlug)
        except ModuleNotFoundError:
            raise HTTPException(404, "Module not found")
        live_kwargs = {
            "module_slug": body.moduleSlug,
            "section_index": body.sectionIndex,
            "segment_index": body.segmentIndex,
            "course_slug": body.courseSlug,
            "messages": body.messages,
            "include_course_overview": body.enableCourseOverview,
            "instructions_override": body.instructionsOverride,
            "content_context_override": body.contentContextOverride,
            "course_overview_override": body.courseOverviewOverride,
            "llm_messages_override": body.llmMessagesOverride,
        }
        return None, live_kwargs

    raise HTTPException(400, f"Unknown scenarioSource: {body.scenarioSource}")


# --- Endpoints ---


@router.get("/config")
async def get_config(
    _user: dict = Depends(get_facilitator_user),
) -> dict:
    """Return facilitator-visible configuration: selectable models and the
    production tutor base prompt (for prepopulating the live-tutor editor)."""
    return {
        "models": MODEL_CHOICES,
        "defaultModel": DEFAULT_PROVIDER,
        "defaultBasePrompt": DEFAULT_BASE_PROMPT,
    }


@router.get("/fixtures")
async def list_all_fixtures(
    _user: dict = Depends(get_facilitator_user),
) -> dict:
    """
    List all available chat fixtures for Prompt Lab.

    Auth: facilitator or admin required.
    """
    fixtures = list_fixtures()
    return {"fixtures": fixtures}


@router.get("/fixtures/{name:path}")
async def get_fixture(
    name: str,
    _user: dict = Depends(get_facilitator_user),
) -> dict:
    """
    Load a specific fixture by name.

    Auth: facilitator or admin required.
    Returns 404 if fixture not found.
    """
    decoded_name = urllib.parse.unquote(name)
    fixture = load_fixture(decoded_name)
    if not fixture:
        raise HTTPException(404, "Fixture not found")
    return fixture


@router.put("/fixtures/{name}")
async def put_fixture(
    name: str,
    body: dict,
    _user: dict = Depends(get_facilitator_user),
) -> dict:
    """Atomically write a fixture file. Body is the full v2 fixture dict.

    Used by the Prompt Lab to persist every UI change. The body's `name`
    field must equal the path `name`. Auth: facilitator or admin.
    """
    try:
        return save_fixture(name, body)
    except InvalidFixtureNameError as e:
        raise HTTPException(400, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.delete("/fixtures/{name}")
async def delete_fixture_endpoint(
    name: str,
    _user: dict = Depends(get_facilitator_user),
) -> dict:
    try:
        removed = delete_fixture(name)
    except InvalidFixtureNameError as e:
        raise HTTPException(400, str(e))
    if not removed:
        raise HTTPException(404, "Fixture not found")
    return {"removed": True}


@router.post("/score")
async def score(
    request: ScoreRequest,
    _user: dict = Depends(get_facilitator_user),
) -> dict:
    """
    Score a student answer with a custom assessment prompt.

    Auth: facilitator or admin required.
    Returns structured score result (not SSE — uses non-streaming complete()).
    Does NOT write to any database table.
    """
    result = await score_response(
        base_system_prompt=request.baseSystemPrompt,
        assessment_instructions=request.assessmentInstructions,
        question_text=request.questionText,
        answer_text=request.answerText,
        provider=request.model,
    )
    return result


@router.post("/tutor-turn")
async def tutor_turn(
    body: TutorTurnRequest,
    request: Request,
    _user: dict = Depends(get_facilitator_user),
) -> StreamingResponse:
    """Run one tutor turn through the production pipeline (no DB writes).

    Source is discriminated by `scenarioSource`. Both sources flow through
    the same `run_tutor_turn` / `send_module_message` path — see
    `TutorTurnRequest` for the input shape.
    """
    prebuilt_scenario, live_kwargs = _resolve_scenario(body)

    mcp_manager = getattr(request.app.state, "mcp_manager", None)
    content_index = getattr(request.app.state, "content_index", None)

    async def event_generator():
        try:
            async for event in run_tutor_turn(
                prebuilt_scenario=prebuilt_scenario,
                base_prompt_override=body.basePromptOverride,
                system_prompt_override=body.systemPromptOverride,
                enable_tools=body.enableTools,
                enable_thinking=body.enableThinking,
                effort=body.effort,
                model=body.model,
                mcp_manager=mcp_manager,
                content_index=content_index,
                **live_kwargs,
            ):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def _scenario_to_dict(scenario: ScenarioTurn) -> dict:
    """Serialize a ScenarioTurn for the /inspect response.

    Stage is a dataclass — flatten to a plain dict so it round-trips
    through JSON. All other fields are already JSON-safe.
    """
    d = dataclasses.asdict(scenario)
    return d


def _build_provenance(body: TutorTurnRequest) -> dict:
    """Describe where each piece of the request came from, for the Inspector.

    The strings are human-readable labels shown as tags next to each
    overridable field in the UI. When an override is active, the label
    notes that explicitly.
    """
    if body.scenarioSource == "fixture":
        scenario_origin = (
            f"fixture(key={body.fixtureKey!r}, section={body.fixtureSectionIndex})"
        )
    else:
        scenario_origin = (
            f"build_scenario_turn(moduleSlug={body.moduleSlug!r}, "
            f"section={body.sectionIndex}, segment={body.segmentIndex})"
        )

    def _label(override_value, default_label: str) -> str:
        return "override (verbatim)" if override_value is not None else default_label

    return {
        "source": body.scenarioSource,
        "scenario_origin": scenario_origin,
        "system_prompt": _label(
            body.systemPromptOverride,
            "DEFAULT_BASE_PROMPT + course_overview + repeat(General Instructions)",
        ),
        "instructions": _label(
            body.instructionsOverride,
            "segment.instructions via _build_segment_instructions default branch",
        ),
        "course_overview": _label(
            body.courseOverviewOverride,
            "concat of summaryForTutor across sections via build_course_overview",
        ),
        "content_context_message": _label(
            body.contentContextOverride,
            "build_content_context_message wraps section_context",
        ),
        "llm_messages": _label(
            body.llmMessagesOverride,
            "merge_existing_messages + content-context prepended to new user message",
        ),
        "base_prompt": _label(body.basePromptOverride, "DEFAULT_BASE_PROMPT"),
    }


@router.post("/inspect")
async def inspect(
    body: TutorTurnRequest,
    request: Request,
    _user: dict = Depends(get_facilitator_user),
) -> dict:
    """Return the assembled LLM request without invoking the LLM.

    Same input shape as /tutor-turn. Resolves the ScenarioTurn exactly as
    /tutor-turn would, runs it through `assemble_llm_request`, and returns
    the system prompt, final `llm_messages`, kwargs LiteLLM would see, and
    provenance labels for each field (for the Inspector UI).

    Tools are NOT loaded — they're an async side effect and irrelevant for
    inspection. `llm_kwargs` reflects a tools-off view; downstream clients
    that need the tools-on view should call /tutor-turn.
    """
    prebuilt_scenario, live_kwargs = _resolve_scenario(body)

    if prebuilt_scenario is not None:
        scenario = prebuilt_scenario
    else:
        from core.modules.loader import load_flattened_module

        module = load_flattened_module(live_kwargs["module_slug"])
        existing = list(live_kwargs["messages"] or [])
        user_message = ""
        if existing and existing[-1].get("role") == "user":
            user_message = existing[-1].get("content", "")
            existing = existing[:-1]
        scenario = build_scenario_turn(
            module=module,
            section_index=live_kwargs["section_index"],
            segment_index=live_kwargs["segment_index"],
            existing_messages=existing,
            user_message=user_message,
            course_slug=live_kwargs["course_slug"],
            include_course_overview=live_kwargs["include_course_overview"],
            instructions_override=live_kwargs["instructions_override"],
            content_context_override=live_kwargs["content_context_override"],
            course_overview_override=live_kwargs["course_overview_override"],
            llm_messages_override=live_kwargs["llm_messages_override"],
        )

    model = body.model or DEFAULT_PROVIDER
    assembled = assemble_llm_request(
        messages=scenario.llm_messages,
        current_stage=scenario.stage,
        current_content=scenario.current_content,
        course_overview=scenario.course_overview,
        base_prompt=body.basePromptOverride,
        model=model,
        thinking=body.enableThinking,
        effort=body.effort,
        tools=None,
        system_prompt_override=body.systemPromptOverride,
    )

    return {
        "scenario": _scenario_to_dict(scenario),
        "system_prompt": assembled["system_prompt"],
        "llm_messages": assembled["llm_messages"],
        "llm_kwargs": {
            "model": assembled["llm_kwargs"]["model"],
            "thinking": assembled["llm_kwargs"].get("thinking"),
            "output_config": assembled["llm_kwargs"].get("output_config"),
            "max_tokens": assembled["llm_kwargs"]["max_tokens"],
        },
        "provenance": _build_provenance(body),
    }
