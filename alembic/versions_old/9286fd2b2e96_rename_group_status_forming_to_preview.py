"""rename group_status forming to preview

Revision ID: 9286fd2b2e96
Revises: 002
Create Date: 2026-01-21 11:06:20.228225

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9286fd2b2e96"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Rename the enum value from 'forming' to 'preview'
    op.execute("ALTER TYPE group_status RENAME VALUE 'forming' TO 'preview'")


def downgrade() -> None:
    # Rename the enum value back from 'preview' to 'forming'
    op.execute("ALTER TYPE group_status RENAME VALUE 'preview' TO 'forming'")
