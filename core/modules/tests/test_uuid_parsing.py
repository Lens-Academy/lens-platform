"""Tests for UUID extraction from content frontmatter."""

import uuid
from core.modules.markdown_parser import parse_module


def test_parse_module_extracts_uuid():
    """Module with id in frontmatter should have content_id set."""
    markdown = """---
id: 550e8400-e29b-41d4-a716-446655440000
slug: introduction
title: Introduction
---

# Text: Welcome
content::
Hello world.
"""
    module = parse_module(markdown)
    assert module.content_id == uuid.UUID("550e8400-e29b-41d4-a716-446655440000")


def test_parse_module_without_uuid():
    """Module without id should have content_id as None."""
    markdown = """---
slug: introduction
title: Introduction
---

# Text: Welcome
content::
Hello world.
"""
    module = parse_module(markdown)
    assert module.content_id is None


def test_parse_section_with_uuid():
    """Section with id field should have content_id set."""
    markdown = """---
slug: introduction
title: Introduction
---

# Video: AI Overview
id:: f47ac10b-58cc-4372-a567-0e02b2c3d479
source:: [[video_transcripts/ai-overview]]

## Video-excerpt
from:: 0:00
"""
    module = parse_module(markdown)
    assert len(module.sections) == 1
    assert module.sections[0].content_id == uuid.UUID(
        "f47ac10b-58cc-4372-a567-0e02b2c3d479"
    )


def test_parse_section_without_uuid():
    """Section without id should have content_id as None."""
    markdown = """---
slug: introduction
title: Introduction
---

# Video: AI Overview
source:: [[video_transcripts/ai-overview]]

## Video-excerpt
from:: 0:00
"""
    module = parse_module(markdown)
    assert len(module.sections) == 1
    assert module.sections[0].content_id is None
