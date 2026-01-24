# core/modules/tests/test_markdown_validator.py
"""Tests for the Markdown module/course validator."""

from core.modules.markdown_validator import (
    validate_lesson,
    validate_course,
    validate_lesson_file,
    validate_course_file,
    ValidationError,
)


class TestValidateLessonValid:
    """Test that valid lessons pass validation."""

    def test_valid_minimal_lesson(self):
        """A minimal valid lesson should pass."""
        text = """---
slug: test-lesson
title: Test Lesson
---

# Text: Introduction
content::
Hello world
"""
        errors = validate_lesson(text)
        assert errors == []

    def test_valid_video_section(self):
        """A valid video section with segments should pass."""
        text = """---
slug: test
title: Test
---

# Video: Test Video
source:: [[video_transcripts/test]]

## Text
content::
Watch this.

## Video-excerpt
from:: 0:00
to:: 5:00

## Chat
instructions::
Discuss what you saw.
"""
        errors = validate_lesson(text)
        assert errors == []

    def test_valid_article_section(self):
        """A valid article section with segments should pass."""
        text = """---
slug: test
title: Test
---

# Article: Test Article
source:: [[articles/test]]

## Text
content::
Read this.

## Article-excerpt
from:: "Start here"
to:: "End here"
"""
        errors = validate_lesson(text)
        assert errors == []

    def test_valid_chat_section(self):
        """A valid standalone chat section should pass."""
        text = """---
slug: test
title: Test
---

# Chat: Discussion
instructions::
Ask the user questions.
"""
        errors = validate_lesson(text)
        assert errors == []


class TestValidateLessonFrontmatter:
    """Test frontmatter validation."""

    def test_missing_frontmatter(self):
        """Missing frontmatter should error."""
        text = """# Text: Introduction
content::
Hello world
"""
        errors = validate_lesson(text)
        assert len(errors) >= 1
        assert any("frontmatter" in str(e).lower() for e in errors)

    def test_missing_slug(self):
        """Missing slug should error."""
        text = """---
title: Test
---

# Text: Intro
content::
Hello
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "slug" in errors[0].message

    def test_missing_title(self):
        """Missing title should error."""
        text = """---
slug: test
---

# Text: Intro
content::
Hello
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "title" in errors[0].message

    def test_empty_frontmatter(self):
        """Empty frontmatter (---\\n---) is treated as missing frontmatter."""
        text = """---
---

# Text: Intro
content::
Hello
"""
        errors = validate_lesson(text)
        # Empty frontmatter doesn't match the pattern, so it's "missing"
        assert len(errors) >= 1
        assert any("frontmatter" in str(e).lower() for e in errors)


class TestValidateLessonSectionTypes:
    """Test section type validation."""

    def test_invalid_section_type(self):
        """Invalid section type should error."""
        text = """---
slug: test
title: Test
---

# Invalid: Something
content::
Hello
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "Invalid section type" in errors[0].message


class TestValidateLessonSectionFields:
    """Test required fields for sections."""

    def test_video_missing_source(self):
        """Video section without source should error."""
        text = """---
slug: test
title: Test
---

# Video: Test Video

## Text
content::
Watch this.
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "source" in errors[0].message

    def test_article_missing_source(self):
        """Article section without source should error."""
        text = """---
slug: test
title: Test
---

# Article: Test Article

## Text
content::
Read this.
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "source" in errors[0].message

    def test_text_section_missing_content(self):
        """Text section without content should error."""
        text = """---
slug: test
title: Test
---

# Text: Summary
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "content" in errors[0].message

    def test_chat_section_missing_instructions(self):
        """Chat section without instructions should error."""
        text = """---
slug: test
title: Test
---

# Chat: Discussion
hidePreviousContentFromUser:: true
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "instructions" in errors[0].message


class TestValidateLessonSegments:
    """Test segment validation within sections."""

    def test_invalid_segment_type(self):
        """Invalid segment type should error."""
        text = """---
slug: test
title: Test
---

# Video: Test
source:: [[video_transcripts/test]]

## Invalid
content::
Something
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "Invalid segment type" in errors[0].message

    def test_text_segment_missing_content(self):
        """Text segment without content should error."""
        text = """---
slug: test
title: Test
---

# Video: Test
source:: [[video_transcripts/test]]

## Text
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "content" in errors[0].message

    def test_chat_segment_missing_instructions(self):
        """Chat segment without instructions should error."""
        text = """---
slug: test
title: Test
---

# Video: Test
source:: [[video_transcripts/test]]

## Chat
hidePreviousContentFromUser:: true
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "instructions" in errors[0].message

    def test_video_excerpt_optional_fields(self):
        """Video-excerpt from/to are optional (omit = full range)."""
        text = """---
slug: test
title: Test
---

# Video: Test
source:: [[video_transcripts/test]]

## Video-excerpt
to:: 5:00

## Video-excerpt
from:: 0:00

## Video-excerpt
"""
        errors = validate_lesson(text)
        assert errors == []

    def test_article_excerpt_optional_fields(self):
        """Article-excerpt from/to are optional (omit = full range)."""
        text = """---
slug: test
title: Test
---

# Article: Test
source:: [[articles/test]]

## Article-excerpt
to:: "End"

## Article-excerpt
from:: "Start"

## Article-excerpt
"""
        errors = validate_lesson(text)
        assert errors == []


class TestValidateLessonSegmentSectionMismatch:
    """Test that segments match their parent section type."""

    def test_article_excerpt_in_video_section(self):
        """Article-excerpt in video section should error."""
        text = """---
slug: test
title: Test
---

# Video: Test
source:: [[video_transcripts/test]]

## Article-excerpt
from:: "Start"
to:: "End"
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "Article-excerpt" in errors[0].message
        assert "Video section" in errors[0].message

    def test_video_excerpt_in_article_section(self):
        """Video-excerpt in article section should error."""
        text = """---
slug: test
title: Test
---

# Article: Test
source:: [[articles/test]]

## Video-excerpt
from:: 0:00
to:: 5:00
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "Video-excerpt" in errors[0].message
        assert "Article section" in errors[0].message


class TestValidateLessonInvalidFieldsOnSections:
    """Test that sections reject fields that don't belong to them."""

    def test_article_section_with_content_field(self):
        """Article section should not have content:: (that's for Text sections)."""
        text = """---
slug: test
title: Test
---

# Article: Most Important Century
source:: [[articles/karnofsky-most-important-century]]
content:: hello there
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "content::" in errors[0].message
        assert "unknown" in errors[0].message.lower()

    def test_video_section_with_content_field(self):
        """Video section should not have content:: (that's for Text sections)."""
        text = """---
slug: test
title: Test
---

# Video: Introduction
source:: [[video_transcripts/intro]]
content:: this should not be here
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "content::" in errors[0].message
        assert "unknown" in errors[0].message.lower()

    def test_article_section_with_instructions_field(self):
        """Article section should not have instructions:: (that's for Chat sections)."""
        text = """---
slug: test
title: Test
---

# Article: Some Reading
source:: [[articles/some-article]]
instructions:: discuss this article
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "instructions::" in errors[0].message
        assert "unknown" in errors[0].message.lower()

    def test_video_section_with_instructions_field(self):
        """Video section should not have instructions:: (that's for Chat sections)."""
        text = """---
slug: test
title: Test
---

# Video: Watch This
source:: [[video_transcripts/watch-this]]
instructions:: talk about the video
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "instructions::" in errors[0].message
        assert "unknown" in errors[0].message.lower()

    def test_text_section_with_source_field(self):
        """Text section should not have source:: (that's for Video/Article sections)."""
        text = """---
slug: test
title: Test
---

# Text: Summary
source:: [[somewhere/something]]
content:: This is the summary.
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "source::" in errors[0].message
        assert "unknown" in errors[0].message.lower()

    def test_chat_section_with_source_field(self):
        """Chat section should not have source:: (that's for Video/Article sections)."""
        text = """---
slug: test
title: Test
---

# Chat: Discussion
source:: [[somewhere/something]]
instructions:: Let's discuss.
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "source::" in errors[0].message
        assert "unknown" in errors[0].message.lower()


class TestValidateLessonUnknownFields:
    """Test that unknown fields are rejected."""

    def test_unknown_field_on_video_section(self):
        """Unknown field on Video section should error."""
        text = """---
slug: test
title: Test
---

# Video: Test
source:: [[video_transcripts/test]]
foo:: bar
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "foo::" in errors[0].message
        assert "unknown" in errors[0].message.lower()

    def test_unknown_field_on_article_section(self):
        """Unknown field on Article section should error."""
        text = """---
slug: test
title: Test
---

# Article: Test
source:: [[articles/test]]
randomfield:: something
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "randomfield::" in errors[0].message

    def test_unknown_field_on_text_section(self):
        """Unknown field on Text section should error."""
        text = """---
slug: test
title: Test
---

# Text: Summary
content:: This is the summary.
extra:: not allowed
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "extra::" in errors[0].message

    def test_unknown_field_on_chat_section(self):
        """Unknown field on Chat section should error."""
        text = """---
slug: test
title: Test
---

# Chat: Discussion
instructions:: Let's discuss.
badfield:: nope
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "badfield::" in errors[0].message

    def test_unknown_field_on_text_segment(self):
        """Unknown field on Text segment should error."""
        text = """---
slug: test
title: Test
---

# Video: Test
source:: [[video_transcripts/test]]

## Text
content:: Watch this.
mystery:: value
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "mystery::" in errors[0].message

    def test_unknown_field_on_chat_segment(self):
        """Unknown field on Chat segment should error."""
        text = """---
slug: test
title: Test
---

# Video: Test
source:: [[video_transcripts/test]]

## Chat
instructions:: Discuss.
weird:: stuff
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "weird::" in errors[0].message

    def test_unknown_field_on_video_excerpt_segment(self):
        """Unknown field on Video-excerpt segment should error."""
        text = """---
slug: test
title: Test
---

# Video: Test
source:: [[video_transcripts/test]]

## Video-excerpt
from:: 0:00
to:: 5:00
invalid:: field
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "invalid::" in errors[0].message

    def test_unknown_field_on_article_excerpt_segment(self):
        """Unknown field on Article-excerpt segment should error."""
        text = """---
slug: test
title: Test
---

# Article: Test
source:: [[articles/test]]

## Article-excerpt
from:: "Start"
to:: "End"
notallowed:: here
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "notallowed::" in errors[0].message


class TestSegmentTitles:
    """Test that segments can have optional titles like ## Chat: Discussion Title."""

    def test_chat_segment_with_title_is_valid(self):
        """Chat segment with title should be valid."""
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
        errors = validate_lesson(text)
        assert errors == [], f"Expected no errors but got: {errors}"

    def test_text_segment_with_title_is_valid(self):
        """Text segment with title should be valid."""
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
        errors = validate_lesson(text)
        assert errors == [], f"Expected no errors but got: {errors}"

    def test_chat_segment_with_title_validates_fields(self):
        """Chat segment with title should still validate its fields."""
        text = """---
slug: test
title: Test
---

# Video: Test Video
source:: [[video_transcripts/test]]

## Chat: Discussion Title
hidePreviousContentFromUser:: true
hidePreviousContentFromTutor:: false
instructions::
Ask the user about the video.
"""
        errors = validate_lesson(text)
        assert errors == [], f"Expected no errors but got: {errors}"

    def test_chat_segment_with_title_missing_instructions_errors(self):
        """Chat segment with title but missing instructions should error."""
        text = """---
slug: test
title: Test
---

# Video: Test Video
source:: [[video_transcripts/test]]

## Chat: Discussion Title
hidePreviousContentFromUser:: true
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "instructions" in errors[0].message


class TestValidateLessonMultipleErrors:
    """Test that multiple errors are collected."""

    def test_multiple_errors_collected(self):
        """All errors should be collected, not just first."""
        text = """---
slug: test
title: Test
---

# Video: First
source:: [[video_transcripts/v1]]

## Text

## Chat

# Article: Second

## Text
"""
        errors = validate_lesson(text)
        # Should have:
        # - text segment missing content (1 error)
        # - chat segment missing instructions (1 error)
        # - article missing source (1 error)
        # - text segment missing content (1 error)
        assert len(errors) == 4


class TestValidateCourse:
    """Test course validation."""

    def test_valid_course(self):
        """A valid course should pass."""
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
        errors = validate_course(text)
        assert errors == []

    def test_course_missing_frontmatter(self):
        """Course without frontmatter should error."""
        text = """# Lesson: [[lessons/intro]]

# Meeting: 1
"""
        errors = validate_course(text)
        assert any("frontmatter" in str(e).lower() for e in errors)

    def test_course_missing_slug(self):
        """Course without slug should error."""
        text = """---
title: Test Course
---

# Lesson: [[lessons/intro]]
"""
        errors = validate_course(text)
        assert len(errors) == 1
        assert "slug" in errors[0].message

    def test_course_lesson_without_wiki_link(self):
        """Lesson reference without wiki-link should error."""
        text = """---
slug: test
title: Test
---

# Lesson: lessons/intro
"""
        errors = validate_course(text)
        assert len(errors) == 1
        assert "wiki-link" in errors[0].message.lower()


class TestValidateLessonFile:
    """Test file-based validation."""

    def test_file_not_found(self, tmp_path):
        """Non-existent file should return error."""
        result = validate_lesson_file(tmp_path / "nonexistent.md")
        assert not result.is_valid
        assert any("not found" in str(e).lower() for e in result.errors)

    def test_valid_file(self, tmp_path):
        """Valid file should pass."""
        md_file = tmp_path / "lesson.md"
        md_file.write_text("""---
slug: test
title: Test
---

# Text: Intro
content::
Hello
""")
        result = validate_lesson_file(md_file)
        assert result.is_valid
        assert result.path == md_file


class TestValidationErrorFormatting:
    """Test that validation errors format nicely."""

    def test_error_with_line_and_context(self):
        """Error should include line number and context."""
        error = ValidationError(
            message="Missing field",
            line=10,
            context="# Video: Test",
        )
        formatted = str(error)
        assert "line 10" in formatted
        assert "# Video: Test" in formatted
        assert "Missing field" in formatted

    def test_error_without_line(self):
        """Error without line should still format."""
        error = ValidationError(
            message="Missing field",
            context="frontmatter",
        )
        formatted = str(error)
        assert "frontmatter" in formatted
        assert "Missing field" in formatted


class TestValidateWikiLinks:
    """Test that wiki-links are validated against existing files.

    Wiki-links use relative paths from the file's location, e.g.:
    - From modules/lesson.md: [[../video_transcripts/intro]]
    - From courses/default.md: [[../modules/intro]]
    """

    def test_lesson_with_valid_video_source(self, tmp_path):
        """Lesson with valid video source should pass."""
        # Create directory structure
        (tmp_path / "modules").mkdir()
        (tmp_path / "video_transcripts").mkdir()

        # Create the referenced video transcript
        (tmp_path / "video_transcripts" / "intro.md").write_text(
            "---\ntitle: Intro\n---\n"
        )

        # Create the lesson - uses relative path ../video_transcripts/intro
        lesson = tmp_path / "modules" / "lesson.md"
        lesson.write_text("""---
slug: test
title: Test
---

# Video: Introduction
source:: [[../video_transcripts/intro]]

## Video-excerpt
""")

        result = validate_lesson_file(lesson)
        assert result.is_valid, f"Unexpected errors: {result.errors}"

    def test_lesson_with_missing_video_source(self, tmp_path):
        """Lesson with missing video source should error."""
        # Create directory structure
        (tmp_path / "modules").mkdir()
        # Note: NOT creating the video_transcripts file

        lesson = tmp_path / "modules" / "lesson.md"
        lesson.write_text("""---
slug: test
title: Test
---

# Video: Introduction
source:: [[../video_transcripts/nonexistent]]

## Video-excerpt
""")

        result = validate_lesson_file(lesson)
        assert not result.is_valid
        assert len(result.errors) == 1
        assert "video_transcripts/nonexistent" in result.errors[0].message
        assert "not found" in result.errors[0].message.lower()

    def test_lesson_with_valid_article_source(self, tmp_path):
        """Lesson with valid article source should pass."""
        (tmp_path / "modules").mkdir()
        (tmp_path / "articles").mkdir()

        # Create the referenced article
        (tmp_path / "articles" / "safety.md").write_text("---\ntitle: Safety\n---\n")

        lesson = tmp_path / "modules" / "lesson.md"
        lesson.write_text("""---
slug: test
title: Test
---

# Article: AI Safety
source:: [[../articles/safety]]

## Article-excerpt
""")

        result = validate_lesson_file(lesson)
        assert result.is_valid, f"Unexpected errors: {result.errors}"

    def test_lesson_with_missing_article_source(self, tmp_path):
        """Lesson with missing article source should error."""
        (tmp_path / "modules").mkdir()

        lesson = tmp_path / "modules" / "lesson.md"
        lesson.write_text("""---
slug: test
title: Test
---

# Article: Missing Article
source:: [[../articles/missing]]

## Article-excerpt
""")

        result = validate_lesson_file(lesson)
        assert not result.is_valid
        assert len(result.errors) == 1
        assert "articles/missing" in result.errors[0].message
        assert "not found" in result.errors[0].message.lower()

    def test_course_with_valid_lesson_refs(self, tmp_path):
        """Course with valid lesson references should pass."""
        (tmp_path / "courses").mkdir()
        (tmp_path / "modules").mkdir()

        # Create referenced lessons
        (tmp_path / "modules" / "intro.md").write_text(
            "---\nslug: intro\ntitle: Intro\n---\n# Text: Hi\ncontent:: hello\n"
        )
        (tmp_path / "modules" / "advanced.md").write_text(
            "---\nslug: advanced\ntitle: Advanced\n---\n# Text: Hi\ncontent:: hello\n"
        )

        course = tmp_path / "courses" / "default.md"
        course.write_text("""---
slug: default
title: Default Course
---

# Lesson: [[../modules/intro]]

# Meeting: 1

# Lesson: [[../modules/advanced]]
""")

        result = validate_course_file(course)
        assert result.is_valid, f"Unexpected errors: {result.errors}"

    def test_course_with_missing_lesson_ref(self, tmp_path):
        """Course with missing lesson reference should error."""
        (tmp_path / "courses").mkdir()
        (tmp_path / "modules").mkdir()

        # Only create one lesson
        (tmp_path / "modules" / "intro.md").write_text(
            "---\nslug: intro\ntitle: Intro\n---\n# Text: Hi\ncontent:: hello\n"
        )

        course = tmp_path / "courses" / "default.md"
        course.write_text("""---
slug: default
title: Default Course
---

# Lesson: [[../modules/intro]]

# Lesson: [[../modules/nonexistent]]
""")

        result = validate_course_file(course)
        assert not result.is_valid
        assert len(result.errors) == 1
        assert "modules/nonexistent" in result.errors[0].message
        assert "not found" in result.errors[0].message.lower()

    def test_multiple_missing_sources(self, tmp_path):
        """Multiple missing sources should all be reported."""
        (tmp_path / "modules").mkdir()

        lesson = tmp_path / "modules" / "lesson.md"
        lesson.write_text("""---
slug: test
title: Test
---

# Video: First
source:: [[../video_transcripts/missing1]]

## Video-excerpt

# Article: Second
source:: [[../articles/missing2]]

## Article-excerpt
""")

        result = validate_lesson_file(lesson)
        assert not result.is_valid
        assert len(result.errors) == 2
        error_messages = [str(e) for e in result.errors]
        assert any("video_transcripts/missing1" in msg for msg in error_messages)
        assert any("articles/missing2" in msg for msg in error_messages)
