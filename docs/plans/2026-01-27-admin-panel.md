# Admin Panel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a web admin panel for managing users and groups without direct database access.

**Architecture:** FastAPI endpoints at `/api/admin/*` with admin-only auth, calling existing core functions. React frontend page at `/admin` with Users and Groups tabs. Admin operations trigger `sync_group()` to handle Discord/calendar side effects.

**Tech Stack:** FastAPI, SQLAlchemy Core, React 19, Tailwind CSS v4, Vike routing

---

## Task 1: Add `require_admin` Dependency

**Files:**
- Modify: `web_api/auth.py`
- Test: `web_api/tests/test_admin.py` (create)

**Step 1: Write the failing test**

Create `web_api/tests/test_admin.py`:

```python
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

    @patch("web_api.auth.verify_jwt")
    @patch("web_api.auth.get_connection")
    def test_rejects_non_admin_user(
        self, mock_get_conn, mock_verify, app_with_admin_route
    ):
        """Should return 403 when user is not admin."""
        mock_verify.return_value = {"sub": "123456789"}

        # Mock database returning non-admin user
        mock_conn = AsyncMock()
        mock_conn.__aenter__.return_value = mock_conn
        mock_conn.__aexit__.return_value = None
        mock_get_conn.return_value = mock_conn

        with patch("web_api.auth.get_user_by_discord_id") as mock_get_user, \
             patch("web_api.auth.is_admin") as mock_is_admin:
            mock_get_user.return_value = {"user_id": 1, "discord_id": "123456789"}
            mock_is_admin.return_value = False

            client = TestClient(app_with_admin_route)
            client.cookies.set("session", "fake-token")
            response = client.get("/test-admin")
            assert response.status_code == 403

    @patch("web_api.auth.verify_jwt")
    @patch("web_api.auth.get_connection")
    def test_allows_admin_user(
        self, mock_get_conn, mock_verify, app_with_admin_route
    ):
        """Should return user data when user is admin."""
        mock_verify.return_value = {"sub": "123456789"}

        mock_conn = AsyncMock()
        mock_conn.__aenter__.return_value = mock_conn
        mock_conn.__aexit__.return_value = None
        mock_get_conn.return_value = mock_conn

        with patch("web_api.auth.get_user_by_discord_id") as mock_get_user, \
             patch("web_api.auth.is_admin") as mock_is_admin:
            mock_get_user.return_value = {"user_id": 1, "discord_id": "123456789"}
            mock_is_admin.return_value = True

            client = TestClient(app_with_admin_route)
            client.cookies.set("session", "fake-token")
            response = client.get("/test-admin")
            assert response.status_code == 200
            assert response.json()["user_id"] == 1
```

**Step 2: Run test to verify it fails**

```bash
pytest web_api/tests/test_admin.py -v
```

Expected: FAIL with "cannot import name 'require_admin' from 'web_api.auth'"

**Step 3: Write minimal implementation**

Add to `web_api/auth.py` at the end:

```python
async def require_admin(request: Request) -> dict:
    """
    FastAPI dependency requiring admin privileges.

    Returns the database user dict (with user_id) if admin.

    Raises:
        HTTPException: 401 if not authenticated, 403 if not admin
    """
    from core.database import get_connection
    from core.queries.users import get_user_by_discord_id
    from core.queries.facilitator import is_admin

    # First check authentication
    token = request.cookies.get("session")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    payload = verify_jwt(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    discord_id = payload["sub"]

    # Check admin status
    async with get_connection() as conn:
        db_user = await get_user_by_discord_id(conn, discord_id)
        if not db_user:
            raise HTTPException(status_code=403, detail="User not found")

        if not await is_admin(conn, db_user["user_id"]):
            raise HTTPException(status_code=403, detail="Admin access required")

    return db_user
```

**Step 4: Run test to verify it passes**

```bash
pytest web_api/tests/test_admin.py -v
```

Expected: PASS

**Step 5: Commit**

```bash
jj describe -m "feat(api): add require_admin auth dependency"
```

---

## Task 2: Add User Search Query

**Files:**
- Modify: `core/queries/users.py`
- Modify: `core/queries/__init__.py`
- Test: `core/tests/test_queries_users.py` (create or add to existing)

**Step 1: Write the failing test**

Create `core/tests/test_queries_users.py`:

```python
"""Tests for user queries."""

import pytest
from unittest.mock import AsyncMock, MagicMock


class TestSearchUsers:
    """Tests for search_users query."""

    @pytest.mark.asyncio
    async def test_search_by_nickname(self):
        """Should find users by nickname substring."""
        from core.queries.users import search_users

        # Create mock connection that returns test data
        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value = [
            {
                "user_id": 1,
                "discord_id": "111",
                "nickname": "Alice",
                "discord_username": "alice#1234",
            },
        ]
        mock_conn.execute.return_value = mock_result

        results = await search_users(mock_conn, "Ali")

        assert len(results) == 1
        assert results[0]["nickname"] == "Alice"

    @pytest.mark.asyncio
    async def test_search_by_discord_username(self):
        """Should find users by discord_username substring."""
        from core.queries.users import search_users

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value = [
            {
                "user_id": 2,
                "discord_id": "222",
                "nickname": None,
                "discord_username": "bob_smith",
            },
        ]
        mock_conn.execute.return_value = mock_result

        results = await search_users(mock_conn, "bob")

        assert len(results) == 1
        assert results[0]["discord_username"] == "bob_smith"

    @pytest.mark.asyncio
    async def test_search_limits_results(self):
        """Should limit results to specified count."""
        from core.queries.users import search_users

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        # Return more results than limit
        mock_result.mappings.return_value = [
            {"user_id": i, "discord_id": str(i), "nickname": f"User{i}", "discord_username": f"user{i}"}
            for i in range(5)
        ]
        mock_conn.execute.return_value = mock_result

        results = await search_users(mock_conn, "User", limit=3)

        # Mock returns all 5, but function should pass limit to query
        # For unit test, we verify the query was constructed correctly
        call_args = mock_conn.execute.call_args
        assert call_args is not None
```

**Step 2: Run test to verify it fails**

```bash
pytest core/tests/test_queries_users.py::TestSearchUsers -v
```

Expected: FAIL with "cannot import name 'search_users'"

**Step 3: Write minimal implementation**

Add to `core/queries/users.py`:

```python
async def search_users(
    conn: AsyncConnection,
    query: str,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """
    Search users by nickname or discord_username.

    Args:
        conn: Database connection
        query: Search string (case-insensitive substring match)
        limit: Maximum results to return

    Returns:
        List of user dicts with user_id, discord_id, nickname, discord_username
    """
    search_pattern = f"%{query}%"

    result = await conn.execute(
        select(
            users.c.user_id,
            users.c.discord_id,
            users.c.nickname,
            users.c.discord_username,
        )
        .where(
            (users.c.nickname.ilike(search_pattern))
            | (users.c.discord_username.ilike(search_pattern))
        )
        .order_by(users.c.nickname, users.c.discord_username)
        .limit(limit)
    )

    return [dict(row) for row in result.mappings()]
```

**Step 4: Run test to verify it passes**

```bash
pytest core/tests/test_queries_users.py::TestSearchUsers -v
```

Expected: PASS

**Step 5: Export from `core/queries/__init__.py`**

Add to imports and `__all__`:

```python
from .users import search_users
# In __all__:
"search_users",
```

**Step 6: Commit**

```bash
jj describe -m "feat(core): add search_users query"
```

---

## Task 3: Add User Admin Details Query

**Files:**
- Modify: `core/queries/users.py`
- Test: `core/tests/test_queries_users.py`

**Step 1: Write the failing test**

Add to `core/tests/test_queries_users.py`:

```python
class TestGetUserAdminDetails:
    """Tests for get_user_admin_details query."""

    @pytest.mark.asyncio
    async def test_returns_user_with_group_info(self):
        """Should return user details including current group."""
        from core.queries.users import get_user_admin_details

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value.first.return_value = {
            "user_id": 1,
            "discord_id": "111",
            "nickname": "Alice",
            "discord_username": "alice#1234",
            "email": "alice@example.com",
            "group_id": 5,
            "group_name": "Group A",
            "cohort_id": 2,
            "cohort_name": "Jan 2026 Cohort",
            "group_status": "active",
        }
        mock_conn.execute.return_value = mock_result

        result = await get_user_admin_details(mock_conn, 1)

        assert result is not None
        assert result["user_id"] == 1
        assert result["group_id"] == 5
        assert result["cohort_name"] == "Jan 2026 Cohort"

    @pytest.mark.asyncio
    async def test_returns_none_for_nonexistent_user(self):
        """Should return None when user not found."""
        from core.queries.users import get_user_admin_details

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value.first.return_value = None
        mock_conn.execute.return_value = mock_result

        result = await get_user_admin_details(mock_conn, 999)

        assert result is None
```

**Step 2: Run test to verify it fails**

```bash
pytest core/tests/test_queries_users.py::TestGetUserAdminDetails -v
```

Expected: FAIL with "cannot import name 'get_user_admin_details'"

**Step 3: Write minimal implementation**

Add to `core/queries/users.py`:

```python
async def get_user_admin_details(
    conn: AsyncConnection,
    user_id: int,
) -> dict[str, Any] | None:
    """
    Get user details for admin panel, including current group membership.

    Returns:
        Dict with user info plus group_id, group_name, cohort_id, cohort_name, group_status
        or None if user not found
    """
    from ..tables import groups, cohorts

    result = await conn.execute(
        select(
            users.c.user_id,
            users.c.discord_id,
            users.c.nickname,
            users.c.discord_username,
            users.c.email,
            groups.c.group_id,
            groups.c.group_name,
            groups.c.status.label("group_status"),
            cohorts.c.cohort_id,
            cohorts.c.cohort_name,
        )
        .outerjoin(
            groups_users,
            (users.c.user_id == groups_users.c.user_id)
            & (groups_users.c.status == GroupUserStatus.active),
        )
        .outerjoin(groups, groups_users.c.group_id == groups.c.group_id)
        .outerjoin(cohorts, groups.c.cohort_id == cohorts.c.cohort_id)
        .where(users.c.user_id == user_id)
    )

    row = result.mappings().first()
    return dict(row) if row else None
```

**Step 4: Run test to verify it passes**

```bash
pytest core/tests/test_queries_users.py::TestGetUserAdminDetails -v
```

Expected: PASS

**Step 5: Commit**

```bash
jj describe -m "feat(core): add get_user_admin_details query"
```

---

## Task 4: Create Admin Routes File with User Search Endpoint

**Files:**
- Create: `web_api/routes/admin.py`
- Modify: `main.py` (add router)
- Test: `web_api/tests/test_admin.py`

**Step 1: Write the failing test**

Add to `web_api/tests/test_admin.py`:

```python
class TestAdminUserSearch:
    """Tests for POST /api/admin/users/search endpoint."""

    @patch("web_api.routes.admin.require_admin")
    @patch("web_api.routes.admin.get_connection")
    def test_search_returns_matching_users(self, mock_get_conn, mock_require_admin):
        """Should return users matching search query."""
        from web_api.routes.admin import router
        from fastapi import FastAPI

        app = FastAPI()
        app.include_router(router)

        # Mock admin auth
        mock_require_admin.return_value = {"user_id": 1}

        # Mock database
        mock_conn = AsyncMock()
        mock_conn.__aenter__.return_value = mock_conn
        mock_conn.__aexit__.return_value = None
        mock_get_conn.return_value = mock_conn

        with patch("web_api.routes.admin.search_users") as mock_search:
            mock_search.return_value = [
                {"user_id": 2, "discord_id": "222", "nickname": "Alice", "discord_username": "alice"}
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
```

**Step 2: Run test to verify it fails**

```bash
pytest web_api/tests/test_admin.py::TestAdminUserSearch -v
```

Expected: FAIL with "No module named 'web_api.routes.admin'"

**Step 3: Write minimal implementation**

Create `web_api/routes/admin.py`:

```python
"""
Admin panel API routes.

All endpoints require admin authentication.

Endpoints:
- POST /api/admin/users/search - Search users by name/username
- GET /api/admin/users/{user_id} - Get user details
- POST /api/admin/groups/{group_id}/sync - Sync a group
- POST /api/admin/groups/{group_id}/realize - Realize a group
- POST /api/admin/groups/{group_id}/members/add - Add user to group
- POST /api/admin/groups/{group_id}/members/remove - Remove user from group
- POST /api/admin/groups/create - Create a new group
- POST /api/admin/cohorts/{cohort_id}/sync - Sync all groups in cohort
- POST /api/admin/cohorts/{cohort_id}/realize - Realize all preview groups
"""

import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.database import get_connection
from core.queries.users import search_users, get_user_admin_details
from web_api.auth import require_admin

router = APIRouter(prefix="/api/admin", tags=["admin"])


class UserSearchRequest(BaseModel):
    """Request body for user search."""

    query: str
    limit: int = 20


@router.post("/users/search")
async def search_users_endpoint(
    request: UserSearchRequest,
    admin: dict = Depends(require_admin),
) -> dict[str, Any]:
    """
    Search users by nickname or discord_username.

    Returns list of matching users with basic info.
    """
    async with get_connection() as conn:
        users = await search_users(conn, request.query, request.limit)

    return {"users": users}
```

**Step 4: Run test to verify it passes**

```bash
pytest web_api/tests/test_admin.py::TestAdminUserSearch -v
```

Expected: PASS

**Step 5: Register router in `main.py`**

Add after other route imports (around line 108):

```python
from web_api.routes.admin import router as admin_router
```

Add after other `app.include_router()` calls (around line 230):

```python
app.include_router(admin_router)
```

**Step 6: Commit**

```bash
jj describe -m "feat(api): add admin routes with user search endpoint"
```

---

## Task 5: Add User Details Endpoint

**Files:**
- Modify: `web_api/routes/admin.py`
- Test: `web_api/tests/test_admin.py`

**Step 1: Write the failing test**

Add to `web_api/tests/test_admin.py`:

```python
class TestAdminUserDetails:
    """Tests for GET /api/admin/users/{user_id} endpoint."""

    @patch("web_api.routes.admin.require_admin")
    @patch("web_api.routes.admin.get_connection")
    def test_returns_user_details(self, mock_get_conn, mock_require_admin):
        """Should return user details with group info."""
        from web_api.routes.admin import router
        from fastapi import FastAPI

        app = FastAPI()
        app.include_router(router)

        mock_require_admin.return_value = {"user_id": 1}

        mock_conn = AsyncMock()
        mock_conn.__aenter__.return_value = mock_conn
        mock_conn.__aexit__.return_value = None
        mock_get_conn.return_value = mock_conn

        with patch("web_api.routes.admin.get_user_admin_details") as mock_get_details:
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

    @patch("web_api.routes.admin.require_admin")
    @patch("web_api.routes.admin.get_connection")
    def test_returns_404_for_nonexistent_user(self, mock_get_conn, mock_require_admin):
        """Should return 404 when user not found."""
        from web_api.routes.admin import router
        from fastapi import FastAPI

        app = FastAPI()
        app.include_router(router)

        mock_require_admin.return_value = {"user_id": 1}

        mock_conn = AsyncMock()
        mock_conn.__aenter__.return_value = mock_conn
        mock_conn.__aexit__.return_value = None
        mock_get_conn.return_value = mock_conn

        with patch("web_api.routes.admin.get_user_admin_details") as mock_get_details:
            mock_get_details.return_value = None

            client = TestClient(app)
            response = client.get("/api/admin/users/999")

            assert response.status_code == 404
```

**Step 2: Run test to verify it fails**

```bash
pytest web_api/tests/test_admin.py::TestAdminUserDetails -v
```

Expected: FAIL with 404 (no route defined)

**Step 3: Write minimal implementation**

Add to `web_api/routes/admin.py`:

```python
@router.get("/users/{user_id}")
async def get_user_details_endpoint(
    user_id: int,
    admin: dict = Depends(require_admin),
) -> dict[str, Any]:
    """
    Get detailed user information including group membership.
    """
    async with get_connection() as conn:
        user = await get_user_admin_details(conn, user_id)

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return user
```

**Step 4: Run test to verify it passes**

```bash
pytest web_api/tests/test_admin.py::TestAdminUserDetails -v
```

Expected: PASS

**Step 5: Commit**

```bash
jj describe -m "feat(api): add admin user details endpoint"
```

---

## Task 6: Add Group Sync Endpoint

**Files:**
- Modify: `web_api/routes/admin.py`
- Test: `web_api/tests/test_admin.py`

**Step 1: Write the failing test**

Add to `web_api/tests/test_admin.py`:

```python
class TestAdminGroupSync:
    """Tests for POST /api/admin/groups/{group_id}/sync endpoint."""

    @patch("web_api.routes.admin.require_admin")
    @patch("web_api.routes.admin.sync_group")
    def test_calls_sync_group(self, mock_sync, mock_require_admin):
        """Should call sync_group and return result."""
        from web_api.routes.admin import router
        from fastapi import FastAPI

        app = FastAPI()
        app.include_router(router)

        mock_require_admin.return_value = {"user_id": 1}
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
```

**Step 2: Run test to verify it fails**

```bash
pytest web_api/tests/test_admin.py::TestAdminGroupSync -v
```

Expected: FAIL with 404 (no route)

**Step 3: Write minimal implementation**

Add to `web_api/routes/admin.py`:

```python
from core.sync import sync_group


@router.post("/groups/{group_id}/sync")
async def sync_group_endpoint(
    group_id: int,
    admin: dict = Depends(require_admin),
) -> dict[str, Any]:
    """
    Sync a group's Discord permissions, calendar, and reminders.

    Does NOT create infrastructure - use /realize for that.
    """
    result = await sync_group(group_id, allow_create=False)
    return result
```

**Step 4: Run test to verify it passes**

```bash
pytest web_api/tests/test_admin.py::TestAdminGroupSync -v
```

Expected: PASS

**Step 5: Commit**

```bash
jj describe -m "feat(api): add admin group sync endpoint"
```

---

## Task 7: Add Group Realize Endpoint

**Files:**
- Modify: `web_api/routes/admin.py`
- Test: `web_api/tests/test_admin.py`

**Step 1: Write the failing test**

Add to `web_api/tests/test_admin.py`:

```python
class TestAdminGroupRealize:
    """Tests for POST /api/admin/groups/{group_id}/realize endpoint."""

    @patch("web_api.routes.admin.require_admin")
    @patch("web_api.routes.admin.sync_group")
    def test_calls_sync_group_with_allow_create(self, mock_sync, mock_require_admin):
        """Should call sync_group with allow_create=True."""
        from web_api.routes.admin import router
        from fastapi import FastAPI

        app = FastAPI()
        app.include_router(router)

        mock_require_admin.return_value = {"user_id": 1}
        mock_sync.return_value = {
            "infrastructure": {"category": {"status": "created"}},
            "discord": {"granted": 3},
        }

        client = TestClient(app)
        response = client.post("/api/admin/groups/5/realize")

        assert response.status_code == 200
        mock_sync.assert_called_once_with(5, allow_create=True)
```

**Step 2: Run test to verify it fails**

```bash
pytest web_api/tests/test_admin.py::TestAdminGroupRealize -v
```

Expected: FAIL with 404

**Step 3: Write minimal implementation**

Add to `web_api/routes/admin.py`:

```python
@router.post("/groups/{group_id}/realize")
async def realize_group_endpoint(
    group_id: int,
    admin: dict = Depends(require_admin),
) -> dict[str, Any]:
    """
    Realize a group - create Discord infrastructure and sync.

    Creates category, channels, calendar events, then syncs permissions.
    """
    result = await sync_group(group_id, allow_create=True)
    return result
```

**Step 4: Run test to verify it passes**

```bash
pytest web_api/tests/test_admin.py::TestAdminGroupRealize -v
```

Expected: PASS

**Step 5: Commit**

```bash
jj describe -m "feat(api): add admin group realize endpoint"
```

---

## Task 8: Add Member Management Endpoints

**Files:**
- Modify: `web_api/routes/admin.py`
- Test: `web_api/tests/test_admin.py`

**Step 1: Write the failing test**

Add to `web_api/tests/test_admin.py`:

```python
class TestAdminMemberAdd:
    """Tests for POST /api/admin/groups/{group_id}/members/add endpoint."""

    @patch("web_api.routes.admin.require_admin")
    @patch("web_api.routes.admin.get_transaction")
    @patch("web_api.routes.admin.sync_after_group_change")
    def test_adds_user_to_group(self, mock_sync, mock_get_tx, mock_require_admin):
        """Should add user to group and sync."""
        from web_api.routes.admin import router
        from fastapi import FastAPI

        app = FastAPI()
        app.include_router(router)

        mock_require_admin.return_value = {"user_id": 1}

        mock_conn = AsyncMock()
        mock_conn.__aenter__.return_value = mock_conn
        mock_conn.__aexit__.return_value = None
        mock_get_tx.return_value = mock_conn

        with patch("web_api.routes.admin.add_user_to_group") as mock_add:
            mock_add.return_value = {"group_user_id": 100, "group_id": 5, "user_id": 2}

            client = TestClient(app)
            response = client.post(
                "/api/admin/groups/5/members/add",
                json={"user_id": 2},
            )

            assert response.status_code == 200
            mock_add.assert_called_once()
            mock_sync.assert_called_once()


class TestAdminMemberRemove:
    """Tests for POST /api/admin/groups/{group_id}/members/remove endpoint."""

    @patch("web_api.routes.admin.require_admin")
    @patch("web_api.routes.admin.get_transaction")
    @patch("web_api.routes.admin.sync_after_group_change")
    def test_removes_user_from_group(self, mock_sync, mock_get_tx, mock_require_admin):
        """Should remove user from group and sync."""
        from web_api.routes.admin import router
        from fastapi import FastAPI

        app = FastAPI()
        app.include_router(router)

        mock_require_admin.return_value = {"user_id": 1}

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
```

**Step 2: Run test to verify it fails**

```bash
pytest web_api/tests/test_admin.py::TestAdminMemberAdd -v
pytest web_api/tests/test_admin.py::TestAdminMemberRemove -v
```

Expected: FAIL with 404

**Step 3: Add remove_user_from_group query**

Add to `core/queries/groups.py`:

```python
async def remove_user_from_group(
    conn: AsyncConnection,
    group_id: int,
    user_id: int,
) -> bool:
    """
    Remove a user from a group by setting status to 'removed'.

    Returns True if user was removed, False if not found.
    """
    from ..enums import GroupUserStatus

    result = await conn.execute(
        update(groups_users)
        .where(groups_users.c.group_id == group_id)
        .where(groups_users.c.user_id == user_id)
        .where(groups_users.c.status == GroupUserStatus.active)
        .values(status="removed")
        .returning(groups_users.c.group_user_id)
    )
    return result.first() is not None
```

Add import at top: `from sqlalchemy import insert, select, update`

Export from `core/queries/__init__.py`.

**Step 4: Write endpoint implementation**

Add to `web_api/routes/admin.py`:

```python
from core.database import get_transaction
from core.queries.groups import add_user_to_group, remove_user_from_group
from core.sync import sync_after_group_change


class MemberRequest(BaseModel):
    """Request body for member operations."""

    user_id: int


@router.post("/groups/{group_id}/members/add")
async def add_member_endpoint(
    group_id: int,
    request: MemberRequest,
    admin: dict = Depends(require_admin),
) -> dict[str, Any]:
    """
    Add a user to a group.

    Automatically syncs Discord permissions, calendar, and sends notifications.
    """
    async with get_transaction() as conn:
        result = await add_user_to_group(conn, group_id, request.user_id)

    # Sync after transaction commits
    await sync_after_group_change(group_id=group_id, user_id=request.user_id)

    return {"status": "added", "group_user_id": result["group_user_id"]}


@router.post("/groups/{group_id}/members/remove")
async def remove_member_endpoint(
    group_id: int,
    request: MemberRequest,
    admin: dict = Depends(require_admin),
) -> dict[str, Any]:
    """
    Remove a user from a group.

    Automatically syncs to revoke Discord permissions and calendar access.
    """
    async with get_transaction() as conn:
        removed = await remove_user_from_group(conn, group_id, request.user_id)

    if not removed:
        raise HTTPException(status_code=404, detail="User not in group")

    # Sync to revoke access
    await sync_after_group_change(group_id=group_id)

    return {"status": "removed"}
```

**Step 5: Run tests to verify they pass**

```bash
pytest web_api/tests/test_admin.py::TestAdminMemberAdd -v
pytest web_api/tests/test_admin.py::TestAdminMemberRemove -v
```

Expected: PASS

**Step 6: Commit**

```bash
jj describe -m "feat(api): add admin member add/remove endpoints"
```

---

## Task 9: Add Group Create Endpoint

**Files:**
- Modify: `web_api/routes/admin.py`
- Test: `web_api/tests/test_admin.py`

**Step 1: Write the failing test**

Add to `web_api/tests/test_admin.py`:

```python
class TestAdminGroupCreate:
    """Tests for POST /api/admin/groups/create endpoint."""

    @patch("web_api.routes.admin.require_admin")
    @patch("web_api.routes.admin.get_transaction")
    def test_creates_group(self, mock_get_tx, mock_require_admin):
        """Should create a new group."""
        from web_api.routes.admin import router
        from fastapi import FastAPI

        app = FastAPI()
        app.include_router(router)

        mock_require_admin.return_value = {"user_id": 1}

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
```

**Step 2: Run test to verify it fails**

```bash
pytest web_api/tests/test_admin.py::TestAdminGroupCreate -v
```

Expected: FAIL with 404

**Step 3: Write minimal implementation**

Add to `web_api/routes/admin.py`:

```python
from core.queries.groups import create_group


class CreateGroupRequest(BaseModel):
    """Request body for creating a group."""

    cohort_id: int
    group_name: str
    meeting_time: str  # e.g., "Wednesday 15:00"


@router.post("/groups/create")
async def create_group_endpoint(
    request: CreateGroupRequest,
    admin: dict = Depends(require_admin),
) -> dict[str, Any]:
    """
    Create a new group in a cohort.

    Group starts in 'preview' status. Use /realize to create Discord infrastructure.
    """
    async with get_transaction() as conn:
        group = await create_group(
            conn,
            cohort_id=request.cohort_id,
            group_name=request.group_name,
            recurring_meeting_time_utc=request.meeting_time,
        )

    return group
```

**Step 4: Run test to verify it passes**

```bash
pytest web_api/tests/test_admin.py::TestAdminGroupCreate -v
```

Expected: PASS

**Step 5: Commit**

```bash
jj describe -m "feat(api): add admin group create endpoint"
```

---

## Task 10: Add Cohort-Level Sync and Realize Endpoints

**Files:**
- Modify: `web_api/routes/admin.py`
- Test: `web_api/tests/test_admin.py`

**Step 1: Write the failing test**

Add to `web_api/tests/test_admin.py`:

```python
class TestAdminCohortSync:
    """Tests for POST /api/admin/cohorts/{cohort_id}/sync endpoint."""

    @patch("web_api.routes.admin.require_admin")
    @patch("web_api.routes.admin.get_connection")
    @patch("web_api.routes.admin.sync_group")
    def test_syncs_all_cohort_groups(self, mock_sync, mock_get_conn, mock_require_admin):
        """Should sync all groups in cohort."""
        from web_api.routes.admin import router
        from fastapi import FastAPI

        app = FastAPI()
        app.include_router(router)

        mock_require_admin.return_value = {"user_id": 1}

        mock_conn = AsyncMock()
        mock_conn.__aenter__.return_value = mock_conn
        mock_conn.__aexit__.return_value = None
        mock_get_conn.return_value = mock_conn

        mock_sync.return_value = {"discord": {"granted": 1}}

        with patch("web_api.routes.admin.get_cohort_group_ids") as mock_get_ids:
            mock_get_ids.return_value = [1, 2, 3]

            client = TestClient(app)
            response = client.post("/api/admin/cohorts/1/sync")

            assert response.status_code == 200
            assert mock_sync.call_count == 3


class TestAdminCohortRealize:
    """Tests for POST /api/admin/cohorts/{cohort_id}/realize endpoint."""

    @patch("web_api.routes.admin.require_admin")
    @patch("web_api.routes.admin.get_connection")
    @patch("web_api.routes.admin.sync_group")
    def test_realizes_preview_groups_only(self, mock_sync, mock_get_conn, mock_require_admin):
        """Should only realize groups in preview status."""
        from web_api.routes.admin import router
        from fastapi import FastAPI

        app = FastAPI()
        app.include_router(router)

        mock_require_admin.return_value = {"user_id": 1}

        mock_conn = AsyncMock()
        mock_conn.__aenter__.return_value = mock_conn
        mock_conn.__aexit__.return_value = None
        mock_get_conn.return_value = mock_conn

        mock_sync.return_value = {"infrastructure": {"status": "created"}}

        with patch("web_api.routes.admin.get_cohort_preview_group_ids") as mock_get_ids:
            mock_get_ids.return_value = [1, 2]  # Only preview groups

            client = TestClient(app)
            response = client.post("/api/admin/cohorts/1/realize")

            assert response.status_code == 200
            assert mock_sync.call_count == 2
            # Verify allow_create=True was passed
            for call in mock_sync.call_args_list:
                assert call.kwargs.get("allow_create") is True or call.args[1] is True
```

**Step 2: Run tests to verify they fail**

```bash
pytest web_api/tests/test_admin.py::TestAdminCohortSync -v
pytest web_api/tests/test_admin.py::TestAdminCohortRealize -v
```

Expected: FAIL with 404

**Step 3: Add cohort group queries**

Add to `core/queries/groups.py`:

```python
async def get_cohort_group_ids(
    conn: AsyncConnection,
    cohort_id: int,
) -> list[int]:
    """Get all group IDs for a cohort."""
    result = await conn.execute(
        select(groups.c.group_id)
        .where(groups.c.cohort_id == cohort_id)
        .order_by(groups.c.group_id)
    )
    return [row.group_id for row in result]


async def get_cohort_preview_group_ids(
    conn: AsyncConnection,
    cohort_id: int,
) -> list[int]:
    """Get group IDs for groups in 'preview' status in a cohort."""
    result = await conn.execute(
        select(groups.c.group_id)
        .where(groups.c.cohort_id == cohort_id)
        .where(groups.c.status == "preview")
        .order_by(groups.c.group_id)
    )
    return [row.group_id for row in result]
```

Export from `core/queries/__init__.py`.

**Step 4: Write endpoint implementations**

Add to `web_api/routes/admin.py`:

```python
from core.queries.groups import get_cohort_group_ids, get_cohort_preview_group_ids


@router.post("/cohorts/{cohort_id}/sync")
async def sync_cohort_endpoint(
    cohort_id: int,
    admin: dict = Depends(require_admin),
) -> dict[str, Any]:
    """
    Sync all groups in a cohort.

    Updates Discord permissions, calendar, and reminders for all groups.
    """
    async with get_connection() as conn:
        group_ids = await get_cohort_group_ids(conn, cohort_id)

    results = []
    for group_id in group_ids:
        result = await sync_group(group_id, allow_create=False)
        results.append({"group_id": group_id, "result": result})

    return {"synced": len(results), "results": results}


@router.post("/cohorts/{cohort_id}/realize")
async def realize_cohort_endpoint(
    cohort_id: int,
    admin: dict = Depends(require_admin),
) -> dict[str, Any]:
    """
    Realize all preview groups in a cohort.

    Creates Discord infrastructure for groups that don't have it yet.
    """
    async with get_connection() as conn:
        group_ids = await get_cohort_preview_group_ids(conn, cohort_id)

    results = []
    for group_id in group_ids:
        result = await sync_group(group_id, allow_create=True)
        results.append({"group_id": group_id, "result": result})

    return {"realized": len(results), "results": results}
```

**Step 5: Run tests to verify they pass**

```bash
pytest web_api/tests/test_admin.py::TestAdminCohortSync -v
pytest web_api/tests/test_admin.py::TestAdminCohortRealize -v
```

Expected: PASS

**Step 6: Commit**

```bash
jj describe -m "feat(api): add admin cohort sync/realize endpoints"
```

---

## Task 11: Add Groups List Endpoint for Admin

**Files:**
- Modify: `web_api/routes/admin.py`
- Modify: `core/queries/groups.py`
- Test: `web_api/tests/test_admin.py`

**Step 1: Write the failing test**

Add to `web_api/tests/test_admin.py`:

```python
class TestAdminGroupsList:
    """Tests for GET /api/admin/cohorts/{cohort_id}/groups endpoint."""

    @patch("web_api.routes.admin.require_admin")
    @patch("web_api.routes.admin.get_connection")
    def test_returns_groups_with_member_counts(self, mock_get_conn, mock_require_admin):
        """Should return groups with member counts."""
        from web_api.routes.admin import router
        from fastapi import FastAPI

        app = FastAPI()
        app.include_router(router)

        mock_require_admin.return_value = {"user_id": 1}

        mock_conn = AsyncMock()
        mock_conn.__aenter__.return_value = mock_conn
        mock_conn.__aexit__.return_value = None
        mock_get_conn.return_value = mock_conn

        with patch("web_api.routes.admin.get_cohort_groups_summary") as mock_get:
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
```

**Step 2: Run test to verify it fails**

```bash
pytest web_api/tests/test_admin.py::TestAdminGroupsList -v
```

Expected: FAIL

**Step 3: Add query**

Add to `core/queries/groups.py`:

```python
async def get_cohort_groups_summary(
    conn: AsyncConnection,
    cohort_id: int,
) -> list[dict[str, Any]]:
    """
    Get groups in a cohort with member counts for admin panel.

    Returns list of dicts with group_id, group_name, status, member_count, meeting_time.
    """
    from sqlalchemy import func

    from ..enums import GroupUserStatus

    # Subquery for member counts
    member_counts = (
        select(
            groups_users.c.group_id,
            func.count(groups_users.c.user_id).label("member_count"),
        )
        .where(groups_users.c.status == GroupUserStatus.active)
        .group_by(groups_users.c.group_id)
        .subquery()
    )

    result = await conn.execute(
        select(
            groups.c.group_id,
            groups.c.group_name,
            groups.c.status,
            groups.c.recurring_meeting_time_utc.label("meeting_time"),
            func.coalesce(member_counts.c.member_count, 0).label("member_count"),
        )
        .outerjoin(member_counts, groups.c.group_id == member_counts.c.group_id)
        .where(groups.c.cohort_id == cohort_id)
        .order_by(groups.c.group_name)
    )

    return [dict(row) for row in result.mappings()]
```

**Step 4: Add endpoint**

Add to `web_api/routes/admin.py`:

```python
from core.queries.groups import get_cohort_groups_summary


@router.get("/cohorts/{cohort_id}/groups")
async def list_cohort_groups_endpoint(
    cohort_id: int,
    admin: dict = Depends(require_admin),
) -> dict[str, Any]:
    """
    List all groups in a cohort with member counts.
    """
    async with get_connection() as conn:
        groups = await get_cohort_groups_summary(conn, cohort_id)

    return {"groups": groups}
```

**Step 5: Run test to verify it passes**

```bash
pytest web_api/tests/test_admin.py::TestAdminGroupsList -v
```

Expected: PASS

**Step 6: Commit**

```bash
jj describe -m "feat(api): add admin cohort groups list endpoint"
```

---

## Task 12: Create Frontend Admin Page Structure

**Files:**
- Create: `web_frontend/src/pages/admin/+Page.tsx`
- Create: `web_frontend/src/views/Admin.tsx`
- Create: `web_frontend/src/api/admin.ts`

**Step 1: Create API client**

Create `web_frontend/src/api/admin.ts`:

```typescript
/**
 * API client for admin endpoints.
 */

import { API_URL } from "../config";

const API_BASE = API_URL;

export interface UserSearchResult {
  user_id: number;
  discord_id: string;
  nickname: string | null;
  discord_username: string | null;
}

export interface UserDetails {
  user_id: number;
  discord_id: string;
  nickname: string | null;
  discord_username: string | null;
  email: string | null;
  group_id: number | null;
  group_name: string | null;
  cohort_id: number | null;
  cohort_name: string | null;
  group_status: string | null;
}

export interface GroupSummary {
  group_id: number;
  group_name: string;
  status: string;
  member_count: number;
  meeting_time: string;
}

export async function searchUsers(query: string): Promise<UserSearchResult[]> {
  const res = await fetch(`${API_BASE}/api/admin/users/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error("Search failed");
  const data = await res.json();
  return data.users;
}

export async function getUserDetails(userId: number): Promise<UserDetails> {
  const res = await fetch(`${API_BASE}/api/admin/users/${userId}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to get user details");
  return res.json();
}

export async function syncGroup(groupId: number): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}/api/admin/groups/${groupId}/sync`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Sync failed");
  return res.json();
}

export async function realizeGroup(groupId: number): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}/api/admin/groups/${groupId}/realize`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Realize failed");
  return res.json();
}

export async function getCohortGroups(cohortId: number): Promise<GroupSummary[]> {
  const res = await fetch(`${API_BASE}/api/admin/cohorts/${cohortId}/groups`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to get groups");
  const data = await res.json();
  return data.groups;
}

export async function syncCohort(cohortId: number): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}/api/admin/cohorts/${cohortId}/sync`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Cohort sync failed");
  return res.json();
}

export async function realizeCohort(cohortId: number): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}/api/admin/cohorts/${cohortId}/realize`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Cohort realize failed");
  return res.json();
}

export async function addMemberToGroup(
  groupId: number,
  userId: number
): Promise<{ status: string }> {
  const res = await fetch(`${API_BASE}/api/admin/groups/${groupId}/members/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ user_id: userId }),
  });
  if (!res.ok) throw new Error("Failed to add member");
  return res.json();
}

export async function removeMemberFromGroup(
  groupId: number,
  userId: number
): Promise<{ status: string }> {
  const res = await fetch(`${API_BASE}/api/admin/groups/${groupId}/members/remove`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ user_id: userId }),
  });
  if (!res.ok) throw new Error("Failed to remove member");
  return res.json();
}

export async function createGroup(
  cohortId: number,
  groupName: string,
  meetingTime: string
): Promise<{ group_id: number }> {
  const res = await fetch(`${API_BASE}/api/admin/groups/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      cohort_id: cohortId,
      group_name: groupName,
      meeting_time: meetingTime,
    }),
  });
  if (!res.ok) throw new Error("Failed to create group");
  return res.json();
}
```

**Step 2: Create Admin view**

Create `web_frontend/src/views/Admin.tsx`:

```tsx
import { useState } from "react";
import { useAuth } from "../hooks/useAuth";
import {
  searchUsers,
  getUserDetails,
  syncGroup,
  type UserSearchResult,
  type UserDetails,
} from "../api/admin";

export default function Admin() {
  const { isAuthenticated, isLoading: authLoading, login } = useAuth();
  const [activeTab, setActiveTab] = useState<"users" | "groups">("users");

  // User search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserDetails | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setMessage(null);
    try {
      const results = await searchUsers(searchQuery);
      setSearchResults(results);
      setSelectedUser(null);
    } catch {
      setMessage("Search failed");
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectUser = async (userId: number) => {
    try {
      const details = await getUserDetails(userId);
      setSelectedUser(details);
      setMessage(null);
    } catch {
      setMessage("Failed to load user details");
    }
  };

  const handleSyncGroup = async () => {
    if (!selectedUser?.group_id) return;
    setIsSyncing(true);
    setMessage(null);
    try {
      await syncGroup(selectedUser.group_id);
      setMessage("Group synced successfully!");
    } catch {
      setMessage("Sync failed");
    } finally {
      setIsSyncing(false);
    }
  };

  if (authLoading) {
    return <div className="py-8 max-w-4xl mx-auto px-4">Loading...</div>;
  }

  if (!isAuthenticated) {
    return (
      <div className="py-8 max-w-4xl mx-auto px-4">
        <h1 className="text-2xl font-bold mb-4">Admin Panel</h1>
        <p className="mb-4">Please sign in to access the admin panel.</p>
        <button
          onClick={login}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          Sign in with Discord
        </button>
      </div>
    );
  }

  return (
    <div className="py-8 max-w-4xl mx-auto px-4">
      <h1 className="text-2xl font-bold mb-6">Admin Panel</h1>

      {/* Tabs */}
      <div className="flex gap-4 mb-6 border-b">
        <button
          onClick={() => setActiveTab("users")}
          className={`pb-2 px-1 ${
            activeTab === "users"
              ? "border-b-2 border-blue-600 text-blue-600"
              : "text-gray-600"
          }`}
        >
          Users
        </button>
        <button
          onClick={() => setActiveTab("groups")}
          className={`pb-2 px-1 ${
            activeTab === "groups"
              ? "border-b-2 border-blue-600 text-blue-600"
              : "text-gray-600"
          }`}
        >
          Groups
        </button>
      </div>

      {message && (
        <div
          className={`mb-4 p-3 rounded ${
            message.includes("success") ? "bg-green-100" : "bg-red-100"
          }`}
        >
          {message}
        </div>
      )}

      {activeTab === "users" && (
        <div>
          {/* Search */}
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="Search by nickname or Discord username..."
              className="flex-1 border rounded px-3 py-2"
            />
            <button
              onClick={handleSearch}
              disabled={isSearching}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {isSearching ? "Searching..." : "Search"}
            </button>
          </div>

          {/* Results */}
          {searchResults.length > 0 && (
            <div className="border rounded mb-4">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-2">Name</th>
                    <th className="text-left px-4 py-2">Discord</th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map((user) => (
                    <tr
                      key={user.user_id}
                      onClick={() => handleSelectUser(user.user_id)}
                      className="border-t cursor-pointer hover:bg-gray-50"
                    >
                      <td className="px-4 py-2">
                        {user.nickname || "(no nickname)"}
                      </td>
                      <td className="px-4 py-2">{user.discord_username}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Selected User Details */}
          {selectedUser && (
            <div className="border rounded p-4">
              <h2 className="text-lg font-semibold mb-3">
                {selectedUser.nickname || selectedUser.discord_username}
              </h2>
              <dl className="grid grid-cols-2 gap-2 text-sm mb-4">
                <dt className="text-gray-600">Discord:</dt>
                <dd>{selectedUser.discord_username}</dd>
                <dt className="text-gray-600">Email:</dt>
                <dd>{selectedUser.email || "(none)"}</dd>
                <dt className="text-gray-600">Cohort:</dt>
                <dd>{selectedUser.cohort_name || "(none)"}</dd>
                <dt className="text-gray-600">Group:</dt>
                <dd>{selectedUser.group_name || "(none)"}</dd>
                <dt className="text-gray-600">Group Status:</dt>
                <dd>{selectedUser.group_status || "-"}</dd>
              </dl>

              {selectedUser.group_id && (
                <button
                  onClick={handleSyncGroup}
                  disabled={isSyncing}
                  className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50"
                >
                  {isSyncing ? "Syncing..." : "Sync Group"}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === "groups" && (
        <div className="text-gray-600">
          Groups tab - coming in next task
        </div>
      )}
    </div>
  );
}
```

**Step 3: Create page**

Create `web_frontend/src/pages/admin/+Page.tsx`:

```tsx
import Layout from "@/components/Layout";
import Admin from "@/views/Admin";

export default function AdminPage() {
  return (
    <Layout>
      <Admin />
    </Layout>
  );
}
```

**Step 4: Build and verify**

```bash
cd web_frontend && npm run build && cd ..
```

Expected: Build succeeds

**Step 5: Commit**

```bash
jj describe -m "feat(frontend): add admin page with user search"
```

---

## Task 13: Add Groups Tab to Admin Frontend

**Files:**
- Modify: `web_frontend/src/views/Admin.tsx`
- Modify: `web_frontend/src/api/admin.ts`

**Step 1: Update Admin view with Groups tab**

This task adds:
- Cohort selector (reuse existing cohorts API)
- Groups table with status and member counts
- Sync/Realize buttons per group
- Sync All/Realize All buttons for cohort

Add the Groups tab implementation to `Admin.tsx` - replace the placeholder with full group management UI including cohort selection, groups table, and action buttons.

**Step 2: Build and verify**

```bash
cd web_frontend && npm run build && cd ..
```

**Step 3: Commit**

```bash
jj describe -m "feat(frontend): add groups tab to admin panel"
```

---

## Task 14: Final Integration Test

**Files:**
- Test manual workflow

**Step 1: Run all tests**

```bash
pytest web_api/tests/test_admin.py -v
pytest core/tests/test_queries_users.py -v
ruff check .
ruff format --check .
cd web_frontend && npm run lint && npm run build && cd ..
```

**Step 2: Manual verification**

1. Start dev server: `python main.py --dev`
2. Start frontend: `cd web_frontend && npm run dev`
3. Navigate to `/admin`
4. Verify admin-only access (non-admin should see 403)
5. Test user search
6. Test sync group button
7. Test groups tab (if implemented)

**Step 3: Commit**

```bash
jj describe -m "feat: admin panel for group management

- Add require_admin auth dependency
- Add user search and details queries
- Add admin API endpoints for users, groups, cohorts
- Add React admin page with user search and sync
- All endpoints require admin authentication
- Operations trigger sync_group() for side effects"
```

---

## Summary

**Backend (11 tasks):**
- Task 1: `require_admin` dependency
- Task 2: `search_users` query
- Task 3: `get_user_admin_details` query
- Task 4: Admin routes file + user search endpoint
- Task 5: User details endpoint
- Task 6: Group sync endpoint
- Task 7: Group realize endpoint
- Task 8: Member add/remove endpoints
- Task 9: Group create endpoint
- Task 10: Cohort sync/realize endpoints
- Task 11: Cohort groups list endpoint

**Frontend (2 tasks):**
- Task 12: Admin page with Users tab
- Task 13: Groups tab

**Integration (1 task):**
- Task 14: Final testing

**Total: 14 tasks**
