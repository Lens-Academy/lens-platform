# System Prompt Formatting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the tutor system prompt to use markdown headers for hierarchy, make instructions prominent, clearly label lenses/modules, and make TLDRs readable — all driven by a golden-file test fixture.

**Architecture:** A single golden-file test defines the exact expected markdown output for a given set of inputs (course structure, section context, instructions). The production code (`build_course_overview`, `assemble_chat_prompt`, `_build_system_prompt`) is updated to produce output matching that fixture. Each function is tested independently, then a full end-to-end test validates the assembled prompt.

**Tech Stack:** Python, pytest, `core/modules/prompts.py`, `core/modules/chat.py`

---

## Current Problems

1. **No markdown structure** — the prompt is a wall of text with no headers
2. **Instructions hidden** — stage-specific instructions (the most important part for behavior) are buried after a plain `Instructions:` label
3. **TLDR not clearly separated** — title and TLDR run together on one line with just a dash
4. **Course overview doesn't explain what items are** — no indication that listed items are navigable lenses
5. **Optional lenses not marked** — only modules have `(optional)`, individual lenses don't
6. **Modules not labeled as modules** — just indented bullets with no header

## Target Format

The full system prompt should look like this (for a ChatStage with instructions and context):

```markdown
# Role

You are a tutor helping someone learn about AI safety. Each piece of content (article, video) has different topics and learning objectives.

# Instructions

[stage-specific instructions injected here — the author's guidance for tutor behavior]

# Course Overview

The course contains lenses (articles, videos, discussions) organized into modules. The student can navigate between them.

## Introduction to AI Safety

- **The Alignment Problem** ← you are here
  TLDR: Why aligning AI with human values is hard
- **Risks from AI** ✓
  TLDR: Overview of catastrophic and existential risks

--- Week 1 Discussion ---

## Advanced Topics (optional)

- **Deceptive Alignment**
  TLDR: When AI systems appear aligned but aren't

# Current Context

Current location: Introduction to AI Safety > The Alignment Problem

The user is engaging with the following content:

Segment 1:
[Written by Lens Academy]
Intro text

Segment 2:
Article content

The user is currently at segment 2. They have probably not read segments 3–3 yet.
```

Key changes from current format:
- `# Role` header for the base prompt
- `# Instructions` header (promoted from plain text label) — placed BEFORE course overview so it's near the top
- `# Course Overview` with explanatory intro line
- `## Module Title` headers (with `(optional)` suffix where applicable)
- TLDR on its own line with `TLDR:` prefix, indented under lens title
- Status markers on the lens title line (not in brackets): `✓` for completed, `← you are here` for current
- `# Current Context` header for section content
- Meeting markers stay as `--- Name ---` separators between modules

## File Changes

| File | Change |
|------|--------|
| `core/modules/tests/test_system_prompt_format.py` | **Create** — golden-file test for full prompt + unit tests for `build_course_overview` format |
| `core/modules/prompts.py` | **Modify** — update `build_course_overview` output format, update `assemble_chat_prompt` to use markdown headers |
| `core/modules/chat.py` | **Modify** — update `_build_system_prompt` to wrap base prompt in `# Role` header |
| `core/modules/tests/test_course_overview.py` | **Modify** — update assertions to match new format |
| `core/modules/tests/test_prompts.py` | **Modify** — update assertions to match new format |

---

### Task 1: Golden-file test for `build_course_overview`

Define the exact expected output format for the course overview section.

**Files:**
- Create: `core/modules/tests/test_system_prompt_format.py`

- [ ] **Step 1: Write the golden-file test for course overview**

```python
# core/modules/tests/test_system_prompt_format.py
"""Golden-file tests for system prompt formatting.

These tests define the exact expected output. To change prompt format,
update the expected strings here first (TDD), then update production code.
"""

from unittest.mock import patch
from uuid import uuid4

import pytest

from core.modules.flattened_types import (
    FlattenedModule,
    MeetingMarker,
    ModuleRef,
    ParsedCourse,
)
from core.modules.prompts import build_course_overview


# -- Fixtures: course structure --

LENS_A1_ID = str(uuid4())
LENS_A2_ID = str(uuid4())
LENS_B1_ID = str(uuid4())

MOD_A = FlattenedModule(
    slug="intro",
    title="Introduction to AI Safety",
    content_id=None,
    sections=[
        {
            "meta": {"title": "The Alignment Problem"},
            "tldr": "Why aligning AI with human values is hard",
            "contentId": LENS_A1_ID,
        },
        {
            "meta": {"title": "Risks from AI"},
            "tldr": "Overview of catastrophic and existential risks",
            "contentId": LENS_A2_ID,
        },
    ],
)

MOD_B = FlattenedModule(
    slug="advanced",
    title="Advanced Topics",
    content_id=None,
    sections=[
        {
            "meta": {"title": "Deceptive Alignment"},
            "tldr": "When AI systems appear aligned but aren't",
            "contentId": LENS_B1_ID,
        },
    ],
)


def _mock_load(slug):
    modules = {"intro": MOD_A, "advanced": MOD_B}
    if slug not in modules:
        from core.modules import ModuleNotFoundError
        raise ModuleNotFoundError(slug)
    return modules[slug]


COURSE = ParsedCourse(
    slug="default",
    title="Intro to AI Safety",
    progression=[
        ModuleRef(slug="intro"),
        MeetingMarker(name="Week 1 Discussion"),
        ModuleRef(slug="advanced", optional=True),
    ],
)


class TestCourseOverviewFormat:
    """Golden-file tests: define exact expected output for build_course_overview."""

    @patch("core.modules.loader.load_flattened_module", side_effect=_mock_load)
    def test_full_course_overview_format(self, _mock):
        """The complete expected output for a typical course state."""
        result = build_course_overview(
            COURSE,
            current_module_slug="intro",
            current_section_index=0,
            completed_content_ids={LENS_A2_ID},
        )

        expected = (
            "The course contains lenses (articles, videos, discussions) "
            "organized into modules. The student can navigate between them.\n"
            "\n"
            "## Introduction to AI Safety\n"
            "\n"
            "- **The Alignment Problem** ← you are here\n"
            f"  TLDR: Why aligning AI with human values is hard\n"
            "- **Risks from AI** ✓\n"
            f"  TLDR: Overview of catastrophic and existential risks\n"
            "\n"
            "--- Week 1 Discussion ---\n"
            "\n"
            "## Advanced Topics (optional)\n"
            "\n"
            "- **Deceptive Alignment**\n"
            f"  TLDR: When AI systems appear aligned but aren't\n"
        )

        assert result == expected

    @patch("core.modules.loader.load_flattened_module", side_effect=_mock_load)
    def test_no_tldrs_still_works(self, _mock):
        """Lenses without TLDRs just show the title line."""
        mod = FlattenedModule(
            slug="intro",
            title="Introduction to AI Safety",
            content_id=None,
            sections=[
                {"meta": {"title": "Untitled Lens"}, "contentId": LENS_A1_ID},
            ],
        )
        with patch("core.modules.loader.load_flattened_module", return_value=mod):
            course = ParsedCourse(
                slug="test", title="Test", progression=[ModuleRef(slug="intro")]
            )
            result = build_course_overview(course, "intro", 0, set())
            assert "- **Untitled Lens** ← you are here\n" in result
            assert "TLDR:" not in result
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/penguin/code/lens-platform/ws4 && .venv/bin/pytest core/modules/tests/test_system_prompt_format.py -v`
Expected: FAIL — output format doesn't match (current format uses `Course Overview:` title, indented bullets, `[status]` brackets, etc.)

- [ ] **Step 3: Update `build_course_overview` to match expected format**

In `core/modules/prompts.py`, rewrite `build_course_overview`:

```python
def build_course_overview(
    course: ParsedCourse,
    current_module_slug: str,
    current_section_index: int,
    completed_content_ids: set[str],
) -> str:
    from .loader import load_flattened_module
    from . import ModuleNotFoundError

    lines = [
        "The course contains lenses (articles, videos, discussions) "
        "organized into modules. The student can navigate between them.",
        "",
    ]

    for item in course.progression:
        if isinstance(item, MeetingMarker):
            lines.append(f"--- {item.name} ---")
            lines.append("")
            continue

        if not isinstance(item, ModuleRef):
            continue

        is_current_module = item.slug == current_module_slug

        try:
            module = load_flattened_module(item.slug)
        except (ModuleNotFoundError, Exception):
            lines.append(f"## {item.slug} (unavailable)")
            lines.append("")
            continue

        optional = " (optional)" if item.optional else ""
        lines.append(f"## {module.title}{optional}")
        lines.append("")

        for i, section in enumerate(module.sections):
            title = section.get("meta", {}).get("title", "Untitled")
            tldr = section.get("tldr", "")
            content_id = section.get("contentId")

            # Status marker
            if is_current_module and i == current_section_index:
                status = " ← you are here"
            elif content_id and str(content_id) in completed_content_ids:
                status = " ✓"
            else:
                status = ""

            lines.append(f"- **{title}**{status}")
            if tldr:
                lines.append(f"  TLDR: {tldr}")

        lines.append("")

    return "\n".join(lines)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/penguin/code/lens-platform/ws4 && .venv/bin/pytest core/modules/tests/test_system_prompt_format.py -v`
Expected: PASS

- [ ] **Step 5: Update existing `test_course_overview.py` assertions**

The existing tests in `core/modules/tests/test_course_overview.py` will now fail because the format changed. Update assertions:
- `"Course Overview: Intro to AI Safety"` → check for intro line `"The course contains lenses"`
- `"CURRENT:"` → `"← you are here"`
- `"•"` → no longer used (now `## Module Title`)
- `"(optional)"` now on `## Module Title (optional)` header line
- `"✓"` still present but no longer in `[✓]` brackets
- `"---"` meeting markers unchanged
- `"unavailable"` now on `## slug (unavailable)` line

- [ ] **Step 6: Run all course overview tests**

Run: `cd /home/penguin/code/lens-platform/ws4 && .venv/bin/pytest core/modules/tests/test_course_overview.py core/modules/tests/test_system_prompt_format.py -v`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
jj commit -m "refactor: course overview uses markdown headers and structured TLDR format"
```

---

### Task 2: Markdown headers in `assemble_chat_prompt`

Add `# Instructions` and `# Current Context` headers. Move instructions before context for prominence.

**Files:**
- Modify: `core/modules/prompts.py:40-81` (`assemble_chat_prompt`)
- Modify: `core/modules/tests/test_system_prompt_format.py` (add test)
- Modify: `core/modules/tests/test_prompts.py` (update assertions)

- [ ] **Step 1: Write golden-file test for `assemble_chat_prompt` with headers**

Add to `test_system_prompt_format.py`:

```python
from core.modules.context import SectionContext
from core.modules.prompts import assemble_chat_prompt


class TestAssembleChatPromptFormat:
    """Golden-file tests for assemble_chat_prompt markdown structure."""

    def test_full_prompt_with_instructions_and_context(self):
        """Instructions come before context, both have markdown headers."""
        ctx = SectionContext(
            segments=[
                (0, "[Written by Lens Academy]\nIntro text"),
                (1, "Article content"),
            ],
            segment_index=1,
            total_segments=3,
            module_title="Introduction to AI Safety",
            section_title="The Alignment Problem",
        )

        result = assemble_chat_prompt(
            "Base prompt text",
            instructions="Ask the student what they think about X.\nDo not give away the answer.",
            context=ctx,
        )

        # Instructions header comes first (most important for behavior)
        assert "# Instructions\n" in result
        assert "# Current Context\n" in result

        # Instructions before context
        instr_pos = result.index("# Instructions")
        ctx_pos = result.index("# Current Context")
        assert instr_pos < ctx_pos

        # Content present under context
        assert "Introduction to AI Safety > The Alignment Problem" in result
        assert "Segment 1:" in result
        assert "Segment 2:" in result

    def test_instructions_only_no_context(self):
        result = assemble_chat_prompt(
            "Base prompt",
            instructions="Be concise.",
        )
        assert "# Instructions\n\nBe concise." in result
        assert "# Current Context" not in result

    def test_context_only_no_instructions(self):
        ctx = SectionContext(
            segments=[(0, "Content")],
            segment_index=0,
            total_segments=1,
        )
        result = assemble_chat_prompt("Base prompt", context=ctx)
        assert "# Instructions" not in result
        assert "# Current Context\n" in result
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/penguin/code/lens-platform/ws4 && .venv/bin/pytest core/modules/tests/test_system_prompt_format.py::TestAssembleChatPromptFormat -v`
Expected: FAIL — current format uses `Instructions:` (no `#`), no `# Current Context` header

- [ ] **Step 3: Update `assemble_chat_prompt` to use markdown headers**

```python
def assemble_chat_prompt(
    base: str,
    instructions: str | None = None,
    context: SectionContext | str | None = None,
) -> str:
    prompt = base

    # Instructions first — most important for tutor behavior
    if instructions:
        prompt += f"\n\n# Instructions\n\n{instructions}"

    if context:
        if isinstance(context, str):
            # Legacy callers (e.g. promptlab) pass a plain string
            prompt += f"\n\n# Current Context\n\nThe user previously read this content:\n---\n{context}\n---"
        else:
            prompt += "\n\n# Current Context"

            location = _format_location(context)
            if location:
                prompt += f"\n\nCurrent location: {location}"

            if context.segments:
                prompt += "\n\nThe user is engaging with the following content:"
                for seg_num, content in context.segments:
                    prompt += f"\n\nSegment {seg_num + 1}:\n{content}"

                pos = context.segment_index + 1
                total = context.total_segments
                if pos < total:
                    prompt += f"\n\nThe user is currently at segment {pos}. They have probably not read segments {pos + 1}\u2013{total} yet."
                else:
                    prompt += f"\n\nThe user is currently at segment {pos} (the last segment)."

    return prompt
```

- [ ] **Step 4: Run golden-file tests**

Run: `cd /home/penguin/code/lens-platform/ws4 && .venv/bin/pytest core/modules/tests/test_system_prompt_format.py -v`
Expected: PASS

- [ ] **Step 5: Update existing `test_prompts.py` assertions**

Update `core/modules/tests/test_prompts.py` to match new format:
- `"Instructions:\nDo this thing"` → `"# Instructions\n\nDo this thing"`
- `"The user previously read this content:"` still present but under `# Current Context`
- Location format: `"Current location in course:"` → `"Current location:"`
- Order check: instructions before context (already true, but header format changed)

- [ ] **Step 6: Run all prompt tests**

Run: `cd /home/penguin/code/lens-platform/ws4 && .venv/bin/pytest core/modules/tests/test_prompts.py core/modules/tests/test_system_prompt_format.py -v`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
jj commit -m "refactor: use markdown headers in system prompt (Instructions, Current Context)"
```

---

### Task 3: `# Role` header and `# Course Overview` header in `_build_system_prompt`

Wrap the base prompt in a `# Role` header and the course overview in a `# Course Overview` header.

**Files:**
- Modify: `core/modules/chat.py:31-79` (`_build_system_prompt`)
- Modify: `core/modules/tests/test_system_prompt_format.py` (add end-to-end test)

- [ ] **Step 1: Write end-to-end golden-file test**

Add to `test_system_prompt_format.py`:

```python
from core.modules.chat import _build_system_prompt
from core.modules.types import ChatStage


class TestFullSystemPromptFormat:
    """End-to-end test: _build_system_prompt assembles all sections."""

    def test_chat_stage_with_overview_and_context(self):
        stage = ChatStage(
            type="chat",
            instructions="Ask probing questions about alignment.",
        )
        ctx = SectionContext(
            segments=[(0, "Content here")],
            segment_index=0,
            total_segments=1,
            module_title="Intro",
            section_title="Alignment",
        )
        overview = (
            "The course contains lenses...\n"
            "\n"
            "## Intro\n"
            "\n"
            "- **Alignment** ← you are here\n"
        )

        result = _build_system_prompt(stage, None, ctx, course_overview=overview)

        # Verify section order: Role, Instructions, Course Overview, Current Context
        assert result.startswith("# Role\n\n")
        role_pos = result.index("# Role")
        instr_pos = result.index("# Instructions")
        overview_pos = result.index("# Course Overview")
        ctx_pos = result.index("# Current Context")

        assert role_pos < instr_pos
        assert instr_pos < overview_pos
        assert overview_pos < ctx_pos

    def test_chat_stage_no_overview(self):
        stage = ChatStage(type="chat", instructions="Be helpful.")
        result = _build_system_prompt(stage, None, None)

        assert result.startswith("# Role\n\n")
        assert "# Instructions\n\nBe helpful." in result
        assert "# Course Overview" not in result

    def test_article_stage_with_overview(self):
        """Article/video stages don't use assemble_chat_prompt path."""
        from core.modules.types import ArticleStage
        stage = ArticleStage(type="article", source="test.md")
        overview = "The course contains lenses...\n"

        result = _build_system_prompt(stage, "Article text here", None, course_overview=overview)

        assert result.startswith("# Role\n\n")
        assert "# Course Overview" in result
        assert "reading an article" in result
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/penguin/code/lens-platform/ws4 && .venv/bin/pytest core/modules/tests/test_system_prompt_format.py::TestFullSystemPromptFormat -v`
Expected: FAIL — no `# Role` header, course overview not under `# Course Overview`

- [ ] **Step 3: Update `_build_system_prompt` in chat.py**

```python
def _build_system_prompt(
    current_stage: Stage,
    current_content: str | None,
    section_context: SectionContext | None,
    course_overview: str | None = None,
) -> str:
    base = f"# Role\n\n{DEFAULT_BASE_PROMPT}"

    if isinstance(current_stage, ChatStage):
        context = (
            section_context
            if not current_stage.hide_previous_content_from_tutor
            else None
        )
        # assemble_chat_prompt adds # Instructions and # Current Context
        prompt = assemble_chat_prompt(base, current_stage.instructions, context)

    elif isinstance(current_stage, (ArticleStage, VideoStage)):
        content_type = (
            "reading an article"
            if isinstance(current_stage, ArticleStage)
            else "watching a video"
        )
        prompt = (
            base
            + f"\n\nThe user is currently {content_type}. Answer the student's questions "
            "to help them understand the content, but don't lengthen the conversation. "
            "There will be more time for chatting after they are done reading/watching."
        )
        if current_content:
            prompt += f"\n\nContent the user is viewing:\n---\n{current_content}\n---"
    else:
        prompt = base

    # Course overview injected after instructions but before end
    # For ChatStage, insert between Instructions and Current Context
    # For other stages, append at end
    if course_overview:
        overview_block = f"\n\n# Course Overview\n\n{course_overview}"
        if "# Current Context" in prompt:
            # Insert before # Current Context
            prompt = prompt.replace(
                "\n\n# Current Context",
                f"{overview_block}\n\n# Current Context",
            )
        else:
            prompt += overview_block

    return prompt
```

Note: The `assemble_chat_prompt` function now handles `# Instructions` and `# Current Context` headers. The `_build_system_prompt` function adds `# Role` at the top and `# Course Overview` in the right position.

- [ ] **Step 4: Run all golden-file tests**

Run: `cd /home/penguin/code/lens-platform/ws4 && .venv/bin/pytest core/modules/tests/test_system_prompt_format.py -v`
Expected: ALL PASS

- [ ] **Step 5: Run full test suite to catch regressions**

Run: `cd /home/penguin/code/lens-platform/ws4 && .venv/bin/pytest core/modules/tests/ -v`
Expected: ALL PASS (after updating test_prompts.py and test_course_overview.py in previous tasks)

- [ ] **Step 6: Commit**

```bash
jj commit -m "refactor: add Role and Course Overview markdown headers to system prompt"
```

---

### Task 4: Tool usage guidance under its own header

Currently `TOOL_USAGE_GUIDANCE` is appended to the base prompt as plain text when tools are available. Give it a `# Tools` header.

**Files:**
- Modify: `core/modules/chat.py` (where TOOL_USAGE_GUIDANCE is appended)
- Modify: `core/modules/tests/test_system_prompt_format.py` (add test)

- [ ] **Step 1: Find where TOOL_USAGE_GUIDANCE is used and write test**

```python
# In test_system_prompt_format.py
from core.modules.prompts import TOOL_USAGE_GUIDANCE


class TestToolGuidanceFormat:
    def test_tool_guidance_has_header_when_appended(self):
        """TOOL_USAGE_GUIDANCE should start with # Tools header."""
        assert TOOL_USAGE_GUIDANCE.strip().startswith("# Tools")
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — current TOOL_USAGE_GUIDANCE starts with `"You have access to tools..."`

- [ ] **Step 3: Update TOOL_USAGE_GUIDANCE in prompts.py**

```python
TOOL_USAGE_GUIDANCE = """# Tools

You have access to tools for looking up information. Use them when:
- The student asks about alignment research topics beyond the current material
- You need to verify or expand on a specific claim
- The student asks about something not covered in the course

When you use a tool, briefly mention what you're looking up. Cite sources when providing information from tools."""
```

- [ ] **Step 4: Check where it's appended in chat.py and adjust**

Search for `TOOL_USAGE_GUIDANCE` usage in `chat.py`. It's likely appended to `system` string. Ensure it's appended with proper spacing (`\n\n`) so the `# Tools` header renders correctly.

- [ ] **Step 5: Run tests**

Run: `cd /home/penguin/code/lens-platform/ws4 && .venv/bin/pytest core/modules/tests/test_system_prompt_format.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
jj commit -m "refactor: add Tools header to tool usage guidance in system prompt"
```

---

### Task 5: Manual verification with DEBUG=1

**Files:** None (verification only)

- [ ] **Step 1: Restart backend with DEBUG=1**

```bash
cd /home/penguin/code/lens-platform/ws4
lsof -ti:8400 | xargs kill 2>/dev/null
DEBUG=1 .venv/bin/python main.py --dev --port 8400 &
```

- [ ] **Step 2: Send a test message and inspect system prompt in browser**

Navigate to a module page, send a message, and verify the DEBUG output shows:
- `# Role` at the top
- `# Instructions` before course overview
- `# Course Overview` with `##` module headers and TLDR on separate lines
- `# Current Context` with segment content
- Proper markdown hierarchy throughout

- [ ] **Step 3: Run full test suite**

```bash
cd /home/penguin/code/lens-platform/ws4
.venv/bin/pytest core/modules/tests/ -v
npm run lint --prefix web_frontend
npm run build --prefix web_frontend
```

- [ ] **Step 4: Commit any final adjustments**

```bash
jj commit -m "chore: final system prompt formatting adjustments"
```
