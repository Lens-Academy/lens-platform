# web_api/tests/test_course_progress_contract.py
"""Contract tests for course progress API.

These tests verify the API produces output EXACTLY matching the shared fixture.
The same fixture is used by frontend tests to verify rendering.

If content changes legitimately, regenerate the fixture:
    curl http://localhost:8000/api/courses/default/progress | jq > fixtures/course_progress_response.json
"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Load shared fixture
FIXTURE_PATH = (
    Path(__file__).parent.parent.parent / "fixtures" / "course_progress_response.json"
)


@pytest.fixture
def expected_response():
    """Load the shared fixture."""
    with open(FIXTURE_PATH) as f:
        return json.load(f)


@pytest.fixture
def client():
    """Create test client."""
    from main import app

    return TestClient(app)


def normalize_for_comparison(data: dict) -> dict:
    """Normalize API response for comparison with fixture.

    Removes fields that vary between calls (like progress-related fields
    that depend on user state) while keeping the structural contract.
    """
    normalized = {
        "course": data["course"],
        "units": [],
    }

    for unit in data["units"]:
        norm_unit = {
            "meetingNumber": unit["meetingNumber"],
            "modules": [],
        }
        for module in unit["modules"]:
            norm_module = {
                "slug": module["slug"],
                "title": module["title"],
                "optional": module["optional"],
                "status": module["status"],
                "stages": module["stages"],
                # These fields are in the fixture
                "completedLenses": module.get("completedLenses", 0),
                "totalLenses": module.get("totalLenses", 0),
            }
            norm_unit["modules"].append(norm_module)
        normalized["units"].append(norm_unit)

    return normalized


class TestCourseProgressContractExact:
    """Verify API produces output EXACTLY matching the shared fixture.

    This is the strict contract test. If it fails, either:
    1. The API output format changed (update frontend to match, regenerate fixture)
    2. The course content changed (regenerate fixture)
    3. There's a bug in the API
    """

    def test_api_output_matches_fixture_exactly(self, client, expected_response):
        """API response must match the fixture exactly.

        This catches any drift between what the API produces and what
        the frontend expects. The fixture is the contract.
        """
        response = client.get("/api/courses/default/progress")
        assert response.status_code == 200
        actual = response.json()

        # Normalize both for comparison
        actual_normalized = normalize_for_comparison(actual)
        expected_normalized = normalize_for_comparison(expected_response)

        # Exact match on course info
        assert actual_normalized["course"] == expected_normalized["course"], (
            f"Course mismatch:\n"
            f"  actual: {actual_normalized['course']}\n"
            f"  expected: {expected_normalized['course']}"
        )

        # Exact match on unit count
        assert len(actual_normalized["units"]) == len(expected_normalized["units"]), (
            f"Unit count mismatch: "
            f"actual={len(actual_normalized['units'])}, "
            f"expected={len(expected_normalized['units'])}"
        )

        # Exact match on each unit
        for i, (actual_unit, expected_unit) in enumerate(
            zip(actual_normalized["units"], expected_normalized["units"])
        ):
            assert actual_unit["meetingNumber"] == expected_unit["meetingNumber"], (
                f"Unit {i} meetingNumber mismatch"
            )

            assert len(actual_unit["modules"]) == len(expected_unit["modules"]), (
                f"Unit {i} module count mismatch: "
                f"actual={len(actual_unit['modules'])}, "
                f"expected={len(expected_unit['modules'])}"
            )

            # Exact match on each module
            for j, (actual_mod, expected_mod) in enumerate(
                zip(actual_unit["modules"], expected_unit["modules"])
            ):
                assert actual_mod["slug"] == expected_mod["slug"], (
                    f"Unit {i} Module {j} slug mismatch: "
                    f"actual={actual_mod['slug']}, expected={expected_mod['slug']}"
                )
                assert actual_mod["title"] == expected_mod["title"], (
                    f"Unit {i} Module {j} title mismatch"
                )
                assert actual_mod["optional"] == expected_mod["optional"], (
                    f"Unit {i} Module {j} optional mismatch"
                )

                # Exact match on stages
                assert len(actual_mod["stages"]) == len(expected_mod["stages"]), (
                    f"Unit {i} Module {j} ({actual_mod['slug']}) stage count mismatch: "
                    f"actual={len(actual_mod['stages'])}, "
                    f"expected={len(expected_mod['stages'])}"
                )

                for k, (actual_stage, expected_stage) in enumerate(
                    zip(actual_mod["stages"], expected_mod["stages"])
                ):
                    assert actual_stage == expected_stage, (
                        f"Unit {i} Module {j} Stage {k} mismatch:\n"
                        f"  actual: {actual_stage}\n"
                        f"  expected: {expected_stage}"
                    )

    def test_module_slugs_match_fixture(self, client, expected_response):
        """Quick sanity check - all module slugs should match fixture."""
        response = client.get("/api/courses/default/progress")
        actual = response.json()

        actual_slugs = [m["slug"] for u in actual["units"] for m in u["modules"]]
        expected_slugs = [
            m["slug"] for u in expected_response["units"] for m in u["modules"]
        ]

        assert actual_slugs == expected_slugs, (
            f"Module slugs don't match:\n"
            f"  actual: {actual_slugs}\n"
            f"  expected: {expected_slugs}"
        )
