"""rename assessment_prompt and prompt_version columns

Revision ID: 79e06d6c97c8
Revises: 37934a5f4509
Create Date: 2026-02-23 12:59:09.679806

"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "79e06d6c97c8"
down_revision: Union[str, None] = "37934a5f4509"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Rename 1: assessment_prompt → assessment_instructions (question_responses)
    op.alter_column(
        "question_responses",
        "assessment_prompt",
        new_column_name="assessment_instructions",
    )

    # Rename 2: prompt_version → assessment_system_prompt_version (question_assessments)
    # Note: DB column was "prompt_version" but code previously used "system_prompt_version"
    # (pre-existing mismatch). This migration renames the DB column to match the new
    # canonical name "assessment_system_prompt_version".
    op.alter_column(
        "question_assessments",
        "prompt_version",
        new_column_name="assessment_system_prompt_version",
    )


def downgrade() -> None:
    op.alter_column(
        "question_assessments",
        "assessment_system_prompt_version",
        new_column_name="prompt_version",
    )
    op.alter_column(
        "question_responses",
        "assessment_instructions",
        new_column_name="assessment_prompt",
    )
