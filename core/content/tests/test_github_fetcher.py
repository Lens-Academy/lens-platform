"""Tests for GitHub content fetcher (git-based)."""

import os
import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from datetime import datetime
from pathlib import Path
from uuid import UUID

from core.content.github_fetcher import (
    get_content_branch,
    ContentBranchNotConfiguredError,
    GitHubFetchError,
    CONTENT_REPO,
    fetch_file,
    fetch_all_content,
    get_latest_commit_sha,
    compare_commits,
    ChangedFile,
    CommitComparison,
    incremental_refresh,
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
    """Test fetch_file function (reads from local clone dir)."""

    @pytest.mark.asyncio
    async def test_fetch_file_success(self, tmp_path):
        """Should read file content from clone directory."""
        # Create a fake clone dir with a file
        (tmp_path / "modules").mkdir()
        (tmp_path / "modules" / "test.md").write_text("# Test Content\n\nHello world")

        with patch.dict(
            os.environ,
            {"EDUCATIONAL_CONTENT_BRANCH": "main", "API_PORT": "8000"},
        ):
            with patch(
                "core.content.github_fetcher._get_clone_dir", return_value=tmp_path
            ):
                result = await fetch_file("modules/test.md")

                assert result == "# Test Content\n\nHello world"

    @pytest.mark.asyncio
    async def test_fetch_file_raises_on_missing_file(self, tmp_path):
        """Should raise GitHubFetchError when file not found in clone dir."""
        with patch.dict(os.environ, {"EDUCATIONAL_CONTENT_BRANCH": "main"}):
            with patch(
                "core.content.github_fetcher._get_clone_dir", return_value=tmp_path
            ):
                with pytest.raises(GitHubFetchError) as exc_info:
                    await fetch_file("nonexistent.md")

                assert "not found" in str(exc_info.value).lower()


class TestFetchAllContent:
    """Test fetch_all_content function."""

    @pytest.mark.asyncio
    async def test_fetch_all_content_returns_cache(self):
        """Should fetch all content via git clone and return ContentCache."""
        module_md = "---\nslug: intro\ntitle: Introduction\n---\n\n# Chat: Welcome\ninstructions:: Hello!\n"
        course_md = "---\nslug: fundamentals\ntitle: AI Safety Fundamentals\n---\n\n# Lesson: [[modules/intro]]\n"
        article_md = "# Safety Article\n\nContent here."
        transcript_md = "# Video Transcript\n\nTranscript here."

        all_files = {
            "modules/intro.md": module_md,
            "courses/fundamentals.md": course_md,
            "articles/safety.md": article_md,
            "video_transcripts/vid1.md": transcript_md,
        }

        # Mock TypeScript processor result
        ts_result = {
            "modules": [
                {
                    "slug": "intro",
                    "title": "Introduction",
                    "contentId": "00000000-0000-0000-0000-000000000001",
                    "sections": [
                        {
                            "type": "lens",
                            "contentId": "00000000-0000-0000-0000-000000000002",
                            "title": "Welcome",
                            "segments": [{"type": "text", "content": "Hello"}],
                        }
                    ],
                }
            ],
            "courses": [
                {
                    "slug": "fundamentals",
                    "title": "AI Safety Fundamentals",
                    "progression": [],
                }
            ],
            "errors": [],
        }

        with patch.dict(
            os.environ, {"EDUCATIONAL_CONTENT_BRANCH": "main", "GITHUB_TOKEN": "token"}
        ):
            with patch(
                "core.content.github_fetcher.git_fetcher.clone_repo",
                new_callable=AsyncMock,
            ):
                with patch(
                    "core.content.github_fetcher.git_fetcher.read_all_files",
                    new_callable=AsyncMock,
                    return_value=all_files,
                ):
                    with patch(
                        "core.content.github_fetcher.git_fetcher.get_head_sha",
                        new_callable=AsyncMock,
                        return_value="abc123def456",
                    ):
                        with patch(
                            "core.content.github_fetcher.process_content_typescript",
                            new_callable=AsyncMock,
                            return_value=ts_result,
                        ):
                            # Mock _get_clone_dir to return a path without .git
                            with patch(
                                "core.content.github_fetcher._get_clone_dir",
                                return_value=Path("/tmp/fake-clone-no-git"),
                            ):
                                cache = await fetch_all_content()

                # Verify cache structure
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
    async def test_get_latest_commit_sha_from_git(self, tmp_path):
        """Should return SHA from git when clone exists."""
        # Create fake .git dir to indicate clone exists
        (tmp_path / ".git").mkdir()

        with patch.dict(
            os.environ,
            {"EDUCATIONAL_CONTENT_BRANCH": "main", "GITHUB_TOKEN": "test-token"},
        ):
            with patch(
                "core.content.github_fetcher._get_clone_dir", return_value=tmp_path
            ):
                with patch(
                    "core.content.github_fetcher.git_fetcher.fetch_latest_sha",
                    new_callable=AsyncMock,
                    return_value="a1b2c3d4e5f6g7h8i9j0",
                ):
                    result = await get_latest_commit_sha()

                    assert result == "a1b2c3d4e5f6g7h8i9j0"

    @pytest.mark.asyncio
    async def test_get_latest_commit_sha_api_fallback(self, tmp_path):
        """Should fall back to GitHub API when clone doesn't exist."""
        # tmp_path has no .git dir, so API fallback is used
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"sha": "api_sha_123"}

        with patch.dict(
            os.environ,
            {"EDUCATIONAL_CONTENT_BRANCH": "staging"},
        ):
            with patch(
                "core.content.github_fetcher._get_clone_dir", return_value=tmp_path
            ):
                with patch("httpx.AsyncClient") as mock_client_class:
                    mock_client = AsyncMock()
                    mock_client.__aenter__.return_value = mock_client
                    mock_client.__aexit__.return_value = None
                    mock_client.get.return_value = mock_response
                    mock_client_class.return_value = mock_client

                    result = await get_latest_commit_sha()

                    assert result == "api_sha_123"
                    call_url = mock_client.get.call_args[0][0]
                    assert "api.github.com" in call_url
                    assert "staging" in call_url

    @pytest.mark.asyncio
    async def test_get_latest_commit_sha_api_raises_on_error(self, tmp_path):
        """Should raise GitHubFetchError when API fallback fails."""
        mock_response = MagicMock()
        mock_response.status_code = 404

        with patch.dict(os.environ, {"EDUCATIONAL_CONTENT_BRANCH": "main"}):
            with patch(
                "core.content.github_fetcher._get_clone_dir", return_value=tmp_path
            ):
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
    async def test_get_latest_commit_sha_api_includes_auth_header(self, tmp_path):
        """Should include auth header when GITHUB_TOKEN is set (API fallback)."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"sha": "sha123"}

        with patch.dict(
            os.environ,
            {"EDUCATIONAL_CONTENT_BRANCH": "main", "GITHUB_TOKEN": "my-secret-token"},
        ):
            with patch(
                "core.content.github_fetcher._get_clone_dir", return_value=tmp_path
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
        test_commit_sha = "deadbeef1234567890"

        with patch.dict(
            os.environ, {"EDUCATIONAL_CONTENT_BRANCH": "main", "GITHUB_TOKEN": "token"}
        ):
            with patch(
                "core.content.github_fetcher.git_fetcher.clone_repo",
                new_callable=AsyncMock,
            ):
                with patch(
                    "core.content.github_fetcher.git_fetcher.read_all_files",
                    new_callable=AsyncMock,
                    return_value={},
                ):
                    with patch(
                        "core.content.github_fetcher.git_fetcher.get_head_sha",
                        new_callable=AsyncMock,
                        return_value=test_commit_sha,
                    ):
                        with patch(
                            "core.content.github_fetcher.process_content_typescript",
                            new_callable=AsyncMock,
                            return_value={"modules": [], "courses": [], "errors": []},
                        ):
                            with patch(
                                "core.content.github_fetcher._get_clone_dir",
                                return_value=Path("/tmp/fake-clone-no-git"),
                            ):
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


class TestCompareCommitsDiffData:
    """Test that compare_commits captures diff data from GitHub API."""

    @pytest.mark.asyncio
    async def test_compare_commits_captures_diff_stats(self):
        """Should capture additions, deletions, and patch from GitHub Compare API."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "files": [
                {
                    "filename": "modules/intro.md",
                    "status": "modified",
                    "additions": 3,
                    "deletions": 1,
                    "patch": "@@ -1,4 +1,6 @@\n old line\n+new line",
                },
            ]
        }

        with patch("httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client.get.return_value = mock_response
            mock_client_class.return_value = mock_client

            with patch.dict(
                os.environ,
                {"EDUCATIONAL_CONTENT_BRANCH": "main", "GITHUB_TOKEN": "test"},
            ):
                result = await compare_commits("old_sha", "new_sha")

        assert len(result.files) == 1
        assert result.files[0].additions == 3
        assert result.files[0].deletions == 1
        assert result.files[0].patch == "@@ -1,4 +1,6 @@\n old line\n+new line"


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
    """Test incremental_refresh function.

    incremental_refresh now uses git_fetcher.fetch_and_reset + git_fetcher.read_all_files
    for content I/O, and compare_commits (GitHub API) for frontend diff display.
    """

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
                            "type": "lens",
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
    async def test_incremental_refresh_with_tracked_changes(self):
        """Should re-read files and re-process when tracked files change."""
        self._create_test_cache(last_commit_sha="oldsha123")

        # Mock compare_commits to return a modified module file
        mock_comparison = CommitComparison(
            files=[ChangedFile(path="modules/intro.md", status="modified")],
            is_truncated=False,
        )

        updated_files = {
            "modules/intro.md": "# Updated Introduction\nNew content",
            "courses/fundamentals.md": "# AI Safety Fundamentals\nContent",
            "articles/safety.md": "# Safety Article\nContent",
            "video_transcripts/vid1.md": "# Video 1\nTranscript",
        }

        ts_result = {
            "modules": [
                {
                    "slug": "intro",
                    "title": "Updated Introduction",
                    "contentId": "00000000-0000-0000-0000-000000000001",
                    "sections": [],
                }
            ],
            "courses": [],
            "errors": [],
        }

        with patch.dict(
            os.environ, {"EDUCATIONAL_CONTENT_BRANCH": "main", "GITHUB_TOKEN": "token"}
        ):
            with patch(
                "core.content.github_fetcher.git_fetcher.fetch_and_reset",
                new_callable=AsyncMock,
                return_value="newsha456",
            ):
                with patch(
                    "core.content.github_fetcher.git_fetcher.read_all_files",
                    new_callable=AsyncMock,
                    return_value=updated_files,
                ):
                    with patch(
                        "core.content.github_fetcher.compare_commits",
                        new_callable=AsyncMock,
                        return_value=mock_comparison,
                    ):
                        with patch(
                            "core.content.github_fetcher.process_content_typescript",
                            new_callable=AsyncMock,
                            return_value=ts_result,
                        ):
                            await incremental_refresh("newsha456")

        cache = get_cache()
        assert cache.last_commit_sha == "newsha456"
        assert "intro" in cache.flattened_modules
        assert cache.flattened_modules["intro"].title == "Updated Introduction"

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
    async def test_incremental_refresh_ignores_untracked_files(self):
        """Should skip re-read when only untracked files changed."""
        self._create_test_cache(last_commit_sha="oldsha123")

        # compare_commits returns only untracked files
        mock_comparison = CommitComparison(
            files=[
                ChangedFile(path="README.md", status="modified"),
                ChangedFile(path=".github/workflows/ci.yml", status="modified"),
                ChangedFile(path="docs/architecture.md", status="added"),
            ],
            is_truncated=False,
        )

        with patch.dict(
            os.environ, {"EDUCATIONAL_CONTENT_BRANCH": "main", "GITHUB_TOKEN": "token"}
        ):
            with patch(
                "core.content.github_fetcher.git_fetcher.fetch_and_reset",
                new_callable=AsyncMock,
                return_value="newsha456",
            ):
                with patch(
                    "core.content.github_fetcher.compare_commits",
                    new_callable=AsyncMock,
                    return_value=mock_comparison,
                ):
                    # read_all_files should NOT be called since no tracked files changed
                    with patch(
                        "core.content.github_fetcher.git_fetcher.read_all_files",
                        new_callable=AsyncMock,
                    ) as mock_read:
                        initial_modules = get_cache().flattened_modules.copy()
                        initial_articles = get_cache().articles.copy()

                        await incremental_refresh("newsha456")

                        # read_all_files should not have been called
                        mock_read.assert_not_called()

        cache = get_cache()
        # Cache content should be unchanged
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
            with patch(
                "core.content.github_fetcher.git_fetcher.fetch_and_reset",
                new_callable=AsyncMock,
            ) as mock_fetch:
                await incremental_refresh("samesha123")

                # Should not have fetched
                mock_fetch.assert_not_called()

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

    @pytest.mark.asyncio
    async def test_incremental_refresh_falls_back_on_error(self):
        """Should do full refresh when git operations fail."""
        self._create_test_cache(last_commit_sha="oldsha123")

        with patch.dict(
            os.environ, {"EDUCATIONAL_CONTENT_BRANCH": "main", "GITHUB_TOKEN": "token"}
        ):
            with patch(
                "core.content.github_fetcher.git_fetcher.fetch_and_reset",
                new_callable=AsyncMock,
                side_effect=RuntimeError("git fetch failed"),
            ):
                with patch(
                    "core.content.github_fetcher.refresh_cache", new_callable=AsyncMock
                ) as mock_refresh:
                    await incremental_refresh("newsha456")

                    # Should have called full refresh
                    mock_refresh.assert_called_once()


class TestIncrementalRefreshSHATracking:
    """Test three-stage SHA tracking in incremental_refresh."""

    def setup_method(self):
        clear_cache()

    def teardown_method(self):
        clear_cache()

    @pytest.mark.asyncio
    async def test_incremental_refresh_updates_three_shas(self):
        """After incremental refresh, fetched_sha and processed_sha should be set."""
        # Set up initial cache at old SHA
        initial_cache = ContentCache(
            courses={},
            flattened_modules={},
            articles={},
            video_transcripts={},
            parsed_learning_outcomes={},
            parsed_lenses={},
            last_refreshed=datetime.now(),
            last_commit_sha="old_sha_111",
            processed_sha="old_sha_111",
            raw_files={"modules/test.md": "---\ntitle: Test\nslug: test\n---\n"},
        )
        set_cache(initial_cache)

        mock_comparison = CommitComparison(
            files=[
                ChangedFile(
                    path="modules/test.md",
                    status="modified",
                    additions=2,
                    deletions=1,
                    patch="@@ -1 +1,2 @@\n+new line",
                )
            ],
            is_truncated=False,
        )

        with patch(
            "core.content.github_fetcher._get_clone_dir",
            return_value="/tmp/fake-clone",
        ):
            with patch(
                "core.content.github_fetcher.get_content_branch",
                return_value="staging",
            ):
                with patch(
                    "core.content.github_fetcher.compare_commits",
                    new_callable=AsyncMock,
                    return_value=mock_comparison,
                ):
                    with patch(
                        "core.content.github_fetcher.git_fetcher.fetch_and_reset",
                        new_callable=AsyncMock,
                        return_value="new_sha_222",
                    ):
                        with patch(
                            "core.content.github_fetcher.git_fetcher.read_all_files",
                            new_callable=AsyncMock,
                            return_value={
                                "modules/test.md": "---\ntitle: Test Updated\nslug: test\n---\n"
                            },
                        ):
                            with patch(
                                "core.content.github_fetcher.process_content_typescript",
                                new_callable=AsyncMock,
                                return_value={
                                    "modules": [],
                                    "courses": [],
                                    "errors": [],
                                },
                            ):
                                await incremental_refresh("new_sha_222")

        cache = get_cache()
        assert cache.fetched_sha == "new_sha_222"
        assert cache.processed_sha == "new_sha_222"
        assert cache.last_commit_sha == "new_sha_222"
        assert cache.fetched_sha_timestamp is not None
        assert cache.processed_sha_timestamp is not None

    @pytest.mark.asyncio
    async def test_incremental_refresh_stores_diff(self):
        """After incremental refresh, last_diff should contain file change info."""
        initial_cache = ContentCache(
            courses={},
            flattened_modules={},
            articles={},
            video_transcripts={},
            parsed_learning_outcomes={},
            parsed_lenses={},
            last_refreshed=datetime.now(),
            last_commit_sha="old_sha_111",
            processed_sha="old_sha_111",
            raw_files={"modules/test.md": "---\ntitle: Test\nslug: test\n---\n"},
        )
        set_cache(initial_cache)

        mock_comparison = CommitComparison(
            files=[
                ChangedFile(
                    path="modules/test.md",
                    status="modified",
                    additions=2,
                    deletions=1,
                    patch="@@ -1 +1,2 @@\n+new line",
                )
            ],
            is_truncated=False,
        )

        with patch(
            "core.content.github_fetcher._get_clone_dir",
            return_value="/tmp/fake-clone",
        ):
            with patch(
                "core.content.github_fetcher.get_content_branch",
                return_value="staging",
            ):
                with patch(
                    "core.content.github_fetcher.compare_commits",
                    new_callable=AsyncMock,
                    return_value=mock_comparison,
                ):
                    with patch(
                        "core.content.github_fetcher.git_fetcher.fetch_and_reset",
                        new_callable=AsyncMock,
                        return_value="new_sha_222",
                    ):
                        with patch(
                            "core.content.github_fetcher.git_fetcher.read_all_files",
                            new_callable=AsyncMock,
                            return_value={"modules/test.md": "updated content"},
                        ):
                            with patch(
                                "core.content.github_fetcher.process_content_typescript",
                                new_callable=AsyncMock,
                                return_value={
                                    "modules": [],
                                    "courses": [],
                                    "errors": [],
                                },
                            ):
                                await incremental_refresh("new_sha_222")

        cache = get_cache()
        assert cache.last_diff is not None
        assert len(cache.last_diff) == 1
        assert cache.last_diff[0]["filename"] == "modules/test.md"
        assert cache.last_diff[0]["status"] == "modified"
        assert cache.last_diff[0]["additions"] == 2
        assert cache.last_diff[0]["deletions"] == 1
        assert cache.last_diff[0]["patch"] == "@@ -1 +1,2 @@\n+new line"
