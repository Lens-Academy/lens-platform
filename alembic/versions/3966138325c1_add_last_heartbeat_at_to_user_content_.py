"""add last_heartbeat_at to user_content_progress

Revision ID: 3966138325c1
Revises: dd842eeebb7a
Create Date: 2026-02-08 13:35:07.971820

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "3966138325c1"
down_revision: Union[str, None] = "dd842eeebb7a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "user_content_progress",
        sa.Column("last_heartbeat_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("user_content_progress", "last_heartbeat_at")
