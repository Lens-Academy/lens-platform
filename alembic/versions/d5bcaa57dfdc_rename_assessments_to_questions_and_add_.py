"""rename assessments to questions and add question snapshots

Revision ID: d5bcaa57dfdc
Revises: 74fbfc5a473f
Create Date: 2026-02-22 19:19:18.994004

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d5bcaa57dfdc"
down_revision: Union[str, None] = "74fbfc5a473f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Rename child table first (has FK to parent)
    op.rename_table("assessment_scores", "question_assessments")

    # 2. Rename parent table
    op.rename_table("assessment_responses", "question_responses")

    # 3. Drop old indexes on question_responses (IF EXISTS for dev DB compat)
    op.execute("DROP INDEX IF EXISTS idx_assessment_responses_user_id")
    op.execute("DROP INDEX IF EXISTS idx_assessment_responses_anon")
    op.execute("DROP INDEX IF EXISTS idx_assessment_responses_question")
    op.execute("DROP INDEX IF EXISTS idx_assessment_responses_module")

    # 4. Create new indexes on question_responses
    op.create_index("idx_question_responses_user_id", "question_responses", ["user_id"])
    op.create_index(
        "idx_question_responses_anon", "question_responses", ["anonymous_token"]
    )
    op.create_index(
        "idx_question_responses_question", "question_responses", ["question_id"]
    )
    op.create_index(
        "idx_question_responses_module", "question_responses", ["module_slug"]
    )

    # 5. Drop old index on question_assessments (IF EXISTS for dev DB compat)
    op.execute("DROP INDEX IF EXISTS idx_assessment_scores_response_id")

    # 6. Create new index on question_assessments
    op.create_index(
        "idx_question_assessments_response_id", "question_assessments", ["response_id"]
    )

    # 7. Drop and recreate FK on question_assessments pointing to question_responses
    #    Handle both naming conventions: production uses fk_assessment_scores_*,
    #    some dev DBs use auto-generated assessment_scores_response_id_fkey
    conn = op.get_bind()
    fk_name = conn.execute(
        sa.text(
            "SELECT conname FROM pg_constraint "
            "WHERE conrelid = 'question_assessments'::regclass AND contype = 'f' "
            "LIMIT 1"
        )
    ).scalar()
    if fk_name:
        op.drop_constraint(fk_name, "question_assessments", type_="foreignkey")
    op.create_foreign_key(
        "fk_question_assessments_response_id_question_responses",
        "question_assessments",
        "question_responses",
        ["response_id"],
        ["response_id"],
        ondelete="CASCADE",
    )

    # 8. Drop unused columns from question_responses
    op.drop_column("question_responses", "content_id")
    op.drop_column("question_responses", "learning_outcome_id")

    # 9. Add new columns (nullable initially for backfill)
    op.add_column(
        "question_responses", sa.Column("question_text", sa.Text(), nullable=True)
    )
    op.add_column(
        "question_responses", sa.Column("assessment_prompt", sa.Text(), nullable=True)
    )
    op.add_column(
        "question_responses", sa.Column("question_hash", sa.Text(), nullable=True)
    )

    # 10. Backfill existing rows
    op.execute(
        "UPDATE question_responses "
        "SET question_text = '[migrated]', "
        "    question_hash = encode(sha256('[migrated]'::bytea), 'hex') "
        "WHERE question_text IS NULL"
    )

    # 11. Set NOT NULL constraints after backfill
    op.alter_column("question_responses", "question_text", nullable=False)
    op.alter_column("question_responses", "question_hash", nullable=False)

    # 12. Add hash index for data analysis
    op.create_index(
        "idx_question_responses_hash", "question_responses", ["question_hash"]
    )


def downgrade() -> None:
    # Reverse in opposite order

    # Drop hash index
    op.drop_index("idx_question_responses_hash", table_name="question_responses")

    # Remove NOT NULL and drop new columns
    op.drop_column("question_responses", "question_hash")
    op.drop_column("question_responses", "assessment_prompt")
    op.drop_column("question_responses", "question_text")

    # Re-add dropped columns
    op.add_column(
        "question_responses",
        sa.Column("learning_outcome_id", sa.Text(), nullable=True),
    )
    op.add_column(
        "question_responses",
        sa.Column(
            "content_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True
        ),
    )

    # Drop and recreate FK back to old names
    op.drop_constraint(
        "fk_question_assessments_response_id_question_responses",
        "question_assessments",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "fk_assessment_scores_response_id_assessment_responses",
        "question_assessments",
        "question_responses",
        ["response_id"],
        ["response_id"],
        ondelete="CASCADE",
    )

    # Drop new indexes, recreate old ones on question_assessments
    op.drop_index(
        "idx_question_assessments_response_id", table_name="question_assessments"
    )
    op.create_index(
        "idx_assessment_scores_response_id", "question_assessments", ["response_id"]
    )

    # Drop new indexes, recreate old ones on question_responses
    op.drop_index("idx_question_responses_module", table_name="question_responses")
    op.drop_index("idx_question_responses_question", table_name="question_responses")
    op.drop_index("idx_question_responses_anon", table_name="question_responses")
    op.drop_index("idx_question_responses_user_id", table_name="question_responses")
    op.create_index(
        "idx_assessment_responses_module", "question_responses", ["module_slug"]
    )
    op.create_index(
        "idx_assessment_responses_question", "question_responses", ["question_id"]
    )
    op.create_index(
        "idx_assessment_responses_anon", "question_responses", ["anonymous_token"]
    )
    op.create_index(
        "idx_assessment_responses_user_id", "question_responses", ["user_id"]
    )

    # Rename tables back
    op.rename_table("question_responses", "assessment_responses")
    op.rename_table("question_assessments", "assessment_scores")
