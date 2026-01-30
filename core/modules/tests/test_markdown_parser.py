# core/modules/tests/test_markdown_parser.py
"""Tests for the Markdown module/course parser.

NOTE: The parser supports both v1 (legacy) and v2 module formats for flexibility.
The validator is what enforces v2 format for modules. See test_markdown_validator.py
for tests that verify v1 format is rejected at validation time.

Test organization:
- TestParseModuleFrontmatter: Basic frontmatter parsing
- TestParseModuleV2Sections: v2 format sections (Page, Learning Outcome, Uncategorized)
- TestParseSectionTypes: Video/Article/Text/Chat section parsing (shared logic)
- TestParseLensFile: Lens file parsing (uses Video/Article sections at H3 level)
- TestParseLearningOutcomeFile: Learning Outcome file parsing
- TestParseCourse: Course file parsing
- TestRealModuleParsing: Integration test with fixture file
"""

from core.modules.markdown_parser import (
    parse_module,
    parse_course,
    VideoSection,
    ArticleSection,
    TextSection,
    ChatSection,
    PageSection,
    LearningOutcomeRef,
    UncategorizedSection,
    LensRef,
    TextSegment,
    ChatSegment,
    VideoExcerptSegment,
    ArticleExcerptSegment,
    ModuleRef,
    MeetingMarker,
)


class TestParseModuleFrontmatter:
    """Test module frontmatter parsing."""

    def test_parse_frontmatter(self):
        """Should extract slug and title from frontmatter."""
        text = """---
slug: test-module
title: Test Module Title
---

# Page: Introduction
id:: 11111111-1111-1111-1111-111111111111
## Text
content::
Hello world
"""
        module = parse_module(text)
        assert module.slug == "test-module"
        assert module.title == "Test Module Title"


class TestParseSectionTypes:
    """Test parsing of Video, Article, Text, and Chat section types.

    These section types are used in:
    - Lens files (at ### level)
    - Legacy v1 module format (at # level, now rejected by validator)

    The parser supports these at any heading level for flexibility.
    """

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
    """Test video section parsing with segments.

    VideoSection is used in Lens files (at ### level) and legacy v1 modules.
    """

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
    """Test article section parsing with segments.

    ArticleSection is used in Lens files (at ### level) and legacy v1 modules.
    """

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
    """Test parsing files with multiple sections.

    These tests use legacy v1 format (# Video:, # Article:, # Text:) which
    is still supported by the parser but rejected by the validator for modules.
    This tests that the parser correctly handles section boundaries.
    """

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
    """Test parsing with real module fixture (v2 format)."""

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
        assert str(module.content_id) == expected["id"], (
            f"Module id mismatch: {module.content_id} != {expected['id']}"
        )
        assert len(module.sections) == len(expected["sections"]), (
            f"Expected {len(expected['sections'])} sections, got {len(module.sections)}"
        )

        # Verify each section
        for i, (actual, exp) in enumerate(zip(module.sections, expected["sections"])):
            assert actual.type == exp["type"], (
                f"Section {i} type mismatch: {actual.type} != {exp['type']}"
            )

            if exp["type"] == "page":
                assert actual.title == exp["title"], (
                    f"Section {i} title mismatch: {actual.title} != {exp['title']}"
                )
                assert str(actual.content_id) == exp["content_id"], (
                    f"Section {i} content_id mismatch"
                )
                assert len(actual.segments) == len(exp["segments"]), (
                    f"Section {i} segment count: {len(actual.segments)} != {len(exp['segments'])}"
                )

                # Verify segments
                for j, (actual_seg, exp_seg) in enumerate(
                    zip(actual.segments, exp["segments"])
                ):
                    assert actual_seg.type == exp_seg["type"], (
                        f"Section {i} segment {j} type mismatch"
                    )
                    if exp_seg["type"] == "text":
                        assert actual_seg.content == exp_seg["content"], (
                            f"Section {i} segment {j} content mismatch:\n"
                            f"Actual: {actual_seg.content!r}\n"
                            f"Expected: {exp_seg['content']!r}"
                        )
                    elif exp_seg["type"] == "chat":
                        assert actual_seg.instructions == exp_seg["instructions"], (
                            f"Section {i} segment {j} instructions mismatch"
                        )
                        assert (
                            actual_seg.hide_previous_content_from_user
                            == exp_seg["hide_previous_content_from_user"]
                        ), (
                            f"Section {i} segment {j} hide_previous_content_from_user mismatch"
                        )
                        assert (
                            actual_seg.hide_previous_content_from_tutor
                            == exp_seg["hide_previous_content_from_tutor"]
                        ), (
                            f"Section {i} segment {j} hide_previous_content_from_tutor mismatch"
                        )

            elif exp["type"] == "learning_outcome":
                assert actual.source == exp["source"], (
                    f"Section {i} source mismatch: {actual.source} != {exp['source']}"
                )
                assert actual.optional == exp["optional"], (
                    f"Section {i} optional mismatch: {actual.optional} != {exp['optional']}"
                )

            elif exp["type"] == "uncategorized":
                assert len(actual.lenses) == len(exp["lenses"]), (
                    f"Section {i} lens count mismatch: {len(actual.lenses)} != {len(exp['lenses'])}"
                )
                for j, (actual_lens, exp_lens) in enumerate(
                    zip(actual.lenses, exp["lenses"])
                ):
                    assert actual_lens.source == exp_lens["source"], (
                        f"Section {i} lens {j} source mismatch"
                    )
                    assert actual_lens.optional == exp_lens["optional"], (
                        f"Section {i} lens {j} optional mismatch"
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


class TestParsePageSection:
    """Test parsing # Page: sections."""

    def test_parse_page_section_basic(self):
        """Should parse a basic Page section with id and Text segment."""
        text = """---
slug: test
title: Test
---

# Page: Welcome
id:: 8a9b0c1d-2e3f-4a5b-6c7d-8e9f0a1b2c3d
## Text
content::
Hello world
"""
        module = parse_module(text)
        assert len(module.sections) == 1
        section = module.sections[0]
        assert isinstance(section, PageSection)
        assert section.title == "Welcome"
        assert str(section.content_id) == "8a9b0c1d-2e3f-4a5b-6c7d-8e9f0a1b2c3d"
        assert len(section.segments) == 1

    def test_parse_page_section_with_chat(self):
        """Should parse Page section with Text and Chat segments."""
        text = """---
slug: test
title: Test
---

# Page: Intro
id:: 11111111-1111-1111-1111-111111111111
## Text
content::
Welcome to the course.

## Chat
instructions::
What brings you here?
"""
        module = parse_module(text)
        section = module.sections[0]
        assert isinstance(section, PageSection)
        assert len(section.segments) == 2
        assert isinstance(section.segments[0], TextSegment)
        assert isinstance(section.segments[1], ChatSegment)

    def test_parse_page_section_segments_any_order(self):
        """Page segments can appear in any order."""
        text = """---
slug: test
title: Test
---

# Page: Mixed
id:: 22222222-2222-2222-2222-222222222222
## Chat
instructions::
First question

## Text
content::
Some context

## Chat
instructions::
Follow-up question
"""
        module = parse_module(text)
        section = module.sections[0]
        assert len(section.segments) == 3
        assert isinstance(section.segments[0], ChatSegment)
        assert isinstance(section.segments[1], TextSegment)
        assert isinstance(section.segments[2], ChatSegment)


class TestParseLearningOutcomeRef:
    """Test parsing # Learning Outcome: sections."""

    def test_parse_learning_outcome_ref_basic(self):
        """Should parse Learning Outcome reference with source."""
        text = """---
slug: test
title: Test
---

# Learning Outcome:
source:: [[../Learning Outcomes/Core Concepts]]
"""
        module = parse_module(text)
        assert len(module.sections) == 1
        section = module.sections[0]
        assert isinstance(section, LearningOutcomeRef)
        assert section.source == "../Learning Outcomes/Core Concepts"
        assert section.optional is False

    def test_parse_learning_outcome_ref_optional(self):
        """Should parse optional Learning Outcome reference."""
        text = """---
slug: test
title: Test
---

# Learning Outcome:
optional:: true
source:: [[../Learning Outcomes/Objections L1]]
"""
        module = parse_module(text)
        section = module.sections[0]
        assert isinstance(section, LearningOutcomeRef)
        assert section.optional is True
        assert section.source == "../Learning Outcomes/Objections L1"

    def test_parse_learning_outcome_ref_with_embed_syntax(self):
        """Should parse ![[embed]] syntax the same as [[link]]."""
        text = """---
slug: test
title: Test
---

# Learning Outcome:
source:: ![[../Learning Outcomes/Core Concepts]]
"""
        module = parse_module(text)
        section = module.sections[0]
        assert isinstance(section, LearningOutcomeRef)
        assert section.source == "../Learning Outcomes/Core Concepts"

    def test_parse_learning_outcome_mixed_with_other_sections(self):
        """Should parse Learning Outcome refs mixed with other section types."""
        text = """---
slug: test
title: Test
---

# Video: Intro Video
source:: [[videos/intro]]

## Text
content::
Watch this video.

# Learning Outcome:
source:: [[../Learning Outcomes/Core Concepts]]

# Text: Summary
content::
That was great!
"""
        module = parse_module(text)
        assert len(module.sections) == 3
        assert isinstance(module.sections[0], VideoSection)
        assert isinstance(module.sections[1], LearningOutcomeRef)
        assert isinstance(module.sections[2], TextSection)

    def test_parse_multiple_learning_outcomes(self):
        """Should parse multiple Learning Outcome refs in a module."""
        text = """---
slug: test
title: Test
---

# Learning Outcome:
source:: [[../Learning Outcomes/First Concept]]

# Learning Outcome:
optional:: true
source:: [[../Learning Outcomes/Second Concept]]
"""
        module = parse_module(text)
        assert len(module.sections) == 2

        assert isinstance(module.sections[0], LearningOutcomeRef)
        assert module.sections[0].source == "../Learning Outcomes/First Concept"
        assert module.sections[0].optional is False

        assert isinstance(module.sections[1], LearningOutcomeRef)
        assert module.sections[1].source == "../Learning Outcomes/Second Concept"
        assert module.sections[1].optional is True


class TestParseUncategorizedSection:
    """Test parsing # Uncategorized: sections with ## Lens: refs."""

    def test_parse_uncategorized_with_lens_refs(self):
        """Should parse Uncategorized section with Lens references."""
        text = """---
slug: test
title: Test
---

# Uncategorized:
## Lens:
optional:: true
source:: [[../Lenses/Background Reading]]

## Lens:
source:: [[../Lenses/Deep Dive]]
"""
        module = parse_module(text)
        assert len(module.sections) == 1
        section = module.sections[0]
        assert isinstance(section, UncategorizedSection)
        assert len(section.lenses) == 2

        assert section.lenses[0].source == "../Lenses/Background Reading"
        assert section.lenses[0].optional is True

        assert section.lenses[1].source == "../Lenses/Deep Dive"
        assert section.lenses[1].optional is False

    def test_parse_uncategorized_single_lens(self):
        """Should parse Uncategorized with single Lens ref."""
        text = """---
slug: test
title: Test
---

# Uncategorized:
## Lens:
source:: [[../Lenses/Only One]]
"""
        module = parse_module(text)
        section = module.sections[0]
        assert isinstance(section, UncategorizedSection)
        assert len(section.lenses) == 1
        assert isinstance(section.lenses[0], LensRef)
        assert section.lenses[0].source == "../Lenses/Only One"
        assert section.lenses[0].optional is False

    def test_parse_uncategorized_with_embed_syntax(self):
        """Should parse ![[embed]] syntax for Lens source."""
        text = """---
slug: test
title: Test
---

# Uncategorized:
## Lens:
source:: ![[../Lenses/Embedded Lens]]
"""
        module = parse_module(text)
        section = module.sections[0]
        assert isinstance(section, UncategorizedSection)
        assert section.lenses[0].source == "../Lenses/Embedded Lens"

    def test_parse_uncategorized_mixed_with_other_sections(self):
        """Should parse Uncategorized section mixed with other section types."""
        text = """---
slug: test
title: Test
---

# Video: Intro Video
source:: [[videos/intro]]

## Text
content::
Watch this video.

# Uncategorized:
## Lens:
source:: [[../Lenses/Background Reading]]

# Text: Summary
content::
That was great!
"""
        module = parse_module(text)
        assert len(module.sections) == 3
        assert isinstance(module.sections[0], VideoSection)
        assert isinstance(module.sections[1], UncategorizedSection)
        assert isinstance(module.sections[2], TextSection)


class TestParseLearningOutcomeFile:
    """Test parsing Learning Outcome files."""

    def test_parse_learning_outcome_basic(self):
        """Should parse Learning Outcome file with Lens refs."""
        from core.modules.markdown_parser import parse_learning_outcome

        text = """---
id: e8f86891-a3b8-4176-b917-044b4015e0bd
discussion: https://discord.com/channels/123/456
---
## Test:
source:: [[../Tests/Core Concepts Quiz]]

## Lens:
source:: [[../Lenses/AI Basics Video]]

## Lens:
optional:: true
source:: [[../Lenses/Wikipedia Overview]]
"""
        lo = parse_learning_outcome(text)
        assert str(lo.content_id) == "e8f86891-a3b8-4176-b917-044b4015e0bd"
        assert lo.discussion == "https://discord.com/channels/123/456"
        assert lo.test is not None
        assert lo.test.source == "../Tests/Core Concepts Quiz"
        assert len(lo.lenses) == 2
        assert lo.lenses[0].optional is False
        assert lo.lenses[1].optional is True

    def test_parse_learning_outcome_no_test(self):
        """Learning Outcome can have no Test section."""
        from core.modules.markdown_parser import parse_learning_outcome

        text = """---
id: 11111111-1111-1111-1111-111111111111
---
## Lens:
source:: [[../Lenses/Some Lens]]
"""
        lo = parse_learning_outcome(text)
        assert lo.test is None
        assert len(lo.lenses) == 1

    def test_parse_learning_outcome_no_discussion(self):
        """Discussion field is optional."""
        from core.modules.markdown_parser import parse_learning_outcome

        text = """---
id: 22222222-2222-2222-2222-222222222222
---
## Lens:
source:: [[../Lenses/Foo]]
"""
        lo = parse_learning_outcome(text)
        assert lo.discussion is None
        assert str(lo.content_id) == "22222222-2222-2222-2222-222222222222"

    def test_parse_learning_outcome_embed_syntax(self):
        """Should handle ![[embed]] syntax."""
        from core.modules.markdown_parser import parse_learning_outcome

        text = """---
id: 33333333-3333-3333-3333-333333333333
---
## Lens:
source:: ![[../Lenses/Embedded]]
"""
        lo = parse_learning_outcome(text)
        assert lo.lenses[0].source == "../Lenses/Embedded"

    def test_parse_learning_outcome_with_display_name(self):
        """Should strip Obsidian display name from wiki-links (pipe syntax)."""
        from core.modules.markdown_parser import parse_learning_outcome

        text = """---
id: 44444444-4444-4444-4444-444444444444
---
## Lens:
source:: [[../Lenses/My Lens|Custom Display Name]]
"""
        lo = parse_learning_outcome(text)
        assert lo.lenses[0].source == "../Lenses/My Lens"


class TestWikiLinkPipeSyntax:
    """Test that Obsidian display name syntax (pipe) is handled correctly."""

    def test_learning_outcome_source_with_pipe(self):
        """Learning Outcome source should strip display name."""
        text = """---
slug: test
title: Test
---

# Learning Outcome:
source:: [[../Learning Outcomes/Core Concepts|Core Concepts Overview]]
"""
        module = parse_module(text)
        section = module.sections[0]
        assert isinstance(section, LearningOutcomeRef)
        assert section.source == "../Learning Outcomes/Core Concepts"

    def test_uncategorized_lens_with_pipe(self):
        """Uncategorized Lens source should strip display name."""
        text = """---
slug: test
title: Test
---

# Uncategorized:
## Lens:
source:: [[../Lenses/Background|Background Reading Lens]]
"""
        module = parse_module(text)
        section = module.sections[0]
        assert isinstance(section, UncategorizedSection)
        assert section.lenses[0].source == "../Lenses/Background"

    def test_video_section_source_with_pipe(self):
        """Video section source should strip display name."""
        text = """---
slug: test
title: Test
---

# Video: Test Video
source:: [[video_transcripts/intro|Introduction Video]]

## Text
content::
Watch this.
"""
        module = parse_module(text)
        section = module.sections[0]
        assert isinstance(section, VideoSection)
        assert section.source == "video_transcripts/intro"

    def test_embed_with_pipe(self):
        """Embed syntax with display name should also strip it."""
        text = """---
slug: test
title: Test
---

# Learning Outcome:
source:: ![[../Learning Outcomes/Core|Core Concepts]]
"""
        module = parse_module(text)
        section = module.sections[0]
        assert isinstance(section, LearningOutcomeRef)
        assert section.source == "../Learning Outcomes/Core"


class TestCriticMarkupStripping:
    """Test that critic markup is stripped during parsing."""

    def test_strip_comments_from_content(self):
        """Comments should be stripped from content."""
        text = """---
slug: test
title: Test
---

# Page: Welcome
id:: 11111111-1111-1111-1111-111111111111
## Text
content::
Hello{>>this is a comment<<} world
"""
        module = parse_module(text)
        section = module.sections[0]
        assert isinstance(section, PageSection)
        assert "Hello world" in section.segments[0].content
        assert "comment" not in section.segments[0].content

    def test_strip_additions_from_content(self):
        """Additions should be stripped (rejected)."""
        text = """---
slug: test
title: Test
---

# Page: Test
id:: 11111111-1111-1111-1111-111111111111
## Text
content::
Hello{++added text++} world
"""
        module = parse_module(text)
        section = module.sections[0]
        assert isinstance(section, PageSection)
        assert section.segments[0].content.strip() == "Hello world"

    def test_keep_deletions_in_content(self):
        """Deletions should be kept (reject = keep original)."""
        text = """---
slug: test
title: Test
---

# Page: Test
id:: 11111111-1111-1111-1111-111111111111
## Text
content::
Hello{--deleted text--} world
"""
        module = parse_module(text)
        section = module.sections[0]
        assert isinstance(section, PageSection)
        assert "deleted text" in section.segments[0].content

    def test_substitution_keeps_old_text(self):
        """Substitutions should keep old text, discard new."""
        text = """---
slug: test
title: Test
---

# Page: Test
id:: 11111111-1111-1111-1111-111111111111
## Text
content::
Hello{~~original~>replacement~~} world
"""
        module = parse_module(text)
        section = module.sections[0]
        assert isinstance(section, PageSection)
        assert "original" in section.segments[0].content
        assert "replacement" not in section.segments[0].content

    def test_highlights_keep_content(self):
        """Highlights should keep inner content."""
        text = """---
slug: test
title: Test
---

# Page: Test
id:: 11111111-1111-1111-1111-111111111111
## Text
content::
Hello{==highlighted==} world
"""
        module = parse_module(text)
        section = module.sections[0]
        assert isinstance(section, PageSection)
        assert "highlighted" in section.segments[0].content
        assert "{==" not in section.segments[0].content

    def test_critic_markup_in_frontmatter_preserved(self):
        """Critic markup in frontmatter should also be stripped."""
        text = """---
slug: test{>>comment<<}
title: Test{++addition++} Title
---

# Page: Test
id:: 11111111-1111-1111-1111-111111111111
## Text
content::
Content here
"""
        module = parse_module(text)
        # Frontmatter values should have critic markup stripped
        assert module.slug == "test"
        assert module.title == "Test Title"


class TestParseLensFile:
    """Test parsing Lens files."""

    def test_parse_lens_with_video_section(self):
        """Should parse Lens file with Video section and segments."""
        from core.modules.markdown_parser import parse_lens

        text = """---
id: 01f6df31-099f-48ed-adef-773cc4f947e4
---
### Video: AI Basics
source:: [[../video_transcripts/kurzgesagt-ai]]

#### Text
content::
Watch this introduction.

#### Video-excerpt
from:: 0:00
to:: 5:00

#### Chat
instructions::
What stood out to you?
"""
        lens = parse_lens(text)
        assert str(lens.content_id) == "01f6df31-099f-48ed-adef-773cc4f947e4"
        assert len(lens.sections) == 1
        section = lens.sections[0]
        assert section.type == "video"
        assert section.title == "AI Basics"
        assert section.source == "../video_transcripts/kurzgesagt-ai"
        assert len(section.segments) == 3

    def test_parse_lens_with_article_section(self):
        """Should parse Lens file with Article section."""
        from core.modules.markdown_parser import parse_lens

        text = """---
id: 22222222-2222-2222-2222-222222222222
---
### Article: Deep Dive
source:: [[../articles/ai-safety]]

#### Article-excerpt
from:: "## The Problem"
to:: "needs attention."

#### Chat
instructions::
What do you think?
"""
        lens = parse_lens(text)
        section = lens.sections[0]
        assert section.type == "article"
        assert section.title == "Deep Dive"
        assert len(section.segments) == 2

    def test_parse_lens_multiple_sections(self):
        """Lens can have multiple Video/Article sections."""
        from core.modules.markdown_parser import parse_lens

        text = """---
id: 33333333-3333-3333-3333-333333333333
---
### Video: First
source:: [[../video_transcripts/vid1]]

#### Video-excerpt

### Article: Second
source:: [[../articles/art1]]

#### Article-excerpt
"""
        lens = parse_lens(text)
        assert len(lens.sections) == 2
        assert lens.sections[0].type == "video"
        assert lens.sections[0].title == "First"
        assert lens.sections[1].type == "article"
        assert lens.sections[1].title == "Second"

    def test_parse_lens_video_excerpt_times(self):
        """Should parse video excerpt timestamps."""
        from core.modules.markdown_parser import parse_lens

        text = """---
id: 44444444-4444-4444-4444-444444444444
---
### Video: Test
source:: [[video]]

#### Video-excerpt
from:: 1:30
to:: 5:45
"""
        lens = parse_lens(text)
        segment = lens.sections[0].segments[0]
        assert segment.type == "video-excerpt"
        assert segment.from_time == "1:30"
        assert segment.to_time == "5:45"

    def test_parse_lens_article_excerpt_anchors(self):
        """Should parse article excerpt text anchors."""
        from core.modules.markdown_parser import parse_lens

        text = """---
id: 55555555-5555-5555-5555-555555555555
---
### Article: Test
source:: [[article]]

#### Article-excerpt
from:: "## Start Here"
to:: "end of section."
"""
        lens = parse_lens(text)
        segment = lens.sections[0].segments[0]
        assert segment.type == "article-excerpt"
        assert segment.from_text == "## Start Here"
        assert segment.to_text == "end of section."

    def test_parse_lens_optional_segment(self):
        """Segments can have optional:: true."""
        from core.modules.markdown_parser import parse_lens

        text = """---
id: 66666666-6666-6666-6666-666666666666
---
### Video: Test
source:: [[video]]

#### Video-excerpt

#### Chat: Optional Discussion
optional:: true
instructions::
Optional discussion here.
"""
        lens = parse_lens(text)
        chat_segment = lens.sections[0].segments[1]
        assert chat_segment.type == "chat"
        assert chat_segment.optional is True

    def test_parse_lens_text_segment_content(self):
        """Should parse Text segment content."""
        from core.modules.markdown_parser import parse_lens

        text = """---
id: 77777777-7777-7777-7777-777777777777
---
### Video: Test
source:: [[video]]

#### Text
content::
This is the introduction text.
It can span multiple lines.

#### Video-excerpt
"""
        lens = parse_lens(text)
        text_segment = lens.sections[0].segments[0]
        assert text_segment.type == "text"
        assert "This is the introduction text." in text_segment.content
        assert "multiple lines" in text_segment.content

    def test_parse_lens_chat_segment_flags(self):
        """Should parse Chat segment with hide flags."""
        from core.modules.markdown_parser import parse_lens

        text = """---
id: 88888888-8888-8888-8888-888888888888
---
### Article: Test
source:: [[article]]

#### Article-excerpt

#### Chat
hidePreviousContentFromUser:: true
hidePreviousContentFromTutor:: false
instructions::
Discuss this.
"""
        lens = parse_lens(text)
        chat_segment = lens.sections[0].segments[1]
        assert chat_segment.type == "chat"
        assert chat_segment.hide_previous_content_from_user is True
        assert chat_segment.hide_previous_content_from_tutor is False
        assert "Discuss this." in chat_segment.instructions

    def test_parse_lens_strips_critic_markup(self):
        """Critic markup should be stripped from Lens content."""
        from core.modules.markdown_parser import parse_lens

        text = """---
id: 99999999-9999-9999-9999-999999999999
---
### Video: Test
source:: [[video]]

#### Text
content::
Hello{>>comment<<} world{++addition++}

#### Video-excerpt
"""
        lens = parse_lens(text)
        text_segment = lens.sections[0].segments[0]
        # Comments should be stripped, additions rejected
        assert "Hello world" in text_segment.content
        assert "comment" not in text_segment.content
        assert "addition" not in text_segment.content
