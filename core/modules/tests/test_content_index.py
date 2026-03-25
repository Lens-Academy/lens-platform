# core/modules/tests/test_content_index.py
"""Tests for course content indexing."""

from core.modules.tools.content_index import ContentIndex


def _make_cache_data():
    """Minimal cache-like data for testing."""
    from core.modules.flattened_types import FlattenedModule, ParsedCourse, ModuleRef

    modules = {
        "risks-from-ai": FlattenedModule(
            slug="risks-from-ai",
            title="Risks from AI",
            content_id=None,
            sections=[
                {
                    "type": "lens",
                    "meta": {"title": "Goal Misgeneralization"},
                    "segments": [
                        {
                            "type": "text",
                            "content": "Mesa-optimization is when a learned model develops its own objective.",
                        },
                        {
                            "type": "article",
                            "content": "Inner alignment failures can cause mesa-optimizers to pursue unintended goals.",
                            "title": "Inner Alignment",
                            "author": "Hubinger",
                        },
                        {"type": "chat", "instructions": "Discuss"},
                    ],
                },
                {
                    "type": "lens",
                    "meta": {"title": "Deceptive Alignment"},
                    "segments": [
                        {
                            "type": "video",
                            "transcript": "A deceptively aligned agent would behave well during training.",
                            "title": "Deceptive AI",
                            "channel": "Robert Miles",
                        },
                        {"type": "chat", "instructions": "Discuss"},
                    ],
                },
            ],
        ),
        "alignment": FlattenedModule(
            slug="alignment",
            title="Alignment Approaches",
            content_id=None,
            sections=[
                {
                    "type": "lens",
                    "meta": {"title": "RLHF Overview"},
                    "segments": [
                        {
                            "type": "text",
                            "content": "Reinforcement learning from human feedback is a technique for aligning language models.",
                        },
                        {"type": "chat", "instructions": "Discuss"},
                    ],
                },
            ],
        ),
    }

    courses = {
        "agi-safety": ParsedCourse(
            slug="agi-safety",
            title="AGI Safety Fundamentals",
            progression=[
                ModuleRef(slug="risks-from-ai"),
                ModuleRef(slug="alignment"),
            ],
        ),
    }

    return courses, modules


class TestContentIndexBuild:
    def test_builds_paths_from_course(self):
        """Index should create entries for each lens in each course."""
        courses, modules = _make_cache_data()
        index = ContentIndex(courses, modules)

        paths = index.list_paths()
        assert "AGI Safety Fundamentals/Risks from AI/Goal Misgeneralization" in paths
        assert "AGI Safety Fundamentals/Risks from AI/Deceptive Alignment" in paths
        assert "AGI Safety Fundamentals/Alignment Approaches/RLHF Overview" in paths

    def test_total_lens_count(self):
        courses, modules = _make_cache_data()
        index = ContentIndex(courses, modules)
        assert len(index.list_paths()) == 3

    def test_skips_modules_not_in_courses(self):
        """Modules not referenced by any course should not be indexed."""
        courses, modules = _make_cache_data()
        from core.modules.flattened_types import FlattenedModule

        modules["standalone"] = FlattenedModule(
            slug="standalone",
            title="Standalone Module",
            content_id=None,
            sections=[
                {
                    "type": "lens",
                    "meta": {"title": "Orphan Lens"},
                    "segments": [{"type": "text", "content": "Not in course"}],
                }
            ],
        )
        index = ContentIndex(courses, modules)
        assert not any("Standalone" in p for p in index.list_paths())


class TestContentIndexRead:
    def test_read_existing_lens(self):
        """read_lens should return formatted content with segment tags."""
        courses, modules = _make_cache_data()
        index = ContentIndex(courses, modules)

        result = index.read_lens(
            "AGI Safety Fundamentals/Risks from AI/Goal Misgeneralization"
        )
        assert result is not None
        assert '<segment index="1" type="text">' in result
        assert "Mesa-optimization" in result
        assert '<segment index="2" type="article-excerpt">' in result
        assert "Inner alignment failures" in result
        assert '<segment index="3" type="chat">' in result
        assert "</segment>" in result

    def test_read_case_insensitive(self):
        courses, modules = _make_cache_data()
        index = ContentIndex(courses, modules)

        result = index.read_lens(
            "agi safety fundamentals/risks from ai/goal misgeneralization"
        )
        assert result is not None
        assert "Mesa-optimization" in result

    def test_read_nonexistent_returns_none(self):
        courses, modules = _make_cache_data()
        index = ContentIndex(courses, modules)

        result = index.read_lens("Nonexistent/Path/Here")
        assert result is None

    def test_read_strips_slashes(self):
        courses, modules = _make_cache_data()
        index = ContentIndex(courses, modules)

        result = index.read_lens(
            "/AGI Safety Fundamentals/Risks from AI/Goal Misgeneralization/"
        )
        assert result is not None


class TestContentIndexSearch:
    def test_search_finds_matching_content(self):
        """Search should find lenses containing the query terms."""
        courses, modules = _make_cache_data()
        index = ContentIndex(courses, modules)
        results = index.search("mesa-optimization")
        assert len(results) >= 1
        assert (
            results[0].path
            == "AGI Safety Fundamentals/Risks from AI/Goal Misgeneralization"
        )

    def test_search_returns_snippets(self):
        """Results should include a text snippet with context."""
        courses, modules = _make_cache_data()
        index = ContentIndex(courses, modules)
        results = index.search("RLHF")
        assert len(results) >= 1
        assert "reinforcement learning" in results[0].snippet.lower()

    def test_search_ranks_by_relevance(self):
        """Lenses with more matches should rank higher."""
        courses, modules = _make_cache_data()
        index = ContentIndex(courses, modules)
        results = index.search("mesa")
        if len(results) > 1:
            assert (
                results[0].path
                == "AGI Safety Fundamentals/Risks from AI/Goal Misgeneralization"
            )

    def test_search_no_results(self):
        courses, modules = _make_cache_data()
        index = ContentIndex(courses, modules)
        results = index.search("quantum computing blockchain")
        assert results == []

    def test_search_empty_query(self):
        courses, modules = _make_cache_data()
        index = ContentIndex(courses, modules)
        results = index.search("")
        assert results == []

    def test_search_max_results(self):
        courses, modules = _make_cache_data()
        index = ContentIndex(courses, modules)
        results = index.search("alignment", max_results=1)
        assert len(results) <= 1

    def test_search_result_has_path_and_segment_type(self):
        """Results should include the lens path and the segment type of the best match."""
        courses, modules = _make_cache_data()
        index = ContentIndex(courses, modules)
        results = index.search("deceptively aligned")
        assert len(results) >= 1
        result = results[0]
        assert (
            result.path == "AGI Safety Fundamentals/Risks from AI/Deceptive Alignment"
        )
        assert result.segment_type == "video-excerpt"
