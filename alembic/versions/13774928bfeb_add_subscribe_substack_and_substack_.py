"""add subscribe_substack and substack_synced_at to prospects

Revision ID: 13774928bfeb
Revises: c23b8bda6f96
Create Date: 2026-03-17 12:12:43.460197

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "13774928bfeb"
down_revision: Union[str, None] = "c23b8bda6f96"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "prospects",
        sa.Column(
            "subscribe_substack", sa.Boolean(), server_default="false", nullable=False
        ),
    )
    op.add_column(
        "prospects",
        sa.Column(
            "substack_synced_at", postgresql.TIMESTAMP(timezone=True), nullable=True
        ),
    )


def downgrade() -> None:
    op.drop_column("prospects", "substack_synced_at")
    op.drop_column("prospects", "subscribe_substack")
