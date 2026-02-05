"""add calendar columns to groups, remove from meetings

Revision ID: 9c9ad493fa50
Revises: 4361efdd673d
Create Date: 2026-01-30 15:49:01.968258

Calendar tracking moves from per-meeting to per-group level:
- groups.gcal_recurring_event_id: Google Calendar recurring event ID
- groups.calendar_invite_sent_at: When the recurring invite was created
- meetings: remove google_calendar_event_id and calendar_invite_sent_at (now tracked at group level)
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "9c9ad493fa50"
down_revision: Union[str, None] = "4361efdd673d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add calendar columns to groups (for recurring event tracking)
    op.add_column(
        "groups", sa.Column("gcal_recurring_event_id", sa.Text(), nullable=True)
    )
    op.add_column(
        "groups",
        sa.Column(
            "calendar_invite_sent_at",
            postgresql.TIMESTAMP(timezone=True),
            nullable=True,
        ),
    )

    # Remove calendar columns from meetings (now tracked at group level)
    op.drop_column("meetings", "google_calendar_event_id")
    op.drop_column("meetings", "calendar_invite_sent_at")


def downgrade() -> None:
    # Restore calendar columns to meetings
    op.add_column(
        "meetings",
        sa.Column(
            "calendar_invite_sent_at",
            postgresql.TIMESTAMP(timezone=True),
            autoincrement=False,
            nullable=True,
        ),
    )
    op.add_column(
        "meetings",
        sa.Column(
            "google_calendar_event_id", sa.TEXT(), autoincrement=False, nullable=True
        ),
    )

    # Remove calendar columns from groups
    op.drop_column("groups", "calendar_invite_sent_at")
    op.drop_column("groups", "gcal_recurring_event_id")
