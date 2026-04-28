"""
Prompt Lab evaluation module.

Provides fixture loading and evaluation utilities for the Prompt Lab,
a facilitator-only workbench for iterating on AI tutor system prompts.

Every tutor-style call routes through the production pipeline
(`build_scenario_turn` → `send_module_message`), so the Lab cannot drift
from the live tutor. Fixtures are stored as JSON files in the repo
(version-controlled, curated).
"""

from .fixtures import (
    InvalidFixtureNameError,
    delete_fixture,
    fixture_section_to_scenario,
    list_fixtures,
    load_fixture,
    save_fixture,
    stage_group_to_scenario,
)
from .score import score_response
from .tutor_mode import run_tutor_turn

__all__ = [
    "InvalidFixtureNameError",
    "delete_fixture",
    "fixture_section_to_scenario",
    "list_fixtures",
    "load_fixture",
    "save_fixture",
    "stage_group_to_scenario",
    "score_response",
    "run_tutor_turn",
]
