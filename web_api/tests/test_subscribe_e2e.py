"""End-to-end tests for POST /api/subscribe.

Sends real HTTP requests and verifies database state.
Only mocks the email-sending boundary (SendGrid).
"""

import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select
from dotenv import load_dotenv

load_dotenv(".env.local")

from core.database import get_transaction, close_engine
from core.tables import prospects


@pytest_asyncio.fixture(autouse=True)
async def cleanup_engine():
    await close_engine()
    yield
    await close_engine()


def _unique_email() -> str:
    return f"test-{uuid.uuid4().hex[:8]}@example.com"


async def get_prospect(email: str) -> dict | None:
    async with get_transaction() as conn:
        result = await conn.execute(select(prospects).where(prospects.c.email == email))
        row = result.fetchone()
        return dict(row._mapping) if row else None


async def delete_prospect(email: str) -> None:
    from sqlalchemy import delete

    async with get_transaction() as conn:
        await conn.execute(delete(prospects).where(prospects.c.email == email))


class TestSubscribeNavigatorE2E:
    """Widget navigator subscription should persist correctly to database."""

    @pytest.mark.asyncio
    async def test_navigator_subscription_sets_navigator_flag_in_db(self):
        """When widget sends navigator=true, the DB row has
        subscribe_courses_navigators=True and subscribe_courses_learners=False.
        """
        from unittest.mock import patch
        from main import app

        email = _unique_email()

        try:
            with patch("core.prospects.send_email"):
                async with AsyncClient(
                    transport=ASGITransport(app=app), base_url="http://test"
                ) as client:
                    response = await client.post(
                        "/api/subscribe",
                        json={
                            "email": email,
                            "subscribe_courses_learners": False,
                            "subscribe_courses_navigators": True,
                            "subscribe_substack": False,
                        },
                    )

            assert response.status_code == 200
            assert response.json() == {"ok": True}

            row = await get_prospect(email)
            assert row is not None, "Prospect row should exist"
            assert row["subscribe_courses_navigators"] is True
            assert row["subscribe_courses_learners"] is False
        finally:
            await delete_prospect(email)

    @pytest.mark.asyncio
    async def test_learner_subscription_sets_learner_flag_in_db(self):
        """When widget sends learner=true, the DB row has
        subscribe_courses_learners=True and subscribe_courses_navigators=False.
        """
        from unittest.mock import patch
        from main import app

        email = _unique_email()

        try:
            with patch("core.prospects.send_email"):
                async with AsyncClient(
                    transport=ASGITransport(app=app), base_url="http://test"
                ) as client:
                    response = await client.post(
                        "/api/subscribe",
                        json={
                            "email": email,
                            "subscribe_courses_learners": True,
                            "subscribe_courses_navigators": False,
                            "subscribe_substack": False,
                        },
                    )

            assert response.status_code == 200

            row = await get_prospect(email)
            assert row is not None, "Prospect row should exist"
            assert row["subscribe_courses_learners"] is True
            assert row["subscribe_courses_navigators"] is False
        finally:
            await delete_prospect(email)

    @pytest.mark.asyncio
    async def test_legacy_subscribe_courses_sets_learner_flag_in_db(self):
        """Old callers sending subscribe_courses=true should set learners flag."""
        from unittest.mock import patch
        from main import app

        email = _unique_email()

        try:
            with patch("core.prospects.send_email"):
                async with AsyncClient(
                    transport=ASGITransport(app=app), base_url="http://test"
                ) as client:
                    response = await client.post(
                        "/api/subscribe",
                        json={
                            "email": email,
                            "subscribe_courses": True,
                            "subscribe_substack": False,
                        },
                    )

            assert response.status_code == 200

            row = await get_prospect(email)
            assert row is not None, "Prospect row should exist"
            assert row["subscribe_courses_learners"] is True
            assert row["subscribe_courses_navigators"] is False
        finally:
            await delete_prospect(email)
