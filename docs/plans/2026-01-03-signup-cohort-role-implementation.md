# Signup Cohort & Role Selection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add cohort and role selection to signup wizard, allowing users to enroll as participant or facilitator.

**Architecture:** New Step 2 (Cohort/Role) inserted between Personal Info and Availability. Backend adds 3 new endpoints via core functions. Frontend fetches cohorts and facilitator status after auth, enrolls on final submit.

**Tech Stack:** FastAPI, SQLAlchemy Core, React, TypeScript

---

## Task 1: Core Query - Get Available Cohorts

**Files:**
- Modify: `core/queries/cohorts.py`
- Test: `discord_bot/tests/test_cohort_queries.py` (create)

**Step 1: Write the failing test**

Create `discord_bot/tests/test_cohort_queries.py`:

```python
"""Tests for cohort query functions."""

import pytest
from datetime import date, timedelta

from sqlalchemy import insert

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.tables import courses, cohorts, courses_users, users
from core.queries.cohorts import get_available_cohorts
from core.enums import CohortRole, GroupingStatus


class TestGetAvailableCohorts:
    """Tests for get_available_cohorts query."""

    @pytest.mark.asyncio
    async def test_returns_future_cohorts(self, db_conn):
        """Should return cohorts with start_date > today."""
        # Create course
        course_result = await db_conn.execute(
            insert(courses).values(course_name="Test Course").returning(courses)
        )
        course = dict(course_result.mappings().first())

        # Create future cohort
        future_date = date.today() + timedelta(days=30)
        cohort_result = await db_conn.execute(
            insert(cohorts).values(
                cohort_name="Future Cohort",
                course_id=course["course_id"],
                cohort_start_date=future_date,
                duration_days=56,
                number_of_group_meetings=8,
            ).returning(cohorts)
        )
        future_cohort = dict(cohort_result.mappings().first())

        # Create past cohort (should not appear)
        past_date = date.today() - timedelta(days=30)
        await db_conn.execute(
            insert(cohorts).values(
                cohort_name="Past Cohort",
                course_id=course["course_id"],
                cohort_start_date=past_date,
                duration_days=56,
                number_of_group_meetings=8,
            )
        )

        result = await get_available_cohorts(db_conn, user_id=None)

        assert len(result["available"]) == 1
        assert result["available"][0]["cohort_id"] == future_cohort["cohort_id"]
        assert result["available"][0]["cohort_name"] == "Future Cohort"
        assert result["enrolled"] == []

    @pytest.mark.asyncio
    async def test_shows_enrolled_cohorts_separately(self, db_conn):
        """Should separate enrolled cohorts from available ones."""
        # Create course and user
        course_result = await db_conn.execute(
            insert(courses).values(course_name="Test Course").returning(courses)
        )
        course = dict(course_result.mappings().first())

        user_result = await db_conn.execute(
            insert(users).values(
                discord_id="test_user_123",
                discord_username="testuser",
            ).returning(users)
        )
        user = dict(user_result.mappings().first())

        # Create two future cohorts
        future_date = date.today() + timedelta(days=30)
        cohort1_result = await db_conn.execute(
            insert(cohorts).values(
                cohort_name="Enrolled Cohort",
                course_id=course["course_id"],
                cohort_start_date=future_date,
                duration_days=56,
                number_of_group_meetings=8,
            ).returning(cohorts)
        )
        cohort1 = dict(cohort1_result.mappings().first())

        cohort2_result = await db_conn.execute(
            insert(cohorts).values(
                cohort_name="Available Cohort",
                course_id=course["course_id"],
                cohort_start_date=future_date + timedelta(days=30),
                duration_days=56,
                number_of_group_meetings=8,
            ).returning(cohorts)
        )
        cohort2 = dict(cohort2_result.mappings().first())

        # Enroll user in first cohort
        await db_conn.execute(
            insert(courses_users).values(
                user_id=user["user_id"],
                course_id=course["course_id"],
                cohort_id=cohort1["cohort_id"],
                role_in_cohort=CohortRole.participant,
                grouping_status=GroupingStatus.awaiting_grouping,
            )
        )

        result = await get_available_cohorts(db_conn, user_id=user["user_id"])

        assert len(result["enrolled"]) == 1
        assert result["enrolled"][0]["cohort_id"] == cohort1["cohort_id"]
        assert result["enrolled"][0]["role"] == "participant"

        assert len(result["available"]) == 1
        assert result["available"][0]["cohort_id"] == cohort2["cohort_id"]
```

**Step 2: Run test to verify it fails**

Run: `pytest discord_bot/tests/test_cohort_queries.py -v`
Expected: FAIL with "cannot import name 'get_available_cohorts'"

**Step 3: Write minimal implementation**

Add to `core/queries/cohorts.py`:

```python
async def get_available_cohorts(
    conn: AsyncConnection,
    user_id: int | None = None,
) -> dict[str, list[dict[str, Any]]]:
    """
    Get future cohorts, separated into enrolled and available.

    Args:
        conn: Database connection
        user_id: If provided, check enrollment status for this user

    Returns:
        {"enrolled": [...], "available": [...]}
    """
    from datetime import date

    today = date.today()

    # Get all future active cohorts
    query = (
        select(
            cohorts.c.cohort_id,
            cohorts.c.cohort_name,
            cohorts.c.cohort_start_date,
            courses.c.course_id,
            courses.c.course_name,
        )
        .join(courses, cohorts.c.course_id == courses.c.course_id)
        .where(cohorts.c.cohort_start_date > today)
        .where(cohorts.c.status == "active")
        .order_by(cohorts.c.cohort_start_date)
    )

    result = await conn.execute(query)
    all_cohorts = [dict(row) for row in result.mappings()]

    if not user_id:
        return {"enrolled": [], "available": all_cohorts}

    # Get user's enrollments
    enrollment_query = (
        select(
            courses_users.c.cohort_id,
            courses_users.c.role_in_cohort,
        )
        .where(courses_users.c.user_id == user_id)
    )
    enrollment_result = await conn.execute(enrollment_query)
    enrollments = {row["cohort_id"]: row["role_in_cohort"] for row in enrollment_result.mappings()}

    enrolled = []
    available = []

    for cohort in all_cohorts:
        if cohort["cohort_id"] in enrollments:
            cohort["role"] = enrollments[cohort["cohort_id"]].value
            enrolled.append(cohort)
        else:
            available.append(cohort)

    return {"enrolled": enrolled, "available": available}
```

**Step 4: Run test to verify it passes**

Run: `pytest discord_bot/tests/test_cohort_queries.py -v`
Expected: PASS

**Step 5: Commit**

```bash
jj describe -m "feat: add get_available_cohorts query"
```

---

## Task 2: Core Query - Check Facilitator Status

**Files:**
- Modify: `core/queries/users.py`
- Test: `discord_bot/tests/test_cohort_queries.py` (add to existing)

**Step 1: Write the failing test**

Add to `discord_bot/tests/test_cohort_queries.py`:

```python
from core.queries.users import is_facilitator


class TestIsFacilitator:
    """Tests for is_facilitator query."""

    @pytest.mark.asyncio
    async def test_returns_false_when_not_facilitator(self, db_conn):
        """Should return False for regular user."""
        user_result = await db_conn.execute(
            insert(users).values(
                discord_id="regular_user",
                discord_username="regular",
            ).returning(users)
        )
        user = dict(user_result.mappings().first())

        result = await is_facilitator(db_conn, user["user_id"])

        assert result is False

    @pytest.mark.asyncio
    async def test_returns_true_when_facilitator(self, db_conn):
        """Should return True for user in facilitators table."""
        from core.tables import facilitators

        user_result = await db_conn.execute(
            insert(users).values(
                discord_id="fac_user",
                discord_username="facilitator",
            ).returning(users)
        )
        user = dict(user_result.mappings().first())

        await db_conn.execute(
            insert(facilitators).values(user_id=user["user_id"])
        )

        result = await is_facilitator(db_conn, user["user_id"])

        assert result is True
```

**Step 2: Run test to verify it fails**

Run: `pytest discord_bot/tests/test_cohort_queries.py::TestIsFacilitator -v`
Expected: FAIL (function exists but may have wrong signature)

**Step 3: Write minimal implementation**

The function already exists in `core/queries/users.py` but takes `discord_id`. Add an overload that takes `user_id`:

```python
async def is_facilitator_by_user_id(
    conn: AsyncConnection,
    user_id: int,
) -> bool:
    """Check if a user is a facilitator by user_id."""
    result = await conn.execute(
        select(facilitators).where(facilitators.c.user_id == user_id)
    )
    return result.first() is not None
```

Update test to use `is_facilitator_by_user_id`.

**Step 4: Run test to verify it passes**

Run: `pytest discord_bot/tests/test_cohort_queries.py::TestIsFacilitator -v`
Expected: PASS

**Step 5: Commit**

```bash
jj describe -m "feat: add is_facilitator_by_user_id query"
```

---

## Task 3: Core Function - Become Facilitator

**Files:**
- Modify: `core/users.py`
- Test: `discord_bot/tests/test_cohort_queries.py` (add to existing)

**Step 1: Write the failing test**

Add to `discord_bot/tests/test_cohort_queries.py`:

```python
from core.users import become_facilitator


class TestBecomeFacilitator:
    """Tests for become_facilitator function."""

    @pytest.mark.asyncio
    async def test_adds_user_to_facilitators(self, db_conn):
        """Should add user to facilitators table."""
        from core.tables import facilitators
        from core.database import get_transaction

        user_result = await db_conn.execute(
            insert(users).values(
                discord_id="new_fac",
                discord_username="newfac",
            ).returning(users)
        )
        user = dict(user_result.mappings().first())

        # Commit so become_facilitator can see the user
        await db_conn.commit()

        result = await become_facilitator("new_fac")

        assert result is True

    @pytest.mark.asyncio
    async def test_returns_true_if_already_facilitator(self, db_conn):
        """Should return True even if already a facilitator."""
        from core.tables import facilitators

        user_result = await db_conn.execute(
            insert(users).values(
                discord_id="existing_fac",
                discord_username="existingfac",
            ).returning(users)
        )
        user = dict(user_result.mappings().first())

        await db_conn.execute(
            insert(facilitators).values(user_id=user["user_id"])
        )
        await db_conn.commit()

        result = await become_facilitator("existing_fac")

        assert result is True
```

**Step 2: Run test to verify it fails**

Run: `pytest discord_bot/tests/test_cohort_queries.py::TestBecomeFacilitator -v`
Expected: FAIL with "cannot import name 'become_facilitator'"

**Step 3: Write minimal implementation**

Add to `core/users.py`:

```python
async def become_facilitator(discord_id: str) -> bool:
    """
    Add a user to the facilitators table.

    Returns True if successful or already a facilitator.
    Returns False if user doesn't exist.
    """
    async with get_transaction() as conn:
        from .queries.users import get_user_by_discord_id, is_facilitator_by_user_id
        from .tables import facilitators
        from sqlalchemy import insert

        user = await get_user_by_discord_id(conn, discord_id)
        if not user:
            return False

        # Check if already a facilitator
        if await is_facilitator_by_user_id(conn, user["user_id"]):
            return True

        # Add to facilitators table
        await conn.execute(
            insert(facilitators).values(user_id=user["user_id"])
        )
        return True
```

Export in `core/__init__.py`:
```python
from .users import (
    ..., become_facilitator,
)
```

**Step 4: Run test to verify it passes**

Run: `pytest discord_bot/tests/test_cohort_queries.py::TestBecomeFacilitator -v`
Expected: PASS

**Step 5: Commit**

```bash
jj describe -m "feat: add become_facilitator function"
```

---

## Task 4: Core Function - Enroll in Cohort

**Files:**
- Modify: `core/users.py`
- Test: `discord_bot/tests/test_cohort_queries.py` (add to existing)

**Step 1: Write the failing test**

Add to `discord_bot/tests/test_cohort_queries.py`:

```python
from core.users import enroll_in_cohort


class TestEnrollInCohort:
    """Tests for enroll_in_cohort function."""

    @pytest.mark.asyncio
    async def test_creates_enrollment_record(self, db_conn):
        """Should create courses_users record."""
        # Setup
        course_result = await db_conn.execute(
            insert(courses).values(course_name="Test Course").returning(courses)
        )
        course = dict(course_result.mappings().first())

        cohort_result = await db_conn.execute(
            insert(cohorts).values(
                cohort_name="Test Cohort",
                course_id=course["course_id"],
                cohort_start_date=date.today() + timedelta(days=30),
                duration_days=56,
                number_of_group_meetings=8,
            ).returning(cohorts)
        )
        cohort = dict(cohort_result.mappings().first())

        user_result = await db_conn.execute(
            insert(users).values(
                discord_id="enroll_user",
                discord_username="enrolluser",
            ).returning(users)
        )
        await db_conn.commit()

        # Act
        result = await enroll_in_cohort("enroll_user", cohort["cohort_id"], "participant")

        # Assert
        assert result is not None
        assert result["cohort_id"] == cohort["cohort_id"]
        assert result["role_in_cohort"] == "participant"
        assert result["grouping_status"] == "awaiting_grouping"

    @pytest.mark.asyncio
    async def test_returns_none_for_invalid_cohort(self, db_conn):
        """Should return None if cohort doesn't exist."""
        user_result = await db_conn.execute(
            insert(users).values(
                discord_id="bad_cohort_user",
                discord_username="badcohort",
            ).returning(users)
        )
        await db_conn.commit()

        result = await enroll_in_cohort("bad_cohort_user", 99999, "participant")

        assert result is None
```

**Step 2: Run test to verify it fails**

Run: `pytest discord_bot/tests/test_cohort_queries.py::TestEnrollInCohort -v`
Expected: FAIL with "cannot import name 'enroll_in_cohort'"

**Step 3: Write minimal implementation**

Add to `core/users.py`:

```python
async def enroll_in_cohort(
    discord_id: str,
    cohort_id: int,
    role_in_cohort: str,
) -> dict | None:
    """
    Enroll a user in a cohort.

    Args:
        discord_id: User's Discord ID
        cohort_id: Cohort to enroll in
        role_in_cohort: "participant" or "facilitator"

    Returns:
        The created enrollment record, or None if user/cohort not found.
    """
    async with get_transaction() as conn:
        from .queries.users import get_user_by_discord_id
        from .queries.cohorts import get_cohort_by_id
        from .tables import courses_users
        from .enums import CohortRole, GroupingStatus
        from sqlalchemy import insert

        user = await get_user_by_discord_id(conn, discord_id)
        if not user:
            return None

        cohort = await get_cohort_by_id(conn, cohort_id)
        if not cohort:
            return None

        role_enum = CohortRole.facilitator if role_in_cohort == "facilitator" else CohortRole.participant

        result = await conn.execute(
            insert(courses_users)
            .values(
                user_id=user["user_id"],
                course_id=cohort["course_id"],
                cohort_id=cohort_id,
                role_in_cohort=role_enum,
                grouping_status=GroupingStatus.awaiting_grouping,
            )
            .returning(courses_users)
        )
        row = result.mappings().first()
        enrollment = dict(row)
        # Convert enums to strings for JSON serialization
        enrollment["role_in_cohort"] = enrollment["role_in_cohort"].value
        enrollment["grouping_status"] = enrollment["grouping_status"].value
        return enrollment
```

Export in `core/__init__.py`.

**Step 4: Run test to verify it passes**

Run: `pytest discord_bot/tests/test_cohort_queries.py::TestEnrollInCohort -v`
Expected: PASS

**Step 5: Commit**

```bash
jj describe -m "feat: add enroll_in_cohort function"
```

---

## Task 5: API Endpoint - Get Available Cohorts

**Files:**
- Create: `web_api/routes/cohorts.py`
- Modify: `main.py` (register router)

**Step 1: Create the endpoint**

Create `web_api/routes/cohorts.py`:

```python
"""
Cohort routes.

Endpoints:
- GET /api/cohorts/available - Get cohorts available for enrollment
"""

import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.database import get_connection
from core.queries.cohorts import get_available_cohorts
from core.queries.users import get_user_by_discord_id
from web_api.auth import get_current_user

router = APIRouter(prefix="/api/cohorts", tags=["cohorts"])


@router.get("/available")
async def get_available(
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Get cohorts available for enrollment.

    Returns enrolled cohorts (read-only) and available cohorts (can enroll).
    """
    discord_id = user["sub"]

    async with get_connection() as conn:
        db_user = await get_user_by_discord_id(conn, discord_id)
        user_id = db_user["user_id"] if db_user else None
        return await get_available_cohorts(conn, user_id)
```

**Step 2: Register the router**

Add to `main.py` imports:
```python
from web_api.routes.cohorts import router as cohorts_router
```

Add to router registration:
```python
app.include_router(cohorts_router)
```

**Step 3: Test manually**

Start server: `python main.py --dev --no-bot`
Test: `curl -H "Cookie: ..." http://localhost:8000/api/cohorts/available`

**Step 4: Commit**

```bash
jj describe -m "feat: add GET /api/cohorts/available endpoint"
```

---

## Task 6: API Endpoints - Facilitator Status & Become Facilitator

**Files:**
- Modify: `web_api/routes/users.py`

**Step 1: Add facilitator status endpoint**

Add to `web_api/routes/users.py`:

```python
from core.database import get_connection
from core.queries.users import get_user_by_discord_id, is_facilitator_by_user_id
from core import become_facilitator as core_become_facilitator


@router.get("/me/facilitator-status")
async def get_facilitator_status(
    user: dict = Depends(get_current_user),
) -> dict[str, bool]:
    """Check if current user is a facilitator."""
    discord_id = user["sub"]

    async with get_connection() as conn:
        db_user = await get_user_by_discord_id(conn, discord_id)
        if not db_user:
            return {"is_facilitator": False}
        is_fac = await is_facilitator_by_user_id(conn, db_user["user_id"])
        return {"is_facilitator": is_fac}


@router.post("/me/become-facilitator")
async def become_facilitator(
    user: dict = Depends(get_current_user),
) -> dict[str, bool]:
    """Add current user to facilitators table."""
    discord_id = user["sub"]
    success = await core_become_facilitator(discord_id)
    return {"success": success}
```

**Step 2: Test manually**

```bash
curl -H "Cookie: ..." http://localhost:8000/api/users/me/facilitator-status
curl -X POST -H "Cookie: ..." http://localhost:8000/api/users/me/become-facilitator
```

**Step 3: Commit**

```bash
jj describe -m "feat: add facilitator status and become-facilitator endpoints"
```

---

## Task 7: Update PATCH /api/users/me for Enrollment

**Files:**
- Modify: `web_api/routes/users.py`

**Step 1: Update schema and endpoint**

Update `UserProfileUpdate` class:
```python
class UserProfileUpdate(BaseModel):
    """Schema for updating user profile."""

    nickname: str | None = None
    email: str | None = None
    timezone: str | None = None
    availability_local: str | None = None
    cohort_id: int | None = None
    role_in_cohort: str | None = None
```

Update `update_my_profile` function:
```python
from core import enroll_in_cohort

@router.patch("/me")
async def update_my_profile(
    updates: UserProfileUpdate,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Update the current user's profile.

    Optionally enroll in a cohort if cohort_id and role_in_cohort provided.
    """
    discord_id = user["sub"]

    # Update profile via core function
    updated_user = await update_user_profile(
        discord_id,
        nickname=updates.nickname,
        email=updates.email,
        timezone_str=updates.timezone,
        availability_local=updates.availability_local,
    )

    if not updated_user:
        raise HTTPException(404, "User not found")

    # Sync nickname to Discord if it was updated
    if updates.nickname is not None:
        await update_nickname_in_discord(discord_id, updates.nickname)

    # Enroll in cohort if provided
    enrollment = None
    if updates.cohort_id is not None and updates.role_in_cohort is not None:
        enrollment = await enroll_in_cohort(
            discord_id,
            updates.cohort_id,
            updates.role_in_cohort,
        )

    return {
        "status": "updated",
        "user": updated_user,
        "enrollment": enrollment,
    }
```

**Step 2: Commit**

```bash
jj describe -m "feat: add cohort enrollment to PATCH /api/users/me"
```

---

## Task 8: Frontend - Cohort Role Step Component

**Files:**
- Create: `web_frontend/src/components/signup/CohortRoleStep.tsx`

**Step 1: Create the component**

```tsx
import { useState } from "react";

interface Cohort {
  cohort_id: number;
  cohort_name: string;
  cohort_start_date: string;
  course_name: string;
  role?: string;
}

interface CohortRoleStepProps {
  enrolledCohorts: Cohort[];
  availableCohorts: Cohort[];
  selectedCohortId: number | null;
  selectedRole: string | null;
  isFacilitator: boolean;
  onCohortSelect: (cohortId: number) => void;
  onRoleSelect: (role: string) => void;
  onBecomeFacilitator: () => Promise<void>;
  onNext: () => void;
  onBack: () => void;
}

export default function CohortRoleStep({
  enrolledCohorts,
  availableCohorts,
  selectedCohortId,
  selectedRole,
  isFacilitator,
  onCohortSelect,
  onRoleSelect,
  onBecomeFacilitator,
  onNext,
  onBack,
}: CohortRoleStepProps) {
  const [showFacilitatorModal, setShowFacilitatorModal] = useState(false);
  const [isBecoming, setIsBecoming] = useState(false);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };

  const handleBecomeFacilitator = async () => {
    setIsBecoming(true);
    try {
      await onBecomeFacilitator();
      setShowFacilitatorModal(false);
    } finally {
      setIsBecoming(false);
    }
  };

  const canProceed = selectedCohortId !== null && selectedRole !== null;

  return (
    <div className="max-w-md mx-auto">
      <h2 className="text-2xl font-bold text-gray-900 mb-2">
        Choose Your Cohort
      </h2>
      <p className="text-gray-600 mb-8">
        Select which cohort you'd like to join.
      </p>

      {/* Already enrolled cohorts */}
      {enrolledCohorts.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-gray-700 mb-2">
            You're signed up for:
          </h3>
          <ul className="space-y-2">
            {enrolledCohorts.map((cohort) => (
              <li
                key={cohort.cohort_id}
                className="flex items-center gap-2 text-sm text-gray-600 bg-gray-50 px-3 py-2 rounded-lg"
              >
                <span className="text-green-600">✓</span>
                <span>
                  {cohort.cohort_name} (as {cohort.role}) — starts{" "}
                  {formatDate(cohort.cohort_start_date)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Available cohorts dropdown */}
      {availableCohorts.length > 0 ? (
        <div className="mb-6">
          <label
            htmlFor="cohort"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Enroll in a new cohort
          </label>
          <select
            id="cohort"
            value={selectedCohortId ?? ""}
            onChange={(e) => onCohortSelect(Number(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          >
            <option value="">Select a cohort...</option>
            {availableCohorts.map((cohort) => (
              <option key={cohort.cohort_id} value={cohort.cohort_id}>
                {cohort.cohort_name} — starts {formatDate(cohort.cohort_start_date)}
              </option>
            ))}
          </select>
        </div>
      ) : enrolledCohorts.length > 0 ? (
        <p className="text-gray-600 mb-6">
          You're enrolled in all available cohorts.
        </p>
      ) : (
        <p className="text-gray-600 mb-6">
          No cohorts are currently available for signup.
        </p>
      )}

      {/* Role selection - only show when cohort selected */}
      {selectedCohortId && (
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Your role
          </label>

          {isFacilitator ? (
            <div className="space-y-2">
              <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="role"
                  value="facilitator"
                  checked={selectedRole === "facilitator"}
                  onChange={() => onRoleSelect("facilitator")}
                  className="w-4 h-4 text-blue-600"
                />
                <span>Facilitator</span>
              </label>
              <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="role"
                  value="participant"
                  checked={selectedRole === "participant"}
                  onChange={() => onRoleSelect("participant")}
                  className="w-4 h-4 text-blue-600"
                />
                <span>Participant</span>
              </label>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-3 p-3 border rounded-lg bg-gray-50">
                <input
                  type="radio"
                  checked
                  readOnly
                  className="w-4 h-4 text-blue-600"
                />
                <span>Participant</span>
              </div>
              <button
                type="button"
                onClick={() => setShowFacilitatorModal(true)}
                className="mt-3 text-sm text-blue-600 hover:text-blue-800 underline"
              >
                Become a facilitator
              </button>
            </div>
          )}
        </div>
      )}

      {/* Navigation */}
      <div className="flex gap-3 mt-8">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 px-4 py-3 font-medium rounded-lg border border-gray-300 hover:bg-gray-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!canProceed}
          className={`flex-1 px-4 py-3 font-medium rounded-lg transition-colors ${
            canProceed
              ? "bg-blue-500 hover:bg-blue-600 text-white"
              : "bg-gray-200 text-gray-400 cursor-not-allowed"
          }`}
        >
          Continue to Availability
        </button>
      </div>

      {/* Facilitator confirmation modal */}
      {showFacilitatorModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-sm mx-4">
            <h3 className="text-lg font-bold text-gray-900 mb-3">
              Become a Facilitator
            </h3>
            <p className="text-gray-600 mb-6">
              Facilitators lead weekly group discussions and help participants
              engage with the material. You'll be matched with a group based on
              your availability.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowFacilitatorModal(false)}
                disabled={isBecoming}
                className="flex-1 px-4 py-2 font-medium rounded-lg border border-gray-300 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBecomeFacilitator}
                disabled={isBecoming}
                className="flex-1 px-4 py-2 font-medium rounded-lg bg-blue-500 hover:bg-blue-600 text-white"
              >
                {isBecoming ? "..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
jj describe -m "feat: add CohortRoleStep component"
```

---

## Task 9: Frontend - Update SignupWizard

**Files:**
- Modify: `web_frontend/src/components/signup/SignupWizard.tsx`
- Modify: `web_frontend/src/types/signup.ts`

**Step 1: Update types**

Add to `web_frontend/src/types/signup.ts`:

```typescript
export interface Cohort {
  cohort_id: number;
  cohort_name: string;
  cohort_start_date: string;
  course_name: string;
  role?: string;
}

export interface SignupFormData {
  displayName: string;
  email: string;
  discordConnected: boolean;
  discordUsername?: string;
  availability: AvailabilityData;
  timezone: string;
  selectedCohortId: number | null;
  selectedRole: string | null;
}
```

**Step 2: Update SignupWizard**

Update `web_frontend/src/components/signup/SignupWizard.tsx`:

```tsx
import { useState, useEffect } from "react";
import type { SignupFormData, Cohort } from "../../types/signup";
import { EMPTY_AVAILABILITY, getBrowserTimezone } from "../../types/signup";
import PersonalInfoStep from "./PersonalInfoStep";
import CohortRoleStep from "./CohortRoleStep";
import AvailabilityStep from "./AvailabilityStep";
import SuccessMessage from "./SuccessMessage";
import { useAuth } from "../../hooks/useAuth";

type Step = 1 | 2 | 3 | "complete";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function SignupWizard() {
  const { isAuthenticated, isLoading, user, discordUsername, login } =
    useAuth();

  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [formData, setFormData] = useState<SignupFormData>({
    displayName: "",
    email: "",
    discordConnected: false,
    discordUsername: undefined,
    availability: { ...EMPTY_AVAILABILITY },
    timezone: getBrowserTimezone(),
    selectedCohortId: null,
    selectedRole: null,
  });
  const [_isSubmitting, setIsSubmitting] = useState(false);

  // Cohort data
  const [enrolledCohorts, setEnrolledCohorts] = useState<Cohort[]>([]);
  const [availableCohorts, setAvailableCohorts] = useState<Cohort[]>([]);
  const [isFacilitator, setIsFacilitator] = useState(false);

  // Sync auth state with form data
  useEffect(() => {
    if (isAuthenticated && discordUsername) {
      setFormData((prev) => {
        let availability = prev.availability;
        let timezone = prev.timezone;

        if (user?.availability_local) {
          try {
            availability = JSON.parse(user.availability_local);
          } catch {
            // Keep existing
          }
        }
        if (user?.timezone) {
          timezone = user.timezone;
        }

        return {
          ...prev,
          discordConnected: true,
          discordUsername: discordUsername,
          displayName: user?.nickname || discordUsername || prev.displayName,
          email: user?.email || prev.email,
          availability,
          timezone,
        };
      });

      // Fetch cohorts and facilitator status
      fetchCohortData();
      fetchFacilitatorStatus();
    }
  }, [isAuthenticated, discordUsername, user]);

  const fetchCohortData = async () => {
    try {
      const response = await fetch(`${API_URL}/api/cohorts/available`, {
        credentials: "include",
      });
      if (response.ok) {
        const data = await response.json();
        setEnrolledCohorts(data.enrolled);
        setAvailableCohorts(data.available);
      }
    } catch (error) {
      console.error("Failed to fetch cohorts:", error);
    }
  };

  const fetchFacilitatorStatus = async () => {
    try {
      const response = await fetch(`${API_URL}/api/users/me/facilitator-status`, {
        credentials: "include",
      });
      if (response.ok) {
        const data = await response.json();
        setIsFacilitator(data.is_facilitator);
      }
    } catch (error) {
      console.error("Failed to fetch facilitator status:", error);
    }
  };

  const handleBecomeFacilitator = async () => {
    const response = await fetch(`${API_URL}/api/users/me/become-facilitator`, {
      method: "POST",
      credentials: "include",
    });
    if (response.ok) {
      setIsFacilitator(true);
      setFormData((prev) => ({ ...prev, selectedRole: "facilitator" }));
    }
  };

  const handleDiscordConnect = () => {
    login();
  };

  const handleSubmit = async () => {
    if (!isAuthenticated) {
      console.error("User not authenticated");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_URL}/api/users/me`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          nickname: formData.displayName || null,
          email: formData.email || null,
          timezone: formData.timezone,
          availability_local: JSON.stringify(formData.availability),
          cohort_id: formData.selectedCohortId,
          role_in_cohort: formData.selectedRole,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to update profile");
      }

      setCurrentStep("complete");
    } catch (error) {
      console.error("Failed to submit:", error);
      alert("Failed to save your profile. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (currentStep === "complete") {
    return <SuccessMessage />;
  }

  return (
    <div>
      {currentStep === 1 && (
        <PersonalInfoStep
          displayName={formData.displayName}
          email={formData.email}
          discordConnected={formData.discordConnected}
          discordUsername={formData.discordUsername}
          onDisplayNameChange={(value) =>
            setFormData((prev) => ({ ...prev, displayName: value }))
          }
          onEmailChange={(value) =>
            setFormData((prev) => ({ ...prev, email: value }))
          }
          onDiscordConnect={handleDiscordConnect}
          onNext={() => setCurrentStep(2)}
        />
      )}

      {currentStep === 2 && (
        <CohortRoleStep
          enrolledCohorts={enrolledCohorts}
          availableCohorts={availableCohorts}
          selectedCohortId={formData.selectedCohortId}
          selectedRole={formData.selectedRole ?? (isFacilitator ? null : "participant")}
          isFacilitator={isFacilitator}
          onCohortSelect={(id) =>
            setFormData((prev) => ({
              ...prev,
              selectedCohortId: id,
              selectedRole: isFacilitator ? null : "participant",
            }))
          }
          onRoleSelect={(role) =>
            setFormData((prev) => ({ ...prev, selectedRole: role }))
          }
          onBecomeFacilitator={handleBecomeFacilitator}
          onNext={() => setCurrentStep(3)}
          onBack={() => setCurrentStep(1)}
        />
      )}

      {currentStep === 3 && (
        <AvailabilityStep
          availability={formData.availability}
          onAvailabilityChange={(data) =>
            setFormData((prev) => ({ ...prev, availability: data }))
          }
          timezone={formData.timezone}
          onTimezoneChange={(tz) =>
            setFormData((prev) => ({ ...prev, timezone: tz }))
          }
          onBack={() => setCurrentStep(2)}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  );
}
```

**Step 3: Commit**

```bash
jj describe -m "feat: integrate cohort/role step into signup wizard"
```

---

## Task 10: Update PersonalInfoStep Button Text

**Files:**
- Modify: `web_frontend/src/components/signup/PersonalInfoStep.tsx`

**Step 1: Update button text**

Change line 113-114:
```tsx
        >
          Continue to Cohort Selection
        </button>
```

**Step 2: Commit**

```bash
jj describe -m "fix: update PersonalInfoStep button text"
```

---

## Task 11: Final Testing

**Step 1: Run all backend tests**

```bash
pytest discord_bot/tests/ -v
```

Expected: All tests pass

**Step 2: Manual E2E test**

1. Start server: `python main.py --dev --no-bot`
2. Open http://localhost:5173/signup
3. Connect Discord
4. Fill personal info, click Next
5. Verify cohort dropdown loads
6. Select cohort, verify role selector appears
7. If not facilitator, click "Become a facilitator", confirm modal
8. Verify role changes to facilitator options
9. Select role, click Next
10. Fill availability, submit
11. Check database: `courses_users` should have new record

**Step 3: Final commit**

```bash
jj describe -m "feat: complete signup cohort/role selection feature"
```
