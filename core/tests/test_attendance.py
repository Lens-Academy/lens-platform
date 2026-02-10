"""Tests for voice attendance tracking."""

import pytest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch, Mock

from core.attendance import record_voice_attendance


def _make_mapping_result(rows):
    """Helper to create a mock result that supports .mappings().first()."""
    mock_result = Mock()
    mock_mappings = Mock()
    mock_mappings.first.return_value = rows[0] if rows else None
    mock_result.mappings.return_value = mock_mappings
    mock_result.rowcount = len(rows)
    return mock_result


def _setup_conn_mock(execute_side_effects):
    """Helper to set up get_connection and get_transaction mocks."""
    read_conn = AsyncMock()
    read_conn.execute = AsyncMock(side_effect=execute_side_effects)

    write_conn = AsyncMock()
    # Default: upsert returns rowcount=1 (inserted)
    write_conn.execute = AsyncMock(return_value=Mock(rowcount=1))

    conn_ctx = patch("core.attendance.get_connection")
    tx_ctx = patch("core.attendance.get_transaction")

    return read_conn, write_conn, conn_ctx, tx_ctx


class TestRecordVoiceAttendance:
    """Test record_voice_attendance()."""

    @pytest.mark.asyncio
    async def test_no_matching_meeting_returns_none(self):
        """When no meeting matches the voice channel + time window, return None."""
        read_conn, write_conn, conn_ctx, tx_ctx = _setup_conn_mock(
            [_make_mapping_result([])]  # meeting lookup: no match
        )
        with conn_ctx as mock_conn_ctx, tx_ctx as mock_tx_ctx:
            mock_conn_ctx.return_value.__aenter__ = AsyncMock(return_value=read_conn)
            mock_conn_ctx.return_value.__aexit__ = AsyncMock()
            mock_tx_ctx.return_value.__aenter__ = AsyncMock(return_value=write_conn)
            mock_tx_ctx.return_value.__aexit__ = AsyncMock()

            result = await record_voice_attendance(
                discord_id="123456", voice_channel_id="999999"
            )
            assert result is None
            # Should NOT have attempted a write
            write_conn.execute.assert_not_called()

    @pytest.mark.asyncio
    async def test_unregistered_user_returns_none(self):
        """When the discord user isn't in our users table, return None."""
        meeting_row = {"meeting_id": 1, "scheduled_at": datetime.now(timezone.utc)}
        read_conn, write_conn, conn_ctx, tx_ctx = _setup_conn_mock(
            [
                _make_mapping_result([meeting_row]),  # meeting lookup: match
                _make_mapping_result([]),  # user lookup: no match
            ]
        )
        with conn_ctx as mock_conn_ctx, tx_ctx as mock_tx_ctx:
            mock_conn_ctx.return_value.__aenter__ = AsyncMock(return_value=read_conn)
            mock_conn_ctx.return_value.__aexit__ = AsyncMock()
            mock_tx_ctx.return_value.__aenter__ = AsyncMock(return_value=write_conn)
            mock_tx_ctx.return_value.__aexit__ = AsyncMock()

            result = await record_voice_attendance(
                discord_id="123456", voice_channel_id="999999"
            )
            assert result is None
            write_conn.execute.assert_not_called()

    @pytest.mark.asyncio
    async def test_already_checked_in_returns_none(self):
        """When attendance already recorded (ON CONFLICT DO NOTHING), return None."""
        meeting_row = {"meeting_id": 1, "scheduled_at": datetime.now(timezone.utc)}
        user_row = {"user_id": 42}
        read_conn, write_conn, conn_ctx, tx_ctx = _setup_conn_mock(
            [
                _make_mapping_result([meeting_row]),  # meeting lookup
                _make_mapping_result([user_row]),  # user lookup
            ]
        )
        # Upsert returns rowcount=0 (conflict, nothing inserted)
        write_conn.execute = AsyncMock(return_value=Mock(rowcount=0))

        with conn_ctx as mock_conn_ctx, tx_ctx as mock_tx_ctx:
            mock_conn_ctx.return_value.__aenter__ = AsyncMock(return_value=read_conn)
            mock_conn_ctx.return_value.__aexit__ = AsyncMock()
            mock_tx_ctx.return_value.__aenter__ = AsyncMock(return_value=write_conn)
            mock_tx_ctx.return_value.__aexit__ = AsyncMock()

            result = await record_voice_attendance(
                discord_id="123456", voice_channel_id="999999"
            )
            assert result is None

    @pytest.mark.asyncio
    async def test_records_new_attendance(self):
        """When meeting matches and user exists and no prior record, return recorded."""
        meeting_row = {"meeting_id": 1, "scheduled_at": datetime.now(timezone.utc)}
        user_row = {"user_id": 42}
        read_conn, write_conn, conn_ctx, tx_ctx = _setup_conn_mock(
            [
                _make_mapping_result([meeting_row]),  # meeting lookup
                _make_mapping_result([user_row]),  # user lookup
            ]
        )
        # Upsert returns rowcount=1 (inserted)
        write_conn.execute = AsyncMock(return_value=Mock(rowcount=1))

        with conn_ctx as mock_conn_ctx, tx_ctx as mock_tx_ctx:
            mock_conn_ctx.return_value.__aenter__ = AsyncMock(return_value=read_conn)
            mock_conn_ctx.return_value.__aexit__ = AsyncMock()
            mock_tx_ctx.return_value.__aenter__ = AsyncMock(return_value=write_conn)
            mock_tx_ctx.return_value.__aexit__ = AsyncMock()

            result = await record_voice_attendance(
                discord_id="123456", voice_channel_id="999999"
            )
            assert result is not None
            assert result["recorded"] is True
            assert result["meeting_id"] == 1
            assert result["user_id"] == 42

    @pytest.mark.asyncio
    async def test_concurrent_joins_are_safe(self):
        """Concurrent voice joins for same user+meeting don't raise errors.

        The ON CONFLICT DO NOTHING clause handles the race — second insert
        returns rowcount=0 and the function returns None.
        """
        meeting_row = {"meeting_id": 1, "scheduled_at": datetime.now(timezone.utc)}
        user_row = {"user_id": 42}

        # Simulate two concurrent calls — both find the meeting and user
        for expected_rowcount, expected_result in [(1, True), (0, None)]:
            read_conn, write_conn, conn_ctx, tx_ctx = _setup_conn_mock(
                [
                    _make_mapping_result([meeting_row]),
                    _make_mapping_result([user_row]),
                ]
            )
            write_conn.execute = AsyncMock(
                return_value=Mock(rowcount=expected_rowcount)
            )

            with conn_ctx as mock_conn_ctx, tx_ctx as mock_tx_ctx:
                mock_conn_ctx.return_value.__aenter__ = AsyncMock(
                    return_value=read_conn
                )
                mock_conn_ctx.return_value.__aexit__ = AsyncMock()
                mock_tx_ctx.return_value.__aenter__ = AsyncMock(return_value=write_conn)
                mock_tx_ctx.return_value.__aexit__ = AsyncMock()

                result = await record_voice_attendance(
                    discord_id="123456", voice_channel_id="999999"
                )
                if expected_result:
                    assert result is not None
                    assert result["recorded"] is True
                else:
                    assert result is None
