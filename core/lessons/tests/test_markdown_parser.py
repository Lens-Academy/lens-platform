# core/lessons/tests/test_markdown_parser.py
"""Tests for the Markdown lesson/course parser."""

import pytest
from core.lessons.markdown_parser import (
    parse_lesson,
    parse_course,
    ParsedLesson,
    ParsedCourse,
    VideoSection,
    ArticleSection,
    TextSection,
    ChatSection,
    TextSegment,
    ChatSegment,
    VideoExcerptSegment,
    ArticleExcerptSegment,
    LessonRef,
    MeetingMarker,
)


class TestParseLessonBasic:
    """Test basic lesson parsing."""

    def test_parse_frontmatter(self):
        """Should extract slug and title from frontmatter."""
        text = """---
slug: test-lesson
title: Test Lesson Title
---

# Text: Introduction
content::
Hello world
"""
        lesson = parse_lesson(text)
        assert lesson.slug == "test-lesson"
        assert lesson.title == "Test Lesson Title"

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
        lesson = parse_lesson(text)
        assert len(lesson.sections) == 1
        section = lesson.sections[0]
        assert isinstance(section, TextSection)
        assert section.title == "Summary"
        assert "# Key Takeaways" in section.content  # ! should be unescaped
        assert "!#" not in section.content

    def test_parse_chat_section(self):
        """Should parse standalone chat section."""
        text = """---
slug: test
title: Test
---

# Chat: Discussion
showUserPreviousContent:: false
instructions::
Ask the user about their understanding.

Topics:
- Topic 1
- Topic 2
"""
        lesson = parse_lesson(text)
        assert len(lesson.sections) == 1
        section = lesson.sections[0]
        assert isinstance(section, ChatSection)
        assert section.title == "Discussion"
        assert section.show_user_previous_content is False
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
showUserPreviousContent:: true
instructions::
Discuss the video.
"""
        lesson = parse_lesson(text)
        assert len(lesson.sections) == 1
        section = lesson.sections[0]

        assert isinstance(section, VideoSection)
        assert section.title == "Test Video"
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
        lesson = parse_lesson(text)
        section = lesson.sections[0]

        assert isinstance(section, ArticleSection)
        assert section.source == "articles/test-article"
        assert len(section.segments) == 3

        # Article excerpt segment
        seg1 = section.segments[1]
        assert isinstance(seg1, ArticleExcerptSegment)
        assert seg1.from_text == '"Start here"'
        assert seg1.to_text == '"End here"'


class TestParseMultipleSections:
    """Test parsing lessons with multiple sections."""

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
        lesson = parse_lesson(text)
        assert len(lesson.sections) == 3

        assert isinstance(lesson.sections[0], VideoSection)
        assert lesson.sections[0].title == "First Video"

        assert isinstance(lesson.sections[1], ArticleSection)
        assert lesson.sections[1].title == "First Article"

        assert isinstance(lesson.sections[2], TextSection)
        assert lesson.sections[2].title == "Summary"


class TestParseCourse:
    """Test course parsing."""

    def test_parse_course_basic(self):
        """Should parse course with lessons and meetings."""
        text = """---
slug: test-course
title: Test Course
---

# Lesson: [[lessons/intro]]

# Meeting: 1

# Lesson: [[lessons/advanced]]
optional:: true

# Meeting: 2
"""
        course = parse_course(text)

        assert course.slug == "test-course"
        assert course.title == "Test Course"
        assert len(course.progression) == 4

        # First lesson
        item0 = course.progression[0]
        assert isinstance(item0, LessonRef)
        assert item0.path == "lessons/intro"
        assert item0.optional is False

        # First meeting
        item1 = course.progression[1]
        assert isinstance(item1, MeetingMarker)
        assert item1.number == 1

        # Optional lesson
        item2 = course.progression[2]
        assert isinstance(item2, LessonRef)
        assert item2.path == "lessons/advanced"
        assert item2.optional is True

        # Second meeting
        item3 = course.progression[3]
        assert isinstance(item3, MeetingMarker)
        assert item3.number == 2


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
        lesson = parse_lesson(text)
        section = lesson.sections[0]
        assert isinstance(section, TextSection)

        # All should be unescaped
        assert "# Heading 1" in section.content
        assert "## Heading 2" in section.content
        assert "### Heading 3" in section.content

        # None should have the ! prefix
        assert "!#" not in section.content
