# LLM Context Accumulation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix `get_narrative_chat_context()` to accumulate ALL previous segments within a section (text, article-excerpt, video-excerpt) instead of just the most recent content segment.

**Architecture:** Replace the current "find first content segment" loop with an accumulation loop that collects all segments before the chat, formats them in order with the last marked specially, and includes video metadata alongside transcripts.

**Tech Stack:** Python (FastAPI backend), existing content loading functions

**Important:** Narrative modules use types from `core.modules.markdown_parser`, NOT `core.modules.types`. The `markdown_parser` version of `VideoExcerptSegment` uses `from_time: str` and `to_time: str` (like `"1:30"`), not integers.

---

## Task 1: Write failing test for TextSegment inclusion

**Files:**
- Create: `web_api/tests/test_narrative_chat_context.py`

**Step 1: Write the failing test**

```python
"""Tests for get_narrative_chat_context function."""

import pytest
from unittest.mock import patch, MagicMock
from dataclasses import dataclass

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
                    show_user_previous_content=True,
                    show_tutor_previous_content=True,
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
                    show_user_previous_content=True,
                    show_tutor_previous_content=True,
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
                    show_user_previous_content=True,
                    show_tutor_previous_content=True,
                ),
            ],
        )
        module = MockModule(sections=[section])

        instructions, previous_content = get_narrative_chat_context(
            module, section_index=0, segment_index=2
        )

        assert previous_content is not None
        # Last segment should have special marker
        assert "read last" in previous_content.lower() or "most recent" in previous_content.lower()
```

**Step 2: Run test to verify it fails**

Run: `pytest web_api/tests/test_narrative_chat_context.py -v`
Expected: FAIL - TextSegment not included in context (returns None or missing text)

**Step 3: Commit test file**

```bash
jj new -m "test: add failing tests for LLM context accumulation"
```

---

## Task 2: Implement segment accumulation logic

**Files:**
- Modify: `web_api/routes/modules.py:444-519` (the `get_narrative_chat_context` function)

**Step 1: Read current implementation and plan changes**

The current implementation at lines 488-517 uses a loop that breaks after finding the first content segment. Replace with accumulation.

**Step 2: Add helper functions above `get_narrative_chat_context`**

Add these new helper functions before `get_narrative_chat_context`:

```python
def _parse_time_to_seconds(time_str: str | None) -> int:
    """
    Convert time string (e.g., '1:30' or '1:30:45') to seconds.

    Args:
        time_str: Time in format "MM:SS" or "HH:MM:SS", or None

    Returns:
        Time in seconds (0 if None or invalid)
    """
    if time_str is None:
        return 0
    # Strip any extra content (defensive - content parsing issue)
    time_str = time_str.strip().split("\n")[0].strip()
    try:
        parts = time_str.split(":")
        if len(parts) == 2:
            # MM:SS format
            minutes, seconds = int(parts[0]), int(parts[1])
            return minutes * 60 + seconds
        elif len(parts) == 3:
            # HH:MM:SS format
            hours, minutes, seconds = int(parts[0]), int(parts[1]), int(parts[2])
            return hours * 3600 + minutes * 60 + seconds
        else:
            # Single number assumed to be seconds
            return int(time_str)
    except ValueError:
        # If parsing fails, return 0 as fallback
        return 0


def _format_time_range(from_seconds: int, to_seconds: int) -> str:
    """Format a time range for display (e.g., '1:30 - 3:45')."""
    def fmt(s: int) -> str:
        minutes, secs = divmod(s, 60)
        return f"{minutes}:{secs:02d}"
    return f"{fmt(from_seconds)} - {fmt(to_seconds)}"


def _format_segment_for_llm(
    segment,
    section,
    is_last: bool,
) -> str | None:
    """
    Format a single segment's content for LLM context.

    Args:
        segment: The segment to format (TextSegment, ArticleExcerptSegment, or VideoExcerptSegment)
        section: Parent section (ArticleSection or VideoSection)
        is_last: Whether this is the most recent segment before the chat

    Returns:
        Formatted string, or None if content couldn't be loaded
    """
    # IMPORTANT: Use markdown_parser types for narrative modules
    from core.modules.markdown_parser import (
        ArticleSection,
        VideoSection,
        TextSegment,
        ArticleExcerptSegment,
        VideoExcerptSegment,
    )
    from core.modules.content import (
        load_article_with_metadata,
        load_video_transcript_with_metadata,
    )
    from core.transcripts import get_text_at_time

    prefix = "The user read last:" if is_last else "The user read earlier:"

    if isinstance(segment, TextSegment):
        return f"{prefix}\n{segment.content}"

    elif isinstance(segment, ArticleExcerptSegment) and isinstance(section, ArticleSection):
        try:
            result = load_article_with_metadata(
                section.source,
                segment.from_text,
                segment.to_text,
            )
            return f"{prefix}\n{result.content}"
        except FileNotFoundError:
            return None

    elif isinstance(segment, VideoExcerptSegment) and isinstance(section, VideoSection):
        try:
            video_result = load_video_transcript_with_metadata(section.source)
            video_id = video_result.metadata.video_id
            video_title = video_result.metadata.title or "Video"

            # VideoExcerptSegment uses from_time/to_time STRINGS, not integers
            from_seconds = _parse_time_to_seconds(segment.from_time)
            to_seconds = _parse_time_to_seconds(segment.to_time) if segment.to_time else 99999

            transcript = get_text_at_time(
                video_id,
                from_seconds,
                to_seconds,
            )

            # Format with metadata
            time_range = _format_time_range(from_seconds, to_seconds)
            return f"{prefix}\n[Video: {video_title}, {time_range}]\n{transcript}"
        except FileNotFoundError:
            return None

    return None
```

**Step 3: Replace the `get_narrative_chat_context` function**

Replace the function body (keeping signature) with:

```python
def get_narrative_chat_context(
    module,
    section_index: int,
    segment_index: int,
) -> tuple[str, str | None]:
    """
    Get chat instructions and previous content for a narrative module position.

    Accumulates ALL segments before the chat segment within the current section,
    including TextSegment, ArticleExcerptSegment, and VideoExcerptSegment.
    Content is ordered earliest-to-latest, with the last segment marked specially.

    Note: This is section-scoped only. A standalone ChatSection will not receive
    content from a previous section. This can lead to unexpected behavior if
    module authors expect cross-section context inheritance.

    Args:
        module: NarrativeModule dataclass
        section_index: Section index (0-based)
        segment_index: Segment index within section (0-based)

    Returns:
        Tuple of (instructions, previous_content or None)
    """
    # IMPORTANT: Use markdown_parser types for narrative modules
    from core.modules.markdown_parser import ChatSegment

    section = module.sections[section_index]

    # Note: Standalone ChatSection does not inherit content from previous sections.
    # This is intentional but can lead to unexpected behavior if authors expect
    # cross-section context. Consider adding cross-section support in the future.
    if not hasattr(section, "segments"):
        return "", None

    segment = section.segments[segment_index]

    if not isinstance(segment, ChatSegment):
        return "", None

    instructions = segment.instructions

    if not segment.show_tutor_previous_content or segment_index == 0:
        return instructions, None

    # Accumulate all previous segments in order
    accumulated_parts: list[str] = []

    for i in range(segment_index):
        prev_seg = section.segments[i]
        is_last = (i == segment_index - 1)
        content_part = _format_segment_for_llm(prev_seg, section, is_last)
        if content_part:
            accumulated_parts.append(content_part)

    if not accumulated_parts:
        return instructions, None

    previous_content = "\n\n".join(accumulated_parts)
    return instructions, previous_content
```

**Step 4: Run tests to verify they pass**

Run: `pytest web_api/tests/test_narrative_chat_context.py -v`
Expected: All 3 tests PASS

**Step 5: Commit implementation**

```bash
jj new -m "feat: accumulate all previous segments for LLM context"
```

---

## Task 3: Add test for video excerpt with metadata

**Files:**
- Modify: `web_api/tests/test_narrative_chat_context.py`

**Step 1: Add test for video metadata inclusion**

Append to the test file:

```python
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
                VideoExcerptSegment(type="video-excerpt", from_time="1:00", to_time="2:00"),
                ChatSegment(
                    type="chat",
                    instructions="Discuss the video.",
                    show_user_previous_content=True,
                    show_tutor_previous_content=True,
                ),
            ],
        )
        module = MockModule(sections=[section])

        # Mock the content loading - use the actual import paths
        with patch("core.modules.content.load_video_transcript_with_metadata") as mock_video:
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
```

**Step 2: Run tests**

Run: `pytest web_api/tests/test_narrative_chat_context.py::TestGetNarrativeChatContext::test_video_excerpt_includes_metadata -v`
Expected: PASS (implementation already handles this)

**Step 3: Commit**

```bash
jj new -m "test: add test for video excerpt metadata in LLM context"
```

---

## Task 4: Add test for article excerpt inclusion

**Files:**
- Modify: `web_api/tests/test_narrative_chat_context.py`

**Step 1: Add test for article excerpts**

Append to the test file:

```python
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
                    show_user_previous_content=True,
                    show_tutor_previous_content=True,
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
                    show_user_previous_content=True,
                    show_tutor_previous_content=True,
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
```

**Step 2: Run all tests**

Run: `pytest web_api/tests/test_narrative_chat_context.py -v`
Expected: All tests PASS

**Step 3: Commit**

```bash
jj new -m "test: add tests for article excerpt and mixed segment inclusion"
```

---

## Task 5: Add test for VideoSection with mixed segments

**Files:**
- Modify: `web_api/tests/test_narrative_chat_context.py`

**Step 1: Add test for VideoSection with text + video-excerpt**

Append to the test file:

```python
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
                VideoExcerptSegment(type="video-excerpt", from_time="0:00", to_time="1:30"),
                TextSegment(type="text", content="Now consider what you saw."),
                ChatSegment(
                    type="chat",
                    instructions="Discuss the video.",
                    show_user_previous_content=True,
                    show_tutor_previous_content=True,
                ),
            ],
        )
        module = MockModule(sections=[section])

        with patch("core.modules.content.load_video_transcript_with_metadata") as mock_video:
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
```

**Step 2: Run all tests**

Run: `pytest web_api/tests/test_narrative_chat_context.py -v`
Expected: All tests PASS

**Step 3: Commit**

```bash
jj new -m "test: add test for VideoSection with mixed segments"
```

---

## Task 6: Add edge case tests

**Files:**
- Modify: `web_api/tests/test_narrative_chat_context.py`

**Step 1: Add edge case tests**

Append to the test file:

```python
    def test_show_tutor_previous_content_false_returns_none(self):
        """When showTutorPreviousContent is false, previous_content should be None."""
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
                    show_user_previous_content=True,
                    show_tutor_previous_content=False,  # Disabled!
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
                    show_user_previous_content=True,
                    show_tutor_previous_content=True,
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
                    show_user_previous_content=True,
                    show_tutor_previous_content=True,
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
```

**Step 2: Run all tests**

Run: `pytest web_api/tests/test_narrative_chat_context.py -v`
Expected: All tests PASS

**Step 3: Commit**

```bash
jj new -m "test: add edge case tests for LLM context"
```

---

## Task 7: Run full test suite and lint

**Files:** None (verification only)

**Step 1: Run backend tests**

Run: `pytest web_api/tests/test_narrative_chat_context.py -v`
Expected: All tests PASS

**Step 2: Run linting**

Run: `ruff check web_api/routes/modules.py web_api/tests/test_narrative_chat_context.py`
Expected: No errors

**Step 3: Run formatting check**

Run: `ruff format --check web_api/routes/modules.py web_api/tests/test_narrative_chat_context.py`
Expected: No formatting issues (or fix them)

**Step 4: Final commit if needed**

```bash
jj new -m "chore: fix linting issues"
```

---

## Summary

This plan:
1. Creates comprehensive tests for the new accumulation behavior
2. Replaces the "find first content" loop with an accumulation loop
3. Handles TextSegment (which was previously ignored)
4. Formats content with "read earlier" vs "read last" markers
5. Includes video metadata (title, time range) alongside transcripts
6. Maintains section-scoped context (with documented limitation)

**Key fixes from code review:**
- Uses `markdown_parser` types (not `types.py`) for narrative modules
- VideoExcerptSegment uses `from_time`/`to_time` strings, not integers
- Added `_parse_time_to_seconds()` helper for time string conversion
- Fixed mock paths to use actual import locations (`core.modules.content.*`)
- Added test for VideoSection with mixed segments
- Added test for error handling when content loading fails

The key behavior changes:
- **Before:** Only the most recent ArticleExcerpt or VideoExcerpt was passed to LLM
- **After:** ALL previous segments (text, article, video) are accumulated in order
