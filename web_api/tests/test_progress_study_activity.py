"""Tests for study activity hook in the progress completion route."""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from uuid import UUID


class TestStudyActivityHook:
    """Verify that completing a lens triggers the study activity update."""

    @pytest.mark.asyncio
    async def test_lens_completion_with_module_slug_triggers_update(self):
        created_tasks = []

        def capture_create_task(coro, **kwargs):
            created_tasks.append(coro)
            coro.close()
            return MagicMock()

        with (
            patch(
                "web_api.routes.progress.asyncio.create_task",
                side_effect=capture_create_task,
            ),
            patch(
                "web_api.routes.progress.mark_content_complete",
                new_callable=AsyncMock,
                return_value={"completed_at": None},
            ),
            patch("web_api.routes.progress.get_transaction") as mock_txn,
            patch(
                "web_api.routes.progress.get_user_or_token",
                return_value=(42, None),
            ),
        ):
            mock_conn = AsyncMock()
            mock_txn.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_txn.return_value.__aexit__ = AsyncMock(return_value=None)

            from web_api.routes.progress import complete_content, MarkCompleteRequest

            body = MarkCompleteRequest(
                content_id=UUID(int=1),
                content_type="lens",
                content_title="Test Section",
                module_slug="cognitive-superpowers",
            )
            await complete_content(body=body, auth=(42, None))

        assert len(created_tasks) == 1

    @pytest.mark.asyncio
    async def test_module_completion_does_not_trigger_update(self):
        created_tasks = []

        def capture_create_task(coro, **kwargs):
            created_tasks.append(coro)
            coro.close()
            return MagicMock()

        with (
            patch(
                "web_api.routes.progress.asyncio.create_task",
                side_effect=capture_create_task,
            ),
            patch(
                "web_api.routes.progress.mark_content_complete",
                new_callable=AsyncMock,
                return_value={"completed_at": None},
            ),
            patch("web_api.routes.progress.get_transaction") as mock_txn,
        ):
            mock_conn = AsyncMock()
            mock_txn.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_txn.return_value.__aexit__ = AsyncMock(return_value=None)

            from web_api.routes.progress import complete_content, MarkCompleteRequest

            body = MarkCompleteRequest(
                content_id=UUID(int=1),
                content_type="module",
                content_title="Test Module",
                module_slug="cognitive-superpowers",
            )
            await complete_content(body=body, auth=(42, None))

        assert len(created_tasks) == 0

    @pytest.mark.asyncio
    async def test_anonymous_user_does_not_trigger_update(self):
        created_tasks = []

        def capture_create_task(coro, **kwargs):
            created_tasks.append(coro)
            coro.close()
            return MagicMock()

        with (
            patch(
                "web_api.routes.progress.asyncio.create_task",
                side_effect=capture_create_task,
            ),
            patch(
                "web_api.routes.progress.mark_content_complete",
                new_callable=AsyncMock,
                return_value={"completed_at": None},
            ),
            patch("web_api.routes.progress.get_transaction") as mock_txn,
        ):
            mock_conn = AsyncMock()
            mock_txn.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_txn.return_value.__aexit__ = AsyncMock(return_value=None)

            from web_api.routes.progress import complete_content, MarkCompleteRequest

            body = MarkCompleteRequest(
                content_id=UUID(int=1),
                content_type="lens",
                content_title="Test Section",
                module_slug="cognitive-superpowers",
            )
            await complete_content(body=body, auth=(None, UUID(int=99)))

        assert len(created_tasks) == 0

    @pytest.mark.asyncio
    async def test_no_module_slug_does_not_trigger_update(self):
        created_tasks = []

        def capture_create_task(coro, **kwargs):
            created_tasks.append(coro)
            coro.close()
            return MagicMock()

        with (
            patch(
                "web_api.routes.progress.asyncio.create_task",
                side_effect=capture_create_task,
            ),
            patch(
                "web_api.routes.progress.mark_content_complete",
                new_callable=AsyncMock,
                return_value={"completed_at": None},
            ),
            patch("web_api.routes.progress.get_transaction") as mock_txn,
        ):
            mock_conn = AsyncMock()
            mock_txn.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_txn.return_value.__aexit__ = AsyncMock(return_value=None)

            from web_api.routes.progress import complete_content, MarkCompleteRequest

            body = MarkCompleteRequest(
                content_id=UUID(int=1),
                content_type="lens",
                content_title="Test Section",
            )
            await complete_content(body=body, auth=(42, None))

        assert len(created_tasks) == 0
