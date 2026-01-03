"""rename availability_utc to availability_local

Revision ID: a1b2c3d4e5f6
Revises: d448668f9f24
Create Date: 2026-01-03 12:00:00.000000

The column stores times in user's local timezone, not UTC.
UTC conversion happens at scheduling time using the user's timezone setting.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'd448668f9f24'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute('ALTER TABLE users RENAME COLUMN availability_utc TO availability_local')
    op.execute('ALTER TABLE users RENAME COLUMN if_needed_availability_utc TO if_needed_availability_local')


def downgrade() -> None:
    op.execute('ALTER TABLE users RENAME COLUMN availability_local TO availability_utc')
    op.execute('ALTER TABLE users RENAME COLUMN if_needed_availability_local TO if_needed_availability_utc')
