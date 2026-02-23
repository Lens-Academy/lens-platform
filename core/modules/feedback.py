"""
AI feedback module for post-answer conversations.

Builds feedback-specific system prompts from question context, student answer,
and mode (socratic vs assessment).
"""


def build_feedback_prompt(
    *,
    answer_text: str,
    question_text: str,
    assessment_instructions: str | None,
    learning_outcome_name: str | None,
    mode: str,
) -> str:
    """
    Build a system prompt for feedback conversation.

    This is a pure function that returns a system prompt string.
    Unlike the scoring prompt (which returns a tuple of system + messages),
    feedback only needs the system prompt -- messages come from the chat session.

    Args:
        answer_text: The student's response text
        question_text: The question text shown to the student
        assessment_instructions: Optional rubric/assessment criteria
        learning_outcome_name: Optional learning outcome name for context
        mode: "socratic" or "assessment"

    Returns:
        System prompt string for the feedback conversation
    """
    if mode == "socratic":
        system = (
            "You are a supportive tutor providing feedback on a student's response. "
            "Focus on what the student understood well, gently point out gaps, and "
            "ask Socratic questions to deepen their understanding. "
            "Be encouraging and constructive."
        )
    else:  # assessment
        system = (
            "You are an educational assessor providing feedback on a student's response. "
            "Evaluate the response against the rubric. Point out strengths and weaknesses "
            "with specific references to the student's answer. "
            "Suggest concrete improvements."
        )

    system += f"\n\nQuestion: {question_text}"

    if learning_outcome_name:
        system += f"\nLearning Outcome: {learning_outcome_name}"

    if assessment_instructions:
        system += f"\nRubric:\n{assessment_instructions}"

    system += f"\n\nStudent's answer:\n{answer_text}"

    return system
