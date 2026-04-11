"""Tests for admin API endpoints."""

import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, Depends
from fastapi.testclient import TestClient

project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from web_api.auth import require_admin


@pytest.fixture
def app_with_admin_route():
    """Create test app with admin-protected route."""
    app = FastAPI()

    @app.get("/test-admin")
    async def admin_route(user=Depends(require_admin)):
        return {"user_id": user["user_id"], "is_admin": True}

    return app


class TestRequireAdmin:
    """Tests for require_admin dependency."""

    def test_rejects_unauthenticated_user(self, app_with_admin_route):
        """Should return 401 when no session cookie."""
        client = TestClient(app_with_admin_route)
        response = client.get("/test-admin")
        assert response.status_code == 401

    @patch("core.database.get_connection")
    @patch("core.queries.users.get_user_by_discord_id")
    @patch("core.queries.facilitator.is_admin")
    def test_rejects_non_admin_user(
        self, mock_is_admin, mock_get_user, mock_get_conn, app_with_admin_route
    ):
        """Should return 403 when user is not admin."""
        # Mock database connection context manager
        mock_conn = AsyncMock()
        mock_get_conn.return_value.__aenter__.return_value = mock_conn
        mock_get_conn.return_value.__aexit__.return_value = None

        # Mock user lookup and admin check
        mock_get_user.return_value = {"user_id": 1, "discord_id": "123456789"}
        mock_is_admin.return_value = False

        # Patch verify_jwt to return valid payload
        with patch("web_api.auth.verify_jwt") as mock_verify:
            mock_verify.return_value = {"sub": "123456789"}

            client = TestClient(app_with_admin_route)
            client.cookies.set("session", "fake-token")
            response = client.get("/test-admin")
            assert response.status_code == 403

    @patch("core.database.get_connection")
    @patch("core.queries.users.get_user_by_discord_id")
    @patch("core.queries.facilitator.is_admin")
    def test_allows_admin_user(
        self, mock_is_admin, mock_get_user, mock_get_conn, app_with_admin_route
    ):
        """Should return user data when user is admin."""
        # Mock database connection context manager
        mock_conn = AsyncMock()
        mock_get_conn.return_value.__aenter__.return_value = mock_conn
        mock_get_conn.return_value.__aexit__.return_value = None

        # Mock user lookup and admin check
        mock_get_user.return_value = {"user_id": 1, "discord_id": "123456789"}
        mock_is_admin.return_value = True

        # Patch verify_jwt to return valid payload
        with patch("web_api.auth.verify_jwt") as mock_verify:
            mock_verify.return_value = {"sub": "123456789"}

            client = TestClient(app_with_admin_route)
            client.cookies.set("session", "fake-token")
            response = client.get("/test-admin")
            assert response.status_code == 200
            assert response.json()["user_id"] == 1


class TestAdminUserSearch:
    """Tests for POST /api/admin/users/search endpoint."""

    @patch("web_api.routes.admin.get_connection")
    @patch("web_api.routes.admin.search_users")
    def test_search_returns_matching_users(self, mock_search, mock_get_conn):
        """Should return users matching search query."""
        from web_api.routes.admin import router
        from fastapi import FastAPI

        app = FastAPI()
        app.include_router(router)

        # Override require_admin dependency to return mock admin user
        app.dependency_overrides[require_admin] = lambda: {"user_id": 1}

        # Mock database
        mock_conn = AsyncMock()
        mock_conn.__aenter__.return_value = mock_conn
        mock_conn.__aexit__.return_value = None
        mock_get_conn.return_value = mock_conn

        # Mock search_users result
        mock_search.return_value = [
            {
                "user_id": 2,
                "discord_id": "222",
                "nickname": "Alice",
                "discord_username": "alice",
            }
        ]

        client = TestClient(app)
        response = client.post(
            "/api/admin/users/search",
            json={"query": "ali"},
        )

        assert response.status_code == 200
        data = response.json()
        assert "users" in data
        assert len(data["users"]) == 1
        assert data["users"][0]["nickname"] == "Alice"


class TestAdminUserDetails:
    """Tests for GET /api/admin/users/{user_id} endpoint."""

    @patch("web_api.routes.admin.get_connection")
    @patch("web_api.routes.admin.get_user_admin_details")
    def test_returns_user_details(self, mock_get_details, mock_get_conn):
        """Should return user details with group info."""
        from web_api.routes.admin import router
        from fastapi import FastAPI

        app = FastAPI()
        app.include_router(router)

        # Override require_admin dependency to return mock admin user
        app.dependency_overrides[require_admin] = lambda: {"user_id": 1}

        # Mock database
        mock_conn = AsyncMock()
        mock_conn.__aenter__.return_value = mock_conn
        mock_conn.__aexit__.return_value = None
        mock_get_conn.return_value = mock_conn

        # Mock get_user_admin_details result
        mock_get_details.return_value = {
            "user_id": 2,
            "discord_id": "222",
            "nickname": "Alice",
            "discord_username": "alice",
            "email": "alice@test.com",
            "group_id": 5,
            "group_name": "Group A",
            "cohort_id": 1,
            "cohort_name": "Jan 2026",
            "group_status": "active",
        }

        client = TestClient(app)
        response = client.get("/api/admin/users/2")

        assert response.status_code == 200
        data = response.json()
        assert data["user_id"] == 2
        assert data["group_name"] == "Group A"

    @patch("web_api.routes.admin.get_connection")
    @patch("web_api.routes.admin.get_user_admin_details")
    def test_returns_404_for_nonexistent_user(self, mock_get_details, mock_get_conn):
        """Should return 404 when user not found."""
        from web_api.routes.admin import router
        from fastapi import FastAPI

        app = FastAPI()
        app.include_router(router)

        # Override require_admin dependency to return mock admin user
        app.dependency_overrides[require_admin] = lambda: {"user_id": 1}

        # Mock database
        mock_conn = AsyncMock()
        mock_conn.__aenter__.return_value = mock_conn
        mock_conn.__aexit__.return_value = None
        mock_get_conn.return_value = mock_conn

        # Mock get_user_admin_details returning None (user not found)
        mock_get_details.return_value = None

        client = TestClient(app)
        response = client.get("/api/admin/users/999")

        assert response.status_code == 404


class TestAdminGroupSync:
    """Tests for POST /api/admin/groups/{group_id}/sync endpoint."""

    @patch("web_api.routes.admin.sync_group")
    def test_calls_sync_group(self, mock_sync):
        """Should call sync_group and return result."""
        from web_api.routes.admin import router
        from fastapi import FastAPI

        app = FastAPI()
        app.include_router(router)

        # Override require_admin dependency to return mock admin user
        app.dependency_overrides[require_admin] = lambda: {"user_id": 1}

        mock_sync.return_value = {
            "discord": {"granted": 1, "revoked": 0},
            "calendar": {"synced": 2},
        }

        client = TestClient(app)
        response = client.post("/api/admin/groups/5/sync")

        assert response.status_code == 200
        mock_sync.assert_called_once_with(5, allow_create=False)
        data = response.json()
        assert "discord" in data


class TestAdminGroupRealize:
    """Tests for POST /api/admin/groups/{group_id}/realize endpoint."""

    @patch("web_api.routes.admin.sync_group")
    def test_calls_sync_group_with_allow_create(self, mock_sync):
        """Should call sync_group with allow_create=True."""
        from web_api.routes.admin import router
        from fastapi import FastAPI

        app = FastAPI()
        app.include_router(router)

        # Override require_admin dependency to return mock admin user
        app.dependency_overrides[require_admin] = lambda: {"user_id": 1}

        mock_sync.return_value = {
            "infrastructure": {"category": {"status": "created"}},
            "discord": {"granted": 3},
        }

        client = TestClient(app)
        response = client.post("/api/admin/groups/5/realize")

        assert response.status_code == 200
        mock_sync.assert_called_once_with(5, allow_create=True)


class TestAdminMemberAdd:
    """Tests for POST /api/admin/groups/{group_id}/members/add endpoint."""

    @patch("web_api.routes.admin.get_transaction")
    @patch("web_api.routes.admin.sync_after_group_change")
    @patch("web_api.routes.admin.assign_to_group")
    @patch("web_api.routes.admin.get_user_current_group_membership")
    def test_adds_user_to_group(
        self, mock_get_membership, mock_assign, mock_sync, mock_get_tx
    ):
        """Should add user to group and sync."""
        from web_api.routes.admin import router
        from fastapi import FastAPI

        app = FastAPI()
        app.include_router(router)

        # Override require_admin dependency to return mock admin user
        app.dependency_overrides[require_admin] = lambda: {"user_id": 1}

        mock_conn = AsyncMock()
        mock_conn.__aenter__.return_value = mock_conn
        mock_conn.__aexit__.return_value = None
        mock_get_tx.return_value = mock_conn

        # Mock group exists check
        mock_execute_result = AsyncMock()
        mock_execute_result.first.return_value = (5,)  # Group exists
        mock_conn.execute.return_value = mock_execute_result

        # User not in any group
        mock_get_membership.return_value = None
        mock_assign.return_value = {"group_id": 5, "group_user_id": 100}

        client = TestClient(app)
        response = client.post(
            "/api/admin/groups/5/members/add",
            json={"user_id": 2},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "added"
        mock_assign.assert_called_once_with(
            mock_conn, user_id=2, to_group_id=5, from_group_id=None
        )
        mock_sync.assert_called_once()

    @patch("web_api.routes.admin.get_transaction")
    @patch("web_api.routes.admin.sync_after_group_change")
    @patch("web_api.routes.admin.assign_to_group")
    @patch("web_api.routes.admin.get_user_current_group_membership")
    def test_moves_user_between_groups(
        self, mock_get_membership, mock_assign, mock_sync, mock_get_tx
    ):
        """Should move user from old group to new group."""
        from web_api.routes.admin import router
        from fastapi import FastAPI

        app = FastAPI()
        app.include_router(router)

        # Override require_admin dependency to return mock admin user
        app.dependency_overrides[require_admin] = lambda: {"user_id": 1}

        mock_conn = AsyncMock()
        mock_conn.__aenter__.return_value = mock_conn
        mock_conn.__aexit__.return_value = None
        mock_get_tx.return_value = mock_conn

        # Mock group exists check
        mock_execute_result = AsyncMock()
        mock_execute_result.first.return_value = (5,)  # Group exists
        mock_conn.execute.return_value = mock_execute_result

        # User is in group 3
        mock_get_membership.return_value = {
            "group_id": 3,
            "group_user_id": 50,
            "group_name": "Old Group",
        }
        mock_assign.return_value = {"group_id": 5, "group_user_id": 100}

        client = TestClient(app)
        response = client.post(
            "/api/admin/groups/5/members/add",
            json={"user_id": 2},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "moved"
        mock_assign.assert_called_once_with(
            mock_conn, user_id=2, to_group_id=5, from_group_id=3
        )
        # Sync should be called once with both group IDs
        mock_sync.assert_called_once_with(group_id=5, previous_group_id=3, user_id=2)

    @patch("web_api.routes.admin.get_transaction")
    @patch("web_api.routes.admin.sync_after_group_change")
    @patch("web_api.routes.admin.get_user_current_group_membership")
    def test_rejects_adding_to_same_group(
        self, mock_get_membership, mock_sync, mock_get_tx
    ):
        """Should return 400 when trying to add user to group they're already in."""
        from web_api.routes.admin import router
        from fastapi import FastAPI

        app = FastAPI()
        app.include_router(router)

        # Override require_admin dependency to return mock admin user
        app.dependency_overrides[require_admin] = lambda: {"user_id": 1}

        mock_conn = AsyncMock()
        mock_conn.__aenter__.return_value = mock_conn
        mock_conn.__aexit__.return_value = None
        mock_get_tx.return_value = mock_conn

        # Mock group exists check
        mock_execute_result = AsyncMock()
        mock_execute_result.first.return_value = (5,)  # Group exists
        mock_conn.execute.return_value = mock_execute_result

        # User is already in group 5
        mock_get_membership.return_value = {
            "group_id": 5,
            "group_user_id": 50,
            "group_name": "Target Group",
        }

        client = TestClient(app)
        response = client.post(
            "/api/admin/groups/5/members/add",
            json={"user_id": 2},
        )

        assert response.status_code == 400
        assert "already in this group" in response.json()["detail"]


class TestAdminMemberRemove:
    """Tests for POST /api/admin/groups/{group_id}/members/remove endpoint."""

    @patch("web_api.routes.admin.get_transaction")
    @patch("web_api.routes.admin.sync_after_group_change")
    def test_removes_user_from_group(self, mock_sync, mock_get_tx):
        """Should remove user from group and sync."""
        from web_api.routes.admin import router
        from fastapi import FastAPI

        app = FastAPI()
        app.include_router(router)

        # Override require_admin dependency to return mock admin user
        app.dependency_overrides[require_admin] = lambda: {"user_id": 1}

        mock_conn = AsyncMock()
        mock_conn.__aenter__.return_value = mock_conn
        mock_conn.__aexit__.return_value = None
        mock_get_tx.return_value = mock_conn

        with patch("web_api.routes.admin.remove_user_from_group") as mock_remove:
            mock_remove.return_value = True

            client = TestClient(app)
            response = client.post(
                "/api/admin/groups/5/members/remove",
                json={"user_id": 2},
            )

            assert response.status_code == 200
            mock_remove.assert_called_once()
            mock_sync.assert_called_once()

    @patch("web_api.routes.admin.get_transaction")
    @patch("web_api.routes.admin.sync_after_group_change")
    def test_returns_404_when_user_not_in_group(self, mock_sync, mock_get_tx):
        """Should return 404 when user is not in the group."""
        from web_api.routes.admin import router
        from fastapi import FastAPI

        app = FastAPI()
        app.include_router(router)

        # Override require_admin dependency to return mock admin user
        app.dependency_overrides[require_admin] = lambda: {"user_id": 1}

        mock_conn = AsyncMock()
        mock_conn.__aenter__.return_value = mock_conn
        mock_conn.__aexit__.return_value = None
        mock_get_tx.return_value = mock_conn

        with patch("web_api.routes.admin.remove_user_from_group") as mock_remove:
            mock_remove.return_value = False  # User not found in group

            client = TestClient(app)
            response = client.post(
                "/api/admin/groups/5/members/remove",
                json={"user_id": 999},
            )

            assert response.status_code == 404


class TestAdminGroupCreate:
    """Tests for POST /api/admin/groups/create endpoint."""

    @patch("web_api.routes.admin.get_transaction")
    def test_creates_group(self, mock_get_tx):
        """Should create a new group."""
        from web_api.routes.admin import router
        from fastapi import FastAPI

        app = FastAPI()
        app.include_router(router)

        # Override require_admin dependency to return mock admin user
        app.dependency_overrides[require_admin] = lambda: {"user_id": 1}

        mock_conn = AsyncMock()
        mock_conn.__aenter__.return_value = mock_conn
        mock_conn.__aexit__.return_value = None
        mock_get_tx.return_value = mock_conn

        with patch("web_api.routes.admin.create_group") as mock_create:
            mock_create.return_value = {
                "group_id": 10,
                "cohort_id": 1,
                "group_name": "New Group",
                "recurring_meeting_time_utc": "Wednesday 15:00",
                "status": "preview",
            }

            client = TestClient(app)
            response = client.post(
                "/api/admin/groups/create",
                json={
                    "cohort_id": 1,
                    "group_name": "New Group",
                    "meeting_time": "Wednesday 15:00",
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert data["group_id"] == 10
            assert data["status"] == "preview"


class TestAdminCohortSync:
    """Tests for POST /api/admin/cohorts/{cohort_id}/sync endpoint."""

    @patch("web_api.routes.admin.get_connection")
    @patch("web_api.routes.admin.sync_group")
    @patch("web_api.routes.admin.get_cohort_group_ids")
    def test_syncs_all_cohort_groups(self, mock_get_ids, mock_sync, mock_get_conn):
        """Should sync all groups in cohort."""
        from web_api.routes.admin import router
        from fastapi import FastAPI

        app = FastAPI()
        app.include_router(router)

        # Override require_admin dependency to return mock admin user
        app.dependency_overrides[require_admin] = lambda: {"user_id": 1}

        mock_conn = AsyncMock()
        mock_conn.__aenter__.return_value = mock_conn
        mock_conn.__aexit__.return_value = None
        mock_get_conn.return_value = mock_conn

        mock_get_ids.return_value = [1, 2, 3]
        mock_sync.return_value = {"discord": {"granted": 1}}

        client = TestClient(app)
        response = client.post("/api/admin/cohorts/1/sync")

        assert response.status_code == 200
        assert mock_sync.call_count == 3
        # Verify sync_group called with allow_create=False
        for call in mock_sync.call_args_list:
            assert call[1]["allow_create"] is False

        data = response.json()
        assert data["synced"] == 3
        assert len(data["results"]) == 3

        app.dependency_overrides.clear()

    @patch("web_api.routes.admin.get_connection")
    @patch("web_api.routes.admin.sync_group")
    @patch("web_api.routes.admin.get_cohort_group_ids")
    def test_handles_empty_cohort(self, mock_get_ids, mock_sync, mock_get_conn):
        """Should handle cohort with no groups."""
        from web_api.routes.admin import router
        from fastapi import FastAPI

        app = FastAPI()
        app.include_router(router)

        app.dependency_overrides[require_admin] = lambda: {"user_id": 1}

        mock_conn = AsyncMock()
        mock_conn.__aenter__.return_value = mock_conn
        mock_conn.__aexit__.return_value = None
        mock_get_conn.return_value = mock_conn

        mock_get_ids.return_value = []

        client = TestClient(app)
        response = client.post("/api/admin/cohorts/1/sync")

        assert response.status_code == 200
        data = response.json()
        assert data["synced"] == 0
        assert data["results"] == []
        mock_sync.assert_not_called()

        app.dependency_overrides.clear()


class TestAdminCohortRealize:
    """Tests for POST /api/admin/cohorts/{cohort_id}/realize endpoint."""

    @patch("web_api.routes.admin.get_connection")
    @patch("web_api.routes.admin.sync_group")
    @patch("web_api.routes.admin.get_cohort_preview_group_ids")
    def test_realizes_preview_groups(self, mock_get_ids, mock_sync, mock_get_conn):
        """Should realize all preview groups in cohort."""
        from web_api.routes.admin import router
        from fastapi import FastAPI

        app = FastAPI()
        app.include_router(router)

        app.dependency_overrides[require_admin] = lambda: {"user_id": 1}

        mock_conn = AsyncMock()
        mock_conn.__aenter__.return_value = mock_conn
        mock_conn.__aexit__.return_value = None
        mock_get_conn.return_value = mock_conn

        mock_get_ids.return_value = [2, 4]  # Only preview groups
        mock_sync.return_value = {"infrastructure": {"category": {"status": "created"}}}

        client = TestClient(app)
        response = client.post("/api/admin/cohorts/1/realize")

        assert response.status_code == 200
        assert mock_sync.call_count == 2
        # Verify sync_group called with allow_create=True
        for call in mock_sync.call_args_list:
            assert call[1]["allow_create"] is True

        data = response.json()
        assert data["realized"] == 2
        assert len(data["results"]) == 2

        app.dependency_overrides.clear()

    @patch("web_api.routes.admin.get_connection")
    @patch("web_api.routes.admin.sync_group")
    @patch("web_api.routes.admin.get_cohort_preview_group_ids")
    def test_handles_no_preview_groups(self, mock_get_ids, mock_sync, mock_get_conn):
        """Should handle cohort with no preview groups."""
        from web_api.routes.admin import router
        from fastapi import FastAPI

        app = FastAPI()
        app.include_router(router)

        app.dependency_overrides[require_admin] = lambda: {"user_id": 1}

        mock_conn = AsyncMock()
        mock_conn.__aenter__.return_value = mock_conn
        mock_conn.__aexit__.return_value = None
        mock_get_conn.return_value = mock_conn

        mock_get_ids.return_value = []  # No preview groups

        client = TestClient(app)
        response = client.post("/api/admin/cohorts/1/realize")

        assert response.status_code == 200
        data = response.json()
        assert data["realized"] == 0
        assert data["results"] == []
        mock_sync.assert_not_called()

        app.dependency_overrides.clear()


class TestAdminGroupsList:
    """Tests for GET /api/admin/cohorts/{cohort_id}/groups endpoint."""

    @patch("web_api.routes.admin.get_connection")
    @patch("web_api.routes.admin.get_cohort_groups_summary")
    def test_returns_groups_with_member_counts(self, mock_get, mock_get_conn):
        """Should return groups with member counts."""
        from web_api.routes.admin import router
        from fastapi import FastAPI

        app = FastAPI()
        app.include_router(router)

        app.dependency_overrides[require_admin] = lambda: {"user_id": 1}

        mock_conn = AsyncMock()
        mock_conn.__aenter__.return_value = mock_conn
        mock_conn.__aexit__.return_value = None
        mock_get_conn.return_value = mock_conn

        mock_get.return_value = [
            {
                "group_id": 1,
                "group_name": "Group A",
                "status": "active",
                "member_count": 5,
                "meeting_time": "Wednesday 15:00",
            },
            {
                "group_id": 2,
                "group_name": "Group B",
                "status": "preview",
                "member_count": 3,
                "meeting_time": "Thursday 16:00",
            },
        ]

        client = TestClient(app)
        response = client.get("/api/admin/cohorts/1/groups")

        assert response.status_code == 200
        data = response.json()
        assert len(data["groups"]) == 2
        assert data["groups"][0]["member_count"] == 5
        assert data["groups"][0]["group_name"] == "Group A"
        assert data["groups"][1]["status"] == "preview"

        app.dependency_overrides.clear()

    @patch("web_api.routes.admin.get_connection")
    @patch("web_api.routes.admin.get_cohort_groups_summary")
    def test_returns_empty_list_for_empty_cohort(self, mock_get, mock_get_conn):
        """Should return empty list when cohort has no groups."""
        from web_api.routes.admin import router
        from fastapi import FastAPI

        app = FastAPI()
        app.include_router(router)

        app.dependency_overrides[require_admin] = lambda: {"user_id": 1}

        mock_conn = AsyncMock()
        mock_conn.__aenter__.return_value = mock_conn
        mock_conn.__aexit__.return_value = None
        mock_get_conn.return_value = mock_conn

        mock_get.return_value = []

        client = TestClient(app)
        response = client.get("/api/admin/cohorts/999/groups")

        assert response.status_code == 200
        data = response.json()
        assert data["groups"] == []

        app.dependency_overrides.clear()
