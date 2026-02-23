"""Tests for AI feedback module (prompt building and mode switching)."""

from core.modules.feedback import build_feedback_prompt


class TestBuildFeedbackPrompt:
    """Tests for build_feedback_prompt -- pure function returning a system prompt string."""

    def test_socratic_mode_prompt_is_supportive(self):
        """mode='socratic' produces prompt with supportive/tutor/Socratic language."""
        prompt = build_feedback_prompt(
            answer_text="Some answer",
            question_text="Explain X",
            assessment_instructions=None,
            learning_outcome_name=None,
            mode="socratic",
        )
        assert any(
            word in prompt.lower() for word in ["supportive", "tutor", "socratic"]
        )
        assert "assessor" not in prompt.lower()

    def test_assessment_mode_prompt_is_evaluative(self):
        """mode='assessment' produces prompt with assessor/evaluate/rubric language."""
        prompt = build_feedback_prompt(
            answer_text="Some answer",
            question_text="Explain X",
            assessment_instructions=None,
            learning_outcome_name=None,
            mode="assessment",
        )
        assert any(word in prompt.lower() for word in ["assessor", "evaluate"])
        assert "supportive tutor" not in prompt.lower()

    def test_includes_learning_outcome_when_provided(self):
        """learning_outcome_name='Understanding X' appears in prompt."""
        prompt = build_feedback_prompt(
            answer_text="Some answer",
            question_text="Explain X",
            assessment_instructions=None,
            learning_outcome_name="Understanding X",
            mode="socratic",
        )
        assert "Understanding X" in prompt

    def test_excludes_learning_outcome_when_none(self):
        """learning_outcome_name=None means no 'Learning Outcome:' in prompt."""
        prompt = build_feedback_prompt(
            answer_text="Some answer",
            question_text="Explain X",
            assessment_instructions=None,
            learning_outcome_name=None,
            mode="socratic",
        )
        assert "Learning Outcome:" not in prompt

    def test_includes_rubric_when_provided(self):
        """assessment_instructions='Check for X' appears in prompt after 'Rubric'."""
        prompt = build_feedback_prompt(
            answer_text="Some answer",
            question_text="Explain X",
            assessment_instructions="Check for X",
            learning_outcome_name=None,
            mode="assessment",
        )
        assert "Rubric" in prompt
        assert "Check for X" in prompt

    def test_excludes_rubric_when_none(self):
        """assessment_instructions=None means no 'Rubric' in prompt."""
        prompt = build_feedback_prompt(
            answer_text="Some answer",
            question_text="Explain X",
            assessment_instructions=None,
            learning_outcome_name=None,
            mode="socratic",
        )
        assert "Rubric" not in prompt

    def test_includes_answer_text_and_question(self):
        """Both answer_text and question_text appear in prompt."""
        prompt = build_feedback_prompt(
            answer_text="My detailed answer about alignment",
            question_text="Explain the alignment problem",
            assessment_instructions=None,
            learning_outcome_name=None,
            mode="socratic",
        )
        assert "My detailed answer about alignment" in prompt
        assert "Explain the alignment problem" in prompt

    def test_returns_string(self):
        """Return value is a string."""
        result = build_feedback_prompt(
            answer_text="Answer",
            question_text="Question",
            assessment_instructions=None,
            learning_outcome_name=None,
            mode="socratic",
        )
        assert isinstance(result, str)
        assert len(result) > 50  # Should be a substantial prompt
