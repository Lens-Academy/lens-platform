"""add subscribe_courses, drop unsubscribed_at from prospects

Revision ID: 1fe8fa591d8a
Revises: 13774928bfeb
Create Date: 2026-03-17 13:42:28.248167

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "1fe8fa591d8a"
down_revision: Union[str, None] = "13774928bfeb"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Existing rows with unsubscribed_at set get subscribe_courses=false,
    # all others (who signed up for courses) get subscribe_courses=true.
    op.add_column(
        "prospects",
        sa.Column(
            "subscribe_courses", sa.Boolean(), server_default="false", nullable=False
        ),
    )
    # Backfill: anyone without unsubscribed_at was a course subscriber
    op.execute(
        "UPDATE prospects SET subscribe_courses = true WHERE unsubscribed_at IS NULL"
    )
    op.drop_column("prospects", "unsubscribed_at")


def downgrade() -> None:
    op.add_column(
        "prospects",
        sa.Column(
            "unsubscribed_at",
            postgresql.TIMESTAMP(timezone=True),
            autoincrement=False,
            nullable=True,
        ),
    )
    # Backfill: anyone with subscribe_courses=false was unsubscribed
    op.execute(
        "UPDATE prospects SET unsubscribed_at = now() WHERE subscribe_courses = false"
    )
    op.drop_column("prospects", "subscribe_courses")
