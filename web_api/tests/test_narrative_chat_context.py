"""Tests for get_narrative_chat_context function."""

from dataclasses import dataclass
from unittest.mock import patch, MagicMock

# IMPORTANT: Use markdown_parser types for narrative modules, not core.modules.types
from core.modules.markdown_parser import (
    ArticleSection,
    VideoSection,
    TextSegment,
    ArticleExcerptSegment,
    VideoExcerptSegment,
    ChatSegment,
)


class TestGetNarrativeChatContext:
    """Tests for get_narrative_chat_context accumulation logic."""

    def test_text_segment_included_in_context(self):
        """TextSegment content should be included in LLM context."""
        from web_api.routes.modules import get_narrative_chat_context

        # Create a mock module with text -> chat structure
        @dataclass
        class MockModule:
            sections: list

        section = ArticleSection(
            type="article",
            source="articles/test.md",
            segments=[
                TextSegment(type="text", content="This is important context."),
                ChatSegment(
                    type="chat",
                    instructions="Discuss the text.",
                    hide_previous_content_from_user=False,
                    hide_previous_content_from_tutor=False,
                ),
            ],
        )
        module = MockModule(sections=[section])

        instructions, previous_content = get_narrative_chat_context(
            module, section_index=0, segment_index=1
        )

        assert instructions == "Discuss the text."
        assert previous_content is not None
        assert "This is important context." in previous_content

    def test_multiple_segments_accumulated_in_order(self):
        """Multiple segments should be accumulated earliest-to-latest."""
        from web_api.routes.modules import get_narrative_chat_context

        @dataclass
        class MockModule:
            sections: list

        section = ArticleSection(
            type="article",
            source="articles/test.md",
            segments=[
                TextSegment(type="text", content="First segment."),
                TextSegment(type="text", content="Second segment."),
                TextSegment(type="text", content="Third segment."),
                ChatSegment(
                    type="chat",
                    instructions="Discuss all.",
                    hide_previous_content_from_user=False,
                    hide_previous_content_from_tutor=False,
                ),
            ],
        )
        module = MockModule(sections=[section])

        instructions, previous_content = get_narrative_chat_context(
            module, section_index=0, segment_index=3
        )

        assert previous_content is not None
        # Check order: first should appear before second, second before third
        first_pos = previous_content.find("First segment.")
        second_pos = previous_content.find("Second segment.")
        third_pos = previous_content.find("Third segment.")
        assert first_pos < second_pos < third_pos

    def test_last_segment_marked_specially(self):
        """The last segment should be marked as 'read last'."""
        from web_api.routes.modules import get_narrative_chat_context

        @dataclass
        class MockModule:
            sections: list

        section = ArticleSection(
            type="article",
            source="articles/test.md",
            segments=[
                TextSegment(type="text", content="Earlier content."),
                TextSegment(type="text", content="Most recent content."),
                ChatSegment(
                    type="chat",
                    instructions="Discuss.",
                    hide_previous_content_from_user=False,
                    hide_previous_content_from_tutor=False,
                ),
            ],
        )
        module = MockModule(sections=[section])

        instructions, previous_content = get_narrative_chat_context(
            module, section_index=0, segment_index=2
        )

        assert previous_content is not None
        # Last segment should have special marker
        assert (
            "read last" in previous_content.lower()
            or "most recent" in previous_content.lower()
        )

    def test_video_excerpt_includes_metadata(self):
        """Video excerpts should include title and timestamp range."""
        from web_api.routes.modules import get_narrative_chat_context

        @dataclass
        class MockModule:
            sections: list

        # Note: VideoExcerptSegment uses from_time/to_time STRINGS, not integers
        section = VideoSection(
            type="video",
            source="video_transcripts/test.md",
            segments=[
                VideoExcerptSegment(
                    type="video-excerpt", from_time="1:00", to_time="2:00"
                ),
                ChatSegment(
                    type="chat",
                    instructions="Discuss the video.",
                    hide_previous_content_from_user=False,
                    hide_previous_content_from_tutor=False,
                ),
            ],
        )
        module = MockModule(sections=[section])

        # Mock the content loading - use the actual import paths
        with patch(
            "core.modules.content.load_video_transcript_with_metadata"
        ) as mock_video:
            with patch("core.transcripts.get_text_at_time") as mock_transcript:
                mock_video.return_value = MagicMock(
                    metadata=MagicMock(video_id="abc123", title="Test Video")
                )
                mock_transcript.return_value = "This is the transcript text."

                instructions, previous_content = get_narrative_chat_context(
                    module, section_index=0, segment_index=1
                )

        assert previous_content is not None
        assert "Test Video" in previous_content
        assert "1:00" in previous_content  # from_time="1:00"
        assert "2:00" in previous_content  # to_time="2:00"
        assert "This is the transcript text." in previous_content

    def test_article_excerpt_included(self):
        """Article excerpts should be included in context."""
        from web_api.routes.modules import get_narrative_chat_context

        @dataclass
        class MockModule:
            sections: list

        section = ArticleSection(
            type="article",
            source="articles/test.md",
            segments=[
                ArticleExcerptSegment(
                    type="article-excerpt",
                    from_text="Start here",
                    to_text="End here",
                ),
                ChatSegment(
                    type="chat",
                    instructions="Discuss the article.",
                    hide_previous_content_from_user=False,
                    hide_previous_content_from_tutor=False,
                ),
            ],
        )
        module = MockModule(sections=[section])

        # Mock the content loading - use the actual import path
        with patch("core.modules.content.load_article_with_metadata") as mock_article:
            mock_article.return_value = MagicMock(
                content="This is the article excerpt content."
            )

            instructions, previous_content = get_narrative_chat_context(
                module, section_index=0, segment_index=1
            )

        assert previous_content is not None
        assert "This is the article excerpt content." in previous_content

    def test_mixed_segments_all_included(self):
        """Mixed segment types should all be included."""
        from web_api.routes.modules import get_narrative_chat_context

        @dataclass
        class MockModule:
            sections: list

        section = ArticleSection(
            type="article",
            source="articles/test.md",
            segments=[
                TextSegment(type="text", content="Intro text."),
                ArticleExcerptSegment(
                    type="article-excerpt",
                    from_text="A",
                    to_text="B",
                ),
                TextSegment(type="text", content="Commentary."),
                ChatSegment(
                    type="chat",
                    instructions="Discuss.",
                    hide_previous_content_from_user=False,
                    hide_previous_content_from_tutor=False,
                ),
            ],
        )
        module = MockModule(sections=[section])

        with patch("core.modules.content.load_article_with_metadata") as mock_article:
            mock_article.return_value = MagicMock(content="Article content.")

            instructions, previous_content = get_narrative_chat_context(
                module, section_index=0, segment_index=3
            )

        assert previous_content is not None
        assert "Intro text." in previous_content
        assert "Article content." in previous_content
        assert "Commentary." in previous_content
        # Verify order
        intro_pos = previous_content.find("Intro text.")
        article_pos = previous_content.find("Article content.")
        commentary_pos = previous_content.find("Commentary.")
        assert intro_pos < article_pos < commentary_pos

    def test_video_section_mixed_segments(self):
        """VideoSection with text + video-excerpt should include both."""
        from web_api.routes.modules import get_narrative_chat_context

        @dataclass
        class MockModule:
            sections: list

        section = VideoSection(
            type="video",
            source="video_transcripts/test.md",
            segments=[
                TextSegment(type="text", content="Watch this important clip."),
                VideoExcerptSegment(
                    type="video-excerpt", from_time="0:00", to_time="1:30"
                ),
                TextSegment(type="text", content="Now consider what you saw."),
                ChatSegment(
                    type="chat",
                    instructions="Discuss the video.",
                    hide_previous_content_from_user=False,
                    hide_previous_content_from_tutor=False,
                ),
            ],
        )
        module = MockModule(sections=[section])

        with patch(
            "core.modules.content.load_video_transcript_with_metadata"
        ) as mock_video:
            with patch("core.transcripts.get_text_at_time") as mock_transcript:
                mock_video.return_value = MagicMock(
                    metadata=MagicMock(video_id="xyz789", title="Important Video")
                )
                mock_transcript.return_value = "Speaker talks about AI safety."

                instructions, previous_content = get_narrative_chat_context(
                    module, section_index=0, segment_index=3
                )

        assert previous_content is not None
        assert "Watch this important clip." in previous_content
        assert "Important Video" in previous_content
        assert "Speaker talks about AI safety." in previous_content
        assert "Now consider what you saw." in previous_content
        # Verify order
        intro_pos = previous_content.find("Watch this important clip.")
        video_pos = previous_content.find("Speaker talks about AI safety.")
        reflection_pos = previous_content.find("Now consider what you saw.")
        assert intro_pos < video_pos < reflection_pos

    def test_hide_previous_content_from_tutor_true_returns_none(self):
        """When hidePreviousContentFromTutor is true, previous_content should be None."""
        from web_api.routes.modules import get_narrative_chat_context

        @dataclass
        class MockModule:
            sections: list

        section = ArticleSection(
            type="article",
            source="articles/test.md",
            segments=[
                TextSegment(type="text", content="This should NOT be included."),
                ChatSegment(
                    type="chat",
                    instructions="Discuss.",
                    hide_previous_content_from_user=False,
                    hide_previous_content_from_tutor=True,  # Hidden!
                ),
            ],
        )
        module = MockModule(sections=[section])

        instructions, previous_content = get_narrative_chat_context(
            module, section_index=0, segment_index=1
        )

        assert instructions == "Discuss."
        assert previous_content is None

    def test_chat_at_index_zero_returns_none(self):
        """Chat at segment index 0 has no previous content."""
        from web_api.routes.modules import get_narrative_chat_context

        @dataclass
        class MockModule:
            sections: list

        section = ArticleSection(
            type="article",
            source="articles/test.md",
            segments=[
                ChatSegment(
                    type="chat",
                    instructions="First segment is chat.",
                    hide_previous_content_from_user=False,
                    hide_previous_content_from_tutor=False,
                ),
            ],
        )
        module = MockModule(sections=[section])

        instructions, previous_content = get_narrative_chat_context(
            module, section_index=0, segment_index=0
        )

        assert instructions == "First segment is chat."
        assert previous_content is None

    def test_content_load_failure_skips_segment(self):
        """When content loading fails, that segment is skipped but others included."""
        from web_api.routes.modules import get_narrative_chat_context

        @dataclass
        class MockModule:
            sections: list

        section = ArticleSection(
            type="article",
            source="articles/test.md",
            segments=[
                TextSegment(type="text", content="First text."),
                ArticleExcerptSegment(
                    type="article-excerpt",
                    from_text="A",
                    to_text="B",
                ),
                TextSegment(type="text", content="Last text."),
                ChatSegment(
                    type="chat",
                    instructions="Discuss.",
                    hide_previous_content_from_user=False,
                    hide_previous_content_from_tutor=False,
                ),
            ],
        )
        module = MockModule(sections=[section])

        # Make article loading fail
        with patch("core.modules.content.load_article_with_metadata") as mock_article:
            mock_article.side_effect = FileNotFoundError("Article not found")

            instructions, previous_content = get_narrative_chat_context(
                module, section_index=0, segment_index=3
            )

        assert previous_content is not None
        # Text segments should still be included
        assert "First text." in previous_content
        assert "Last text." in previous_content
