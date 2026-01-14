# core/lessons/tests/test_content_references.py
"""Tests that verify all content referenced in lessons actually exists.

These tests catch broken references early - before users encounter missing content.
"""

import pytest
from pathlib import Path

from core.lessons.loader import get_available_lessons, load_lesson, LESSONS_DIR
from core.lessons.content import CONTENT_DIR
from core.lessons.types import ArticleStage, VideoStage


def get_all_stages():
    """Get all stages from all lessons with their lesson context."""
    stages = []
    for lesson_slug in get_available_lessons():
        lesson = load_lesson(lesson_slug)
        for i, stage in enumerate(lesson.stages):
            stages.append((lesson_slug, i, stage))
    return stages


def get_article_stages():
    """Get all article stages from all lessons."""
    return [
        (lesson_slug, stage_idx, stage)
        for lesson_slug, stage_idx, stage in get_all_stages()
        if isinstance(stage, ArticleStage)
    ]


def get_video_stages():
    """Get all video stages from all lessons."""
    return [
        (lesson_slug, stage_idx, stage)
        for lesson_slug, stage_idx, stage in get_all_stages()
        if isinstance(stage, VideoStage)
    ]


class TestArticleReferences:
    """Tests for article content references."""

    @pytest.mark.parametrize(
        "lesson_slug,stage_idx,stage",
        get_article_stages(),
        ids=lambda x: f"{x[0]}:stage{x[1]}" if isinstance(x, tuple) else str(x),
    )
    def test_article_file_exists(self, lesson_slug, stage_idx, stage):
        """Every article source in a lesson should point to an existing file."""
        article_path = CONTENT_DIR / stage.source

        assert article_path.exists(), (
            f"Lesson '{lesson_slug}' stage {stage_idx} references missing article: "
            f"'{stage.source}'\n"
            f"Expected file at: {article_path}"
        )

    @pytest.mark.parametrize(
        "lesson_slug,stage_idx,stage",
        get_article_stages(),
        ids=lambda x: f"{x[0]}:stage{x[1]}" if isinstance(x, tuple) else str(x),
    )
    def test_article_from_anchor_exists(self, lesson_slug, stage_idx, stage):
        """If an article has a 'from' anchor, that text should exist in the file."""
        if stage.from_text is None:
            pytest.skip("No 'from' anchor specified")

        article_path = CONTENT_DIR / stage.source
        if not article_path.exists():
            pytest.skip("Article file doesn't exist (caught by other test)")

        content = article_path.read_text()

        assert stage.from_text in content, (
            f"Lesson '{lesson_slug}' stage {stage_idx}: "
            f"'from' anchor text not found in article '{stage.source}'\n"
            f"Looking for: \"{stage.from_text[:80]}...\"\n"
            f"This anchor text doesn't appear in the article content."
        )

    @pytest.mark.parametrize(
        "lesson_slug,stage_idx,stage",
        get_article_stages(),
        ids=lambda x: f"{x[0]}:stage{x[1]}" if isinstance(x, tuple) else str(x),
    )
    def test_article_to_anchor_exists(self, lesson_slug, stage_idx, stage):
        """If an article has a 'to' anchor, that text should exist in the file."""
        if stage.to_text is None:
            pytest.skip("No 'to' anchor specified")

        article_path = CONTENT_DIR / stage.source
        if not article_path.exists():
            pytest.skip("Article file doesn't exist (caught by other test)")

        content = article_path.read_text()

        assert stage.to_text in content, (
            f"Lesson '{lesson_slug}' stage {stage_idx}: "
            f"'to' anchor text not found in article '{stage.source}'\n"
            f"Looking for: \"{stage.to_text[:80]}...\"\n"
            f"This anchor text doesn't appear in the article content."
        )

    @pytest.mark.parametrize(
        "lesson_slug,stage_idx,stage",
        get_article_stages(),
        ids=lambda x: f"{x[0]}:stage{x[1]}" if isinstance(x, tuple) else str(x),
    )
    def test_article_anchor_order(self, lesson_slug, stage_idx, stage):
        """The 'from' anchor should appear before the 'to' anchor."""
        if stage.from_text is None or stage.to_text is None:
            pytest.skip("Both anchors needed for order test")

        article_path = CONTENT_DIR / stage.source
        if not article_path.exists():
            pytest.skip("Article file doesn't exist (caught by other test)")

        content = article_path.read_text()

        from_idx = content.find(stage.from_text)
        to_idx = content.find(stage.to_text)

        if from_idx == -1 or to_idx == -1:
            pytest.skip("Anchors don't exist (caught by other tests)")

        assert from_idx < to_idx, (
            f"Lesson '{lesson_slug}' stage {stage_idx}: "
            f"'from' anchor appears AFTER 'to' anchor in '{stage.source}'\n"
            f"'from' at position {from_idx}, 'to' at position {to_idx}"
        )


class TestVideoReferences:
    """Tests for video transcript references."""

    @pytest.mark.parametrize(
        "lesson_slug,stage_idx,stage",
        get_video_stages(),
        ids=lambda x: f"{x[0]}:stage{x[1]}" if isinstance(x, tuple) else str(x),
    )
    def test_video_transcript_file_exists(self, lesson_slug, stage_idx, stage):
        """Every video source in a lesson should point to an existing transcript."""
        transcript_path = CONTENT_DIR / stage.source

        assert transcript_path.exists(), (
            f"Lesson '{lesson_slug}' stage {stage_idx} references missing transcript: "
            f"'{stage.source}'\n"
            f"Expected file at: {transcript_path}"
        )

    @pytest.mark.parametrize(
        "lesson_slug,stage_idx,stage",
        get_video_stages(),
        ids=lambda x: f"{x[0]}:stage{x[1]}" if isinstance(x, tuple) else str(x),
    )
    def test_video_timestamps_file_exists(self, lesson_slug, stage_idx, stage):
        """Every video transcript should have a corresponding timestamps JSON file."""
        transcript_path = CONTENT_DIR / stage.source
        if not transcript_path.exists():
            pytest.skip("Transcript file doesn't exist (caught by other test)")

        timestamps_path = transcript_path.with_suffix(".timestamps.json")

        assert timestamps_path.exists(), (
            f"Lesson '{lesson_slug}' stage {stage_idx}: "
            f"Missing timestamps file for '{stage.source}'\n"
            f"Expected: {timestamps_path.name}"
        )

    @pytest.mark.parametrize(
        "lesson_slug,stage_idx,stage",
        get_video_stages(),
        ids=lambda x: f"{x[0]}:stage{x[1]}" if isinstance(x, tuple) else str(x),
    )
    def test_video_time_range_valid(self, lesson_slug, stage_idx, stage):
        """Video from_seconds should be less than to_seconds when both are set."""
        if stage.to_seconds is None:
            pytest.skip("No end time specified")

        assert stage.from_seconds < stage.to_seconds, (
            f"Lesson '{lesson_slug}' stage {stage_idx}: "
            f"Invalid time range: from={stage.from_seconds}s, to={stage.to_seconds}s\n"
            f"Start time must be before end time."
        )


class TestContentDirectoryStructure:
    """Tests for overall content directory structure."""

    def test_articles_directory_exists(self):
        """Articles directory should exist."""
        articles_dir = CONTENT_DIR / "articles"
        assert articles_dir.exists(), f"Articles directory not found: {articles_dir}"

    def test_video_transcripts_directory_exists(self):
        """Video transcripts directory should exist."""
        transcripts_dir = CONTENT_DIR / "video_transcripts"
        assert transcripts_dir.exists(), (
            f"Video transcripts directory not found: {transcripts_dir}"
        )

    def test_lessons_directory_exists(self):
        """Lessons directory should exist."""
        assert LESSONS_DIR.exists(), f"Lessons directory not found: {LESSONS_DIR}"

    def test_at_least_one_lesson_exists(self):
        """Should have at least one lesson defined."""
        lessons = get_available_lessons()
        assert len(lessons) > 0, "No lessons found in lessons directory"

    def test_at_least_one_article_exists(self):
        """Should have at least one article file."""
        articles_dir = CONTENT_DIR / "articles"
        articles = list(articles_dir.glob("*.md")) if articles_dir.exists() else []
        assert len(articles) > 0, "No article files found"

    def test_at_least_one_transcript_exists(self):
        """Should have at least one video transcript file."""
        transcripts_dir = CONTENT_DIR / "video_transcripts"
        transcripts = (
            list(transcripts_dir.glob("*.md")) if transcripts_dir.exists() else []
        )
        assert len(transcripts) > 0, "No video transcript files found"


class TestUnusedContent:
    """Tests to identify potentially unused content files."""

    def test_report_unreferenced_articles(self):
        """Report articles that exist but aren't referenced by any lesson.

        This is a warning, not a failure - unused articles might be intentional.
        """
        articles_dir = CONTENT_DIR / "articles"
        if not articles_dir.exists():
            pytest.skip("Articles directory doesn't exist")

        # Get all article files
        all_articles = {f.name for f in articles_dir.glob("*.md")}

        # Get all referenced articles
        referenced_articles = set()
        for _, _, stage in get_article_stages():
            # Extract filename from source path like "articles/foo.md"
            if stage.source.startswith("articles/"):
                referenced_articles.add(stage.source.replace("articles/", ""))

        unreferenced = all_articles - referenced_articles

        if unreferenced:
            # Just report, don't fail - unreferenced articles might be intentional
            print(f"\nNote: {len(unreferenced)} article(s) not referenced by any lesson:")
            for article in sorted(unreferenced):
                print(f"  - {article}")

    def test_report_unreferenced_transcripts(self):
        """Report video transcripts that exist but aren't referenced by any lesson.

        This is a warning, not a failure - unused transcripts might be intentional.
        """
        transcripts_dir = CONTENT_DIR / "video_transcripts"
        if not transcripts_dir.exists():
            pytest.skip("Video transcripts directory doesn't exist")

        # Get all transcript files
        all_transcripts = {f.name for f in transcripts_dir.glob("*.md")}

        # Get all referenced transcripts
        referenced_transcripts = set()
        for _, _, stage in get_video_stages():
            # Extract filename from source path like "video_transcripts/foo.md"
            if stage.source.startswith("video_transcripts/"):
                referenced_transcripts.add(
                    stage.source.replace("video_transcripts/", "")
                )

        unreferenced = all_transcripts - referenced_transcripts

        if unreferenced:
            # Just report, don't fail - unreferenced transcripts might be intentional
            print(
                f"\nNote: {len(unreferenced)} transcript(s) not referenced by any lesson:"
            )
            for transcript in sorted(unreferenced):
                print(f"  - {transcript}")
