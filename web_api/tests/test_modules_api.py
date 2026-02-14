# web_api/tests/test_modules_api.py
"""Tests for module API endpoints.

The old module-sessions API tests have been removed as those endpoints
were deprecated in favor of the new content-based progress tracking system.

TODO: Add tests for:
- GET /api/modules - List modules
- GET /api/modules/{module_slug} - Get module by slug
- GET /api/modules/{module_slug}/progress - Get module progress
"""

import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from uuid import UUID

from fastapi.testclient import TestClient
from main import app
from core.modules.flattened_types import FlattenedModule


@pytest.fixture
def client():
    return TestClient(app)


def test_get_module_returns_error_field_when_present(client):
    """GET /api/modules/{slug} should include error field when module has error."""
    mock_module = FlattenedModule(
        slug="broken-module",
        title="Broken Module",
        content_id=UUID("00000000-0000-0000-0000-000000000001"),
        sections=[],
        error="'from' anchor not found: some text...",
    )

    with patch(
        "web_api.routes.modules.load_flattened_module", return_value=mock_module
    ):
        response = client.get("/api/modules/broken-module")

    assert response.status_code == 200
    data = response.json()
    assert data["slug"] == "broken-module"
    assert data["title"] == "Broken Module"
    assert data["sections"] == []
    assert data["error"] == "'from' anchor not found: some text..."


def test_get_module_omits_error_field_when_none(client):
    """GET /api/modules/{slug} should not include error field when module is OK."""
    mock_module = FlattenedModule(
        slug="working-module",
        title="Working Module",
        content_id=UUID("00000000-0000-0000-0000-000000000002"),
        sections=[{"type": "page", "segments": []}],
        error=None,
    )

    with patch(
        "web_api.routes.modules.load_flattened_module", return_value=mock_module
    ):
        response = client.get("/api/modules/working-module")

    assert response.status_code == 200
    data = response.json()
    assert data["slug"] == "working-module"
    assert "error" not in data


def test_list_modules_includes_errored_modules(client):
    """GET /api/modules should include modules with errors in the list."""
    mock_working = FlattenedModule(
        slug="working",
        title="Working Module",
        content_id=UUID("00000000-0000-0000-0000-000000000001"),
        sections=[{"type": "page", "segments": []}],
        error=None,
    )
    mock_broken = FlattenedModule(
        slug="broken",
        title="Broken Module",
        content_id=UUID("00000000-0000-0000-0000-000000000002"),
        sections=[],
        error="Some error",
    )

    def mock_load(slug):
        if slug == "working":
            return mock_working
        elif slug == "broken":
            return mock_broken
        raise Exception("Not found")

    with patch(
        "web_api.routes.modules.get_available_modules",
        return_value=["working", "broken"],
    ):
        with patch(
            "web_api.routes.modules.load_flattened_module", side_effect=mock_load
        ):
            response = client.get("/api/modules")

    assert response.status_code == 200
    data = response.json()
    slugs = [m["slug"] for m in data["modules"]]
    assert "working" in slugs
    assert "broken" in slugs  # Errored modules still appear in list


def test_get_module_progress_includes_error_when_present(client):
    """GET /api/modules/{slug}/progress should include error field when module has error."""
    mock_module = FlattenedModule(
        slug="broken-module",
        title="Broken Module",
        content_id=UUID("00000000-0000-0000-0000-000000000001"),
        sections=[],
        error="'from' anchor not found: some text...",
    )

    # Use anonymous token for authentication
    anon_token = "00000000-0000-0000-0000-000000000099"
    headers = {"X-Anonymous-Token": anon_token}

    # Mock database connection as async context manager
    mock_conn = MagicMock()
    mock_conn.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_conn.__aexit__ = AsyncMock(return_value=None)

    # Mock chat session response
    mock_chat_session = {
        "session_id": "test-session-id",
        "messages": [],
    }

    with (
        patch("web_api.routes.modules.load_flattened_module", return_value=mock_module),
        patch("web_api.routes.modules.get_connection", return_value=mock_conn),
        patch(
            "web_api.routes.modules.get_module_progress",
            new_callable=AsyncMock,
            return_value={},
        ),
        patch(
            "web_api.routes.modules.get_or_create_chat_session",
            new_callable=AsyncMock,
            return_value=mock_chat_session,
        ),
    ):
        response = client.get("/api/modules/broken-module/progress", headers=headers)

    assert response.status_code == 200
    data = response.json()
    assert data["error"] == "'from' anchor not found: some text..."
    assert data["progress"]["total"] == 0


def test_get_module_progress_omits_error_when_none(client):
    """GET /api/modules/{slug}/progress should not include error field when module is OK."""
    mock_module = FlattenedModule(
        slug="working-module",
        title="Working Module",
        content_id=UUID("00000000-0000-0000-0000-000000000002"),
        sections=[{"type": "page", "segments": []}],
        error=None,
    )

    # Use anonymous token for authentication
    anon_token = "00000000-0000-0000-0000-000000000099"
    headers = {"X-Anonymous-Token": anon_token}

    # Mock database connection as async context manager
    mock_conn = MagicMock()
    mock_conn.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_conn.__aexit__ = AsyncMock(return_value=None)

    # Mock chat session response
    mock_chat_session = {
        "session_id": "test-session-id",
        "messages": [],
    }

    with (
        patch("web_api.routes.modules.load_flattened_module", return_value=mock_module),
        patch("web_api.routes.modules.get_connection", return_value=mock_conn),
        patch(
            "web_api.routes.modules.get_module_progress",
            new_callable=AsyncMock,
            return_value={},
        ),
        patch(
            "web_api.routes.modules.get_or_create_chat_session",
            new_callable=AsyncMock,
            return_value=mock_chat_session,
        ),
    ):
        response = client.get("/api/modules/working-module/progress", headers=headers)

    assert response.status_code == 200
    data = response.json()
    assert "error" not in data
    assert data["progress"]["total"] == 1  # 1 section in mock module


def test_get_lens_module_by_slash_slug(client):
    """GET /api/modules/lens/foo should pass 'lens/foo' to load_flattened_module."""
    mock_lens_module = FlattenedModule(
        slug="lens/four-background-claims",
        title="Four Background Claims",
        content_id=UUID("c3d4e5f6-a7b8-9012-cdef-345678901234"),
        sections=[
            {
                "type": "lens-article",
                "meta": {"title": "Four Background Claims", "author": "Nate Soares"},
                "segments": [{"type": "text", "content": "Test content"}],
                "optional": False,
                "contentId": "c3d4e5f6-a7b8-9012-cdef-345678901234",
                "learningOutcomeId": None,
                "learningOutcomeName": None,
                "videoId": None,
            }
        ],
    )

    with patch(
        "web_api.routes.modules.load_flattened_module", return_value=mock_lens_module
    ):
        response = client.get("/api/modules/lens/four-background-claims")

    assert response.status_code == 200
    data = response.json()
    assert data["slug"] == "lens/four-background-claims"
    assert data["title"] == "Four Background Claims"


def test_progress_route_not_swallowed_by_path_param(client):
    """GET /api/modules/lens/foo/progress must route to progress handler.

    With {module_slug:path}, the progress route MUST be defined BEFORE
    the catch-all so it isn't consumed as module_slug='lens/foo/progress'.
    A 401 proves we hit the progress handler (no auth). A 200 or 404
    would mean the wrong handler was matched.
    """
    response = client.get("/api/modules/lens/four-background-claims/progress")
    # 401 = reached progress handler (no auth token) — correct!
    assert response.status_code == 401


def test_list_modules_includes_type_field(client):
    """GET /api/modules should include type field distinguishing modules from lenses."""
    mock_modules = {
        "introduction": FlattenedModule(
            slug="introduction",
            title="Intro",
            content_id=UUID("00000000-0000-0000-0000-000000000001"),
            sections=[],
        ),
        "lens/test-lens": FlattenedModule(
            slug="lens/test-lens",
            title="Test Lens",
            content_id=UUID("00000000-0000-0000-0000-000000000002"),
            sections=[],
        ),
    }

    with patch(
        "web_api.routes.modules.get_available_modules",
        return_value=list(mock_modules.keys()),
    ):
        with patch(
            "web_api.routes.modules.load_flattened_module",
            side_effect=lambda slug: mock_modules[slug],
        ):
            response = client.get("/api/modules")

    assert response.status_code == 200
    data = response.json()
    modules = data["modules"]

    mod = next(m for m in modules if m["slug"] == "introduction")
    assert mod["type"] == "module"

    lens = next(m for m in modules if m["slug"] == "lens/test-lens")
    assert lens["type"] == "lens"


def test_list_modules_filter_by_type(client):
    """GET /api/modules?type=lens should only return lens-type entries."""
    mock_modules = {
        "introduction": FlattenedModule(
            slug="introduction",
            title="Intro",
            content_id=UUID("00000000-0000-0000-0000-000000000001"),
            sections=[],
        ),
        "lens/test-lens": FlattenedModule(
            slug="lens/test-lens",
            title="Test Lens",
            content_id=UUID("00000000-0000-0000-0000-000000000002"),
            sections=[],
        ),
    }

    with patch(
        "web_api.routes.modules.get_available_modules",
        return_value=list(mock_modules.keys()),
    ):
        with patch(
            "web_api.routes.modules.load_flattened_module",
            side_effect=lambda slug: mock_modules[slug],
        ):
            response = client.get("/api/modules?type=lens")

    assert response.status_code == 200
    data = response.json()
    assert len(data["modules"]) == 1
    assert data["modules"][0]["slug"] == "lens/test-lens"
