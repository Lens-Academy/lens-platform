"""Add reference columns to notification_log for deduplication

Revision ID: 003
Revises: 9286fd2b2e96
Create Date: 2026-01-23

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "003"
down_revision: Union[str, None] = "9286fd2b2e96"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create the enum type
    op.execute(
        "CREATE TYPE notification_reference_type AS ENUM "
        "('group_id', 'meeting_id', 'cohort_id', 'user_id')"
    )

    # Add new columns
    op.add_column(
        "notification_log",
        sa.Column(
            "reference_type",
            sa.Enum(
                "group_id",
                "meeting_id",
                "cohort_id",
                "user_id",
                name="notification_reference_type",
            ),
            nullable=True,
        ),
    )
    op.add_column(
        "notification_log",
        sa.Column("reference_id", sa.Integer(), nullable=True),
    )

    # Create index for deduplication queries
    op.create_index(
        "idx_notification_log_dedup",
        "notification_log",
        ["user_id", "message_type", "reference_type", "reference_id"],
    )


def downgrade() -> None:
    # Drop index
    op.drop_index("idx_notification_log_dedup", table_name="notification_log")

    # Drop columns
    op.drop_column("notification_log", "reference_id")
    op.drop_column("notification_log", "reference_type")

    # Drop enum type
    op.execute("DROP TYPE notification_reference_type")
