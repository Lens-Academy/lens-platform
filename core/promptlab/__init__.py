"""
Prompt Lab evaluation module.

Provides fixture loading and evaluation utilities for the Prompt Lab,
a facilitator-only workbench for iterating on AI tutor system prompts.

Prompt Lab calls llm.py directly -- it does not modify chat.py or scoring.py.
Fixtures are stored as JSON files in the repo (version-controlled, curated).
"""

from .fixtures import list_fixtures, load_fixture
from .regenerate import regenerate_response, continue_conversation

__all__ = [
    "list_fixtures",
    "load_fixture",
    "regenerate_response",
    "continue_conversation",
]
