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
from core.modules.context import gather_section_context
from core.modules.chat import _build_system_prompt, ChatStage
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
        """gather_section_context should include video transcript."""
        section = {
            "type": "video",
            "segments": [
                {
                    "type": "video-excerpt",
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
        assert "This is the video transcript content" in context
        assert "[Video transcript]" in context

    def test_returns_none_when_transcript_empty(self):
        """gather_section_context should return None when transcript is empty."""
        section = {
            "type": "video",
            "segments": [
                {
                    "type": "video-excerpt",
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

        # Should be None because there's no content
        assert context is None


class TestSystemPromptIncludesContext:
    """Test that _build_system_prompt includes previous_content."""

    def test_chat_stage_includes_previous_content(self):
        """_build_system_prompt should include previous_content for ChatStage."""
        stage = ChatStage(
            type="chat",
            instructions="Help the user understand the video",
            hide_previous_content_from_tutor=False,
        )
        previous_content = "[Video transcript]\nThis is important AI safety content"

        prompt = _build_system_prompt(stage, None, previous_content)

        assert "This is important AI safety content" in prompt
        assert "The user just engaged with this content" in prompt

    def test_chat_stage_without_previous_content(self):
        """_build_system_prompt should work without previous_content."""
        stage = ChatStage(
            type="chat",
            instructions="Help the user",
            hide_previous_content_from_tutor=False,
        )

        prompt = _build_system_prompt(stage, None, None)

        assert "Help the user" in prompt
        assert "engaged with this content" not in prompt

    def test_chat_stage_hides_content_when_flag_set(self):
        """_build_system_prompt should not include content when hide flag is set."""
        stage = ChatStage(
            type="chat",
            instructions="Start fresh discussion",
            hide_previous_content_from_tutor=True,
        )
        previous_content = "This should NOT appear"

        prompt = _build_system_prompt(stage, None, previous_content)

        assert "This should NOT appear" not in prompt


# NOTE: TestBundleVideoSection was removed because bundle_video_section()
# was deleted - content bundling is now handled by the TypeScript processor.


class TestEndToEndTranscriptFlow:
    """
    End-to-end test: cache -> get_text_at_time -> section -> context -> prompt

    This simulates what happens when a user chats after watching a video.
    """

    def test_transcript_flows_to_prompt(self, cache_with_timestamps):
        """Full flow: transcript from cache reaches the system prompt."""
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
                    "type": "video-excerpt",
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
        assert "AI" in context
        assert "safety" in context

        # Step 5: Build system prompt (simulates what send_module_message does)
        stage = ChatStage(
            type="chat",
            instructions="What did you learn about AI safety?",
            hide_previous_content_from_tutor=False,
        )
        prompt = _build_system_prompt(stage, None, context)

        # Final verification: transcript content is in the prompt
        assert "AI" in prompt
        assert "safety" in prompt
        assert "The user just engaged with this content" in prompt
