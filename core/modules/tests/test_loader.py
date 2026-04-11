# core/modules/tests/test_loader.py
"""Tests for module loader.

These tests verify that the loader retrieves modules from the cache.
"""

import pytest
from datetime import datetime
from uuid import UUID

from core.content import ContentCache, set_cache, clear_cache
from core.modules.loader import (
    load_flattened_module,
    load_narrative_module,
    ModuleNotFoundError,
    get_available_modules,
)
from core.modules.flattened_types import FlattenedModule


class TestLoadNarrativeModuleFromCache:
    """Test loading flattened modules from cache."""

    def setup_method(self):
        """Set up test cache."""
        # Create a minimal flattened module (sections are dicts)
        test_module = FlattenedModule(
            slug="test-module",
            title="Test Module",
            content_id=UUID("00000000-0000-0000-0000-000000000001"),
            sections=[
                {
                    "type": "lens",
                    "contentId": "00000000-0000-0000-0000-000000000002",
                    "title": "Test Page",
                    "segments": [
                        {
                            "type": "chat",
                            "instructions": "Test instructions",
                        }
                    ],
                }
            ],
        )

        another_module = FlattenedModule(
            slug="another-module",
            title="Another Module",
            content_id=UUID("00000000-0000-0000-0000-000000000003"),
            sections=[],
        )

        cache = ContentCache(
            courses={},
            flattened_modules={
                "test-module": test_module,
                "another-module": another_module,
            },
            parsed_learning_outcomes={},
            parsed_lenses={},
            articles={},
            video_transcripts={},
            last_refreshed=datetime.now(),
        )
        set_cache(cache)

    def teardown_method(self):
        """Clear cache after test."""
        clear_cache()

    def test_load_module_from_cache(self):
        """Should load module from cache."""
        module = load_flattened_module("test-module")
        assert module.slug == "test-module"
        assert module.title == "Test Module"
        assert len(module.sections) == 1
        assert module.sections[0]["type"] == "lens"

    def test_load_module_not_found(self):
        """Should raise error for missing module."""
        with pytest.raises(ModuleNotFoundError):
            load_flattened_module("nonexistent")

    def test_get_available_modules(self):
        """Should return list of module slugs from cache."""
        modules = get_available_modules()
        assert isinstance(modules, list)
        assert "test-module" in modules
        assert "another-module" in modules
        assert len(modules) == 2

    def test_load_narrative_module_alias(self):
        """load_narrative_module should be an alias for load_flattened_module."""
        module = load_narrative_module("test-module")
        assert module.slug == "test-module"
        assert module.title == "Test Module"
