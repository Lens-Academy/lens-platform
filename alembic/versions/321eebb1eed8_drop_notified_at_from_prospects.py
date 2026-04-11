"""drop notified_at from prospects

Revision ID: 321eebb1eed8
Revises: 1fe8fa591d8a
Create Date: 2026-03-17 13:44:05.985126

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "321eebb1eed8"
down_revision: Union[str, None] = "1fe8fa591d8a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("prospects", "notified_at")


def downgrade() -> None:
    op.add_column(
        "prospects",
        sa.Column(
            "notified_at",
            postgresql.TIMESTAMP(timezone=True),
            autoincrement=False,
            nullable=True,
        ),
    )
