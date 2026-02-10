"""add attendances unique constraint

Revision ID: 84435d4682c3
Revises: 3966138325c1
Create Date: 2026-02-10 12:35:59.838521

"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "84435d4682c3"
down_revision: Union[str, None] = "3966138325c1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Remove duplicate attendance rows (keep the one with the highest ID)
    op.execute("""
        DELETE FROM attendances a
        USING attendances b
        WHERE a.meeting_id = b.meeting_id
          AND a.user_id = b.user_id
          AND a.attendance_id < b.attendance_id
    """)
    op.create_unique_constraint(
        "attendances_meeting_user_unique",
        "attendances",
        ["meeting_id", "user_id"],
    )


def downgrade() -> None:
    op.drop_constraint("attendances_meeting_user_unique", "attendances", type_="unique")
