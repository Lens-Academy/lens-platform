"""merge heads: roleplay columns + cookie consent

Revision ID: a8f9a97a3d5e
Revises: 5932295cb042, 8780fc3b3396
Create Date: 2026-02-26 09:22:40.022424

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a8f9a97a3d5e'
down_revision: Union[str, None] = ('5932295cb042', '8780fc3b3396')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
