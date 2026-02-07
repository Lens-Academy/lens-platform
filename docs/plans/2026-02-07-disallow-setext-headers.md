# Disallow Setext-Style Headers Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reject Setext-style markdown headers (`===` / `---` underlines) in all content validators, requiring ATX-style (`#` prefix) exclusively.

**Architecture:** Add a shared `_check_no_setext_headers(text, fm_end)` helper that scans lines for Setext underline patterns, skipping frontmatter. Call it early in every public `validate_*` function. The `---` pattern needs care to avoid false positives from frontmatter delimiters and thematic breaks (horizontal rules).

**Tech Stack:** Python, regex, pytest

---

### Task 1: Write failing tests for Setext header detection

**Files:**
- Modify: `core/modules/tests/test_markdown_validator.py`

**Step 1: Write the failing tests**

Add a new test class at the end of the file:

```python
class TestSetextHeadersRejected:
    """Setext-style headers (=== and ---) must be rejected."""

    def test_setext_h1_in_module(self):
        """Setext H1 (===) should produce a validation error with useful guidance."""
        text = """\
---
slug: test
title: Test
---

Bad Header
==========

# Page: Real Page
id:: 11111111-1111-1111-1111-111111111111
## Text
content::
Hello
"""
        errors = validate_module(text)
        setext_errors = [e for e in errors if "setext" in e.message.lower()]
        assert len(setext_errors) >= 1
        msg = setext_errors[0].message
        # Must mention what's wrong AND what to use instead
        assert "===" in msg, "Should mention the === syntax that was found"
        assert "# " in msg, "Should show the ATX-style syntax to use instead"

    def test_setext_h2_in_module(self):
        """Setext H2 (---) should produce a validation error with useful guidance."""
        text = """\
---
slug: test
title: Test
---

# Page: Test
id:: 11111111-1111-1111-1111-111111111111
## Text
content::

Bad Subheader
-------------
"""
        errors = validate_module(text)
        setext_errors = [e for e in errors if "setext" in e.message.lower()]
        assert len(setext_errors) >= 1
        msg = setext_errors[0].message
        # Must mention what's wrong AND what to use instead
        assert "---" in msg, "Should mention the --- syntax that was found"
        assert "## " in msg, "Should show the ATX-style syntax to use instead"

    def test_setext_h1_in_course(self):
        """Setext H1 (===) in a course file should be rejected with guidance."""
        text = """\
---
slug: test-course
title: Test Course
---

Bad Header
==========
"""
        errors = validate_course(text)
        setext_errors = [e for e in errors if "setext" in e.message.lower()]
        assert len(setext_errors) >= 1
        assert "# " in setext_errors[0].message

    def test_setext_h1_in_learning_outcome(self):
        """Setext H1 (===) in a learning outcome file should be rejected with guidance."""
        text = """\
---
id: 11111111-1111-1111-1111-111111111111
---

Bad Header
==========

## Lens: Test
source:: [[test]]
"""
        errors = validate_learning_outcome(text)
        setext_errors = [e for e in errors if "setext" in e.message.lower()]
        assert len(setext_errors) >= 1
        assert "# " in setext_errors[0].message

    def test_setext_h1_in_lens(self):
        """Setext H1 (===) in a lens file should be rejected with guidance."""
        text = """\
---
id: 11111111-1111-1111-1111-111111111111
---

Bad Header
==========
"""
        errors = validate_lens(text)
        setext_errors = [e for e in errors if "setext" in e.message.lower()]
        assert len(setext_errors) >= 1
        assert "# " in setext_errors[0].message

    def test_frontmatter_dashes_not_flagged(self):
        """Frontmatter --- delimiters must NOT be flagged as Setext."""
        text = """\
---
slug: test
title: Test
---

# Page: Test
id:: 11111111-1111-1111-1111-111111111111
## Text
content::
Hello
"""
        errors = validate_module(text)
        setext_errors = [e for e in errors if "setext" in e.message.lower()]
        assert setext_errors == []

    def test_thematic_break_not_flagged(self):
        """A --- on a line after a blank line (thematic break) must NOT be flagged."""
        text = """\
---
slug: test
title: Test
---

# Page: Test
id:: 11111111-1111-1111-1111-111111111111
## Text
content::
Some text.

---

More text.
"""
        errors = validate_module(text)
        setext_errors = [e for e in errors if "setext" in e.message.lower()]
        assert setext_errors == []

    def test_short_equals_not_flagged(self):
        """A single = sign in content should not be flagged."""
        text = """\
---
slug: test
title: Test
---

# Page: Test
id:: 11111111-1111-1111-1111-111111111111
## Text
content::
x = 5
"""
        errors = validate_module(text)
        setext_errors = [e for e in errors if "setext" in e.message.lower()]
        assert setext_errors == []

    def test_atx_headers_still_work(self):
        """ATX-style headers should continue to work normally."""
        text = """\
---
slug: test
title: Test
---

# Page: Test
id:: 11111111-1111-1111-1111-111111111111
## Text
content::
Hello
"""
        errors = validate_module(text)
        assert errors == []
```

**Step 2: Run tests to verify they fail**

Run: `../.venv/bin/pytest core/modules/tests/test_markdown_validator.py::TestSetextHeadersRejected -v`

Expected: 5 FAIL (the detection tests), 4 PASS (the negative/no-false-positive tests)

**Step 3: Commit**

```bash
jj commit -m "test: add failing tests for Setext header rejection"
```

---

### Task 2: Implement Setext header detection helper

**Files:**
- Modify: `core/modules/markdown_validator.py` (add helper near top, after `_strip_critic_markup`)

**Step 1: Write the helper function**

Add after `_strip_critic_markup` (after line 42), before the wiki-link section:

```python
def _check_no_setext_headers(
    text: str, fm_end: int | None
) -> list[ValidationError]:
    """Detect Setext-style headers and return errors.

    Setext H1: a non-blank line followed by a line of ===
    Setext H2: a non-blank line followed by a line of ---

    Skips frontmatter lines. Distinguishes --- thematic breaks (preceded by
    a blank line) from Setext H2 underlines (preceded by text).
    """
    errors: list[ValidationError] = []
    lines = text.split("\n")
    start = fm_end if fm_end is not None else 0

    for i in range(start, len(lines)):
        line = lines[i]
        stripped = line.strip()

        # Setext H1: line of 3+ '=' chars, previous line is non-blank text
        if re.match(r"^={3,}\s*$", stripped):
            if i > 0 and lines[i - 1].strip():
                errors.append(
                    ValidationError(
                        "Setext-style header (===) is not allowed. "
                        "Use ATX-style: # Header",
                        line=i + 1,
                        context=lines[i - 1].strip(),
                    )
                )

        # Setext H2: line of 3+ '-' chars, previous line is non-blank text
        elif re.match(r"^-{3,}\s*$", stripped):
            if i > 0 and lines[i - 1].strip():
                errors.append(
                    ValidationError(
                        "Setext-style header (---) is not allowed. "
                        "Use ATX-style: ## Header",
                        line=i + 1,
                        context=lines[i - 1].strip(),
                    )
                )

    return errors
```

**Step 2: Run all existing tests to verify nothing breaks**

Run: `../.venv/bin/pytest core/modules/tests/test_markdown_validator.py -v -x`

Expected: All existing tests PASS (helper exists but isn't called yet)

**Step 3: Commit**

```bash
jj commit -m "feat: add _check_no_setext_headers helper"
```

---

### Task 3: Wire helper into all four public validators

**Files:**
- Modify: `core/modules/markdown_validator.py`

**Step 1: Add call in `validate_module` (line ~352)**

After `text = _strip_critic_markup(text)` and `errors: list[ValidationError] = []`, before the frontmatter validation:

```python
def validate_module(text: str) -> list[ValidationError]:
    # Strip critic markup before validation
    text = _strip_critic_markup(text)

    errors: list[ValidationError] = []

    # Check for Setext-style headers
    metadata, fm_start, fm_end = _parse_frontmatter_for_validation(text)
    errors.extend(_check_no_setext_headers(text, fm_end))

    # 1. Validate frontmatter (reuse already-parsed result)
    if fm_start is None:
        ...
```

Note: The frontmatter parse is already done — reorder so it happens before the setext check, then reuse the result. This avoids parsing frontmatter twice.

**Step 2: Add call in `validate_course` (line ~837)**

Same pattern — after stripping critic markup (if present) and parsing frontmatter, call `_check_no_setext_headers(text, fm_end)`.

**Step 3: Add call in `validate_learning_outcome` (line ~936)**

Same pattern.

**Step 4: Add call in `validate_lens` (line ~1049)**

Same pattern.

**Step 5: Run the new tests**

Run: `../.venv/bin/pytest core/modules/tests/test_markdown_validator.py::TestSetextHeadersRejected -v`

Expected: All 9 PASS

**Step 6: Run the full test suite**

Run: `../.venv/bin/pytest core/modules/tests/test_markdown_validator.py -v`

Expected: All tests PASS

**Step 7: Commit**

```bash
jj commit -m "feat: reject Setext-style headers in all content validators"
```

---

### Task 4: Run full project checks

**Step 1: Run all core tests**

Run: `../.venv/bin/pytest core/`

Expected: All PASS

**Step 2: Run linting**

Run: `ruff check core/modules/markdown_validator.py core/modules/tests/test_markdown_validator.py`

Expected: No errors

**Step 3: Run formatting check**

Run: `ruff format --check core/modules/markdown_validator.py core/modules/tests/test_markdown_validator.py`

Expected: No errors (fix if needed with `ruff format`)
