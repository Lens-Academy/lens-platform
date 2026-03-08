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

        ctx = gather_section_context(section, segment_index=1)

        assert ctx is not None
        assert "Hello world from video" in (ctx.previous or "")
        assert "[Video transcript]" in (ctx.previous or "")

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

        ctx = gather_section_context(section, segment_index=1)

        assert ctx is not None
        assert "Article content here" in (ctx.previous or "")

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

        ctx = gather_section_context(section, segment_index=1)

        assert ctx is not None
        assert "Some authored text" in (ctx.previous or "")

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

        ctx = gather_section_context(section, segment_index=1)

        assert ctx is None

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

        ctx = gather_section_context(section, segment_index=3)

        assert ctx is not None
        assert "First text" in (ctx.previous or "")
        assert "Article bit" in (ctx.previous or "")
        assert "Second text" in (ctx.previous or "")
        assert "---" in (ctx.previous or "")  # Divider between segments

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

        ctx = gather_section_context(section, segment_index=3)

        assert ctx is not None
        prev = ctx.previous or ""
        assert "Intro text" in prev
        assert "More text" in prev
        assert "First discussion" not in prev

    def test_empty_preceding_returns_none(self):
        """Should return None when there are no content segments."""
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

        ctx = gather_section_context(section, segment_index=0)

        assert ctx is None

    def test_segment_index_out_of_bounds(self):
        """Should handle segment_index gracefully when out of bounds."""
        section = {
            "type": "article",
            "segments": [
                {"type": "text", "content": "Only segment"},
            ],
        }

        # Index 5 is out of bounds
        ctx = gather_section_context(section, segment_index=5)

        assert ctx is None

    def test_includes_current_content_segment(self):
        """Should include the current segment's content when index points to a content segment (sidebar case)."""
        section = {
            "type": "article",
            "segments": [
                {"type": "text", "content": "Intro text"},
                {"type": "article-excerpt", "content": "The actual article"},
                {"type": "chat", "instructions": "Discuss"},
            ],
        }

        # Sidebar sends segmentIndex=1 (the article-excerpt)
        ctx = gather_section_context(section, segment_index=1)

        assert ctx is not None
        assert ctx.previous == "Intro text"
        assert ctx.current == "The actual article"

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

        ctx = gather_section_context(section, segment_index=2)

        assert ctx is not None
        prev = ctx.previous or ""
        assert "Actual content" in prev
        # Empty transcript should not add extra dividers
        assert prev.count("---") == 0  # Only one segment with content

    def test_separates_previous_and_current(self):
        """Should put preceding content in .previous and current segment in .current."""
        section = {
            "type": "article",
            "segments": [
                {"type": "text", "content": "Already read this"},
                {"type": "article-excerpt", "content": "Reading this now"},
            ],
        }

        ctx = gather_section_context(section, segment_index=1)

        assert ctx is not None
        assert ctx.previous == "Already read this"
        assert ctx.current == "Reading this now"

    def test_current_only_no_previous(self):
        """When first segment is content and user is on it, only .current is set."""
        section = {
            "type": "article",
            "segments": [
                {"type": "article-excerpt", "content": "First thing user sees"},
                {"type": "chat", "instructions": "Discuss"},
            ],
        }

        ctx = gather_section_context(section, segment_index=0)

        assert ctx is not None
        assert ctx.previous is None
        assert ctx.current == "First thing user sees"

    def test_chat_segment_has_no_current_content(self):
        """When on a chat segment, .current should be None."""
        section = {
            "type": "article",
            "segments": [
                {"type": "text", "content": "Some text"},
                {"type": "chat", "instructions": "Discuss"},
            ],
        }

        ctx = gather_section_context(section, segment_index=1)

        assert ctx is not None
        assert ctx.previous == "Some text"
        assert ctx.current is None
