# Parser & Validator v2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update the markdown parser and validator to support the new content format v2 (Modules → Learning Outcomes → Lenses hierarchy).

**Architecture:** The parser will be extended with new dataclasses for Page, Learning Outcome refs, Uncategorized sections, and Lens refs. Each file type (Module, Learning Outcome, Lens) will have dedicated parse functions. The validator will be updated to validate the new section types and required fields.

**Tech Stack:** Python, pytest, dataclasses, regex

**Reference:** `docs/plans/2026-01-28-content-format-v2-design.md`

---

## Phase 1: Parser - New Section Types for Modules

### Task 1: Add PageSection dataclass and parse # Page: sections

**Files:**
- Modify: `core/modules/markdown_parser.py`
- Test: `core/modules/tests/test_markdown_parser.py`

**Step 1: Write the failing test**

Add to `test_markdown_parser.py`:

```python
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
```

**Step 2: Run test to verify it fails**

Run: `pytest core/modules/tests/test_markdown_parser.py::TestParsePageSection -v`
Expected: FAIL with "cannot import name 'PageSection'"

**Step 3: Write minimal implementation**

Add to `core/modules/markdown_parser.py`:

```python
@dataclass
class PageSection:
    """A Page section containing Text and Chat segments."""

    type: str = "page"
    title: str = ""
    segments: list[Segment] = field(default_factory=list)
    content_id: PyUUID | None = None
```

Update `Section` union type:
```python
Section = VideoSection | ArticleSection | TextSection | ChatSection | PageSection
```

Update `_parse_section` function to handle `page` type:
```python
elif section_type_lower == "page":
    segment_data = _split_into_segments(content)
    segments = [_parse_segment(stype, scontent) for stype, scontent in segment_data]
    return PageSection(
        title=title,
        segments=segments,
        content_id=content_id,
    )
```

**Step 4: Run test to verify it passes**

Run: `pytest core/modules/tests/test_markdown_parser.py::TestParsePageSection -v`
Expected: PASS

**Step 5: Commit**

```bash
jj describe -m "feat(parser): add PageSection for # Page: sections"
```

---

### Task 2: Add LearningOutcomeRef and parse # Learning Outcome: sections

**Files:**
- Modify: `core/modules/markdown_parser.py`
- Test: `core/modules/tests/test_markdown_parser.py`

**Step 1: Write the failing test**

```python
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
        assert section.source == "../Learning Outcomes/Core Concepts"
```

**Step 2: Run test to verify it fails**

Run: `pytest core/modules/tests/test_markdown_parser.py::TestParseLearningOutcomeRef -v`
Expected: FAIL

**Step 3: Write minimal implementation**

Add dataclass:
```python
@dataclass
class LearningOutcomeRef:
    """Reference to a Learning Outcome file."""

    type: str = "learning_outcome"
    source: str = ""
    optional: bool = False
```

Update `_extract_wiki_link` to handle `![[]]` syntax:
```python
def _extract_wiki_link(text: str) -> str:
    """Extract path from [[wiki-link]] or ![[embed]] syntax."""
    # Handle both [[path]] and ![[path]] and [[path|alias]]
    match = re.search(r"!?\[\[([^\]|]+)(?:\|[^\]]+)?\]\]", text)
    if match:
        return match.group(1)
    return text.strip()
```

Update `Section` union and `_parse_section`.

**Step 4: Run test to verify it passes**

Run: `pytest core/modules/tests/test_markdown_parser.py::TestParseLearningOutcomeRef -v`
Expected: PASS

**Step 5: Commit**

```bash
jj describe -m "feat(parser): add LearningOutcomeRef for # Learning Outcome: sections"
```

---

### Task 3: Add UncategorizedSection and parse # Uncategorized: sections

**Files:**
- Modify: `core/modules/markdown_parser.py`
- Test: `core/modules/tests/test_markdown_parser.py`

**Step 1: Write the failing test**

```python
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
```

**Step 2: Run test to verify it fails**

Run: `pytest core/modules/tests/test_markdown_parser.py::TestParseUncategorizedSection -v`

**Step 3: Write minimal implementation**

Add dataclasses:
```python
@dataclass
class LensRef:
    """Reference to a Lens file."""

    source: str = ""
    optional: bool = False


@dataclass
class UncategorizedSection:
    """Container for Lens references not part of a Learning Outcome."""

    type: str = "uncategorized"
    lenses: list[LensRef] = field(default_factory=list)
```

Update `_parse_section` for uncategorized type.

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
jj describe -m "feat(parser): add UncategorizedSection for # Uncategorized: sections"
```

---

### Task 4: Integrate critic markup stripping

**Files:**
- Modify: `core/modules/markdown_parser.py`
- Test: `core/modules/tests/test_markdown_parser.py`

**Step 1: Write the failing test**

```python
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
        assert "deleted text" in section.segments[0].content
```

**Step 2: Run test to verify it fails**

**Step 3: Write minimal implementation**

At the start of `parse_module`:
```python
from core.modules.critic_markup import strip_critic_markup

def parse_module(text: str) -> ParsedModule:
    # Strip critic markup first
    text = strip_critic_markup(text)
    # ... rest of function
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
jj describe -m "feat(parser): strip critic markup before parsing"
```

---

## Phase 2: Parser - Learning Outcome and Lens File Parsing

### Task 5: Add parse_learning_outcome function

**Files:**
- Modify: `core/modules/markdown_parser.py`
- Test: `core/modules/tests/test_markdown_parser.py`

**Step 1: Write the failing test**

```python
class TestParseLearningOutcomeFile:
    """Test parsing Learning Outcome files."""

    def test_parse_learning_outcome_basic(self):
        """Should parse Learning Outcome file with Lens refs."""
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
        text = """---
id: 11111111-1111-1111-1111-111111111111
---
## Lens:
source:: [[../Lenses/Some Lens]]
"""
        lo = parse_learning_outcome(text)
        assert lo.test is None
        assert len(lo.lenses) == 1
```

**Step 2: Run test to verify it fails**

**Step 3: Write minimal implementation**

Add dataclasses and function:
```python
@dataclass
class TestRef:
    """Reference to a Test file."""
    source: str = ""


@dataclass
class ParsedLearningOutcome:
    """A parsed Learning Outcome file."""
    content_id: PyUUID | None = None
    discussion: str | None = None
    test: TestRef | None = None
    lenses: list[LensRef] = field(default_factory=list)


def parse_learning_outcome(text: str) -> ParsedLearningOutcome:
    """Parse a Learning Outcome markdown file."""
    text = strip_critic_markup(text)
    metadata, content = _parse_frontmatter(text)
    # ... parse ## Test: and ## Lens: sections
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
jj describe -m "feat(parser): add parse_learning_outcome for LO files"
```

---

### Task 6: Add parse_lens function

**Files:**
- Modify: `core/modules/markdown_parser.py`
- Test: `core/modules/tests/test_markdown_parser.py`

**Step 1: Write the failing test**

```python
class TestParseLensFile:
    """Test parsing Lens files."""

    def test_parse_lens_with_video_section(self):
        """Should parse Lens file with Video section and segments."""
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
        assert len(section.segments) == 3

    def test_parse_lens_with_article_section(self):
        """Should parse Lens file with Article section."""
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
        assert len(section.segments) == 2

    def test_parse_lens_multiple_sections(self):
        """Lens can have multiple Video/Article sections."""
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
```

**Step 2: Run test to verify it fails**

**Step 3: Write minimal implementation**

```python
@dataclass
class ParsedLens:
    """A parsed Lens file."""
    content_id: PyUUID | None = None
    sections: list[VideoSection | ArticleSection] = field(default_factory=list)


def parse_lens(text: str) -> ParsedLens:
    """Parse a Lens markdown file."""
    text = strip_critic_markup(text)
    metadata, content = _parse_frontmatter(text)
    # Parse ### sections with #### segments
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
jj describe -m "feat(parser): add parse_lens for Lens files"
```

---

## Phase 3: Validator Updates

### Task 7: Update validator for new Module section types

**Files:**
- Modify: `core/modules/markdown_validator.py`
- Test: `core/modules/tests/test_markdown_validator.py`

**Step 1: Write the failing tests**

```python
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
```

**Step 2: Run tests to verify they fail**

**Step 3: Update validator**

Update `VALID_SECTION_TYPES`:
```python
VALID_SECTION_TYPES = {"video", "article", "text", "chat", "page", "learning outcome", "uncategorized"}
```

Add to `ALLOWED_SECTION_FIELDS`:
```python
"page": {"id"},
"learning outcome": {"source", "optional"},
"uncategorized": set(),  # No direct fields, contains ## Lens:
```

Update `validate_lesson` → `validate_module` and add logic for new types.

**Step 4: Run tests to verify they pass**

**Step 5: Commit**

```bash
jj describe -m "feat(validator): support Page, Learning Outcome, Uncategorized sections"
```

---

### Task 8: Add validate_learning_outcome function

**Files:**
- Modify: `core/modules/markdown_validator.py`
- Test: `core/modules/tests/test_markdown_validator.py`

**Step 1: Write the failing tests**

```python
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

    def test_learning_outcome_missing_id(self):
        """LO file without id should error."""
        text = """---
discussion: https://example.com
---
## Lens:
source:: [[../Lenses/Some Lens]]
"""
        errors = validate_learning_outcome(text)
        assert any("id" in e.message for e in errors)

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
```

**Step 2-5: Implement and commit**

---

### Task 9: Add validate_lens function

**Files:**
- Modify: `core/modules/markdown_validator.py`
- Test: `core/modules/tests/test_markdown_validator.py`

**Step 1: Write the failing tests**

```python
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

    def test_lens_missing_id(self):
        """Lens file without id should error."""
        text = """---
---
### Video: Title
source:: [[../video_transcripts/vid]]

#### Video-excerpt
"""
        errors = validate_lens(text)
        assert any("id" in e.message for e in errors)

    def test_lens_requires_section(self):
        """Lens file without any Article/Video should error."""
        text = """---
id: 11111111-1111-1111-1111-111111111111
---
"""
        errors = validate_lens(text)
        assert any("article" in e.message.lower() or "video" in e.message.lower() for e in errors)

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
```

**Step 2-5: Implement and commit**

---

### Task 10: Disallow old section types at H1 in Modules

**Files:**
- Modify: `core/modules/markdown_validator.py`
- Test: `core/modules/tests/test_markdown_validator.py`

**Step 1: Write the failing tests**

```python
class TestDisallowOldH1Sections:
    """Old format (# Article:, # Video:, # Text:, # Chat:) should be rejected."""

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
        assert any("not allowed" in e.message.lower() or "invalid" in e.message.lower() for e in errors)

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
```

**Step 2-5: Update validator to only allow page, learning outcome, uncategorized at H1**

---

### Task 11: Update existing tests for new format

**Files:**
- Modify: `core/modules/tests/test_markdown_parser.py`
- Modify: `core/modules/tests/test_markdown_validator.py`
- Modify: `core/modules/tests/fixtures/introduction_sample.md`
- Modify: `core/modules/tests/fixtures/introduction_sample_expected.json`

**Step 1: Identify tests that use old format**

The existing tests use `# Video:`, `# Article:`, `# Text:`, `# Chat:` at H1 level. These need to be either:
- Updated to use new format (# Page: with segments, or Lens files)
- Moved to test Lens file parsing
- Marked as testing legacy format (if we keep backwards compat)

**Step 2: Update fixture files**

Update `introduction_sample.md` to use new v2 format.

**Step 3: Update or remove old tests**

Tests in `TestParseModuleBasic`, `TestParseVideoSection`, `TestParseArticleSection` need updating.

**Step 4: Run all tests**

Run: `pytest core/modules/tests/ -v`

**Step 5: Commit**

```bash
jj describe -m "test: update tests for content format v2"
```

---

## Phase 4: Integration

### Task 12: Update cache to include Learning Outcomes and Lenses

**Files:**
- Modify: `core/content/cache.py`
- Test: `core/content/tests/test_cache.py`

**Step 1: Write the failing test**

```python
def test_cache_includes_learning_outcomes(cache_with_content):
    """Cache should include Learning Outcome files."""
    assert "Learning Outcomes" in cache_with_content.learning_outcomes or len(cache_with_content.learning_outcomes) >= 0

def test_cache_includes_lenses(cache_with_content):
    """Cache should include Lens files."""
    assert "Lenses" in cache_with_content.lenses or len(cache_with_content.lenses) >= 0
```

**Step 2-5: Implement and commit**

---

### Task 13: Wire up validator to strip critic markup

**Files:**
- Modify: `core/modules/markdown_validator.py`
- Test: `core/modules/tests/test_markdown_validator.py`

**Step 1: Write the failing test**

```python
class TestValidatorCriticMarkup:
    """Validator should strip critic markup before validating."""

    def test_critic_markup_stripped_before_validation(self):
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
```

**Step 2-5: Add `strip_critic_markup` call at start of validate functions**

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| 1 | 1-4 | Parser: New section types for Modules |
| 2 | 5-6 | Parser: Learning Outcome and Lens file parsing |
| 3 | 7-11 | Validator: All validation updates |
| 4 | 12-13 | Integration: Cache and wiring |

Total: 13 tasks, each with RED-GREEN-REFACTOR cycle and commit.
