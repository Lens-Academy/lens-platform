# core/modules/tests/test_context.py
"""Tests for context gathering from module sections."""

from core.modules.context import gather_section_context


class TestGatherSectionContext:
    """Tests for gather_section_context()."""

    def test_gathers_video_transcript(self):
        """Should include video-excerpt transcript in segments."""
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
        contents = [c for _, c in ctx.segments]
        assert any("Hello world from video" in c for c in contents)
        assert any("[Video transcript]" in c for c in contents)

    def test_gathers_article_content(self):
        """Should include article-excerpt content in segments."""
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
        contents = [c for _, c in ctx.segments]
        assert any("Article content here" in c for c in contents)

    def test_gathers_text_content(self):
        """Should include text segment content in segments."""
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
        contents = [c for _, c in ctx.segments]
        assert any("Some authored text" in c for c in contents)

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

    def test_all_segments_included(self):
        """Should gather ALL segments in the section, not just preceding ones."""
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

        ctx = gather_section_context(section, segment_index=1)

        assert ctx is not None
        contents = [c for _, c in ctx.segments]
        assert any("First text" in c for c in contents)
        assert any("Article bit" in c for c in contents)
        assert any("Second text" in c for c in contents)
        assert any("[Chat discussion]" in c for c in contents)

    def test_chat_segments_labeled(self):
        """Chat segments should appear as [Chat discussion]."""
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
        contents = [c for _, c in ctx.segments]
        assert contents.count("[Chat discussion]") == 2
        assert "First discussion" not in str(contents)

    def test_only_chat_segment_returns_context(self):
        """A single chat segment should still return context (with the label)."""
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

        assert ctx is not None
        assert ctx.segments == [(0, "[Chat discussion]")]

    def test_segment_index_out_of_bounds(self):
        """Should handle segment_index gracefully when out of bounds."""
        section = {
            "type": "article",
            "segments": [
                {"type": "text", "content": "Only segment"},
            ],
        }

        ctx = gather_section_context(section, segment_index=5)

        assert ctx is None

    def test_segment_index_and_total_segments(self):
        """Should track segment_index and total_segments correctly."""
        section = {
            "type": "article",
            "segments": [
                {"type": "text", "content": "Intro text"},
                {"type": "article-excerpt", "content": "The actual article"},
                {"type": "chat", "instructions": "Discuss"},
            ],
        }

        ctx = gather_section_context(section, segment_index=1)

        assert ctx is not None
        assert ctx.segment_index == 1
        assert ctx.total_segments == 3

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
        # Empty transcript segment should be skipped
        indices = [i for i, _ in ctx.segments]
        assert 0 not in indices  # empty transcript skipped
        assert 1 in indices  # real content included

    def test_preserves_original_indices(self):
        """Segment numbering should match original indices."""
        section = {
            "type": "article",
            "segments": [
                {"type": "text", "content": "Already read this"},
                {"type": "article-excerpt", "content": "Reading this now"},
            ],
        }

        ctx = gather_section_context(section, segment_index=1)

        assert ctx is not None
        indices = [i for i, _ in ctx.segments]
        assert indices == [0, 1]

    def test_article_excerpt_includes_title_and_author(self):
        """Article excerpts should be prefixed with title and author from section meta."""
        section = {
            "type": "lens-article",
            "meta": {
                "title": "AI for AI safety",
                "author": "Joe Carlsmith",
            },
            "segments": [
                {"type": "text", "content": "Lens intro"},
                {"type": "article-excerpt", "content": "The actual article text"},
                {"type": "chat", "instructions": "Discuss"},
            ],
        }

        ctx = gather_section_context(section, segment_index=2)

        assert ctx is not None
        contents = [c for _, c in ctx.segments]
        assert any("[Written by Lens Academy]" in c for c in contents)
        assert any('From "AI for AI safety", by Joe Carlsmith' in c for c in contents)
        assert any("The actual article text" in c for c in contents)

    def test_article_excerpt_no_meta(self):
        """Article excerpts without section meta should have no attribution prefix."""
        section = {
            "type": "article",
            "segments": [
                {"type": "article-excerpt", "content": "Some text"},
                {"type": "chat", "instructions": "Discuss"},
            ],
        }

        ctx = gather_section_context(section, segment_index=1)

        assert ctx is not None
        contents = [c for _, c in ctx.segments]
        assert any(c == "Some text" for c in contents)
        assert not any("[From" in c for c in contents)

    def test_question_segment_labeled(self):
        """Question segments should appear as [Question]."""
        section = {
            "type": "article",
            "segments": [
                {"type": "text", "content": "Read this"},
                {"type": "question", "content": "What is AI safety?"},
                {"type": "chat", "instructions": "Discuss"},
            ],
        }

        ctx = gather_section_context(section, segment_index=2)

        assert ctx is not None
        contents = [c for _, c in ctx.segments]
        assert "[Question]" in contents
