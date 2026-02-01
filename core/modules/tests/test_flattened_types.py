# core/modules/tests/test_flattened_types.py
"""Tests for flattened module types."""

from uuid import UUID

from core.modules.flattened_types import FlattenedModule


def test_flattened_module_with_dict_sections():
    """FlattenedModule stores sections as dicts."""
    module = FlattenedModule(
        slug="introduction",
        title="Introduction",
        content_id=UUID("00000000-0000-0000-0000-000000000001"),
        sections=[
            {
                "type": "page",
                "contentId": "00000000-0000-0000-0000-000000000002",
                "title": "Welcome",
                "segments": [],
            },
            {
                "type": "video",
                "contentId": "00000000-0000-0000-0000-000000000003",
                "learningOutcomeId": "00000000-0000-0000-0000-000000000004",
                "videoId": "dQw4w9WgXcQ",
                "meta": {"title": "AI Safety Intro", "channel": "Kurzgesagt"},
                "segments": [],
                "optional": False,
            },
            {
                "type": "article",
                "contentId": "00000000-0000-0000-0000-000000000005",
                "learningOutcomeId": None,
                "meta": {
                    "title": "Deep Dive",
                    "author": "Jane Doe",
                    "sourceUrl": "https://example.com/article",
                },
                "segments": [],
                "optional": True,
            },
        ],
    )
    assert module.slug == "introduction"
    assert len(module.sections) == 3
    assert module.sections[0]["type"] == "page"
    assert module.sections[1]["type"] == "video"
    assert module.sections[2]["type"] == "article"
    assert module.sections[2]["optional"] is True


def test_flattened_module_empty_sections():
    """FlattenedModule can have empty sections list."""
    module = FlattenedModule(
        slug="empty",
        title="Empty Module",
        content_id=None,
        sections=[],
    )
    assert module.sections == []


def test_flattened_module_content_id_optional():
    """FlattenedModule content_id can be None."""
    module = FlattenedModule(
        slug="no-id",
        title="No ID Module",
        content_id=None,
        sections=[],
    )
    assert module.content_id is None


def test_flattened_module_with_error():
    """FlattenedModule can store an error message."""
    module = FlattenedModule(
        slug="broken",
        title="Broken Module",
        content_id=None,
        sections=[],
        error="'from' anchor not found: Cascades are when...",
    )
    assert module.error == "'from' anchor not found: Cascades are when..."


def test_flattened_module_error_defaults_to_none():
    """FlattenedModule error field defaults to None."""
    module = FlattenedModule(
        slug="working",
        title="Working Module",
        content_id=None,
        sections=[{"type": "page", "segments": []}],
    )
    assert module.error is None
