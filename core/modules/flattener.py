# core/modules/flattener.py
"""Flatten parsed modules by resolving Learning Outcome and Lens references."""

from abc import ABC, abstractmethod
from uuid import UUID

from core.modules.markdown_parser import (
    ParsedModule,
    ParsedLearningOutcome,
    ParsedLens,
    PageSection,
    LearningOutcomeRef,
    UncategorizedSection,
    LensVideoSection,
    LensArticleSection,
    TextSegment,
    ChatSegment,
)
from core.modules.flattened_types import FlattenedModule
from core.modules.content import (
    bundle_article_section,
    bundle_video_section,
    ArticleContent,
    VideoTranscriptContent,
)
from core.modules.path_resolver import resolve_wiki_link


class ContentLookup(ABC):
    """Abstract interface for looking up content by cache key."""

    @abstractmethod
    def get_learning_outcome(self, key: str) -> ParsedLearningOutcome:
        """Get a parsed learning outcome by filename stem."""
        pass

    @abstractmethod
    def get_lens(self, key: str) -> ParsedLens:
        """Get a parsed lens by filename stem."""
        pass

    @abstractmethod
    def get_article_for_bundling(self, source: str) -> "ArticleContent":
        """Get article content for bundling (content + metadata)."""
        pass

    @abstractmethod
    def get_video_for_bundling(self, source: str) -> "VideoTranscriptContent":
        """Get video transcript content for bundling (transcript + metadata)."""
        pass


def _flatten_lens(
    lens: ParsedLens,
    learning_outcome_id: UUID | None,
    optional: bool,
    lookup: ContentLookup,
) -> list[dict]:
    """Flatten a lens into one or more section dicts.

    Note: Per design doc, one lens = exactly one video or article.
    We take the first section and raise if there are multiple.

    Returns dicts with standard section format (type: "article" or "video")
    plus additional fields: contentId, learningOutcomeId.
    """
    if len(lens.sections) == 0:
        raise ValueError(f"Lens {lens.content_id} has no sections")
    if len(lens.sections) > 1:
        raise ValueError(
            f"Lens {lens.content_id} has multiple sections (expected exactly 1)"
        )

    section = lens.sections[0]
    content_id = str(lens.content_id) if lens.content_id else None
    lo_id = str(learning_outcome_id) if learning_outcome_id else None

    if isinstance(section, LensVideoSection):
        # Get video content from lookup and pass to bundling
        video_content = lookup.get_video_for_bundling(section.source)
        bundled = bundle_video_section(section, video_content=video_content)
        bundled["contentId"] = content_id
        bundled["learningOutcomeId"] = lo_id
        bundled["optional"] = optional
        return [bundled]

    elif isinstance(section, LensArticleSection):
        # Get article content from lookup and pass to bundling
        article_content = lookup.get_article_for_bundling(section.source)
        bundled = bundle_article_section(section, article_content=article_content)
        bundled["contentId"] = content_id
        bundled["learningOutcomeId"] = lo_id
        bundled["optional"] = optional
        return [bundled]

    return []


def _flatten_learning_outcome(
    lo_ref: LearningOutcomeRef,
    lookup: ContentLookup,
) -> list[dict]:
    """Flatten a learning outcome reference into flat sections."""
    _, lo_key = resolve_wiki_link(lo_ref.source)
    lo = lookup.get_learning_outcome(lo_key)

    sections = []
    for lens_ref in lo.lenses:
        _, lens_key = resolve_wiki_link(lens_ref.source)
        lens = lookup.get_lens(lens_key)
        sections.extend(
            _flatten_lens(
                lens,
                learning_outcome_id=lo.content_id,
                optional=lens_ref.optional or lo_ref.optional,
                lookup=lookup,
            )
        )

    return sections


def _flatten_uncategorized(
    uncategorized: UncategorizedSection,
    lookup: ContentLookup,
) -> list[dict]:
    """Flatten an uncategorized section into flat sections."""
    sections = []
    for lens_ref in uncategorized.lenses:
        _, lens_key = resolve_wiki_link(lens_ref.source)
        lens = lookup.get_lens(lens_key)
        sections.extend(
            _flatten_lens(
                lens,
                learning_outcome_id=None,  # Uncategorized has no LO
                optional=lens_ref.optional,
                lookup=lookup,
            )
        )

    return sections


def _serialize_segment(segment: TextSegment | ChatSegment) -> dict:
    """Serialize a page segment to a dict."""
    if isinstance(segment, TextSegment):
        return {"type": "text", "content": segment.content}
    elif isinstance(segment, ChatSegment):
        return {
            "type": "chat",
            "instructions": segment.instructions,
            "hidePreviousContentFromUser": segment.hide_previous_content_from_user,
            "hidePreviousContentFromTutor": segment.hide_previous_content_from_tutor,
        }
    return {}


def _flatten_page(page: PageSection) -> dict:
    """Convert a PageSection to a dict."""
    segments = [_serialize_segment(s) for s in page.segments]
    return {
        "type": "page",
        "contentId": str(page.content_id) if page.content_id else None,
        "title": page.title,
        "segments": segments,
    }


def flatten_module(module: ParsedModule, lookup: ContentLookup) -> FlattenedModule:
    """Flatten a parsed module by resolving all references.

    Args:
        module: The parsed module with LearningOutcomeRef and UncategorizedSection
        lookup: Interface for looking up referenced content

    Returns:
        FlattenedModule with all sections resolved to page/video/article dicts

    Raises:
        KeyError: If any referenced content is not found (fail fast)
        ValueError: If a lens has zero or multiple sections
    """
    flat_sections: list[dict] = []

    for section in module.sections:
        if isinstance(section, PageSection):
            flat_sections.append(_flatten_page(section))

        elif isinstance(section, LearningOutcomeRef):
            flat_sections.extend(_flatten_learning_outcome(section, lookup))

        elif isinstance(section, UncategorizedSection):
            flat_sections.extend(_flatten_uncategorized(section, lookup))

        # Skip other section types (Text, Article, Video, Chat - v1 types not supported)

    return FlattenedModule(
        slug=module.slug,
        title=module.title,
        content_id=module.content_id,
        sections=flat_sections,
    )
