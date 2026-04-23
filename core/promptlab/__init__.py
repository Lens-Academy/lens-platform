"""
Prompt Lab evaluation module.

Provides fixture loading and evaluation utilities for the Prompt Lab,
a facilitator-only workbench for iterating on AI tutor system prompts.

Every tutor-style call routes through the production pipeline
(`build_scenario_turn` → `send_module_message`), so the Lab cannot drift
from the live tutor. Fixtures are stored as JSON files in the repo
(version-controlled, curated).
"""

from .fixtures import fixture_section_to_scenario, list_fixtures, load_fixture
from .score import score_response
from .tutor_mode import run_tutor_turn

__all__ = [
    "fixture_section_to_scenario",
    "list_fixtures",
    "load_fixture",
    "score_response",
    "run_tutor_turn",
]
