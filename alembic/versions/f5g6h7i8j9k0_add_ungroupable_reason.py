"""add ungroupable_reason column to courses_users

Revision ID: f5g6h7i8j9k0
Revises: e4f5g6h7i8j9
Create Date: 2026-01-11 15:00:00.000000

Store the reason why a user couldn't be grouped during scheduling.
This enables diagnostics for understanding scheduling failures.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f5g6h7i8j9k0'
down_revision: Union[str, None] = 'e4f5g6h7i8j9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create the enum type
    ungroupable_reason_enum = sa.Enum(
        'no_availability',
        'no_overlap_with_others',
        'no_facilitator_overlap',
        'facilitator_capacity',
        'insufficient_group_size',
        name='ungroupable_reason',
    )
    ungroupable_reason_enum.create(op.get_bind(), checkfirst=True)

    # Add the column
    op.add_column(
        'courses_users',
        sa.Column('ungroupable_reason', ungroupable_reason_enum, nullable=True)
    )


def downgrade() -> None:
    # Drop the column
    op.drop_column('courses_users', 'ungroupable_reason')

    # Drop the enum type
    sa.Enum(name='ungroupable_reason').drop(op.get_bind(), checkfirst=True)
