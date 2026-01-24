"""add signup_overview view

Revision ID: 4b119b19345e
Revises: 9286fd2b2e96
Create Date: 2026-01-21 16:58:17.553403

"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "4b119b19345e"
down_revision: Union[str, None] = "9286fd2b2e96"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE VIEW signup_overview AS
        SELECT
            s.signup_id,
            s.user_id,
            s.cohort_id,
            s.role AS cohort_role,
            s.ungroupable_reason,
            u.nickname,
            u.timezone,
            u.availability_local,
            g.group_id,
            g.recurring_meeting_time_utc
        FROM signups s
        LEFT JOIN users u
            ON s.user_id = u.user_id
        LEFT JOIN groups_users gu
            ON s.user_id = gu.user_id
            AND gu.status = 'active'
        LEFT JOIN groups g
            ON gu.group_id = g.group_id
            AND g.cohort_id = s.cohort_id
    """)


def downgrade() -> None:
    op.execute("DROP VIEW IF EXISTS signup_overview")
