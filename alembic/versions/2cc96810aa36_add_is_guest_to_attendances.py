"""add is_guest to attendances

Revision ID: 2cc96810aa36
Revises: b47d38653ec5
Create Date: 2026-02-20 12:45:09.111026

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "2cc96810aa36"
down_revision: Union[str, None] = "b47d38653ec5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "attendances",
        sa.Column(
            "is_guest", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
    )


def downgrade() -> None:
    op.drop_column("attendances", "is_guest")
