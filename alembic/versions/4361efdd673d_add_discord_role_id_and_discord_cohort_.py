"""add discord_role_id and discord_cohort_channel_id

Revision ID: 4361efdd673d
Revises: 005
Create Date: 2026-01-30 14:22:41.563986

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "4361efdd673d"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add discord_role_id to groups table (for role-based channel permissions)
    op.add_column("groups", sa.Column("discord_role_id", sa.Text(), nullable=True))
    # Add discord_cohort_channel_id to cohorts table (for cohort-wide announcements)
    op.add_column(
        "cohorts", sa.Column("discord_cohort_channel_id", sa.Text(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("groups", "discord_role_id")
    op.drop_column("cohorts", "discord_cohort_channel_id")
