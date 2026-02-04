"""Tests for GitHub content fetcher."""

import os
import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from datetime import datetime
from uuid import UUID

# These imports will fail until we implement the module
from core.content.github_fetcher import (
    get_content_branch,
    ContentBranchNotConfiguredError,
    GitHubFetchError,
    CONTENT_REPO,
    fetch_file,
    list_directory,
    fetch_all_content,
    get_latest_commit_sha,
    compare_commits,
    ChangedFile,
    CommitComparison,
    incremental_refresh,
    _apply_file_change,
    _get_tracked_directory,
)
from core.content.cache import ContentCache, set_cache, clear_cache, get_cache
from core.modules.flattened_types import FlattenedModule


class TestConfig:
    """Test configuration handling."""

    def test_get_content_branch_raises_when_not_set(self):
        """Should raise error when EDUCATIONAL_CONTENT_BRANCH not set."""
        with patch.dict(os.environ, {}, clear=True):
            # Remove the env var if it exists
            os.environ.pop("EDUCATIONAL_CONTENT_BRANCH", None)

            with pytest.raises(ContentBranchNotConfiguredError):
                get_content_branch()

    def test_get_content_branch_returns_value(self):
        """Should return branch when set."""
        with patch.dict(os.environ, {"EDUCATIONAL_CONTENT_BRANCH": "staging"}):
            assert get_content_branch() == "staging"

    def test_content_repo_is_correct(self):
        """Should have correct repo configured."""
        assert CONTENT_REPO == "Lens-Academy/lens-edu-relay"


class TestFetchFile:
    """Test fetch_file function."""

    @pytest.mark.asyncio
    async def test_fetch_file_success(self):
        """Should fetch file content from GitHub."""
        mock_response = AsyncMock()
        mock_response.status_code = 200
        mock_response.text = "# Test Content\n\nHello world"

        with patch.dict(
            os.environ,
            {"EDUCATIONAL_CONTENT_BRANCH": "main", "GITHUB_TOKEN": "test-token"},
        ):
            with patch("httpx.AsyncClient") as mock_client_class:
                mock_client = AsyncMock()
                mock_client.__aenter__.return_value = mock_client
                mock_client.__aexit__.return_value = None
                mock_client.get.return_value = mock_response
                mock_client_class.return_value = mock_client

                result = await fetch_file("modules/test.md")

                assert result == "# Test Content\n\nHello world"
                mock_client.get.assert_called_once()
                # Verify URL contains correct path
                call_url = mock_client.get.call_args[0][0]
                assert "modules/test.md" in call_url
                assert "Lens-Academy/lens-edu-relay" in call_url
                assert "main" in call_url

    @pytest.mark.asyncio
    async def test_fetch_file_with_auth_header(self):
        """Should include auth header when GITHUB_TOKEN is set."""
        mock_response = AsyncMock()
        mock_response.status_code = 200
        mock_response.text = "content"

        with patch.dict(
            os.environ,
            {"EDUCATIONAL_CONTENT_BRANCH": "main", "GITHUB_TOKEN": "secret-token"},
        ):
            with patch("httpx.AsyncClient") as mock_client_class:
                mock_client = AsyncMock()
                mock_client.__aenter__.return_value = mock_client
                mock_client.__aexit__.return_value = None
                mock_client.get.return_value = mock_response
                mock_client_class.return_value = mock_client

                await fetch_file("test.md")

                call_kwargs = mock_client.get.call_args[1]
                assert "headers" in call_kwargs
                assert "Authorization" in call_kwargs["headers"]
                assert "token secret-token" in call_kwargs["headers"]["Authorization"]

    @pytest.mark.asyncio
    async def test_fetch_file_raises_on_404(self):
        """Should raise GitHubFetchError on HTTP errors."""
        mock_response = AsyncMock()
        mock_response.status_code = 404
        mock_response.text = "Not Found"

        with patch.dict(os.environ, {"EDUCATIONAL_CONTENT_BRANCH": "main"}):
            with patch("httpx.AsyncClient") as mock_client_class:
                mock_client = AsyncMock()
                mock_client.__aenter__.return_value = mock_client
                mock_client.__aexit__.return_value = None
                mock_client.get.return_value = mock_response
                mock_client_class.return_value = mock_client

                with pytest.raises(GitHubFetchError) as exc_info:
                    await fetch_file("nonexistent.md")

                assert "404" in str(exc_info.value)


class TestListDirectory:
    """Test list_directory function."""

    @pytest.mark.asyncio
    async def test_list_directory_success(self):
        """Should list files in directory."""
        # Use MagicMock for response since httpx .json() is synchronous
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = [
            {"path": "modules/intro.md", "type": "file"},
            {"path": "modules/advanced.md", "type": "file"},
            {"path": "modules/drafts", "type": "dir"},  # Should be excluded
        ]

        with patch.dict(
            os.environ,
            {"EDUCATIONAL_CONTENT_BRANCH": "staging", "GITHUB_TOKEN": "test-token"},
        ):
            with patch("httpx.AsyncClient") as mock_client_class:
                mock_client = AsyncMock()
                mock_client.__aenter__.return_value = mock_client
                mock_client.__aexit__.return_value = None
                mock_client.get.return_value = mock_response
                mock_client_class.return_value = mock_client

                result = await list_directory("modules")

                assert result == ["modules/intro.md", "modules/advanced.md"]
                # Verify API URL is used
                call_url = mock_client.get.call_args[0][0]
                assert "api.github.com" in call_url
                assert "modules" in call_url

    @pytest.mark.asyncio
    async def test_list_directory_raises_on_error(self):
        """Should raise GitHubFetchError on API errors."""
        # Use MagicMock for response since httpx .json() is synchronous
        mock_response = MagicMock()
        mock_response.status_code = 403
        mock_response.json.return_value = {"message": "Rate limit exceeded"}

        with patch.dict(os.environ, {"EDUCATIONAL_CONTENT_BRANCH": "main"}):
            with patch("httpx.AsyncClient") as mock_client_class:
                mock_client = AsyncMock()
                mock_client.__aenter__.return_value = mock_client
                mock_client.__aexit__.return_value = None
                mock_client.get.return_value = mock_response
                mock_client_class.return_value = mock_client

                with pytest.raises(GitHubFetchError) as exc_info:
                    await list_directory("modules")

                assert "403" in str(exc_info.value)


class TestFetchAllContent:
    """Test fetch_all_content function."""

    @pytest.mark.asyncio
    async def test_fetch_all_content_returns_cache(self):
        """Should fetch all content and return ContentCache."""
        # Mock directory listings
        dir_responses = {
            "modules": [{"path": "modules/intro.md", "type": "file"}],
            "courses": [{"path": "courses/fundamentals.md", "type": "file"}],
            "articles": [{"path": "articles/safety.md", "type": "file"}],
            "video_transcripts": [
                {"path": "video_transcripts/vid1.md", "type": "file"}
            ],
        }

        # Mock file contents
        module_md = """---
slug: intro
title: Introduction
---

# Chat: Welcome
instructions:: Hello!
"""
        course_md = """---
slug: fundamentals
title: AI Safety Fundamentals
---

# Lesson: [[modules/intro]]
"""
        article_md = "# Safety Article\n\nContent here."
        transcript_md = "# Video Transcript\n\nTranscript here."

        def mock_get_side_effect(url, **kwargs):
            # Use MagicMock for response since httpx .json() is synchronous
            import base64

            response = MagicMock()
            response.status_code = 200
            if "api.github.com" in url:
                if "/commits/" in url:
                    # Commit SHA API call
                    response.json.return_value = {"sha": "abc123def456"}
                elif ".md" in url:
                    # Contents API for file fetch (returns base64-encoded content)
                    content = ""
                    if "modules/" in url:
                        content = module_md
                    elif "courses/" in url:
                        content = course_md
                    elif "articles/" in url:
                        content = article_md
                    elif "video_transcripts/" in url:
                        content = transcript_md
                    response.json.return_value = {
                        "content": base64.b64encode(content.encode()).decode()
                    }
                else:
                    # Directory listing (no .md in URL)
                    for dir_name, items in dir_responses.items():
                        if dir_name in url:
                            response.json.return_value = items
                            break
            else:
                # Raw file fetch (not used when ref is provided, but keep for completeness)
                if "modules/" in url:
                    response.text = module_md
                elif "courses/" in url:
                    response.text = course_md
                elif "articles/" in url:
                    response.text = article_md
                elif "video_transcripts/" in url:
                    response.text = transcript_md
            return response

        with patch.dict(
            os.environ, {"EDUCATIONAL_CONTENT_BRANCH": "main", "GITHUB_TOKEN": "token"}
        ):
            with patch("httpx.AsyncClient") as mock_client_class:
                mock_client = AsyncMock()
                mock_client.__aenter__.return_value = mock_client
                mock_client.__aexit__.return_value = None
                mock_client.get.side_effect = mock_get_side_effect
                mock_client_class.return_value = mock_client

                cache = await fetch_all_content()

                # Verify cache structure - now uses flattened_modules
                assert "intro" in cache.flattened_modules
                assert cache.flattened_modules["intro"].title == "Introduction"

                assert "fundamentals" in cache.courses
                assert cache.courses["fundamentals"].title == "AI Safety Fundamentals"

                assert "articles/safety.md" in cache.articles
                assert "Safety Article" in cache.articles["articles/safety.md"]

                assert "video_transcripts/vid1.md" in cache.video_transcripts

                assert isinstance(cache.last_refreshed, datetime)
                assert cache.last_commit_sha == "abc123def456"


class TestGetLatestCommitSha:
    """Test get_latest_commit_sha function."""

    @pytest.mark.asyncio
    async def test_get_latest_commit_sha_success(self):
        """Should return SHA from GitHub API response."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "sha": "a1b2c3d4e5f6g7h8i9j0",
            "commit": {"message": "Latest commit"},
        }

        with patch.dict(
            os.environ,
            {"EDUCATIONAL_CONTENT_BRANCH": "main", "GITHUB_TOKEN": "test-token"},
        ):
            with patch("httpx.AsyncClient") as mock_client_class:
                mock_client = AsyncMock()
                mock_client.__aenter__.return_value = mock_client
                mock_client.__aexit__.return_value = None
                mock_client.get.return_value = mock_response
                mock_client_class.return_value = mock_client

                result = await get_latest_commit_sha()

                assert result == "a1b2c3d4e5f6g7h8i9j0"
                # Verify correct API URL is used
                call_url = mock_client.get.call_args[0][0]
                assert "api.github.com" in call_url
                assert "/commits/" in call_url
                assert "main" in call_url

    @pytest.mark.asyncio
    async def test_get_latest_commit_sha_uses_configured_branch(self):
        """Should use configured branch in API URL."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"sha": "sha123"}

        with patch.dict(
            os.environ,
            {"EDUCATIONAL_CONTENT_BRANCH": "staging"},
        ):
            with patch("httpx.AsyncClient") as mock_client_class:
                mock_client = AsyncMock()
                mock_client.__aenter__.return_value = mock_client
                mock_client.__aexit__.return_value = None
                mock_client.get.return_value = mock_response
                mock_client_class.return_value = mock_client

                await get_latest_commit_sha()

                call_url = mock_client.get.call_args[0][0]
                assert "staging" in call_url

    @pytest.mark.asyncio
    async def test_get_latest_commit_sha_raises_on_error(self):
        """Should raise GitHubFetchError on API errors."""
        mock_response = MagicMock()
        mock_response.status_code = 404

        with patch.dict(os.environ, {"EDUCATIONAL_CONTENT_BRANCH": "main"}):
            with patch("httpx.AsyncClient") as mock_client_class:
                mock_client = AsyncMock()
                mock_client.__aenter__.return_value = mock_client
                mock_client.__aexit__.return_value = None
                mock_client.get.return_value = mock_response
                mock_client_class.return_value = mock_client

                with pytest.raises(GitHubFetchError) as exc_info:
                    await get_latest_commit_sha()

                assert "404" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_get_latest_commit_sha_includes_auth_header(self):
        """Should include auth header when GITHUB_TOKEN is set."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"sha": "sha123"}

        with patch.dict(
            os.environ,
            {"EDUCATIONAL_CONTENT_BRANCH": "main", "GITHUB_TOKEN": "my-secret-token"},
        ):
            with patch("httpx.AsyncClient") as mock_client_class:
                mock_client = AsyncMock()
                mock_client.__aenter__.return_value = mock_client
                mock_client.__aexit__.return_value = None
                mock_client.get.return_value = mock_response
                mock_client_class.return_value = mock_client

                await get_latest_commit_sha()

                call_kwargs = mock_client.get.call_args[1]
                assert "headers" in call_kwargs
                assert "Authorization" in call_kwargs["headers"]
                assert "my-secret-token" in call_kwargs["headers"]["Authorization"]


class TestFetchAllContentWithCommitSha:
    """Test fetch_all_content includes commit SHA in cache."""

    @pytest.mark.asyncio
    async def test_fetch_all_content_includes_commit_sha(self):
        """Should include last_commit_sha in returned cache."""
        # Minimal mock setup to test commit SHA integration
        test_commit_sha = "deadbeef1234567890"

        dir_responses = {
            "modules": [],
            "courses": [],
            "articles": [],
            "video_transcripts": [],
        }

        def mock_get_side_effect(url, **kwargs):
            response = MagicMock()
            response.status_code = 200
            if "api.github.com" in url:
                if "/commits/" in url:
                    response.json.return_value = {"sha": test_commit_sha}
                else:
                    # Directory listing - return empty for simplicity
                    for dir_name in dir_responses:
                        if dir_name in url:
                            response.json.return_value = []
                            break
            return response

        with patch.dict(
            os.environ, {"EDUCATIONAL_CONTENT_BRANCH": "main", "GITHUB_TOKEN": "token"}
        ):
            with patch("httpx.AsyncClient") as mock_client_class:
                mock_client = AsyncMock()
                mock_client.__aenter__.return_value = mock_client
                mock_client.__aexit__.return_value = None
                mock_client.get.side_effect = mock_get_side_effect
                mock_client_class.return_value = mock_client

                cache = await fetch_all_content()

                assert cache.last_commit_sha == test_commit_sha


class TestCompareCommits:
    """Test compare_commits function."""

    @pytest.mark.asyncio
    async def test_compare_commits_returns_changed_files(self):
        """Should return correct ChangedFile objects for each change type."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "files": [
                {"filename": "modules/intro.md", "status": "added"},
                {"filename": "modules/advanced.md", "status": "modified"},
                {"filename": "modules/old.md", "status": "removed"},
            ],
            "status": "ahead",
            "total_commits": 3,
        }

        with patch.dict(
            os.environ,
            {"EDUCATIONAL_CONTENT_BRANCH": "main", "GITHUB_TOKEN": "test-token"},
        ):
            with patch("httpx.AsyncClient") as mock_client_class:
                mock_client = AsyncMock()
                mock_client.__aenter__.return_value = mock_client
                mock_client.__aexit__.return_value = None
                mock_client.get.return_value = mock_response
                mock_client_class.return_value = mock_client

                result = await compare_commits("abc123", "def456")

                # Verify we got a CommitComparison
                assert isinstance(result, CommitComparison)
                assert len(result.files) == 3
                assert result.is_truncated is False

                # Verify each ChangedFile
                added = result.files[0]
                assert isinstance(added, ChangedFile)
                assert added.path == "modules/intro.md"
                assert added.status == "added"
                assert added.previous_path is None

                modified = result.files[1]
                assert modified.path == "modules/advanced.md"
                assert modified.status == "modified"

                removed = result.files[2]
                assert removed.path == "modules/old.md"
                assert removed.status == "removed"

                # Verify correct API URL was called
                call_url = mock_client.get.call_args[0][0]
                assert "api.github.com" in call_url
                assert "compare" in call_url
                assert "abc123...def456" in call_url

    @pytest.mark.asyncio
    async def test_compare_commits_handles_renamed_files(self):
        """Should include previous_path for renamed files."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "files": [
                {
                    "filename": "modules/new_name.md",
                    "status": "renamed",
                    "previous_filename": "modules/old_name.md",
                },
            ],
        }

        with patch.dict(os.environ, {"EDUCATIONAL_CONTENT_BRANCH": "main"}):
            with patch("httpx.AsyncClient") as mock_client_class:
                mock_client = AsyncMock()
                mock_client.__aenter__.return_value = mock_client
                mock_client.__aexit__.return_value = None
                mock_client.get.return_value = mock_response
                mock_client_class.return_value = mock_client

                result = await compare_commits("base", "head")

                assert len(result.files) == 1
                renamed = result.files[0]
                assert renamed.path == "modules/new_name.md"
                assert renamed.status == "renamed"
                assert renamed.previous_path == "modules/old_name.md"

    @pytest.mark.asyncio
    async def test_compare_commits_detects_truncation(self):
        """Should set is_truncated=True when 300 or more files returned."""
        # Create 300 files to trigger truncation detection
        files_data = [
            {"filename": f"file{i}.md", "status": "modified"} for i in range(300)
        ]

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"files": files_data}

        with patch.dict(os.environ, {"EDUCATIONAL_CONTENT_BRANCH": "main"}):
            with patch("httpx.AsyncClient") as mock_client_class:
                mock_client = AsyncMock()
                mock_client.__aenter__.return_value = mock_client
                mock_client.__aexit__.return_value = None
                mock_client.get.return_value = mock_response
                mock_client_class.return_value = mock_client

                result = await compare_commits("base", "head")

                assert result.is_truncated is True
                assert len(result.files) == 300

    @pytest.mark.asyncio
    async def test_compare_commits_not_truncated_below_300(self):
        """Should set is_truncated=False when fewer than 300 files returned."""
        files_data = [
            {"filename": f"file{i}.md", "status": "modified"} for i in range(299)
        ]

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"files": files_data}

        with patch.dict(os.environ, {"EDUCATIONAL_CONTENT_BRANCH": "main"}):
            with patch("httpx.AsyncClient") as mock_client_class:
                mock_client = AsyncMock()
                mock_client.__aenter__.return_value = mock_client
                mock_client.__aexit__.return_value = None
                mock_client.get.return_value = mock_response
                mock_client_class.return_value = mock_client

                result = await compare_commits("base", "head")

                assert result.is_truncated is False
                assert len(result.files) == 299

    @pytest.mark.asyncio
    async def test_compare_commits_raises_on_api_error(self):
        """Should raise GitHubFetchError on API errors."""
        mock_response = MagicMock()
        mock_response.status_code = 404

        with patch.dict(os.environ, {"EDUCATIONAL_CONTENT_BRANCH": "main"}):
            with patch("httpx.AsyncClient") as mock_client_class:
                mock_client = AsyncMock()
                mock_client.__aenter__.return_value = mock_client
                mock_client.__aexit__.return_value = None
                mock_client.get.return_value = mock_response
                mock_client_class.return_value = mock_client

                with pytest.raises(GitHubFetchError) as exc_info:
                    await compare_commits("invalid", "commits")

                assert "404" in str(exc_info.value)
                assert "invalid...commits" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_compare_commits_includes_auth_header(self):
        """Should include auth header when GITHUB_TOKEN is set."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"files": []}

        with patch.dict(
            os.environ,
            {"EDUCATIONAL_CONTENT_BRANCH": "main", "GITHUB_TOKEN": "secret-token"},
        ):
            with patch("httpx.AsyncClient") as mock_client_class:
                mock_client = AsyncMock()
                mock_client.__aenter__.return_value = mock_client
                mock_client.__aexit__.return_value = None
                mock_client.get.return_value = mock_response
                mock_client_class.return_value = mock_client

                await compare_commits("base", "head")

                call_kwargs = mock_client.get.call_args[1]
                assert "headers" in call_kwargs
                assert "Authorization" in call_kwargs["headers"]
                assert "token secret-token" in call_kwargs["headers"]["Authorization"]

    @pytest.mark.asyncio
    async def test_compare_commits_handles_empty_files_list(self):
        """Should handle response with no changed files."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"files": []}

        with patch.dict(os.environ, {"EDUCATIONAL_CONTENT_BRANCH": "main"}):
            with patch("httpx.AsyncClient") as mock_client_class:
                mock_client = AsyncMock()
                mock_client.__aenter__.return_value = mock_client
                mock_client.__aexit__.return_value = None
                mock_client.get.return_value = mock_response
                mock_client_class.return_value = mock_client

                result = await compare_commits("same", "same")

                assert len(result.files) == 0
                assert result.is_truncated is False

    @pytest.mark.asyncio
    async def test_compare_commits_handles_unknown_status(self):
        """Should default unknown status values to 'modified'."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "files": [
                {"filename": "file.md", "status": "unknown_status"},
            ],
        }

        with patch.dict(os.environ, {"EDUCATIONAL_CONTENT_BRANCH": "main"}):
            with patch("httpx.AsyncClient") as mock_client_class:
                mock_client = AsyncMock()
                mock_client.__aenter__.return_value = mock_client
                mock_client.__aexit__.return_value = None
                mock_client.get.return_value = mock_response
                mock_client_class.return_value = mock_client

                result = await compare_commits("base", "head")

                assert len(result.files) == 1
                assert result.files[0].status == "modified"


class TestGetTrackedDirectory:
    """Test _get_tracked_directory helper function."""

    def test_returns_modules_for_modules_path(self):
        """Should return 'modules' for files in modules directory."""
        assert _get_tracked_directory("modules/intro.md") == "modules"
        assert _get_tracked_directory("modules/nested/deep.md") == "modules"

    def test_returns_courses_for_courses_path(self):
        """Should return 'courses' for files in courses directory."""
        assert _get_tracked_directory("courses/fundamentals.md") == "courses"

    def test_returns_articles_for_articles_path(self):
        """Should return 'articles' for files in articles directory."""
        assert _get_tracked_directory("articles/safety.md") == "articles"

    def test_returns_video_transcripts_for_transcripts_path(self):
        """Should return 'video_transcripts' for files in video_transcripts directory."""
        assert (
            _get_tracked_directory("video_transcripts/vid1.md") == "video_transcripts"
        )

    def test_returns_none_for_untracked_path(self):
        """Should return None for files outside tracked directories."""
        assert _get_tracked_directory("README.md") is None
        assert _get_tracked_directory("docs/something.md") is None
        assert _get_tracked_directory(".github/workflows/ci.yml") is None


class TestIncrementalRefresh:
    """Test incremental_refresh function."""

    @pytest.fixture(autouse=True)
    def setup_and_teardown(self):
        """Clear cache before and after each test."""
        clear_cache()
        yield
        clear_cache()

    def _create_test_cache(
        self, last_commit_sha: str | None = "oldsha123"
    ) -> ContentCache:
        """Create a test cache with some initial content using new field names."""
        from core.modules.flattened_types import ParsedCourse

        cache = ContentCache(
            flattened_modules={
                "intro": FlattenedModule(
                    slug="intro",
                    title="Introduction",
                    content_id=UUID("00000000-0000-0000-0000-000000000001"),
                    sections=[
                        {
                            "type": "page",
                            "contentId": "00000000-0000-0000-0000-000000000002",
                            "title": "Welcome",
                            "segments": [{"type": "text", "content": "Hello"}],
                        }
                    ],
                )
            },
            courses={
                "fundamentals": ParsedCourse(
                    slug="fundamentals",
                    title="AI Safety Fundamentals",
                    progression=[],
                )
            },
            articles={"articles/safety.md": "# Safety Article\nContent"},
            video_transcripts={"video_transcripts/vid1.md": "# Video 1\nTranscript"},
            parsed_learning_outcomes={},
            parsed_lenses={},
            last_refreshed=datetime.now(),
            last_commit_sha=last_commit_sha,
            # Include raw_files to avoid fallback to full refresh
            raw_files={
                "modules/intro.md": "# Introduction\nContent",
                "courses/fundamentals.md": "# AI Safety Fundamentals\nContent",
                "articles/safety.md": "# Safety Article\nContent",
                "video_transcripts/vid1.md": "# Video 1\nTranscript",
            },
        )
        set_cache(cache)
        return cache

    @pytest.mark.asyncio
    async def test_incremental_refresh_with_modified_module(self):
        """Should trigger full refresh when module is modified.

        Note: With flattened modules, module changes require re-flattening
        which is complex, so we fall back to full refresh for now.
        """
        self._create_test_cache(last_commit_sha="oldsha123")

        # Mock compare_commits to return a modified module
        mock_compare_response = MagicMock()
        mock_compare_response.status_code = 200
        mock_compare_response.json.return_value = {
            "files": [{"filename": "modules/intro.md", "status": "modified"}]
        }

        with patch.dict(
            os.environ, {"EDUCATIONAL_CONTENT_BRANCH": "main", "GITHUB_TOKEN": "token"}
        ):
            with patch("httpx.AsyncClient") as mock_client_class:
                mock_client = AsyncMock()
                mock_client.__aenter__.return_value = mock_client
                mock_client.__aexit__.return_value = None
                mock_client.get.return_value = mock_compare_response
                mock_client_class.return_value = mock_client

                with patch(
                    "core.content.github_fetcher.refresh_cache", new_callable=AsyncMock
                ) as mock_refresh:
                    await incremental_refresh("newsha456")

                    # Module changes should trigger full refresh
                    mock_refresh.assert_called_once()

    @pytest.mark.asyncio
    async def test_incremental_refresh_with_added_file(self):
        """Should add new article when file is added."""
        self._create_test_cache(last_commit_sha="oldsha123")

        mock_compare_response = MagicMock()
        mock_compare_response.status_code = 200
        mock_compare_response.json.return_value = {
            "files": [{"filename": "articles/new_article.md", "status": "added"}]
        }

        new_article_content = "# New Article\nThis is new content."
        import base64

        mock_file_response = MagicMock()
        mock_file_response.status_code = 200
        mock_file_response.json.return_value = {
            "content": base64.b64encode(new_article_content.encode()).decode()
        }

        def mock_get_side_effect(url, **kwargs):
            if "compare" in url:
                return mock_compare_response
            else:
                return mock_file_response

        with patch.dict(
            os.environ, {"EDUCATIONAL_CONTENT_BRANCH": "main", "GITHUB_TOKEN": "token"}
        ):
            with patch("httpx.AsyncClient") as mock_client_class:
                mock_client = AsyncMock()
                mock_client.__aenter__.return_value = mock_client
                mock_client.__aexit__.return_value = None
                mock_client.get.side_effect = mock_get_side_effect
                mock_client_class.return_value = mock_client

                await incremental_refresh("newsha456")

                cache = get_cache()
                assert "articles/new_article.md" in cache.articles
                assert cache.articles["articles/new_article.md"] == new_article_content
                # Original article should still exist
                assert "articles/safety.md" in cache.articles

    @pytest.mark.asyncio
    async def test_incremental_refresh_with_removed_file(self):
        """Should remove article when file is deleted."""
        self._create_test_cache(last_commit_sha="oldsha123")

        mock_compare_response = MagicMock()
        mock_compare_response.status_code = 200
        mock_compare_response.json.return_value = {
            "files": [{"filename": "articles/safety.md", "status": "removed"}]
        }

        with patch.dict(
            os.environ, {"EDUCATIONAL_CONTENT_BRANCH": "main", "GITHUB_TOKEN": "token"}
        ):
            with patch("httpx.AsyncClient") as mock_client_class:
                mock_client = AsyncMock()
                mock_client.__aenter__.return_value = mock_client
                mock_client.__aexit__.return_value = None
                mock_client.get.return_value = mock_compare_response
                mock_client_class.return_value = mock_client

                await incremental_refresh("newsha456")

                cache = get_cache()
                assert "articles/safety.md" not in cache.articles
                assert cache.last_commit_sha == "newsha456"

    @pytest.mark.asyncio
    async def test_incremental_refresh_falls_back_on_no_previous_sha(self):
        """Should do full refresh when cache has no previous commit SHA."""
        # Create cache with no commit SHA
        self._create_test_cache(last_commit_sha=None)

        with patch.dict(
            os.environ, {"EDUCATIONAL_CONTENT_BRANCH": "main", "GITHUB_TOKEN": "token"}
        ):
            with patch(
                "core.content.github_fetcher.refresh_cache", new_callable=AsyncMock
            ) as mock_refresh:
                await incremental_refresh("newsha456")

                # Should have called full refresh
                mock_refresh.assert_called_once()

    @pytest.mark.asyncio
    async def test_incremental_refresh_falls_back_on_truncated_comparison(self):
        """Should do full refresh when comparison has too many files."""
        self._create_test_cache(last_commit_sha="oldsha123")

        # Create 300 files to trigger truncation
        files_data = [
            {"filename": f"modules/file{i}.md", "status": "modified"}
            for i in range(300)
        ]

        mock_compare_response = MagicMock()
        mock_compare_response.status_code = 200
        mock_compare_response.json.return_value = {"files": files_data}

        with patch.dict(
            os.environ, {"EDUCATIONAL_CONTENT_BRANCH": "main", "GITHUB_TOKEN": "token"}
        ):
            with patch("httpx.AsyncClient") as mock_client_class:
                mock_client = AsyncMock()
                mock_client.__aenter__.return_value = mock_client
                mock_client.__aexit__.return_value = None
                mock_client.get.return_value = mock_compare_response
                mock_client_class.return_value = mock_client

                with patch(
                    "core.content.github_fetcher.refresh_cache", new_callable=AsyncMock
                ) as mock_refresh:
                    await incremental_refresh("newsha456")

                    # Should have called full refresh due to truncation
                    mock_refresh.assert_called_once()

    @pytest.mark.asyncio
    async def test_incremental_refresh_falls_back_on_api_error(self):
        """Should do full refresh when compare API fails."""
        self._create_test_cache(last_commit_sha="oldsha123")

        mock_compare_response = MagicMock()
        mock_compare_response.status_code = 500  # API error

        with patch.dict(
            os.environ, {"EDUCATIONAL_CONTENT_BRANCH": "main", "GITHUB_TOKEN": "token"}
        ):
            with patch("httpx.AsyncClient") as mock_client_class:
                mock_client = AsyncMock()
                mock_client.__aenter__.return_value = mock_client
                mock_client.__aexit__.return_value = None
                mock_client.get.return_value = mock_compare_response
                mock_client_class.return_value = mock_client

                with patch(
                    "core.content.github_fetcher.refresh_cache", new_callable=AsyncMock
                ) as mock_refresh:
                    await incremental_refresh("newsha456")

                    # Should have called full refresh due to API error
                    mock_refresh.assert_called_once()

    @pytest.mark.asyncio
    async def test_incremental_refresh_ignores_untracked_files(self):
        """Should ignore files outside tracked directories."""
        self._create_test_cache(last_commit_sha="oldsha123")

        mock_compare_response = MagicMock()
        mock_compare_response.status_code = 200
        mock_compare_response.json.return_value = {
            "files": [
                {"filename": "README.md", "status": "modified"},
                {"filename": ".github/workflows/ci.yml", "status": "modified"},
                {"filename": "docs/architecture.md", "status": "added"},
            ]
        }

        with patch.dict(
            os.environ, {"EDUCATIONAL_CONTENT_BRANCH": "main", "GITHUB_TOKEN": "token"}
        ):
            with patch("httpx.AsyncClient") as mock_client_class:
                mock_client = AsyncMock()
                mock_client.__aenter__.return_value = mock_client
                mock_client.__aexit__.return_value = None
                mock_client.get.return_value = mock_compare_response
                mock_client_class.return_value = mock_client

                initial_modules = get_cache().flattened_modules.copy()
                initial_articles = get_cache().articles.copy()

                await incremental_refresh("newsha456")

                cache = get_cache()
                # Cache should be unchanged (except metadata)
                assert cache.flattened_modules == initial_modules
                assert cache.articles == initial_articles
                # But commit SHA should be updated
                assert cache.last_commit_sha == "newsha456"

    @pytest.mark.asyncio
    async def test_incremental_refresh_skips_if_same_commit(self):
        """Should skip refresh if already at the requested commit."""
        self._create_test_cache(last_commit_sha="samesha123")

        with patch.dict(
            os.environ, {"EDUCATIONAL_CONTENT_BRANCH": "main", "GITHUB_TOKEN": "token"}
        ):
            with patch("httpx.AsyncClient") as mock_client_class:
                mock_client = AsyncMock()
                mock_client.__aenter__.return_value = mock_client
                mock_client.__aexit__.return_value = None
                mock_client_class.return_value = mock_client

                await incremental_refresh("samesha123")

                # Should not have made any API calls
                mock_client.get.assert_not_called()

    @pytest.mark.asyncio
    async def test_incremental_refresh_handles_renamed_files(self):
        """Should handle renamed files correctly (delete old, add new)."""
        self._create_test_cache(last_commit_sha="oldsha123")

        mock_compare_response = MagicMock()
        mock_compare_response.status_code = 200
        mock_compare_response.json.return_value = {
            "files": [
                {
                    "filename": "articles/renamed_safety.md",
                    "status": "renamed",
                    "previous_filename": "articles/safety.md",
                }
            ]
        }

        new_content = "# Renamed Safety\nNew content."
        import base64

        mock_file_response = MagicMock()
        mock_file_response.status_code = 200
        mock_file_response.json.return_value = {
            "content": base64.b64encode(new_content.encode()).decode()
        }

        def mock_get_side_effect(url, **kwargs):
            if "compare" in url:
                return mock_compare_response
            else:
                return mock_file_response

        with patch.dict(
            os.environ, {"EDUCATIONAL_CONTENT_BRANCH": "main", "GITHUB_TOKEN": "token"}
        ):
            with patch("httpx.AsyncClient") as mock_client_class:
                mock_client = AsyncMock()
                mock_client.__aenter__.return_value = mock_client
                mock_client.__aexit__.return_value = None
                mock_client.get.side_effect = mock_get_side_effect
                mock_client_class.return_value = mock_client

                await incremental_refresh("newsha456")

                cache = get_cache()
                # Old path should be removed
                assert "articles/safety.md" not in cache.articles
                # New path should exist
                assert "articles/renamed_safety.md" in cache.articles
                assert cache.articles["articles/renamed_safety.md"] == new_content

    @pytest.mark.asyncio
    async def test_incremental_refresh_falls_back_when_cache_not_initialized(self):
        """Should do full refresh when cache is not initialized."""
        # Don't initialize cache
        clear_cache()

        with patch.dict(
            os.environ, {"EDUCATIONAL_CONTENT_BRANCH": "main", "GITHUB_TOKEN": "token"}
        ):
            with patch(
                "core.content.github_fetcher.refresh_cache", new_callable=AsyncMock
            ) as mock_refresh:
                await incremental_refresh("newsha456")

                # Should have called full refresh
                mock_refresh.assert_called_once()


class TestApplyFileChange:
    """Test _apply_file_change helper function."""

    @pytest.fixture(autouse=True)
    def setup_and_teardown(self):
        """Clear cache before and after each test."""
        clear_cache()
        yield
        clear_cache()

    def _create_test_cache(self) -> ContentCache:
        """Create a test cache with some initial content using new field names."""
        from core.modules.flattened_types import ParsedCourse

        cache = ContentCache(
            flattened_modules={
                "intro": FlattenedModule(
                    slug="intro",
                    title="Introduction",
                    content_id=UUID("00000000-0000-0000-0000-000000000001"),
                    sections=[
                        {
                            "type": "page",
                            "contentId": "00000000-0000-0000-0000-000000000002",
                            "title": "Welcome",
                            "segments": [{"type": "text", "content": "Hello"}],
                        }
                    ],
                )
            },
            courses={
                "fundamentals": ParsedCourse(
                    slug="fundamentals",
                    title="AI Safety Fundamentals",
                    progression=[],
                )
            },
            articles={"articles/safety.md": "# Safety Article\nContent"},
            video_transcripts={"video_transcripts/vid1.md": "# Video 1\nTranscript"},
            parsed_learning_outcomes={},
            parsed_lenses={},
            last_refreshed=datetime.now(),
            last_commit_sha="testsha",
        )
        set_cache(cache)
        return cache

    @pytest.mark.asyncio
    async def test_apply_file_change_ignores_untracked_directory(self):
        """Should do nothing for files outside tracked directories."""
        cache = self._create_test_cache()

        change = ChangedFile(path="README.md", status="modified")

        mock_client = AsyncMock()

        with patch.dict(os.environ, {"EDUCATIONAL_CONTENT_BRANCH": "main"}):
            await _apply_file_change(mock_client, cache, change)

            # Client should not have been called
            mock_client.get.assert_not_called()

    @pytest.mark.asyncio
    async def test_apply_file_change_triggers_full_refresh_for_module(self):
        """Should return True (needs full refresh) for module changes."""
        cache = self._create_test_cache()
        assert "intro" in cache.flattened_modules

        change = ChangedFile(path="modules/intro.md", status="removed")

        mock_client = AsyncMock()

        with patch.dict(os.environ, {"EDUCATIONAL_CONTENT_BRANCH": "main"}):
            needs_refresh = await _apply_file_change(mock_client, cache, change)

            # Module changes need full refresh for re-flattening
            assert needs_refresh is True

    @pytest.mark.asyncio
    async def test_apply_file_change_removes_article(self):
        """Should remove article from cache on removal."""
        cache = self._create_test_cache()
        assert "articles/safety.md" in cache.articles

        change = ChangedFile(path="articles/safety.md", status="removed")

        mock_client = AsyncMock()

        with patch.dict(os.environ, {"EDUCATIONAL_CONTENT_BRANCH": "main"}):
            needs_refresh = await _apply_file_change(mock_client, cache, change)

            assert "articles/safety.md" not in cache.articles
            assert needs_refresh is False

    @pytest.mark.asyncio
    async def test_apply_file_change_adds_article(self):
        """Should add new article to cache."""
        cache = self._create_test_cache()

        change = ChangedFile(path="articles/new.md", status="added")

        new_content = "# New Article\nContent here."
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = new_content

        mock_client = AsyncMock()
        mock_client.get.return_value = mock_response

        with patch.dict(os.environ, {"EDUCATIONAL_CONTENT_BRANCH": "main"}):
            needs_refresh = await _apply_file_change(mock_client, cache, change)

            assert "articles/new.md" in cache.articles
            assert cache.articles["articles/new.md"] == new_content
            assert needs_refresh is False

    @pytest.mark.asyncio
    async def test_apply_file_change_triggers_full_refresh_for_module_update(self):
        """Should return True (needs full refresh) when module is modified."""
        cache = self._create_test_cache()

        change = ChangedFile(path="modules/intro.md", status="modified")

        mock_client = AsyncMock()

        with patch.dict(os.environ, {"EDUCATIONAL_CONTENT_BRANCH": "main"}):
            needs_refresh = await _apply_file_change(mock_client, cache, change)

            # Module changes need full refresh for re-flattening
            assert needs_refresh is True

    @pytest.mark.asyncio
    async def test_apply_file_change_ignores_non_md_files(self):
        """Should ignore non-markdown files."""
        cache = self._create_test_cache()

        change = ChangedFile(path="modules/image.png", status="added")

        mock_client = AsyncMock()

        with patch.dict(os.environ, {"EDUCATIONAL_CONTENT_BRANCH": "main"}):
            needs_refresh = await _apply_file_change(mock_client, cache, change)

            # Client should not have been called
            mock_client.get.assert_not_called()
            assert needs_refresh is False
