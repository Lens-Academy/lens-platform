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
                _make_mapping_result(
                    [], rowcount=1
                ),  # INSERT ON CONFLICT (new row, rowcount=1)
                _make_mapping_result([signup_row]),  # SELECT the inserted signup
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
                _make_mapping_result(
                    [], rowcount=0
                ),  # INSERT ON CONFLICT DO NOTHING (conflict!)
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
