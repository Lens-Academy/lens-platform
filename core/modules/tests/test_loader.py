# core/modules/tests/test_loader.py
"""Tests for module loader.

These tests verify that the loader retrieves modules from the cache.
"""

import pytest
from datetime import datetime

from core.content import ContentCache, set_cache, clear_cache
from core.modules.loader import (
    load_narrative_module,
    ModuleNotFoundError,
    get_available_modules,
)
from core.modules.markdown_parser import ParsedModule, ChatSection


class TestLoadNarrativeModuleFromCache:
    """Test loading narrative modules from cache."""

    def setup_method(self):
        """Set up test cache."""
        # Create a minimal parsed module
        test_module = ParsedModule(
            slug="test-module",
            title="Test Module",
            sections=[
                ChatSection(
                    instructions="Test instructions",
                    hide_previous_content_from_user=False,
                    hide_previous_content_from_tutor=False,
                )
            ],
        )

        another_module = ParsedModule(
            slug="another-module",
            title="Another Module",
            sections=[],
        )

        cache = ContentCache(
            courses={},
            modules={
                "test-module": test_module,
                "another-module": another_module,
            },
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
        module = load_narrative_module("test-module")
        assert module.slug == "test-module"
        assert module.title == "Test Module"
        assert len(module.sections) == 1
        assert module.sections[0].type == "chat"

    def test_load_module_not_found(self):
        """Should raise error for missing module."""
        with pytest.raises(ModuleNotFoundError):
            load_narrative_module("nonexistent")

    def test_get_available_modules(self):
        """Should return list of module slugs from cache."""
        modules = get_available_modules()
        assert isinstance(modules, list)
        assert "test-module" in modules
        assert "another-module" in modules
        assert len(modules) == 2
