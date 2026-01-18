"""Tests for GitHub content fetcher."""

import os
import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from datetime import datetime

# These imports will fail until we implement the module
from core.content.github_fetcher import (
    get_content_branch,
    ContentBranchNotConfiguredError,
    GitHubFetchError,
    CONTENT_REPO,
    fetch_file,
    list_directory,
    fetch_all_content,
)


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
        assert CONTENT_REPO == "lucbrinkman/lens-educational-content"


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

                result = await fetch_file("lessons/test.md")

                assert result == "# Test Content\n\nHello world"
                mock_client.get.assert_called_once()
                # Verify URL contains correct path
                call_url = mock_client.get.call_args[0][0]
                assert "lessons/test.md" in call_url
                assert "lucbrinkman/lens-educational-content" in call_url
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
            {"path": "lessons/intro.md", "type": "file"},
            {"path": "lessons/advanced.md", "type": "file"},
            {"path": "lessons/drafts", "type": "dir"},  # Should be excluded
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

                result = await list_directory("lessons")

                assert result == ["lessons/intro.md", "lessons/advanced.md"]
                # Verify API URL is used
                call_url = mock_client.get.call_args[0][0]
                assert "api.github.com" in call_url
                assert "lessons" in call_url

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
                    await list_directory("lessons")

                assert "403" in str(exc_info.value)


class TestFetchAllContent:
    """Test fetch_all_content function."""

    @pytest.mark.asyncio
    async def test_fetch_all_content_returns_cache(self):
        """Should fetch all content and return ContentCache."""
        # Mock directory listings
        dir_responses = {
            "lessons": [{"path": "lessons/intro.md", "type": "file"}],
            "courses": [{"path": "courses/fundamentals.md", "type": "file"}],
            "articles": [{"path": "articles/safety.md", "type": "file"}],
            "video_transcripts": [
                {"path": "video_transcripts/vid1.md", "type": "file"}
            ],
        }

        # Mock file contents
        lesson_md = """---
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

# Lesson: [[lessons/intro]]
"""
        article_md = "# Safety Article\n\nContent here."
        transcript_md = "# Video Transcript\n\nTranscript here."

        def mock_get_side_effect(url, **kwargs):
            # Use MagicMock for response since httpx .json() is synchronous
            response = MagicMock()
            if "api.github.com" in url:
                # Directory listing
                response.status_code = 200
                for dir_name, items in dir_responses.items():
                    if dir_name in url:
                        response.json.return_value = items
                        break
            else:
                # File fetch
                response.status_code = 200
                if "lessons/" in url:
                    response.text = lesson_md
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

                # Verify cache structure
                assert "intro" in cache.lessons
                assert cache.lessons["intro"].title == "Introduction"

                assert "fundamentals" in cache.courses
                assert cache.courses["fundamentals"].title == "AI Safety Fundamentals"

                assert "articles/safety.md" in cache.articles
                assert "Safety Article" in cache.articles["articles/safety.md"]

                assert "video_transcripts/vid1.md" in cache.video_transcripts

                assert isinstance(cache.last_refreshed, datetime)
