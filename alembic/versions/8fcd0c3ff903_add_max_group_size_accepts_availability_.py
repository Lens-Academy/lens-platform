"""add max_group_size accepts_availability_signups and group max_size

Revision ID: 8fcd0c3ff903
Revises: ce458a56c544
Create Date: 2026-04-19 08:31:12.014352

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "8fcd0c3ff903"
down_revision: Union[str, None] = "ce458a56c544"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "cohorts",
        sa.Column("max_group_size", sa.Integer(), server_default="8", nullable=False),
    )
    op.add_column(
        "cohorts",
        sa.Column(
            "accepts_availability_signups",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
    )
    op.add_column("groups", sa.Column("max_size", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("groups", "max_size")
    op.drop_column("cohorts", "accepts_availability_signups")
    op.drop_column("cohorts", "max_group_size")
