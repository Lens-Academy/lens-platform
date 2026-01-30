# core/modules/tests/test_markdown_validator.py
"""Tests for the Markdown module/course validator."""

from core.modules.markdown_validator import (
    validate_lesson,
    validate_module,
    validate_course,
    validate_lesson_file,
    validate_course_file,
    validate_learning_outcome,
    validate_lens,
    ValidationError,
)


class TestValidateLessonValid:
    """Test that valid lessons pass validation."""

    def test_valid_minimal_lesson(self):
        """A minimal valid lesson should pass (v2 format with Page)."""
        text = """---
slug: test-lesson
title: Test Lesson
---

# Page: Introduction
id:: 11111111-1111-1111-1111-111111111111
## Text
content::
Hello world
"""
        errors = validate_lesson(text)
        assert errors == []

    def test_valid_page_with_text_and_chat(self):
        """A valid Page with Text and Chat segments should pass."""
        text = """---
slug: test
title: Test
---

# Page: Test Page
id:: 11111111-1111-1111-1111-111111111111

## Text
content::
Watch this.

## Chat
instructions::
Discuss what you saw.
"""
        errors = validate_lesson(text)
        assert errors == []

    def test_valid_learning_outcome_ref(self):
        """A valid Learning Outcome reference should pass."""
        text = """---
slug: test
title: Test
---

# Learning Outcome:
source:: [[../Learning Outcomes/Core Concepts]]
"""
        errors = validate_lesson(text)
        assert errors == []

    def test_valid_uncategorized_with_lens(self):
        """A valid Uncategorized section with Lens should pass."""
        text = """---
slug: test
title: Test
---

# Uncategorized:
## Lens:
source:: [[../Lenses/Some Lens]]
"""
        errors = validate_lesson(text)
        assert errors == []


class TestValidateLessonFrontmatter:
    """Test frontmatter validation."""

    def test_missing_frontmatter(self):
        """Missing frontmatter should error."""
        text = """# Page: Introduction
id:: 11111111-1111-1111-1111-111111111111
## Text
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

# Page: Intro
id:: 11111111-1111-1111-1111-111111111111
## Text
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

# Page: Intro
id:: 11111111-1111-1111-1111-111111111111
## Text
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

# Page: Intro
id:: 11111111-1111-1111-1111-111111111111
## Text
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
    """Test required fields for sections (v2 format)."""

    def test_page_missing_id(self):
        """Page section without id should error."""
        text = """---
slug: test
title: Test
---

# Page: Test Page

## Text
content::
Hello
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "id::" in errors[0].message

    def test_learning_outcome_missing_source(self):
        """Learning Outcome section without source should error."""
        text = """---
slug: test
title: Test
---

# Learning Outcome:
optional:: true
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "source" in errors[0].message

    def test_uncategorized_requires_lens(self):
        """Uncategorized section without Lens should error."""
        text = """---
slug: test
title: Test
---

# Uncategorized:
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "lens" in errors[0].message.lower()


class TestValidateLessonSegments:
    """Test segment validation within Page sections (v2 format)."""

    def test_invalid_segment_type(self):
        """Invalid segment type should error."""
        text = """---
slug: test
title: Test
---

# Page: Test
id:: 11111111-1111-1111-1111-111111111111

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

# Page: Test
id:: 11111111-1111-1111-1111-111111111111

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

# Page: Test
id:: 11111111-1111-1111-1111-111111111111

## Chat
hidePreviousContentFromUser:: true
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "instructions" in errors[0].message

    def test_video_excerpt_in_page_disallowed(self):
        """Video-excerpt segment not allowed in Page section."""
        text = """---
slug: test
title: Test
---

# Page: Test
id:: 11111111-1111-1111-1111-111111111111

## Video-excerpt
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "video-excerpt" in errors[0].message.lower()

    def test_article_excerpt_in_page_disallowed(self):
        """Article-excerpt segment not allowed in Page section."""
        text = """---
slug: test
title: Test
---

# Page: Test
id:: 11111111-1111-1111-1111-111111111111

## Article-excerpt
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "article-excerpt" in errors[0].message.lower()


class TestValidateLessonInvalidFieldsOnSections:
    """Test that v2 sections reject fields that don't belong to them."""

    def test_page_section_with_source_field(self):
        """Page section should not have source:: (only id:: and optional::)."""
        text = """---
slug: test
title: Test
---

# Page: Test
id:: 11111111-1111-1111-1111-111111111111
source:: [[somewhere/something]]
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "source::" in errors[0].message
        assert "unknown" in errors[0].message.lower()

    def test_page_section_with_content_field(self):
        """Page section should not have content:: (that's for Text segments)."""
        text = """---
slug: test
title: Test
---

# Page: Test
id:: 11111111-1111-1111-1111-111111111111
content:: this should be in a ## Text segment
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "content::" in errors[0].message
        assert "unknown" in errors[0].message.lower()

    def test_learning_outcome_with_content_field(self):
        """Learning Outcome should not have content:: (only source:: and optional::)."""
        text = """---
slug: test
title: Test
---

# Learning Outcome:
source:: [[../Learning Outcomes/Foo]]
content:: this should not be here
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "content::" in errors[0].message
        assert "unknown" in errors[0].message.lower()


class TestValidateLessonUnknownFields:
    """Test that unknown fields are rejected in v2 format."""

    def test_unknown_field_on_page_section(self):
        """Unknown field on Page section should error."""
        text = """---
slug: test
title: Test
---

# Page: Test
id:: 11111111-1111-1111-1111-111111111111
foo:: bar
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "foo::" in errors[0].message
        assert "unknown" in errors[0].message.lower()

    def test_unknown_field_on_learning_outcome_section(self):
        """Unknown field on Learning Outcome section should error."""
        text = """---
slug: test
title: Test
---

# Learning Outcome:
source:: [[../Learning Outcomes/Foo]]
randomfield:: something
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "randomfield::" in errors[0].message

    def test_unknown_field_on_text_segment(self):
        """Unknown field on Text segment should error."""
        text = """---
slug: test
title: Test
---

# Page: Test
id:: 11111111-1111-1111-1111-111111111111

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

# Page: Test
id:: 11111111-1111-1111-1111-111111111111

## Chat
instructions:: Discuss.
weird:: stuff
"""
        errors = validate_lesson(text)
        assert len(errors) == 1
        assert "weird::" in errors[0].message


class TestSegmentTitles:
    """Test that segments can have optional titles like ## Chat: Discussion Title."""

    def test_chat_segment_with_title_is_valid(self):
        """Chat segment with title should be valid."""
        text = """---
slug: test
title: Test
---

# Page: Test Page
id:: 11111111-1111-1111-1111-111111111111

## Text
content::
What did you think?

## Chat: Discussion on the Topic
instructions::
Discuss what the user just read.
"""
        errors = validate_lesson(text)
        assert errors == [], f"Expected no errors but got: {errors}"

    def test_text_segment_with_title_is_valid(self):
        """Text segment with title should be valid."""
        text = """---
slug: test
title: Test
---

# Page: Test Page
id:: 11111111-1111-1111-1111-111111111111

## Text: Key Takeaways
content::
Here are the main points.
"""
        errors = validate_lesson(text)
        assert errors == [], f"Expected no errors but got: {errors}"

    def test_chat_segment_with_title_validates_fields(self):
        """Chat segment with title should still validate its fields."""
        text = """---
slug: test
title: Test
---

# Page: Test Page
id:: 11111111-1111-1111-1111-111111111111

## Chat: Discussion Title
hidePreviousContentFromUser:: true
hidePreviousContentFromTutor:: false
instructions::
Ask the user about the topic.
"""
        errors = validate_lesson(text)
        assert errors == [], f"Expected no errors but got: {errors}"

    def test_chat_segment_with_title_missing_instructions_errors(self):
        """Chat segment with title but missing instructions should error."""
        text = """---
slug: test
title: Test
---

# Page: Test Page
id:: 11111111-1111-1111-1111-111111111111

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

# Page: First
id:: 11111111-1111-1111-1111-111111111111

## Text

## Chat

# Page: Second

## Text
"""
        errors = validate_lesson(text)
        # Should have:
        # - text segment missing content (1 error)
        # - chat segment missing instructions (1 error)
        # - Page Second missing id (1 error)
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
        """Valid file should pass (v2 format)."""
        md_file = tmp_path / "lesson.md"
        md_file.write_text("""---
slug: test
title: Test
---

# Page: Intro
id:: 11111111-1111-1111-1111-111111111111
## Text
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
            context="# Page: Test",
        )
        formatted = str(error)
        assert "line 10" in formatted
        assert "# Page: Test" in formatted
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
    - From modules/lesson.md: [[../Learning Outcomes/intro]]
    - From courses/default.md: [[../modules/intro]]
    """

    def test_lesson_with_valid_learning_outcome_source(self, tmp_path):
        """Lesson with valid Learning Outcome source should pass."""
        # Create directory structure
        (tmp_path / "modules").mkdir()
        (tmp_path / "Learning Outcomes").mkdir()

        # Create the referenced Learning Outcome
        (tmp_path / "Learning Outcomes" / "intro.md").write_text(
            "---\nid: 11111111-1111-1111-1111-111111111111\n---\n## Lens:\nsource:: [[../Lenses/Foo]]\n"
        )

        # Create the lesson - uses relative path ../Learning Outcomes/intro
        lesson = tmp_path / "modules" / "lesson.md"
        lesson.write_text("""---
slug: test
title: Test
---

# Learning Outcome:
source:: [[../Learning Outcomes/intro]]
""")

        result = validate_lesson_file(lesson)
        assert result.is_valid, f"Unexpected errors: {result.errors}"

    def test_lesson_with_missing_learning_outcome_source(self, tmp_path):
        """Lesson with missing Learning Outcome source should error."""
        # Create directory structure
        (tmp_path / "modules").mkdir()
        # Note: NOT creating the Learning Outcomes file

        lesson = tmp_path / "modules" / "lesson.md"
        lesson.write_text("""---
slug: test
title: Test
---

# Learning Outcome:
source:: [[../Learning Outcomes/nonexistent]]
""")

        result = validate_lesson_file(lesson)
        assert not result.is_valid
        assert len(result.errors) == 1
        assert "Learning Outcomes/nonexistent" in result.errors[0].message
        assert "not found" in result.errors[0].message.lower()

    def test_lesson_with_valid_lens_source(self, tmp_path):
        """Lesson with valid Lens source should pass."""
        (tmp_path / "modules").mkdir()
        (tmp_path / "Lenses").mkdir()

        # Create the referenced Lens
        (tmp_path / "Lenses" / "safety.md").write_text(
            "---\nid: 11111111-1111-1111-1111-111111111111\n---\n### Video: Foo\nsource:: [[../vids/foo]]\n#### Video-excerpt\n"
        )

        lesson = tmp_path / "modules" / "lesson.md"
        lesson.write_text("""---
slug: test
title: Test
---

# Uncategorized:
## Lens:
source:: [[../Lenses/safety]]
""")

        result = validate_lesson_file(lesson)
        assert result.is_valid, f"Unexpected errors: {result.errors}"

    def test_lesson_with_missing_lens_source(self, tmp_path):
        """Lesson with missing Lens source should error."""
        (tmp_path / "modules").mkdir()

        lesson = tmp_path / "modules" / "lesson.md"
        lesson.write_text("""---
slug: test
title: Test
---

# Uncategorized:
## Lens:
source:: [[../Lenses/missing]]
""")

        result = validate_lesson_file(lesson)
        assert not result.is_valid
        assert len(result.errors) == 1
        assert "Lenses/missing" in result.errors[0].message
        assert "not found" in result.errors[0].message.lower()

    def test_course_with_valid_lesson_refs(self, tmp_path):
        """Course with valid lesson references should pass."""
        (tmp_path / "courses").mkdir()
        (tmp_path / "modules").mkdir()

        # Create referenced lessons (v2 format)
        (tmp_path / "modules" / "intro.md").write_text(
            "---\nslug: intro\ntitle: Intro\n---\n# Page: Hi\nid:: 11111111-1111-1111-1111-111111111111\n## Text\ncontent:: hello\n"
        )
        (tmp_path / "modules" / "advanced.md").write_text(
            "---\nslug: advanced\ntitle: Advanced\n---\n# Page: Hi\nid:: 22222222-2222-2222-2222-222222222222\n## Text\ncontent:: hello\n"
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

        # Only create one lesson (v2 format)
        (tmp_path / "modules" / "intro.md").write_text(
            "---\nslug: intro\ntitle: Intro\n---\n# Page: Hi\nid:: 11111111-1111-1111-1111-111111111111\n## Text\ncontent:: hello\n"
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

# Learning Outcome:
source:: [[../Learning Outcomes/missing1]]

# Uncategorized:
## Lens:
source:: [[../Lenses/missing2]]
""")

        result = validate_lesson_file(lesson)
        assert not result.is_valid
        assert len(result.errors) == 2
        error_messages = [str(e) for e in result.errors]
        assert any("Learning Outcomes/missing1" in msg for msg in error_messages)
        assert any("Lenses/missing2" in msg for msg in error_messages)


class TestValidateModuleFunction:
    """Test the new validate_module function and its alias."""

    def test_validate_module_exists_and_works(self):
        """validate_module should be the main validation function (v2 format)."""
        text = """---
slug: test
title: Test
---

# Page: Introduction
id:: 11111111-1111-1111-1111-111111111111
## Text
content::
Hello world
"""
        errors = validate_module(text)
        assert errors == []

    def test_validate_lesson_is_alias_for_validate_module(self):
        """validate_lesson should be an alias for validate_module."""
        text = """---
slug: test
title: Test
---

# Page: Introduction
id:: 11111111-1111-1111-1111-111111111111
## Text
content::
Hello world
"""
        # Both should return the same result
        module_errors = validate_module(text)
        lesson_errors = validate_lesson(text)
        assert module_errors == lesson_errors


class TestValidatePageSection:
    """Test validation of # Page: sections."""

    def test_valid_page_section(self):
        """Valid Page section should pass."""
        text = """---
slug: test
title: Test
---

# Page: Welcome
id:: 11111111-1111-1111-1111-111111111111
## Text
content::
Hello world
"""
        errors = validate_module(text)
        assert errors == []

    def test_page_section_missing_id(self):
        """Page section without id should error."""
        text = """---
slug: test
title: Test
---

# Page: Welcome
## Text
content::
Hello world
"""
        errors = validate_module(text)
        assert len(errors) == 1
        assert "id::" in errors[0].message

    def test_page_section_missing_title(self):
        """Page section without title should error."""
        text = """---
slug: test
title: Test
---

# Page:
id:: 11111111-1111-1111-1111-111111111111
## Text
content::
Hello
"""
        errors = validate_module(text)
        assert len(errors) == 1
        assert "title" in errors[0].message.lower()

    def test_page_section_with_optional_field(self):
        """Page section with optional field should pass."""
        text = """---
slug: test
title: Test
---

# Page: Welcome
id:: 11111111-1111-1111-1111-111111111111
optional:: true
## Text
content::
Hello world
"""
        errors = validate_module(text)
        assert errors == []


class TestValidateLearningOutcomeRef:
    """Test validation of # Learning Outcome: sections."""

    def test_valid_learning_outcome_ref(self):
        """Valid Learning Outcome ref should pass."""
        text = """---
slug: test
title: Test
---

# Learning Outcome:
source:: [[../Learning Outcomes/Core Concepts]]
"""
        errors = validate_module(text)
        assert errors == []

    def test_learning_outcome_missing_source(self):
        """Learning Outcome without source should error."""
        text = """---
slug: test
title: Test
---

# Learning Outcome:
optional:: true
"""
        errors = validate_module(text)
        assert len(errors) == 1
        assert "source" in errors[0].message

    def test_learning_outcome_with_embed_syntax(self):
        """![[embed]] syntax should be valid."""
        text = """---
slug: test
title: Test
---

# Learning Outcome:
source:: ![[../Learning Outcomes/Core Concepts]]
"""
        errors = validate_module(text)
        assert errors == []

    def test_learning_outcome_with_optional_field(self):
        """Learning Outcome with optional field should pass."""
        text = """---
slug: test
title: Test
---

# Learning Outcome:
source:: [[../Learning Outcomes/Core Concepts]]
optional:: true
"""
        errors = validate_module(text)
        assert errors == []

    def test_learning_outcome_with_title_should_error(self):
        """Learning Outcome with title should error (no title allowed)."""
        text = """---
slug: test
title: Test
---

# Learning Outcome: Some Title
source:: [[../Learning Outcomes/Core Concepts]]
"""
        errors = validate_module(text)
        assert len(errors) == 1
        assert "title" in errors[0].message.lower()


class TestValidateUncategorizedSection:
    """Test validation of # Uncategorized: sections."""

    def test_valid_uncategorized_section(self):
        """Valid Uncategorized section should pass."""
        text = """---
slug: test
title: Test
---

# Uncategorized:
## Lens:
source:: [[../Lenses/Some Lens]]
"""
        errors = validate_module(text)
        assert errors == []

    def test_uncategorized_requires_lens(self):
        """Uncategorized without any Lens should error."""
        text = """---
slug: test
title: Test
---

# Uncategorized:
"""
        errors = validate_module(text)
        assert len(errors) == 1
        assert "lens" in errors[0].message.lower()

    def test_lens_in_uncategorized_missing_source(self):
        """Lens in Uncategorized without source should error."""
        text = """---
slug: test
title: Test
---

# Uncategorized:
## Lens:
optional:: true
"""
        errors = validate_module(text)
        assert len(errors) == 1
        assert "source" in errors[0].message

    def test_uncategorized_with_title_should_error(self):
        """Uncategorized with title should error (no title allowed)."""
        text = """---
slug: test
title: Test
---

# Uncategorized: Some Title
## Lens:
source:: [[../Lenses/Some Lens]]
"""
        errors = validate_module(text)
        assert len(errors) == 1
        assert "title" in errors[0].message.lower()

    def test_uncategorized_with_multiple_lenses(self):
        """Uncategorized with multiple Lens sections should pass."""
        text = """---
slug: test
title: Test
---

# Uncategorized:
## Lens:
source:: [[../Lenses/First Lens]]
## Lens:
source:: [[../Lenses/Second Lens]]
"""
        errors = validate_module(text)
        assert errors == []

    def test_lens_with_optional_field(self):
        """Lens with optional field should pass."""
        text = """---
slug: test
title: Test
---

# Uncategorized:
## Lens:
source:: [[../Lenses/Some Lens]]
optional:: true
"""
        errors = validate_module(text)
        assert errors == []


class TestWikiLinkEmbedSyntax:
    """Test that ![[embed]] wiki-link syntax is handled."""

    def test_embed_syntax_in_source_field(self, tmp_path):
        """![[embed]] syntax should be recognized as valid wiki-link."""
        (tmp_path / "modules").mkdir()
        (tmp_path / "Learning Outcomes").mkdir()

        # Create the referenced file
        (tmp_path / "Learning Outcomes" / "Core Concepts.md").write_text(
            "---\ntitle: Core Concepts\n---\n"
        )

        lesson = tmp_path / "modules" / "lesson.md"
        lesson.write_text("""---
slug: test
title: Test
---

# Learning Outcome:
source:: ![[../Learning Outcomes/Core Concepts]]
""")

        result = validate_lesson_file(lesson)
        assert result.is_valid, f"Unexpected errors: {result.errors}"

    def test_embed_syntax_with_missing_file(self, tmp_path):
        """![[embed]] with missing file should error."""
        (tmp_path / "modules").mkdir()

        lesson = tmp_path / "modules" / "lesson.md"
        lesson.write_text("""---
slug: test
title: Test
---

# Learning Outcome:
source:: ![[../Learning Outcomes/Nonexistent]]
""")

        result = validate_lesson_file(lesson)
        assert not result.is_valid
        assert any("not found" in str(e).lower() for e in result.errors)


class TestWikiLinkPipeSyntax:
    """Test that Obsidian display name syntax [[path|display]] is handled."""

    def test_pipe_syntax_stripped_for_validation(self, tmp_path):
        """Wiki-link with display name should validate against path only."""
        (tmp_path / "modules").mkdir()
        (tmp_path / "Learning Outcomes").mkdir()

        # Create the referenced file
        (tmp_path / "Learning Outcomes" / "Core Concepts.md").write_text(
            "---\nid: 11111111-1111-1111-1111-111111111111\n---\n## Lens:\nsource:: [[x]]\n"
        )

        lesson = tmp_path / "modules" / "lesson.md"
        lesson.write_text("""---
slug: test
title: Test
---

# Learning Outcome:
source:: [[../Learning Outcomes/Core Concepts|Display Name]]
""")

        result = validate_lesson_file(lesson)
        assert result.is_valid, f"Unexpected errors: {result.errors}"

    def test_pipe_syntax_with_missing_file(self, tmp_path):
        """Wiki-link with display name pointing to missing file should error."""
        (tmp_path / "modules").mkdir()

        lesson = tmp_path / "modules" / "lesson.md"
        lesson.write_text("""---
slug: test
title: Test
---

# Learning Outcome:
source:: [[../Learning Outcomes/Nonexistent|Nice Title]]
""")

        result = validate_lesson_file(lesson)
        assert not result.is_valid
        assert any("not found" in str(e).lower() for e in result.errors)

    def test_embed_with_pipe_syntax(self, tmp_path):
        """Embed with display name ![[path|display]] should work."""
        (tmp_path / "modules").mkdir()
        (tmp_path / "Learning Outcomes").mkdir()

        # Create the referenced file
        (tmp_path / "Learning Outcomes" / "Core Concepts.md").write_text(
            "---\nid: 11111111-1111-1111-1111-111111111111\n---\n## Lens:\nsource:: [[x]]\n"
        )

        lesson = tmp_path / "modules" / "lesson.md"
        lesson.write_text("""---
slug: test
title: Test
---

# Learning Outcome:
source:: ![[../Learning Outcomes/Core Concepts|Custom Title]]
""")

        result = validate_lesson_file(lesson)
        assert result.is_valid, f"Unexpected errors: {result.errors}"


class TestValidateLearningOutcomeFile:
    """Test validation of Learning Outcome files."""

    def test_valid_learning_outcome_file(self):
        """Valid LO file should pass."""
        text = """---
id: 11111111-1111-1111-1111-111111111111
---
## Lens:
source:: [[../Lenses/Some Lens]]
"""
        errors = validate_learning_outcome(text)
        assert errors == []

    def test_learning_outcome_with_test_and_multiple_lenses(self):
        """LO with Test and multiple Lenses should pass."""
        text = """---
id: 22222222-2222-2222-2222-222222222222
discussion: https://discord.com/channels/123
---
## Test:
source:: [[../Tests/Quiz]]

## Lens:
source:: [[../Lenses/Lens1]]

## Lens:
optional:: true
source:: [[../Lenses/Lens2]]
"""
        errors = validate_learning_outcome(text)
        assert errors == []

    def test_learning_outcome_missing_id(self):
        """LO file without id should error."""
        text = """---
discussion: https://example.com
---
## Lens:
source:: [[../Lenses/Some Lens]]
"""
        errors = validate_learning_outcome(text)
        assert any("id" in e.message.lower() for e in errors)

    def test_learning_outcome_requires_lens(self):
        """LO file without any Lens should error."""
        text = """---
id: 11111111-1111-1111-1111-111111111111
---
## Test:
source:: [[../Tests/Quiz]]
"""
        errors = validate_learning_outcome(text)
        assert len(errors) == 1
        assert "lens" in errors[0].message.lower()

    def test_learning_outcome_lens_missing_source(self):
        """Lens without source should error."""
        text = """---
id: 11111111-1111-1111-1111-111111111111
---
## Lens:
optional:: true
"""
        errors = validate_learning_outcome(text)
        assert len(errors) == 1
        assert "source" in errors[0].message

    def test_learning_outcome_test_without_source_allowed(self):
        """Test without source should be allowed (TBD/empty tests ok for now)."""
        text = """---
id: 11111111-1111-1111-1111-111111111111
---
## Test:

## Lens:
source:: [[../Lenses/Foo]]
"""
        errors = validate_learning_outcome(text)
        # No error for empty Test section
        assert not any(
            "test" in e.message.lower() and "source" in e.message.lower()
            for e in errors
        )

    def test_learning_outcome_strips_critic_markup(self):
        """Critic markup should be stripped before validation."""
        text = """---
id: 11111111-1111-1111-1111-111111111111
---
## Lens:
source:: [[../Lenses/Some Lens]]
{++This is an addition that should be stripped++}
"""
        errors = validate_learning_outcome(text)
        assert errors == []

    def test_learning_outcome_multiple_tests_error(self):
        """Multiple Test sections should error (0 or 1 allowed)."""
        text = """---
id: 11111111-1111-1111-1111-111111111111
---
## Test:
source:: [[../Tests/Quiz1]]

## Test:
source:: [[../Tests/Quiz2]]

## Lens:
source:: [[../Lenses/Foo]]
"""
        errors = validate_learning_outcome(text)
        assert any("test" in e.message.lower() for e in errors)


class TestDisallowOldH1Sections:
    """Old format (# Article:, # Video:, # Text:, # Chat:) should be rejected in modules."""

    def test_article_at_h1_disallowed(self):
        """# Article: at H1 should error in v2 format."""
        text = """---
slug: test
title: Test
---

# Article: Old Style
source:: [[../articles/foo]]

## Article-excerpt
"""
        errors = validate_module(text)
        assert len(errors) >= 1
        assert any(
            "not allowed" in e.message.lower() or "invalid" in e.message.lower()
            for e in errors
        )

    def test_video_at_h1_disallowed(self):
        """# Video: at H1 should error in v2 format."""
        text = """---
slug: test
title: Test
---

# Video: Old Style
source:: [[../video_transcripts/foo]]

## Video-excerpt
"""
        errors = validate_module(text)
        assert len(errors) >= 1

    def test_text_at_h1_disallowed(self):
        """# Text: at H1 should error in v2 format."""
        text = """---
slug: test
title: Test
---

# Text: Old Style
content::
Hello
"""
        errors = validate_module(text)
        assert len(errors) >= 1

    def test_chat_at_h1_disallowed(self):
        """# Chat: at H1 should error in v2 format."""
        text = """---
slug: test
title: Test
---

# Chat: Old Style
instructions::
Hello
"""
        errors = validate_module(text)
        assert len(errors) >= 1

    def test_mixed_old_and_new_disallowed(self):
        """Module mixing old and new formats should error."""
        text = """---
slug: test
title: Test
---

# Page: Welcome
id:: 11111111-1111-1111-1111-111111111111
## Text
content::
Hello

# Video: Old Style
source:: [[../video_transcripts/foo]]

## Video-excerpt
"""
        errors = validate_module(text)
        assert len(errors) >= 1

    def test_old_types_ok_in_lens_files(self):
        """Article and Video are still valid at H3 level in Lens files."""
        text = """---
id: 11111111-1111-1111-1111-111111111111
---
### Article: Title
source:: [[../articles/foo]]

#### Article-excerpt
"""
        errors = validate_lens(text)
        assert errors == []


class TestValidateLensFile:
    """Test validation of Lens files."""

    def test_valid_lens_file(self):
        """Valid Lens file should pass."""
        text = """---
id: 11111111-1111-1111-1111-111111111111
---
### Video: Title
source:: [[../video_transcripts/vid]]

#### Video-excerpt
"""
        errors = validate_lens(text)
        assert errors == []

    def test_valid_lens_with_article(self):
        """Lens with Article section should pass."""
        text = """---
id: 22222222-2222-2222-2222-222222222222
---
### Article: My Article
source:: [[../articles/foo]]

#### Article-excerpt
from:: "## Start"
to:: "end paragraph."
"""
        errors = validate_lens(text)
        assert errors == []

    def test_lens_missing_id(self):
        """Lens file without id should error."""
        text = """---
---
### Video: Title
source:: [[../video_transcripts/vid]]

#### Video-excerpt
"""
        errors = validate_lens(text)
        assert any("id" in e.message.lower() for e in errors)

    def test_lens_empty_frontmatter(self):
        """Lens file with empty frontmatter should error."""
        text = """---
---
### Video: Title
source:: [[../video_transcripts/vid]]

#### Video-excerpt
"""
        errors = validate_lens(text)
        # Empty frontmatter is treated as missing frontmatter
        assert any("frontmatter" in str(e).lower() for e in errors)

    def test_lens_requires_section(self):
        """Lens file without any Article/Video should error."""
        text = """---
id: 11111111-1111-1111-1111-111111111111
---
"""
        errors = validate_lens(text)
        assert any(
            "article" in e.message.lower() or "video" in e.message.lower()
            for e in errors
        )

    def test_lens_section_requires_excerpt(self):
        """Article/Video section without excerpt should error."""
        text = """---
id: 11111111-1111-1111-1111-111111111111
---
### Video: Title
source:: [[../video_transcripts/vid]]

#### Text
content::
No excerpt here
"""
        errors = validate_lens(text)
        assert any("excerpt" in e.message.lower() for e in errors)

    def test_lens_video_section_with_article_excerpt_error(self):
        """Video section with Article-excerpt should error."""
        text = """---
id: 11111111-1111-1111-1111-111111111111
---
### Video: Title
source:: [[../video_transcripts/vid]]

#### Article-excerpt
"""
        errors = validate_lens(text)
        assert any("article-excerpt" in e.message.lower() for e in errors)

    def test_lens_article_section_with_video_excerpt_error(self):
        """Article section with Video-excerpt should error."""
        text = """---
id: 11111111-1111-1111-1111-111111111111
---
### Article: Title
source:: [[../articles/foo]]

#### Video-excerpt
"""
        errors = validate_lens(text)
        assert any("video-excerpt" in e.message.lower() for e in errors)

    def test_lens_section_missing_source(self):
        """Section without source should error."""
        text = """---
id: 11111111-1111-1111-1111-111111111111
---
### Video: Title

#### Video-excerpt
"""
        errors = validate_lens(text)
        assert any("source" in e.message for e in errors)

    def test_lens_multiple_sections(self):
        """Lens with multiple sections should pass."""
        text = """---
id: 11111111-1111-1111-1111-111111111111
---
### Video: First
source:: [[../video_transcripts/vid1]]

#### Video-excerpt

### Article: Second
source:: [[../articles/art1]]

#### Article-excerpt
"""
        errors = validate_lens(text)
        assert errors == []

    def test_lens_strips_critic_markup(self):
        """Critic markup should be stripped before validation."""
        text = """---
id: 11111111-1111-1111-1111-111111111111
---
### Video: Title
source:: [[../video_transcripts/vid]]

#### Video-excerpt
{++This is an addition that should be stripped++}
"""
        errors = validate_lens(text)
        assert errors == []

    def test_lens_with_optional_segment(self):
        """Lens with optional segments should pass."""
        text = """---
id: 11111111-1111-1111-1111-111111111111
---
### Video: Title
source:: [[../video_transcripts/vid]]

#### Video-excerpt

#### Text
optional:: true
content::
This is optional text.
"""
        errors = validate_lens(text)
        assert errors == []

    def test_lens_with_chat_segment(self):
        """Lens with Chat segment should pass."""
        text = """---
id: 11111111-1111-1111-1111-111111111111
---
### Video: Title
source:: [[../video_transcripts/vid]]

#### Video-excerpt

#### Chat
instructions::
Discuss the video.
"""
        errors = validate_lens(text)
        assert errors == []


class TestValidatorCriticMarkup:
    """Validator should strip critic markup before validating."""

    def test_critic_markup_stripped_in_module_validation(self):
        """Content with critic markup should validate after stripping."""
        text = """---
slug: test
title: Test
---

# Page: Welcome{>>comment to strip<<}
id:: 11111111-1111-1111-1111-111111111111
## Text
content::
Hello{++addition to strip++} world
"""
        errors = validate_module(text)
        assert errors == []

    def test_critic_markup_in_page_title_stripped(self):
        """Critic markup in page title should be stripped."""
        text = """---
slug: test
title: Test
---

# Page: Welcome{--deleted--} Message
id:: 11111111-1111-1111-1111-111111111111
## Text
content::
Hello
"""
        errors = validate_module(text)
        assert errors == []

    def test_critic_markup_substitution_uses_old_text(self):
        """Substitution should keep old text, discard new."""
        text = """---
slug: test
title: Test
---

# Page: {~~Old Title~>New Title~~}
id:: 11111111-1111-1111-1111-111111111111
## Text
content::
Hello
"""
        errors = validate_module(text)
        # Should validate successfully - title becomes "Old Title"
        assert errors == []

    def test_critic_addition_in_section_header_stripped(self):
        """Addition markup in section header should be stripped.

        This tests that {++...++} additions are stripped, leaving valid structure.
        Without stripping, "# Page{++: Title++}:" would be invalid syntax.
        """
        text = """---
slug: test
title: Test
---

# Page: Welcome
id:: 11111111-1111-1111-1111-111111111111
## Text
content::
Hello
{++This entire line should be stripped and not cause issues++}
"""
        errors = validate_module(text)
        assert errors == []

    def test_critic_markup_deleted_content_kept(self):
        """Deleted markup should keep the content (reject deletion).

        {--deleted--} should become 'deleted' (the deletion is rejected).
        """
        text = """---
slug: test
title: Test
---

# Page: Welcome
id:: 11111111-1111-1111-1111-111111111111
## Text
content::
{--This content exists because deletion was rejected--}
"""
        errors = validate_module(text)
        assert errors == []

    def test_critic_highlight_content_kept(self):
        """Highlight markup should keep the content.

        {==highlighted==} should become 'highlighted'.
        """
        text = """---
slug: test
title: Test
---

# Page: Welcome
id:: 11111111-1111-1111-1111-111111111111
## Text
content::
{==This is highlighted text==}
"""
        errors = validate_module(text)
        assert errors == []

    def test_critic_comment_in_field_value_stripped(self):
        """Comment in field value should be stripped.

        The id field value with a comment should still be valid after stripping.
        """
        text = """---
slug: test
title: Test
---

# Page: Welcome
id:: 11111111-1111-1111-1111-111111111111{>>this is a comment about the id<<}
## Text
content::
Hello
"""
        errors = validate_module(text)
        assert errors == []

    def test_multiline_critic_markup_stripped(self):
        """Multiline critic markup additions should be completely removed."""
        text = """---
slug: test
title: Test
---

# Page: Welcome
id:: 11111111-1111-1111-1111-111111111111
## Text
content::
Hello world
{++
This is a multiline
addition that should
be completely removed
++}
"""
        errors = validate_module(text)
        assert errors == []

    def test_critic_addition_with_fake_section_header_stripped(self):
        """Addition markup containing section-like header should be stripped.

        Without critic markup stripping, this would cause an 'Invalid section type'
        error because the validator would see '# Fake: ...' as a section header.
        """
        text = """---
slug: test
title: Test
---

# Page: Welcome
id:: 11111111-1111-1111-1111-111111111111
## Text
content::
Hello
{++
# Fake: Section that should be stripped
++}
"""
        errors = validate_module(text)
        # Without stripping, this would fail with "Invalid section type: fake"
        assert errors == [], f"Expected no errors but got: {errors}"


class TestDetectFileType:
    """Test the _detect_file_type helper function."""

    def test_detect_module_in_modules_dir(self, tmp_path):
        """Files in modules/ should be detected as modules."""
        from core.modules.markdown_validator import _detect_file_type

        path = tmp_path / "modules" / "intro.md"
        assert _detect_file_type(path) == "module"

    def test_detect_learning_outcome_in_learning_outcomes_dir(self, tmp_path):
        """Files in Learning Outcomes/ should be detected as learning outcomes."""
        from core.modules.markdown_validator import _detect_file_type

        path = tmp_path / "Learning Outcomes" / "Core Concepts.md"
        assert _detect_file_type(path) == "learning_outcome"

    def test_detect_learning_outcome_lowercase_dir(self, tmp_path):
        """Files in learning_outcomes/ should be detected as learning outcomes."""
        from core.modules.markdown_validator import _detect_file_type

        path = tmp_path / "learning_outcomes" / "intro.md"
        assert _detect_file_type(path) == "learning_outcome"

    def test_detect_lens_in_lenses_dir(self, tmp_path):
        """Files in Lenses/ should be detected as lenses."""
        from core.modules.markdown_validator import _detect_file_type

        path = tmp_path / "Lenses" / "safety.md"
        assert _detect_file_type(path) == "lens"

    def test_detect_lens_lowercase_dir(self, tmp_path):
        """Files in lenses/ should be detected as lenses."""
        from core.modules.markdown_validator import _detect_file_type

        path = tmp_path / "lenses" / "intro.md"
        assert _detect_file_type(path) == "lens"

    def test_detect_article_in_articles_dir(self, tmp_path):
        """Files in articles/ should be detected as articles."""
        from core.modules.markdown_validator import _detect_file_type

        path = tmp_path / "articles" / "post.md"
        assert _detect_file_type(path) == "article"

    def test_detect_video_transcript_in_video_transcripts_dir(self, tmp_path):
        """Files in video_transcripts/ should be detected as video transcripts."""
        from core.modules.markdown_validator import _detect_file_type

        path = tmp_path / "video_transcripts" / "lecture.md"
        assert _detect_file_type(path) == "video_transcript"

    def test_detect_course_in_courses_dir(self, tmp_path):
        """Files in courses/ should be detected as courses."""
        from core.modules.markdown_validator import _detect_file_type

        path = tmp_path / "courses" / "default.md"
        assert _detect_file_type(path) == "course"

    def test_detect_unknown_in_other_dir(self, tmp_path):
        """Files in other directories should be detected as unknown."""
        from core.modules.markdown_validator import _detect_file_type

        path = tmp_path / "other" / "file.md"
        assert _detect_file_type(path) == "unknown"

    def test_detect_nested_module(self, tmp_path):
        """Files nested under modules/ should still be detected as modules."""
        from core.modules.markdown_validator import _detect_file_type

        path = tmp_path / "content" / "modules" / "week1" / "intro.md"
        assert _detect_file_type(path) == "module"


class TestValidateDirectoryRouting:
    """Test that validate_directory routes to appropriate validators."""

    def test_validate_directory_routes_modules(self, tmp_path):
        """Files in modules/ should be validated as modules."""
        from core.modules.markdown_validator import validate_directory

        (tmp_path / "modules").mkdir()
        module_file = tmp_path / "modules" / "test.md"
        module_file.write_text("""---
slug: test
title: Test
---

# Page: Intro
id:: 11111111-1111-1111-1111-111111111111
## Text
content::
Hello
""")

        results = validate_directory(tmp_path)
        assert len(results) == 1
        assert results[0].is_valid

    def test_validate_directory_routes_learning_outcomes(self, tmp_path):
        """Files in Learning Outcomes/ should be validated as learning outcomes."""
        from core.modules.markdown_validator import validate_directory

        (tmp_path / "Learning Outcomes").mkdir()
        (tmp_path / "Lenses").mkdir()

        # Create the referenced Lens file
        (tmp_path / "Lenses" / "Foo.md").write_text("""---
id: 22222222-2222-2222-2222-222222222222
---
### Video: Title
source:: [[../video_transcripts/vid]]

#### Video-excerpt
""")

        lo_file = tmp_path / "Learning Outcomes" / "test.md"
        lo_file.write_text("""---
id: 11111111-1111-1111-1111-111111111111
---
## Lens:
source:: [[../Lenses/Foo]]
""")

        results = validate_directory(tmp_path)
        # Should have 2 results: Learning Outcome and Lens
        lo_results = [r for r in results if "Learning Outcomes" in str(r.path)]
        assert len(lo_results) == 1
        # Should be valid (only id required, no slug/title)
        assert lo_results[0].is_valid, (
            f"Learning Outcome errors: {lo_results[0].errors}"
        )

    def test_validate_directory_routes_lenses(self, tmp_path):
        """Files in Lenses/ should be validated as lenses."""
        from core.modules.markdown_validator import validate_directory

        (tmp_path / "Lenses").mkdir()
        (tmp_path / "video_transcripts").mkdir()

        # Create the referenced video transcript file
        (tmp_path / "video_transcripts" / "vid.md").write_text("""# Video Transcript
Some content here.
""")

        lens_file = tmp_path / "Lenses" / "test.md"
        lens_file.write_text("""---
id: 11111111-1111-1111-1111-111111111111
---
### Video: Title
source:: [[../video_transcripts/vid]]

#### Video-excerpt
""")

        results = validate_directory(tmp_path)
        # Should have 2 results: Lens and video_transcript (skipped)
        lens_results = [r for r in results if "Lenses" in str(r.path)]
        assert len(lens_results) == 1
        assert lens_results[0].is_valid, f"Lens errors: {lens_results[0].errors}"

    def test_validate_directory_skips_articles(self, tmp_path):
        """Files in articles/ should be skipped (return empty errors)."""
        from core.modules.markdown_validator import validate_directory

        (tmp_path / "articles").mkdir()
        article_file = tmp_path / "articles" / "post.md"
        # Write invalid content - should not error since articles are skipped
        article_file.write_text("""# No frontmatter
This is just a plain article with no required fields.
""")

        results = validate_directory(tmp_path)
        assert len(results) == 1
        assert results[0].is_valid  # Should be valid because validation is skipped

    def test_validate_directory_skips_video_transcripts(self, tmp_path):
        """Files in video_transcripts/ should be skipped (return empty errors)."""
        from core.modules.markdown_validator import validate_directory

        (tmp_path / "video_transcripts").mkdir()
        transcript_file = tmp_path / "video_transcripts" / "lecture.md"
        # Write invalid content - should not error since transcripts are skipped
        transcript_file.write_text("""# No frontmatter
This is just a transcript with no required fields.
""")

        results = validate_directory(tmp_path)
        assert len(results) == 1
        assert results[0].is_valid  # Should be valid because validation is skipped

    def test_validate_directory_routes_courses(self, tmp_path):
        """Files in courses/ should be validated as courses."""
        from core.modules.markdown_validator import validate_directory

        (tmp_path / "courses").mkdir()
        course_file = tmp_path / "courses" / "default.md"
        course_file.write_text("""---
slug: default
title: Default Course
---

# Lesson: [[../modules/intro]]
""")

        results = validate_directory(tmp_path)
        assert len(results) == 1
        # Note: this will have a wiki-link validation error since the module doesn't exist
        # but it demonstrates that the course validator is being used


class TestLearningOutcomeFrontmatterRequirements:
    """Test that Learning Outcome files only require id in frontmatter."""

    def test_learning_outcome_valid_with_only_id(self):
        """Learning Outcome with only id should be valid."""
        text = """---
id: 11111111-1111-1111-1111-111111111111
---
## Lens:
source:: [[../Lenses/Foo]]
"""
        errors = validate_learning_outcome(text)
        assert errors == []

    def test_learning_outcome_does_not_require_slug(self):
        """Learning Outcome should NOT require slug in frontmatter."""
        text = """---
id: 11111111-1111-1111-1111-111111111111
---
## Lens:
source:: [[../Lenses/Foo]]
"""
        errors = validate_learning_outcome(text)
        # Should be valid even without slug
        assert not any("slug" in e.message.lower() for e in errors)

    def test_learning_outcome_does_not_require_title(self):
        """Learning Outcome should NOT require title in frontmatter."""
        text = """---
id: 11111111-1111-1111-1111-111111111111
---
## Lens:
source:: [[../Lenses/Foo]]
"""
        errors = validate_learning_outcome(text)
        # Should be valid even without title
        assert not any("title" in e.message.lower() for e in errors)


class TestLensFrontmatterRequirements:
    """Test that Lens files require id in frontmatter, prohibit title, and don't need slug."""

    def test_lens_valid_with_id_only(self):
        """Lens with just id should be valid (title comes from Article/Video header)."""
        text = """---
id: 11111111-1111-1111-1111-111111111111
---
### Video: My Video Title
source:: [[../video_transcripts/vid]]

#### Video-excerpt
"""
        errors = validate_lens(text)
        assert errors == []

    def test_lens_title_prohibited(self):
        """Lens with title in frontmatter should error (title comes from header)."""
        text = """---
id: 11111111-1111-1111-1111-111111111111
title: My Lens Title
---
### Video: Title
source:: [[../video_transcripts/vid]]

#### Video-excerpt
"""
        errors = validate_lens(text)
        assert len(errors) == 1
        assert "title" in errors[0].message.lower()
        assert "not allowed" in errors[0].message.lower()

    def test_lens_does_not_require_slug(self):
        """Lens should NOT require slug in frontmatter."""
        text = """---
id: 11111111-1111-1111-1111-111111111111
---
### Video: Title
source:: [[../video_transcripts/vid]]

#### Video-excerpt
"""
        errors = validate_lens(text)
        # Should be valid - no slug required
        assert errors == []
