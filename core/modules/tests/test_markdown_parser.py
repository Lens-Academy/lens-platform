# core/modules/tests/test_markdown_parser.py
"""Tests for the Markdown module/course parser."""

from core.modules.markdown_parser import (
    parse_module,
    parse_course,
    VideoSection,
    ArticleSection,
    TextSection,
    ChatSection,
    TextSegment,
    ChatSegment,
    VideoExcerptSegment,
    ArticleExcerptSegment,
    ModuleRef,
    MeetingMarker,
)


class TestParseModuleBasic:
    """Test basic module parsing."""

    def test_parse_frontmatter(self):
        """Should extract slug and title from frontmatter."""
        text = """---
slug: test-module
title: Test Module Title
---

# Text: Introduction
content::
Hello world
"""
        module = parse_module(text)
        assert module.slug == "test-module"
        assert module.title == "Test Module Title"

    def test_parse_text_section(self):
        """Should parse standalone text section."""
        text = """---
slug: test
title: Test
---

# Text: Summary
content::
!# Key Takeaways

1. First point
2. Second point
"""
        module = parse_module(text)
        assert len(module.sections) == 1
        section = module.sections[0]
        assert isinstance(section, TextSection)
        # Note: title field was removed from TextSection dataclass
        assert "# Key Takeaways" in section.content  # ! should be unescaped
        assert "!#" not in section.content

    def test_parse_chat_section(self):
        """Should parse standalone chat section."""
        text = """---
slug: test
title: Test
---

# Chat: Discussion
hidePreviousContentFromUser:: true
instructions::
Ask the user about their understanding.

Topics:
- Topic 1
- Topic 2
"""
        module = parse_module(text)
        assert len(module.sections) == 1
        section = module.sections[0]
        assert isinstance(section, ChatSection)
        # Note: title field was removed from ChatSection dataclass
        assert section.hide_previous_content_from_user is True
        assert "Ask the user" in section.instructions


class TestParseVideoSection:
    """Test video section parsing with segments."""

    def test_parse_video_section_with_segments(self):
        """Should parse video section with text, excerpt, and chat segments."""
        text = """---
slug: test
title: Test
---

# Video: Test Video
source:: [[video_transcripts/test-video]]

## Text
content::
Watch this video.

## Video-excerpt
from:: 0:00
to:: 5:00

## Chat
hidePreviousContentFromUser:: false
instructions::
Discuss the video.
"""
        module = parse_module(text)
        assert len(module.sections) == 1
        section = module.sections[0]

        assert isinstance(section, VideoSection)
        # Note: title field was removed from VideoSection dataclass
        assert section.source == "video_transcripts/test-video"
        assert len(section.segments) == 3

        # Text segment
        seg0 = section.segments[0]
        assert isinstance(seg0, TextSegment)
        assert "Watch this video" in seg0.content

        # Video excerpt segment
        seg1 = section.segments[1]
        assert isinstance(seg1, VideoExcerptSegment)
        assert seg1.from_time == "0:00"
        assert seg1.to_time == "5:00"

        # Chat segment
        seg2 = section.segments[2]
        assert isinstance(seg2, ChatSegment)
        assert "Discuss the video" in seg2.instructions


class TestParseArticleSection:
    """Test article section parsing with segments."""

    def test_parse_article_section_with_excerpts(self):
        """Should parse article section with excerpt segments."""
        text = """---
slug: test
title: Test
---

# Article: Test Article
source:: [[articles/test-article]]

## Text
content::
Read this section.

## Article-excerpt
from:: "Start here"
to:: "End here"

## Chat
instructions::
What did you learn?
"""
        module = parse_module(text)
        section = module.sections[0]

        assert isinstance(section, ArticleSection)
        assert section.source == "articles/test-article"
        assert len(section.segments) == 3

        # Article excerpt segment - quotes are now stripped
        seg1 = section.segments[1]
        assert isinstance(seg1, ArticleExcerptSegment)
        assert seg1.from_text == "Start here"
        assert seg1.to_text == "End here"


class TestParseMultipleSections:
    """Test parsing modules with multiple sections."""

    def test_parse_video_then_article(self):
        """Should parse multiple sections in order."""
        text = """---
slug: test
title: Test
---

# Video: First Video
source:: [[video_transcripts/vid1]]

## Video-excerpt
from:: 0:00
to:: 3:00

# Article: First Article
source:: [[articles/art1]]

## Article-excerpt
from:: "Intro"
to:: "Conclusion"

# Text: Summary
content::
The end.
"""
        module = parse_module(text)
        assert len(module.sections) == 3

        # Note: title field was removed from all section dataclasses
        assert isinstance(module.sections[0], VideoSection)
        assert module.sections[0].source == "video_transcripts/vid1"

        assert isinstance(module.sections[1], ArticleSection)
        assert module.sections[1].source == "articles/art1"

        assert isinstance(module.sections[2], TextSection)
        assert module.sections[2].content == "The end."


class TestParseCourse:
    """Test course parsing."""

    def test_parse_course_basic(self):
        """Should parse course with modules and meetings."""
        text = """---
slug: test-course
title: Test Course
---

# Lesson: [[modules/intro]]

# Meeting: 1

# Lesson: [[modules/advanced]]
optional:: true

# Meeting: 2
"""
        course = parse_course(text)

        assert course.slug == "test-course"
        assert course.title == "Test Course"
        assert len(course.progression) == 4

        # First module
        item0 = course.progression[0]
        assert isinstance(item0, ModuleRef)
        assert item0.path == "modules/intro"
        assert item0.optional is False

        # First meeting
        item1 = course.progression[1]
        assert isinstance(item1, MeetingMarker)
        assert item1.number == 1

        # Optional module
        item2 = course.progression[2]
        assert isinstance(item2, ModuleRef)
        assert item2.path == "modules/advanced"
        assert item2.optional is True

        # Second meeting
        item3 = course.progression[3]
        assert isinstance(item3, MeetingMarker)
        assert item3.number == 2


class TestRealModuleParsing:
    """Test parsing with real module fixture from GitHub."""

    def test_parse_introduction_sample(self):
        """Should parse the introduction sample matching expected output."""
        import json
        from pathlib import Path

        fixtures_dir = Path(__file__).parent / "fixtures"

        # Load markdown input
        md_path = fixtures_dir / "introduction_sample.md"
        md_content = md_path.read_text()

        # Load expected output
        json_path = fixtures_dir / "introduction_sample_expected.json"
        expected = json.loads(json_path.read_text())

        # Parse
        module = parse_module(md_content)

        # Verify basic fields
        assert module.slug == expected["slug"]
        assert module.title == expected["title"]
        assert len(module.sections) == len(expected["sections"]), (
            f"Expected {len(expected['sections'])} sections, got {len(module.sections)}"
        )

        # Verify each section
        for i, (actual, exp) in enumerate(zip(module.sections, expected["sections"])):
            assert actual.type == exp["type"], (
                f"Section {i} type mismatch: {actual.type} != {exp['type']}"
            )

            # Verify sections don't have title attribute in serialization
            assert (
                not hasattr(actual, "title")
                or getattr(actual, "title", None) is None
                or "title" not in exp
            ), f"Section {i} should not have title field"

            if exp["type"] == "video":
                assert actual.source == exp["source"], f"Section {i} source mismatch"
                assert len(actual.segments) == len(exp["segments"]), (
                    f"Section {i} segment count: {len(actual.segments)} != {len(exp['segments'])}"
                )
                # Check optional field
                if "optional" in exp:
                    assert actual.optional == exp["optional"], (
                        f"Section {i} optional mismatch"
                    )
                else:
                    assert actual.optional is False, (
                        f"Section {i} optional should default to False"
                    )

                # Verify segments
                for j, (actual_seg, exp_seg) in enumerate(
                    zip(actual.segments, exp["segments"])
                ):
                    assert actual_seg.type == exp_seg["type"], (
                        f"Section {i} segment {j} type mismatch"
                    )
                    if exp_seg["type"] == "video-excerpt":
                        assert actual_seg.from_time == exp_seg["from_time"], (
                            f"Section {i} segment {j} from_time: {actual_seg.from_time} != {exp_seg['from_time']}"
                        )
                        assert actual_seg.to_time == exp_seg["to_time"], (
                            f"Section {i} segment {j} to_time: {actual_seg.to_time} != {exp_seg['to_time']}"
                        )
                    elif exp_seg["type"] == "text":
                        assert actual_seg.content == exp_seg["content"], (
                            f"Section {i} segment {j} content mismatch"
                        )

            elif exp["type"] == "article":
                assert actual.source == exp["source"], f"Section {i} source mismatch"
                assert len(actual.segments) == len(exp["segments"]), (
                    f"Section {i} segment count: {len(actual.segments)} != {len(exp['segments'])}"
                )
                # Check optional field
                if "optional" in exp:
                    assert actual.optional == exp["optional"], (
                        f"Section {i} optional mismatch"
                    )
                else:
                    assert actual.optional is False, (
                        f"Section {i} optional should default to False"
                    )

                # Verify article-excerpt segments have stripped quotes
                for j, (actual_seg, exp_seg) in enumerate(
                    zip(actual.segments, exp["segments"])
                ):
                    assert actual_seg.type == exp_seg["type"], (
                        f"Section {i} segment {j} type mismatch"
                    )
                    if exp_seg["type"] == "article-excerpt":
                        assert actual_seg.from_text == exp_seg["from_text"], (
                            f"Section {i} segment {j} from_text: {actual_seg.from_text!r} != {exp_seg['from_text']!r}"
                        )
                        assert actual_seg.to_text == exp_seg["to_text"], (
                            f"Section {i} segment {j} to_text: {actual_seg.to_text!r} != {exp_seg['to_text']!r}"
                        )

            elif exp["type"] == "chat":
                assert (
                    actual.hide_previous_content_from_user
                    == exp["hide_previous_content_from_user"]
                ), f"Section {i} hide_previous_content_from_user mismatch"
                assert (
                    actual.hide_previous_content_from_tutor
                    == exp["hide_previous_content_from_tutor"]
                ), f"Section {i} hide_previous_content_from_tutor mismatch"
                assert actual.instructions == exp["instructions"], (
                    f"Section {i} instructions mismatch"
                )


class TestContentHeaderUnescaping:
    """Test that !# headers are properly unescaped."""

    def test_unescape_multiple_levels(self):
        """Should unescape !#, !## , !### etc."""
        text = """---
slug: test
title: Test
---

# Text: Content
content::
!# Heading 1

Some text.

!## Heading 2

More text.

!### Heading 3

Even more.
"""
        module = parse_module(text)
        section = module.sections[0]
        assert isinstance(section, TextSection)

        # All should be unescaped
        assert "# Heading 1" in section.content
        assert "## Heading 2" in section.content
        assert "### Heading 3" in section.content

        # None should have the ! prefix
        assert "!#" not in section.content


class TestSegmentTitles:
    """Test that segments can have optional titles like ## Chat: Discussion Title."""

    def test_chat_segment_with_title_is_parsed(self):
        """Chat segment with title should be parsed correctly."""
        text = """---
slug: test
title: Test
---

# Video: Test Video
source:: [[video_transcripts/test]]

## Text
content::
What did you think?

## Chat: Discussion on the Video
instructions::
Discuss what the user just watched.
"""
        module = parse_module(text)
        section = module.sections[0]
        assert isinstance(section, VideoSection)
        assert len(section.segments) == 2

        # First segment: Text without title
        seg0 = section.segments[0]
        assert isinstance(seg0, TextSegment)
        assert "What did you think?" in seg0.content

        # Second segment: Chat with title
        seg1 = section.segments[1]
        assert isinstance(seg1, ChatSegment)
        assert "Discuss what the user just watched" in seg1.instructions

    def test_text_segment_with_title_is_parsed(self):
        """Text segment with title should be parsed correctly."""
        text = """---
slug: test
title: Test
---

# Video: Test Video
source:: [[video_transcripts/test]]

## Text: Key Takeaways
content::
Here are the main points.

## Video-excerpt
"""
        module = parse_module(text)
        section = module.sections[0]
        assert isinstance(section, VideoSection)
        assert len(section.segments) == 2

        # First segment: Text with title
        seg0 = section.segments[0]
        assert isinstance(seg0, TextSegment)
        assert "Here are the main points" in seg0.content

    def test_multiple_titled_segments(self):
        """Multiple segments with titles should all be parsed."""
        text = """---
slug: test
title: Test
---

# Video: Test Video
source:: [[video_transcripts/test]]

## Text: Introduction
content::
Watch this video about AI safety.

## Video-excerpt: Key Segment
from:: 1:00
to:: 5:00

## Chat: Discussion Questions
hidePreviousContentFromUser:: true
instructions::
Ask what stood out to the user.
"""
        module = parse_module(text)
        section = module.sections[0]
        assert isinstance(section, VideoSection)
        assert len(section.segments) == 3

        seg0 = section.segments[0]
        assert isinstance(seg0, TextSegment)

        seg1 = section.segments[1]
        assert isinstance(seg1, VideoExcerptSegment)
        assert seg1.from_time == "1:00"
        assert seg1.to_time == "5:00"

        seg2 = section.segments[2]
        assert isinstance(seg2, ChatSegment)
        assert seg2.hide_previous_content_from_user is True
