"""Tests for AI scoring module (prompt building and question resolution)."""

from unittest.mock import patch

from core.modules.flattened_types import FlattenedModule
from core.scoring import _build_scoring_prompt, _resolve_question_details


def _make_module(sections):
    """Create a FlattenedModule with given sections list."""
    return FlattenedModule(
        slug="test-module", title="Test", content_id=None, sections=sections
    )


# =====================================================
# TestBuildScoringPrompt
# =====================================================


class TestBuildScoringPrompt:
    """Tests for _build_scoring_prompt -- a pure function that returns (system_prompt, messages)."""

    def test_prompt_is_rigorous_assessment(self):
        """Unified prompt uses rigorous assessment language."""
        system, _messages = _build_scoring_prompt(
            answer_text="Some answer",
            question_text="Explain X",
            assessment_instructions=None,
            learning_outcome_name=None,
        )
        assert any(word in system.lower() for word in ["rigorous", "measure"]), (
            f"Prompt should mention rigorous/measure, got: {system}"
        )
        assert "supportive" not in system.lower()

    def test_includes_learning_outcome_when_provided(self):
        """learning_outcome_name='Understanding X' appears in system prompt."""
        system, _messages = _build_scoring_prompt(
            answer_text="Some answer",
            question_text="Explain X",
            assessment_instructions=None,
            learning_outcome_name="Understanding X",
        )
        assert "Understanding X" in system

    def test_excludes_learning_outcome_when_none(self):
        """learning_outcome_name=None means no 'Learning Outcome:' in system prompt."""
        system, _messages = _build_scoring_prompt(
            answer_text="Some answer",
            question_text="Explain X",
            assessment_instructions=None,
            learning_outcome_name=None,
        )
        assert "Learning Outcome:" not in system

    def test_includes_assessment_instructions_as_rubric(self):
        """assessment_instructions='Check for X' appears in system prompt after 'Scoring Rubric'."""
        system, _messages = _build_scoring_prompt(
            answer_text="Some answer",
            question_text="Explain X",
            assessment_instructions="Check for X",
            learning_outcome_name=None,
        )
        assert "Scoring Rubric" in system
        assert "Check for X" in system
        # Rubric text should come after the heading
        rubric_pos = system.index("Scoring Rubric")
        check_pos = system.index("Check for X")
        assert check_pos > rubric_pos

    def test_excludes_assessment_instructions_when_none(self):
        """assessment_instructions=None means no 'Scoring Rubric' in system prompt."""
        system, _messages = _build_scoring_prompt(
            answer_text="Some answer",
            question_text="Explain X",
            assessment_instructions=None,
            learning_outcome_name=None,
        )
        assert "Scoring Rubric" not in system

    def test_user_message_contains_question_and_answer(self):
        """Returned messages list has one user message containing both question_text and answer_text."""
        _system, messages = _build_scoring_prompt(
            answer_text="My detailed answer",
            question_text="Explain the concept of X",
            assessment_instructions=None,
            learning_outcome_name=None,
        )
        assert len(messages) == 1
        msg = messages[0]
        assert msg["role"] == "user"
        assert "Explain the concept of X" in msg["content"]
        assert "My detailed answer" in msg["content"]

    def test_returns_tuple_of_system_and_messages(self):
        """Return value is (str, list) with list length 1."""
        result = _build_scoring_prompt(
            answer_text="Answer",
            question_text="Question",
            assessment_instructions=None,
            learning_outcome_name=None,
        )
        assert isinstance(result, tuple)
        assert len(result) == 2
        system, messages = result
        assert isinstance(system, str)
        assert isinstance(messages, list)
        assert len(messages) == 1


# =====================================================
# TestResolveQuestionDetails
# =====================================================


class TestResolveQuestionDetails:
    """Tests for _resolve_question_details -- resolves question context from content cache."""

    @patch("core.scoring.load_flattened_module")
    def test_resolves_question_in_test_section(self, mock_load):
        """Section type='test' with question segment returns correct fields."""
        mock_load.return_value = _make_module(
            [
                {
                    "type": "test",
                    "learningOutcomeName": "Test LO Name",
                    "segments": [
                        {
                            "type": "question",
                            "content": "Explain X",
                            "assessmentInstructions": "Look for Y",
                        }
                    ],
                }
            ]
        )

        result = _resolve_question_details("test-module", "test-module:0:0")

        assert result["question_text"] == "Explain X"
        assert result["assessment_instructions"] == "Look for Y"
        assert result["learning_outcome_name"] == "Test LO Name"
        assert "mode" not in result

    @patch("core.scoring.load_flattened_module")
    def test_resolves_question_in_page_section(self, mock_load):
        """Section type='page' with question segment returns correct fields."""
        mock_load.return_value = _make_module(
            [
                {
                    "type": "page",
                    "learningOutcomeName": "Page LO",
                    "segments": [
                        {
                            "type": "question",
                            "content": "Reflect on Z",
                            "assessmentInstructions": None,
                        }
                    ],
                }
            ]
        )

        result = _resolve_question_details("test-module", "test-module:0:0")

        assert result["question_text"] == "Reflect on Z"
        assert "mode" not in result

    @patch("core.scoring.load_flattened_module")
    def test_returns_empty_for_invalid_question_id_format(self, mock_load):
        """question_id='invalid' returns {}."""
        mock_load.return_value = _make_module([])

        result = _resolve_question_details("test-module", "invalid")

        assert result == {}

    @patch("core.scoring.load_flattened_module")
    def test_returns_empty_for_out_of_bounds_section(self, mock_load):
        """Section index beyond sections list returns {}."""
        mock_load.return_value = _make_module(
            [
                {
                    "type": "page",
                    "segments": [{"type": "question", "content": "Q1"}],
                }
            ]
        )

        result = _resolve_question_details("test-module", "test-module:5:0")

        assert result == {}

    @patch("core.scoring.load_flattened_module")
    def test_returns_empty_for_out_of_bounds_segment(self, mock_load):
        """Segment index beyond segments list returns {}."""
        mock_load.return_value = _make_module(
            [
                {
                    "type": "page",
                    "segments": [{"type": "question", "content": "Q1"}],
                }
            ]
        )

        result = _resolve_question_details("test-module", "test-module:0:5")

        assert result == {}

    @patch("core.scoring.load_flattened_module")
    def test_returns_empty_for_non_question_segment(self, mock_load):
        """Segment type='text' returns {}."""
        mock_load.return_value = _make_module(
            [
                {
                    "type": "page",
                    "segments": [{"type": "text", "content": "Hello world"}],
                }
            ]
        )

        result = _resolve_question_details("test-module", "test-module:0:0")

        assert result == {}

    @patch("core.scoring.load_flattened_module")
    def test_returns_empty_when_module_not_found(self, mock_load):
        """Mock raises ModuleNotFoundError, returns {}."""
        from core.modules.loader import ModuleNotFoundError

        mock_load.side_effect = ModuleNotFoundError("Module not found: missing-mod")

        result = _resolve_question_details("missing-mod", "missing-mod:0:0")

        assert result == {}
