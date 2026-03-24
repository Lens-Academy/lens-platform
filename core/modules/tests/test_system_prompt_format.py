# core/modules/tests/test_system_prompt_format.py
"""
Golden-file test for the full system prompt.

To change the prompt format:
  1. Edit fixtures/system_prompt_expected_output.md
  2. Run this test — it will fail with a diff
  3. Update production code to match

To change the test inputs (modules, course structure, context, base prompt):
  1. Edit fixtures/system_prompt_input.json
  2. Update fixtures/system_prompt_expected_output.md to match

Uses real ContentCache + real load_flattened_module (no mocks).
The slow/external boundary (GitHub content fetch) is bypassed by
populating the cache directly with set_cache().

The base_prompt in the fixture is injected via patch so the test
doesn't depend on the actual production prompt text.
"""

import json
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

from core.content.cache import ContentCache, set_cache, clear_cache
from core.modules.context import SectionContext
from core.modules.flattened_types import (
    FlattenedModule,
    MeetingMarker,
    ModuleRef,
    ParsedCourse,
)

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def _load_input():
    """Load test inputs from fixtures/system_prompt_input.json."""
    data = json.loads((FIXTURES_DIR / "system_prompt_input.json").read_text())

    # Build course
    progression = []
    for item in data["course"]["progression"]:
        if item["type"] == "module":
            progression.append(ModuleRef(slug=item["slug"], optional=item.get("optional", False)))
        elif item["type"] == "meeting":
            progression.append(MeetingMarker(name=item["name"]))
    course = ParsedCourse(
        slug=data["course"]["slug"],
        title=data["course"]["title"],
        progression=progression,
    )

    # Build modules
    modules = {}
    for slug, mod_data in data["modules"].items():
        modules[slug] = FlattenedModule(
            slug=slug,
            title=mod_data["title"],
            content_id=None,
            sections=mod_data["sections"],
        )

    # Build section context
    sc = data["section_context"]
    ctx = SectionContext(
        segments=[(s[0], s[1]) for s in sc["segments"]],
        segment_index=sc["segment_index"],
        total_segments=sc["total_segments"],
        module_title=sc.get("module_title"),
        section_title=sc.get("section_title"),
        learning_outcome=sc.get("learning_outcome"),
    )

    pos = data["current_position"]

    return data, course, modules, ctx, pos, data["stage"]


class TestFullSystemPromptGoldenFile:
    """
    Single golden-file test: build the full system prompt and compare
    against fixtures/system_prompt_expected_output.md.

    Input data comes from fixtures/system_prompt_input.json.
    The base_prompt from the fixture is patched into DEFAULT_BASE_PROMPT
    so the test doesn't break when the real prompt text changes.
    """

    def setup_method(self):
        self.data, self.course, self.modules, self.ctx, self.pos, self.stage_data = (
            _load_input()
        )
        cache = ContentCache(
            courses={self.course.slug: self.course},
            flattened_modules=self.modules,
            parsed_learning_outcomes={},
            parsed_lenses={},
            articles={},
            video_transcripts={},
            last_refreshed=datetime.now(),
        )
        set_cache(cache)

    def teardown_method(self):
        clear_cache()

    def test_matches_fixture(self):
        from core.modules.chat import _build_system_prompt
        from core.modules.prompts import build_course_overview
        from core.modules.types import ChatStage

        stage = ChatStage(
            type=self.stage_data["type"],
            instructions=self.stage_data["instructions"],
        )

        # Patch prompt text constants so the test uses the fixture's values,
        # not the real production text. This tests prompt assembly/formatting,
        # not the specific prompt wording.
        base = self.data["base_prompt"]
        overview_intro = self.data["course_overview_intro"]
        with (
            patch("core.modules.chat.DEFAULT_BASE_PROMPT", base),
            patch("core.modules.prompts.DEFAULT_BASE_PROMPT", base),
            patch("core.modules.prompts.COURSE_OVERVIEW_INTRO", overview_intro),
        ):
            overview = build_course_overview(self.course)
            result = _build_system_prompt(stage, None, self.ctx, course_overview=overview)

        expected = (
            (FIXTURES_DIR / "system_prompt_expected_output.md").read_text().rstrip("\n")
        )

        assert result == expected, (
            "System prompt does not match fixture.\n"
            "To update: edit core/modules/tests/fixtures/system_prompt_expected_output.md\n\n"
            f"=== ACTUAL ===\n{result}\n\n=== EXPECTED ===\n{expected}"
        )


class TestSystemPromptStructure:
    """Structural checks that don't depend on specific prompt text."""

    def test_no_overview_omits_course_overview_section(self):
        from core.modules.chat import _build_system_prompt
        from core.modules.types import ChatStage

        stage = ChatStage(type="chat", instructions="Be helpful.")
        result = _build_system_prompt(stage, None, None)

        assert "# General Instructions" in result
        assert "# Segment-Specific Instructions" in result
        assert "# Course Overview" not in result

    def test_article_stage_includes_role(self):
        from core.modules.chat import _build_system_prompt
        from core.modules.types import ArticleStage

        stage = ArticleStage(type="article", source="test.md")
        result = _build_system_prompt(stage, "Article text.", None)

        assert "# General Instructions" in result
        assert "reading an article" in result

