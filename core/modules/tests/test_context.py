# core/modules/tests/test_context.py
"""Tests for context gathering from module sections."""

from core.modules.context import gather_section_context


class TestGatherSectionContext:
    """Tests for gather_section_context()."""

    def test_gathers_video_transcript(self):
        """Should include video-excerpt transcript in context."""
        section = {
            "type": "video",
            "segments": [
                {"type": "video-excerpt", "transcript": "Hello world from video"},
                {
                    "type": "chat",
                    "instructions": "Discuss",
                    "hidePreviousContentFromTutor": False,
                },
            ],
        }

        context = gather_section_context(section, segment_index=1)

        assert context is not None
        assert "Hello world from video" in context
        assert "[Video transcript]" in context

    def test_gathers_article_content(self):
        """Should include article-excerpt content in context."""
        section = {
            "type": "article",
            "segments": [
                {"type": "article-excerpt", "content": "Article content here"},
                {
                    "type": "chat",
                    "instructions": "Discuss",
                    "hidePreviousContentFromTutor": False,
                },
            ],
        }

        context = gather_section_context(section, segment_index=1)

        assert context is not None
        assert "Article content here" in context

    def test_gathers_text_content(self):
        """Should include text segment content in context."""
        section = {
            "type": "article",
            "segments": [
                {"type": "text", "content": "Some authored text"},
                {
                    "type": "chat",
                    "instructions": "Discuss",
                    "hidePreviousContentFromTutor": False,
                },
            ],
        }

        context = gather_section_context(section, segment_index=1)

        assert context is not None
        assert "Some authored text" in context

    def test_respects_hide_from_tutor_flag(self):
        """Should return None when hidePreviousContentFromTutor is True."""
        section = {
            "type": "video",
            "segments": [
                {"type": "video-excerpt", "transcript": "Secret content"},
                {
                    "type": "chat",
                    "instructions": "Discuss",
                    "hidePreviousContentFromTutor": True,
                },
            ],
        }

        context = gather_section_context(section, segment_index=1)

        assert context is None

    def test_multiple_preceding_segments(self):
        """Should gather all preceding segments separated by dividers."""
        section = {
            "type": "article",
            "segments": [
                {"type": "text", "content": "First text"},
                {"type": "article-excerpt", "content": "Article bit"},
                {"type": "text", "content": "Second text"},
                {
                    "type": "chat",
                    "instructions": "Discuss",
                    "hidePreviousContentFromTutor": False,
                },
            ],
        }

        context = gather_section_context(section, segment_index=3)

        assert context is not None
        assert "First text" in context
        assert "Article bit" in context
        assert "Second text" in context
        assert "---" in context  # Divider between segments

    def test_skips_chat_segments_in_context(self):
        """Should not include previous chat segments in content context."""
        section = {
            "type": "article",
            "segments": [
                {"type": "text", "content": "Intro text"},
                {"type": "chat", "instructions": "First discussion"},
                {"type": "text", "content": "More text"},
                {
                    "type": "chat",
                    "instructions": "Second discussion",
                    "hidePreviousContentFromTutor": False,
                },
            ],
        }

        context = gather_section_context(section, segment_index=3)

        assert context is not None
        assert "Intro text" in context
        assert "More text" in context
        assert "First discussion" not in context

    def test_empty_preceding_returns_none(self):
        """Should return None when there are no preceding content segments."""
        section = {
            "type": "page",
            "segments": [
                {
                    "type": "chat",
                    "instructions": "Start chatting",
                    "hidePreviousContentFromTutor": False,
                },
            ],
        }

        context = gather_section_context(section, segment_index=0)

        assert context is None

    def test_segment_index_out_of_bounds(self):
        """Should handle segment_index gracefully when out of bounds."""
        section = {
            "type": "article",
            "segments": [
                {"type": "text", "content": "Only segment"},
            ],
        }

        # Index 5 is out of bounds
        context = gather_section_context(section, segment_index=5)

        assert context is None

    def test_skips_empty_transcripts(self):
        """Should skip video-excerpt segments with empty transcripts."""
        section = {
            "type": "video",
            "segments": [
                {"type": "video-excerpt", "transcript": ""},
                {"type": "video-excerpt", "transcript": "Actual content"},
                {
                    "type": "chat",
                    "instructions": "Discuss",
                    "hidePreviousContentFromTutor": False,
                },
            ],
        }

        context = gather_section_context(section, segment_index=2)

        assert context is not None
        assert "Actual content" in context
        # Empty transcript should not add extra dividers
        assert (
            context.count("---") == 0
        )  # Only one segment with content, no dividers needed
