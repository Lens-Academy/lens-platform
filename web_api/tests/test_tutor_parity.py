"""Parity guards: prod tutor, live-module lab, and fixture lab all share
the same scenario assembly and LLM-call pipeline.

The refactor that introduced these tests unified three previously-divergent
paths onto `build_scenario_turn` + `send_module_message`:

- Production tutor (`web_api/routes/module.py::event_generator`)
- Prompt Lab live-module mode (`core/promptlab/tutor_mode.py::run_tutor_turn`)
- Prompt Lab fixture mode (`core/promptlab/fixtures.py::fixture_section_to_scenario`)

These tests pin that parity so a later edit to any single path breaks CI
instead of silently diverging.
"""

from datetime import datetime
from unittest.mock import patch
from uuid import UUID

import pytest

from core.content.cache import ContentCache, clear_cache, set_cache
from core.modules.flattened_types import FlattenedModule
from core.modules.loader import load_flattened_module
from core.modules.tutor_scenario import build_scenario_turn
from core.promptlab.fixtures import fixture_section_to_scenario
from core.promptlab.tutor_mode import run_tutor_turn

_MODULE_SLUG = "parity-test-module"


def _test_module() -> FlattenedModule:
    return FlattenedModule(
        slug=_MODULE_SLUG,
        title="Parity Test Module",
        content_id=UUID("00000000-0000-0000-0000-000000000010"),
        sections=[
            {
                "type": "lens",
                "meta": {"title": "Test Lens"},
                "contentId": "00000000-0000-0000-0000-000000000011",
                "summaryForTutor": "Test summary for tutor.",
                "segments": [
                    {
                        "type": "chat",
                        "instructions": "Test tutor instructions for segment 1.",
                    }
                ],
            }
        ],
    )


@pytest.fixture(autouse=True)
def _setup_cache():
    cache = ContentCache(
        courses={},
        flattened_modules={_MODULE_SLUG: _test_module()},
        parsed_learning_outcomes={},
        parsed_lenses={},
        articles={},
        video_transcripts={},
        last_refreshed=datetime.now(),
    )
    set_cache(cache)
    yield
    clear_cache()


async def _drain(gen):
    return [e async for e in gen]


@pytest.mark.asyncio
async def test_live_module_lab_path_matches_direct_build():
    """run_tutor_turn(module_slug=...) calls send_module_message with args
    equivalent to what event_generator's build_scenario_turn + pass-through
    call would produce. Guards against drift in run_tutor_turn's wiring."""
    user_input = "What is alignment?"
    module = load_flattened_module(_MODULE_SLUG)
    prod_scenario = build_scenario_turn(
        module=module,
        section_index=0,
        segment_index=0,
        existing_messages=[],
        user_message=user_input,
    )

    captured: dict = {}

    async def spy_send(messages, stage, current_content, **kwargs):
        captured["messages"] = messages
        captured["stage"] = stage
        captured["current_content"] = current_content
        captured["kwargs"] = kwargs
        yield {"type": "done"}

    with patch("core.promptlab.tutor_mode.send_module_message", side_effect=spy_send):
        await _drain(
            run_tutor_turn(
                module_slug=_MODULE_SLUG,
                section_index=0,
                segment_index=0,
                messages=[{"role": "user", "content": user_input}],
            )
        )

    assert captured["messages"] == prod_scenario.llm_messages
    assert captured["stage"] == prod_scenario.stage
    assert captured["current_content"] == prod_scenario.current_content
    assert captured["kwargs"]["course_overview"] == prod_scenario.course_overview


@pytest.mark.asyncio
async def test_fixture_with_module_refs_matches_live_module():
    """A fixture that carries moduleSlug/sectionIndex/segmentIndex produces
    a ScenarioTurn byte-identical to the live-module path.

    This is the canary for 'fixtures go through the same thing the live
    code does' — a saved test case is literally the same pipeline."""
    fixture = {
        "schemaVersion": 2,
        "name": "parity-fixture",
        "description": "",
        "globalOverrides": {"basePrompt": None},
        "stageGroups": [
            {
                "kind": "live_module",
                "moduleSlug": _MODULE_SLUG,
                "sectionIndex": 0,
                "segmentIndex": 0,
                "courseSlug": None,
                "overrides": {},
                "chats": [],
            }
        ],
    }
    user_input = "What is alignment?"
    module = load_flattened_module(_MODULE_SLUG)
    live_scenario = build_scenario_turn(
        module=module,
        section_index=0,
        segment_index=0,
        existing_messages=[],
        user_message=user_input,
    )

    fixture_scenario = fixture_section_to_scenario(
        fixture, 0, [{"role": "user", "content": user_input}]
    )

    assert fixture_scenario.llm_messages == live_scenario.llm_messages
    assert fixture_scenario.stage == live_scenario.stage
    assert fixture_scenario.current_content == live_scenario.current_content
    assert fixture_scenario.course_overview == live_scenario.course_overview
    assert fixture_scenario.instructions == live_scenario.instructions
    assert fixture_scenario.section_title == live_scenario.section_title


def test_legacy_fixture_wraps_content_in_live_tutor_shape():
    """Legacy fixtures (no module refs) still produce the <lens>/<segment-
    instructions> structure the live tutor uses, so the LLM sees the same
    shape either way. Can't match byte-for-byte (no live content) but the
    envelope must match."""
    fixture = {
        "schemaVersion": 2,
        "name": "inline-test",
        "description": "",
        "globalOverrides": {"basePrompt": None},
        "stageGroups": [
            {
                "kind": "inline",
                "name": "Legacy section",
                "instructions": "Legacy instructions.",
                "context": "Legacy article content.",
                "overrides": {},
                "chats": [],
            }
        ],
    }

    scenario = fixture_section_to_scenario(
        fixture, 0, [{"role": "user", "content": "Hello"}]
    )

    assert len(scenario.llm_messages) == 1
    user_content = scenario.llm_messages[0]["content"]
    assert "<lens" in user_content
    assert "Legacy article content." in user_content
    assert "<segment-instructions>" in user_content
    assert "Legacy instructions." in user_content
    assert user_content.endswith("Hello")
    assert scenario.instructions == "Legacy instructions."
    assert scenario.section_title == "Legacy section"
    assert scenario.course_overview is None
