"""rename cohort_role to role_in_cohort

Revision ID: b2c3d4e5f6g7
Revises: a1b2c3d4e5f6
Create Date: 2026-01-03 16:00:00.000000

Rename column for clarity: role_in_cohort describes what the column stores.
The enum type (cohort_role) stays the same as it describes the type of values.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6g7'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute('ALTER TABLE courses_users RENAME COLUMN cohort_role TO role_in_cohort')


def downgrade() -> None:
    op.execute('ALTER TABLE courses_users RENAME COLUMN role_in_cohort TO cohort_role')
