# core/modules/tests/test_flattened_types.py
"""Tests for flattened section types."""

from uuid import UUID

from core.modules.flattened_types import (
    FlatPageSection,
    FlatLensVideoSection,
    FlatLensArticleSection,
    FlattenedModule,
)


def test_flat_page_section_has_required_fields():
    section = FlatPageSection(
        content_id=UUID("12345678-1234-1234-1234-123456789abc"),
        title="Welcome",
        segments=[],
    )
    assert section.type == "page"
    assert section.content_id == UUID("12345678-1234-1234-1234-123456789abc")
    assert section.title == "Welcome"
    assert section.segments == []


def test_flat_lens_video_section_has_learning_outcome_id():
    section = FlatLensVideoSection(
        content_id=UUID("12345678-1234-1234-1234-123456789abc"),
        learning_outcome_id=UUID("87654321-4321-4321-4321-cba987654321"),
        title="AI Safety Intro",
        video_id="dQw4w9WgXcQ",
        channel="Kurzgesagt",
        segments=[],
        optional=False,
    )
    assert section.type == "lens-video"
    assert section.learning_outcome_id == UUID("87654321-4321-4321-4321-cba987654321")
    assert section.video_id == "dQw4w9WgXcQ"


def test_flat_lens_article_section_has_metadata():
    section = FlatLensArticleSection(
        content_id=UUID("12345678-1234-1234-1234-123456789abc"),
        learning_outcome_id=None,  # Uncategorized
        title="Deep Dive",
        author="Jane Doe",
        source_url="https://example.com/article",
        segments=[],
        optional=True,
    )
    assert section.type == "lens-article"
    assert section.learning_outcome_id is None
    assert section.author == "Jane Doe"
    assert section.optional is True


def test_flattened_module_contains_flat_sections():
    module = FlattenedModule(
        slug="introduction",
        title="Introduction",
        content_id=UUID("00000000-0000-0000-0000-000000000001"),
        sections=[
            FlatPageSection(
                content_id=UUID("00000000-0000-0000-0000-000000000002"),
                title="Welcome",
                segments=[],
            ),
        ],
    )
    assert module.slug == "introduction"
    assert len(module.sections) == 1
    assert module.sections[0].type == "page"
