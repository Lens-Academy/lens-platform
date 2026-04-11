"""split subscribe_courses into learners and navigators

Revision ID: f511f3fcf68a
Revises: 321eebb1eed8
Create Date: 2026-03-18 13:42:41.193775

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f511f3fcf68a"
down_revision: Union[str, None] = "321eebb1eed8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Rename existing column to preserve data (subscribe_courses=True → learners=True)
    op.alter_column(
        "prospects", "subscribe_courses", new_column_name="subscribe_courses_learners"
    )
    # Add new navigators column (defaults to false for all existing rows)
    op.add_column(
        "prospects",
        sa.Column(
            "subscribe_courses_navigators",
            sa.Boolean(),
            server_default="false",
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("prospects", "subscribe_courses_navigators")
    op.alter_column(
        "prospects", "subscribe_courses_learners", new_column_name="subscribe_courses"
    )
