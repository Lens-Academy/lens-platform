"""add zoom columns, drop discord meeting columns

Revision ID: 180fdfc169c5
Revises: b89c3e61c0a9
Create Date: 2026-04-03 11:14:28.121206

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "180fdfc169c5"
down_revision: Union[str, None] = "b89c3e61c0a9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop discord_voice_channel_id from groups
    op.drop_column("groups", "discord_voice_channel_id")
    # Add Zoom columns to meetings
    op.add_column(
        "meetings", sa.Column("zoom_meeting_id", sa.BigInteger(), nullable=True)
    )
    op.add_column("meetings", sa.Column("zoom_join_url", sa.Text(), nullable=True))
    op.add_column("meetings", sa.Column("zoom_host_email", sa.Text(), nullable=True))
    # Drop Discord columns from meetings
    op.drop_column("meetings", "discord_voice_channel_id")
    op.drop_column("meetings", "discord_event_id")


def downgrade() -> None:
    # Re-add Discord columns to meetings
    op.add_column(
        "meetings",
        sa.Column("discord_event_id", sa.TEXT(), autoincrement=False, nullable=True),
    )
    op.add_column(
        "meetings",
        sa.Column(
            "discord_voice_channel_id", sa.TEXT(), autoincrement=False, nullable=True
        ),
    )
    # Drop Zoom columns from meetings
    op.drop_column("meetings", "zoom_host_email")
    op.drop_column("meetings", "zoom_join_url")
    op.drop_column("meetings", "zoom_meeting_id")
    # Re-add discord_voice_channel_id to groups
    op.add_column(
        "groups",
        sa.Column(
            "discord_voice_channel_id", sa.TEXT(), autoincrement=False, nullable=True
        ),
    )
