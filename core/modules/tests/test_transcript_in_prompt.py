# core/modules/tests/test_transcript_in_prompt.py
"""
End-to-end test verifying video transcripts reach the AI tutor prompt.

This traces the full path:
1. Cache has video_timestamps populated
2. TypeScript processor extracts transcript using timestamp data
3. gather_section_context() includes transcript in context
4. _build_system_prompt() includes context in prompt

NOTE: bundle_video_section() was removed - content bundling is now handled
by the TypeScript processor. Tests for that function have been removed.
"""

from datetime import datetime

import pytest

from core.content.cache import ContentCache, set_cache, clear_cache, get_cache
from core.modules.context import gather_section_context, SectionContext
from core.modules.chat import _build_system_prompt
from core.modules.types import ChatStage
from core.modules.prompts import build_content_context_message
from core.transcripts.tools import get_text_at_time


# Sample timestamp data (word-level)
SAMPLE_TIMESTAMPS = [
    {"text": "Hello", "start": 0.0},
    {"text": "this", "start": 0.5},
    {"text": "is", "start": 1.0},
    {"text": "a", "start": 1.5},
    {"text": "test", "start": 2.0},
    {"text": "transcript", "start": 2.5},
    {"text": "about", "start": 3.0},
    {"text": "AI", "start": 3.5},
    {"text": "safety", "start": 4.0},
]


@pytest.fixture
def cache_with_timestamps():
    """Set up cache with video timestamps."""
    clear_cache()
    cache = ContentCache(
        courses={},
        flattened_modules={},
        parsed_learning_outcomes={},
        parsed_lenses={},
        articles={},
        video_transcripts={},
        video_timestamps={
            "test_video_id": SAMPLE_TIMESTAMPS,
        },
        last_refreshed=datetime.now(),
    )
    set_cache(cache)
    yield cache
    clear_cache()


class TestTranscriptReachesCache:
    """Test that get_text_at_time reads from cache."""

    def test_get_text_at_time_uses_cache(self, cache_with_timestamps):
        """get_text_at_time should return text from cached timestamps."""
        result = get_text_at_time("test_video_id", start=0.0, end=2.5)

        assert result is not None
        assert "Hello" in result
        assert "test" in result
        # Should NOT include words after end time
        assert "safety" not in result

    def test_get_text_at_time_full_range(self, cache_with_timestamps):
        """Should get all words when range covers everything."""
        result = get_text_at_time("test_video_id", start=0.0, end=10.0)

        assert "Hello" in result
        assert "AI" in result
        assert "safety" in result


class TestGatherSectionContext:
    """Test that gather_section_context extracts transcript from segments."""

    def test_extracts_video_transcript(self):
        """gather_section_context should include video transcript in segments."""
        section = {
            "type": "video",
            "segments": [
                {
                    "type": "video",
                    "from": 0,
                    "to": 120,
                    "transcript": "This is the video transcript content",
                },
                {
                    "type": "chat",
                    "instructions": "Discuss what you learned",
                    "hidePreviousContentFromTutor": False,
                },
            ],
        }

        context = gather_section_context(section, segment_index=1)

        assert context is not None
        contents = [c for _, _, c in context.segments]
        assert any("This is the video transcript content" in c for c in contents)
        assert any("<source>Video transcript</source>" in c for c in contents)

    def test_returns_none_when_transcript_empty(self):
        """gather_section_context should return context with chat label even when transcript is empty."""
        section = {
            "type": "video",
            "segments": [
                {
                    "type": "video",
                    "from": 0,
                    "to": 120,
                    "transcript": "",  # Empty!
                },
                {
                    "type": "chat",
                    "instructions": "Discuss",
                    "hidePreviousContentFromTutor": False,
                },
            ],
        }

        context = gather_section_context(section, segment_index=1)

        # Now returns context because chat segment has a label
        assert context is not None
        contents = [c for _, _, c in context.segments]
        assert "<source>Chat discussion</source>" in contents
        # But no video content
        assert not any("Video transcript" in c for c in contents)


class TestContentContextMessage:
    """Test that segment content reaches conversation history via build_content_context_message."""

    def test_includes_segment_content(self):
        """build_content_context_message should include segment content."""
        context = SectionContext(
            segments=[
                (0, "video", "<source>Video transcript</source>\nThis is important AI safety content"),
                (1, "chat", "<source>Chat discussion</source>"),
            ],
            segment_index=1,
            total_segments=2,
            section_title="Test Section",
        )

        result = build_content_context_message(context)

        assert "This is important AI safety content" in result
        assert "<segment" in result

    def test_system_prompt_is_static(self):
        """_build_system_prompt should NOT contain segment content (it's in history now)."""
        stage = ChatStage(
            type="chat",
            instructions="Help the user",
            hide_previous_content_from_tutor=False,
        )

        prompt = _build_system_prompt(stage, None)

        assert "<segment" not in prompt
        assert "<lens" not in prompt


# NOTE: TestBundleVideoSection was removed because bundle_video_section()
# was deleted - content bundling is now handled by the TypeScript processor.


class TestEndToEndTranscriptFlow:
    """
    End-to-end test: cache -> get_text_at_time -> section -> context -> history message

    This simulates what happens when a user chats after watching a video.
    Content now flows to conversation history (not system prompt) for caching.
    """

    def test_transcript_flows_to_context_message(self, cache_with_timestamps):
        """Full flow: transcript from cache reaches the content context message."""
        # Step 1: Verify cache has timestamps
        cache = get_cache()
        assert "test_video_id" in cache.video_timestamps

        # Step 2: Get transcript text (simulates what TypeScript processor does)
        transcript = get_text_at_time("test_video_id", start=0.0, end=5.0)
        assert "AI" in transcript
        assert "safety" in transcript

        # Step 3: Create a section with this transcript (simulates TypeScript output)
        section = {
            "type": "video",
            "videoId": "test_video_id",
            "segments": [
                {
                    "type": "video",
                    "from": 0,
                    "to": 5,
                    "transcript": transcript,
                },
                {
                    "type": "chat",
                    "instructions": "What did you learn about AI safety?",
                    "hidePreviousContentFromTutor": False,
                },
            ],
        }

        # Step 4: Gather context (simulates what module.py route does)
        context = gather_section_context(section, segment_index=1)
        assert context is not None
        contents = [c for _, _, c in context.segments]
        assert any("AI" in c for c in contents)
        assert any("safety" in c for c in contents)

        # Step 5: Build content context message (for conversation history injection)
        context.section_title = "Test Video Section"
        result = build_content_context_message(
            context, instructions="What did you learn about AI safety?"
        )

        # Final verification: transcript content is in the context message
        assert "AI" in result
        assert "safety" in result
        assert "<segment" in result
        assert "<segment-instructions>" in result
