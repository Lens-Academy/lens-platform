# Duplicate Signup Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent duplicate signups by adding a DB unique constraint, making enrollment idempotent with ON CONFLICT, and wiring up frontend submit guards.

**Architecture:** Three-layer fix: (1) Alembic migration adds UNIQUE(user_id, cohort_id) to signups table, (2) `enroll_in_cohort()` uses INSERT ON CONFLICT DO NOTHING + SELECT to return existing signup, (3) frontend wires up the already-declared `isSubmitting` state to disable buttons during submission.

**Tech Stack:** SQLAlchemy (postgresql dialect), Alembic, React/TypeScript, pytest

---

### Task 1: Add unique constraint to signups table schema

**Files:**
- Modify: `core/tables.py:187-209` (signups table definition)

**Step 1: Add UniqueConstraint to the signups table definition**

In `core/tables.py`, add a `UniqueConstraint` to the signups table. `UniqueConstraint` is already imported at line 15. Add it after the existing `Index` lines (after line 208):

```python
# In the signups Table definition, after the two Index lines:
    UniqueConstraint("user_id", "cohort_id", name="uq_signups_user_id_cohort_id"),
```

The full signups table should look like:

```python
signups = Table(
    "signups",
    metadata,
    Column("signup_id", Integer, primary_key=True, autoincrement=True),
    Column(
        "user_id",
        Integer,
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column(
        "cohort_id",
        Integer,
        ForeignKey("cohorts.cohort_id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("role", cohort_role_enum, nullable=False),
    Column("ungroupable_reason", ungroupable_reason_enum),
    Column("created_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Column("updated_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Index("idx_signups_user_id", "user_id"),
    Index("idx_signups_cohort_id", "cohort_id"),
    UniqueConstraint("user_id", "cohort_id", name="uq_signups_user_id_cohort_id"),
)
```

**Step 2: Generate Alembic migration**

Run:
```bash
.venv/bin/alembic revision --autogenerate -m "add unique constraint on signups user_id cohort_id"
```

**Step 3: Review the generated migration**

Open the new file in `alembic/versions/`. It should contain:

```python
def upgrade():
    op.create_unique_constraint("uq_signups_user_id_cohort_id", "signups", ["user_id", "cohort_id"])

def downgrade():
    op.drop_constraint("uq_signups_user_id_cohort_id", "signups", type_="unique")
```

If Alembic generated extra changes (it sometimes detects phantom diffs), remove them — only the unique constraint change should remain.

**Step 4: Run the migration**

Run:
```bash
.venv/bin/alembic upgrade head
```

Expected: Migration succeeds (user already cleaned up duplicate rows).

**Step 5: Commit**

```bash
jj describe -m "db: add unique constraint on signups(user_id, cohort_id)"
```

---

### Task 2: Write failing test for idempotent enrollment

**Files:**
- Create: `core/tests/test_enrollment.py`

**Step 1: Write test file**

Follow the established pattern from `core/tests/test_attendance.py` — mock `get_transaction`, test that double-enrollment returns the existing signup instead of creating a duplicate.

```python
"""Tests for cohort enrollment (idempotent signup)."""

import pytest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch, Mock

from core.enums import CohortRole


def _make_mapping_result(rows, rowcount=None):
    """Helper to create a mock result that supports .mappings().first()."""
    mock_result = Mock()
    mock_mappings = Mock()
    mock_mappings.first.return_value = rows[0] if rows else None
    mock_result.mappings.return_value = mock_mappings
    mock_result.rowcount = rowcount if rowcount is not None else len(rows)
    return mock_result


class TestEnrollInCohort:
    """Test enroll_in_cohort() idempotency."""

    @pytest.mark.asyncio
    async def test_returns_none_when_user_not_found(self):
        """Should return None if discord_id doesn't match a user."""
        mock_conn = AsyncMock()
        mock_conn.execute = AsyncMock(
            return_value=_make_mapping_result([])  # user lookup: no match
        )

        with patch("core.users.get_transaction") as mock_tx:
            mock_tx.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_tx.return_value.__aexit__ = AsyncMock()

            from core.users import enroll_in_cohort

            result = await enroll_in_cohort("unknown_user", 1, "participant")
            assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_when_cohort_not_found(self):
        """Should return None if cohort_id doesn't exist."""
        user_row = {"user_id": 42, "discord_id": "123"}
        mock_conn = AsyncMock()
        mock_conn.execute = AsyncMock(
            side_effect=[
                _make_mapping_result([user_row]),  # user lookup: found
                _make_mapping_result([]),  # cohort lookup: not found
            ]
        )

        with patch("core.users.get_transaction") as mock_tx:
            mock_tx.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_tx.return_value.__aexit__ = AsyncMock()

            from core.users import enroll_in_cohort

            result = await enroll_in_cohort("123", 999, "participant")
            assert result is None

    @pytest.mark.asyncio
    async def test_creates_new_signup(self):
        """Should create a signup and return it for a new enrollment."""
        user_row = {"user_id": 42, "discord_id": "123"}
        cohort_row = {"cohort_id": 1, "cohort_name": "Test"}
        signup_row = {
            "signup_id": 100,
            "user_id": 42,
            "cohort_id": 1,
            "role": CohortRole.participant,
            "ungroupable_reason": None,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
        }

        mock_conn = AsyncMock()
        mock_conn.execute = AsyncMock(
            side_effect=[
                _make_mapping_result([user_row]),  # user lookup
                _make_mapping_result([cohort_row]),  # cohort lookup
                _make_mapping_result([signup_row], rowcount=1),  # INSERT (new row)
            ]
        )

        with (
            patch("core.users.get_transaction") as mock_tx,
            patch("core.users._send_welcome_notification", new_callable=AsyncMock),
        ):
            mock_tx.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_tx.return_value.__aexit__ = AsyncMock()

            from core.users import enroll_in_cohort

            result = await enroll_in_cohort("123", 1, "participant")
            assert result is not None
            assert result["signup_id"] == 100
            assert result["role"] == "participant"

    @pytest.mark.asyncio
    async def test_duplicate_enrollment_returns_existing_signup(self):
        """Calling enroll_in_cohort twice for same user+cohort should return existing signup, not create duplicate."""
        user_row = {"user_id": 42, "discord_id": "123"}
        cohort_row = {"cohort_id": 1, "cohort_name": "Test"}
        existing_signup = {
            "signup_id": 100,
            "user_id": 42,
            "cohort_id": 1,
            "role": CohortRole.participant,
            "ungroupable_reason": None,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
        }

        mock_conn = AsyncMock()
        mock_conn.execute = AsyncMock(
            side_effect=[
                _make_mapping_result([user_row]),  # user lookup
                _make_mapping_result([cohort_row]),  # cohort lookup
                _make_mapping_result([], rowcount=0),  # INSERT ON CONFLICT DO NOTHING (conflict!)
                _make_mapping_result([existing_signup]),  # SELECT existing signup
            ]
        )

        with (
            patch("core.users.get_transaction") as mock_tx,
            patch("core.users._send_welcome_notification", new_callable=AsyncMock),
        ):
            mock_tx.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_tx.return_value.__aexit__ = AsyncMock()

            from core.users import enroll_in_cohort

            result = await enroll_in_cohort("123", 1, "participant")
            assert result is not None
            assert result["signup_id"] == 100
            assert result["role"] == "participant"

    @pytest.mark.asyncio
    async def test_does_not_send_welcome_on_duplicate(self):
        """Should NOT send welcome notification when signup already exists (duplicate)."""
        user_row = {"user_id": 42, "discord_id": "123"}
        cohort_row = {"cohort_id": 1, "cohort_name": "Test"}
        existing_signup = {
            "signup_id": 100,
            "user_id": 42,
            "cohort_id": 1,
            "role": CohortRole.participant,
            "ungroupable_reason": None,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
        }

        mock_conn = AsyncMock()
        mock_conn.execute = AsyncMock(
            side_effect=[
                _make_mapping_result([user_row]),
                _make_mapping_result([cohort_row]),
                _make_mapping_result([], rowcount=0),  # conflict
                _make_mapping_result([existing_signup]),  # existing row
            ]
        )

        with (
            patch("core.users.get_transaction") as mock_tx,
            patch(
                "core.users._send_welcome_notification", new_callable=AsyncMock
            ) as mock_notify,
        ):
            mock_tx.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_tx.return_value.__aexit__ = AsyncMock()

            from core.users import enroll_in_cohort

            await enroll_in_cohort("123", 1, "participant")
            mock_notify.assert_not_called()
```

**Step 2: Run tests to verify they fail**

Run:
```bash
.venv/bin/pytest core/tests/test_enrollment.py -v
```

Expected: `test_duplicate_enrollment_returns_existing_signup` and `test_does_not_send_welcome_on_duplicate` FAIL (current code does a plain INSERT with no ON CONFLICT logic, and always sends welcome notification).

`test_creates_new_signup` may also fail since the mock expects 3 sequential calls but the current INSERT uses `.returning()` which is a different pattern. That's fine — all tests should pass after implementation.

**Step 3: Commit the failing tests**

```bash
jj new -m "test: add failing tests for idempotent enrollment"
```

---

### Task 3: Make enroll_in_cohort idempotent

**Files:**
- Modify: `core/users.py:206-257` (enroll_in_cohort function)

**Step 1: Implement ON CONFLICT DO NOTHING + SELECT fallback**

Replace the `enroll_in_cohort` function (lines 206-257) with:

```python
async def enroll_in_cohort(
    discord_id: str,
    cohort_id: int,
    role: str,
) -> dict[str, Any] | None:
    """
    Enroll a user in a cohort by creating a signup.

    Idempotent: if the user is already enrolled, returns the existing signup
    without creating a duplicate or sending a welcome notification.

    Args:
        discord_id: User's Discord ID
        cohort_id: Cohort to enroll in
        role: "participant" or "facilitator"

    Returns:
        The signup record (with enums converted to strings), or None if user/cohort not found.
    """
    from .queries.cohorts import get_cohort_by_id
    from .tables import signups
    from .enums import CohortRole
    from sqlalchemy import select
    from sqlalchemy.dialects.postgresql import insert

    async with get_transaction() as conn:
        user = await user_queries.get_user_by_discord_id(conn, discord_id)
        if not user:
            return None

        cohort = await get_cohort_by_id(conn, cohort_id)
        if not cohort:
            return None

        role_enum = (
            CohortRole.facilitator if role == "facilitator" else CohortRole.participant
        )

        # INSERT ON CONFLICT DO NOTHING — if signup exists, rowcount=0
        stmt = insert(signups).values(
            user_id=user["user_id"],
            cohort_id=cohort_id,
            role=role_enum,
        )
        stmt = stmt.on_conflict_do_nothing(
            constraint="uq_signups_user_id_cohort_id",
        )
        result = await conn.execute(stmt)

        is_new = result.rowcount > 0

        # Fetch the signup (whether just inserted or already existing)
        select_stmt = select(signups).where(
            signups.c.user_id == user["user_id"],
            signups.c.cohort_id == cohort_id,
        )
        row = (await conn.execute(select_stmt)).mappings().first()
        signup = dict(row)
        # Convert enums to strings for JSON serialization
        signup["role"] = signup["role"].value
        if signup.get("ungroupable_reason"):
            signup["ungroupable_reason"] = signup["ungroupable_reason"].value

    # Only send welcome notification for genuinely new signups
    if is_new:
        asyncio.create_task(_send_welcome_notification(user["user_id"]))

    return signup
```

Key changes from the original:
1. Import `insert` from `sqlalchemy.dialects.postgresql` (not generic `sqlalchemy`) — enables `.on_conflict_do_nothing()`
2. Import `select` from `sqlalchemy` for the fallback query
3. Use `on_conflict_do_nothing(constraint="uq_signups_user_id_cohort_id")`
4. Check `result.rowcount` to determine if this is a new signup
5. Always SELECT the row (handles both new and existing cases)
6. Only fire welcome notification for new signups

**Step 2: Run tests to verify they pass**

Run:
```bash
.venv/bin/pytest core/tests/test_enrollment.py -v
```

Expected: All 5 tests PASS.

**Step 3: Run full core test suite**

Run:
```bash
.venv/bin/pytest core/tests/ -v
```

Expected: No regressions.

**Step 4: Commit**

```bash
jj new -m "fix: make enroll_in_cohort idempotent with ON CONFLICT DO NOTHING"
```

---

### Task 4: Wire up isSubmitting in EnrollWizard

**Files:**
- Modify: `web_frontend/src/components/enroll/EnrollWizard.tsx:38` (destructure isSubmitting)
- Modify: `web_frontend/src/components/enroll/EnrollWizard.tsx:268-293` (pass isSubmitting to GroupSelectionStep)
- Modify: `web_frontend/src/components/enroll/EnrollWizard.tsx:295-311` (pass isSubmitting to AvailabilityStep)

**Step 1: Destructure isSubmitting from useState**

Change line 38 from:

```tsx
const [, setIsSubmitting] = useState(false);
```

to:

```tsx
const [isSubmitting, setIsSubmitting] = useState(false);
```

Also remove the comment on line 37 (`// Submission state tracked for future UI improvements...`) since we're now using it.

**Step 2: Pass isSubmitting to GroupSelectionStep**

In the `GroupSelectionStep` JSX (around line 268-293), add the `isSubmitting` prop. Change:

```tsx
          <GroupSelectionStep
            cohortId={formData.selectedCohortId!}
            timezone={formData.timezone}
```

to:

```tsx
          <GroupSelectionStep
            cohortId={formData.selectedCohortId!}
            isSubmitting={isSubmitting}
            timezone={formData.timezone}
```

**Step 3: Pass isSubmitting to AvailabilityStep**

In the `AvailabilityStep` JSX (around line 295-311), add the `isSubmitting` prop. Change:

```tsx
          <AvailabilityStep
            availability={formData.availability}
```

to:

```tsx
          <AvailabilityStep
            isSubmitting={isSubmitting}
            availability={formData.availability}
```

**Step 4: Run lint and build**

Run:
```bash
cd web_frontend && npm run lint && npm run build
```

Expected: Build fails because AvailabilityStep doesn't accept `isSubmitting` prop yet. That's expected — we fix it in the next task.

**Step 5: Commit (WIP)**

```bash
jj new -m "fix: wire up isSubmitting state in EnrollWizard and pass to step components"
```

---

### Task 5: Add isSubmitting prop to AvailabilityStep

**Files:**
- Modify: `web_frontend/src/components/enroll/AvailabilityStep.tsx:5-13` (interface)
- Modify: `web_frontend/src/components/enroll/AvailabilityStep.tsx:15-23` (destructure)
- Modify: `web_frontend/src/components/enroll/AvailabilityStep.tsx:111` (disabled condition)
- Modify: `web_frontend/src/components/enroll/AvailabilityStep.tsx:112-116` (className condition)

**Step 1: Add isSubmitting to the interface**

Change the `AvailabilityStepProps` interface (lines 5-13) from:

```tsx
interface AvailabilityStepProps {
  availability: AvailabilityData;
  onAvailabilityChange: (data: AvailabilityData) => void;
  timezone: string;
  onTimezoneChange: (timezone: string) => void;
  onBack: () => void;
  onSubmit: () => void;
  cohort: { cohort_start_date: string; duration_days: number } | null;
}
```

to:

```tsx
interface AvailabilityStepProps {
  isSubmitting?: boolean;
  availability: AvailabilityData;
  onAvailabilityChange: (data: AvailabilityData) => void;
  timezone: string;
  onTimezoneChange: (timezone: string) => void;
  onBack: () => void;
  onSubmit: () => void;
  cohort: { cohort_start_date: string; duration_days: number } | null;
}
```

**Step 2: Destructure isSubmitting with default**

Change the function signature (lines 15-23) from:

```tsx
export default function AvailabilityStep({
  availability,
  onAvailabilityChange,
  timezone,
  onTimezoneChange,
  onBack,
  onSubmit,
  cohort,
}: AvailabilityStepProps) {
```

to:

```tsx
export default function AvailabilityStep({
  isSubmitting = false,
  availability,
  onAvailabilityChange,
  timezone,
  onTimezoneChange,
  onBack,
  onSubmit,
  cohort,
}: AvailabilityStepProps) {
```

**Step 3: Update the submit button disabled condition**

Change line 111 from:

```tsx
          disabled={totalSlots === 0}
```

to:

```tsx
          disabled={isSubmitting || totalSlots === 0}
```

**Step 4: Update the button className condition**

Change the className condition (lines 112-116) from:

```tsx
          className={`flex-1 px-6 py-3 font-medium rounded-lg transition-colors disabled:cursor-default ${
            totalSlots === 0
              ? "bg-gray-300 text-gray-500"
              : "bg-blue-500 hover:bg-blue-600 text-white"
          }`}
```

to:

```tsx
          className={`flex-1 px-6 py-3 font-medium rounded-lg transition-colors disabled:cursor-default ${
            isSubmitting || totalSlots === 0
              ? "bg-gray-300 text-gray-500"
              : "bg-blue-500 hover:bg-blue-600 text-white"
          }`}
```

**Step 5: Run lint and build**

Run:
```bash
cd web_frontend && npm run lint && npm run build
```

Expected: Both pass. TypeScript is happy, no lint errors.

**Step 6: Run full check suite**

Run:
```bash
cd /home/penguin/code/lens-platform/ws1 && ruff check . && ruff format --check . && .venv/bin/pytest
```

Expected: All checks pass.

**Step 7: Commit**

```bash
jj new -m "fix: add isSubmitting prop to AvailabilityStep to prevent double-submit"
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `core/tables.py` | Add `UniqueConstraint("user_id", "cohort_id")` to signups |
| `alembic/versions/<new>.py` | Migration to add unique constraint |
| `core/tests/test_enrollment.py` | New test file: 5 tests for idempotent enrollment |
| `core/users.py` | Rewrite `enroll_in_cohort()` with ON CONFLICT DO NOTHING |
| `web_frontend/.../EnrollWizard.tsx` | Destructure `isSubmitting`, pass to both step components |
| `web_frontend/.../AvailabilityStep.tsx` | Accept `isSubmitting` prop, disable button during submit |

`GroupSelectionStep.tsx` needs NO changes — it already accepts and uses `isSubmitting` correctly (lines 18, 36, 286-297, 303).
