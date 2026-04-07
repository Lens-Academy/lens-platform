"""merge discord schema and zoom migrations

Revision ID: 4fedfe9102c9
Revises: 180fdfc169c5, c0dd40a430ae
Create Date: 2026-04-07 11:40:46.412486

"""

from typing import Sequence, Union


# revision identifiers, used by Alembic.
revision: str = "4fedfe9102c9"
down_revision: Union[str, None] = ("180fdfc169c5", "c0dd40a430ae")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
