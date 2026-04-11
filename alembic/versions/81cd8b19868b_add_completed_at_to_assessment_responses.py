"""add completed_at to assessment_responses

Revision ID: 81cd8b19868b
Revises: 0ef080fc2fd5
Create Date: 2026-02-14 21:34:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "81cd8b19868b"
down_revision: Union[str, None] = "0ef080fc2fd5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "assessment_responses",
        sa.Column("completed_at", sa.TIMESTAMP(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("assessment_responses", "completed_at")
