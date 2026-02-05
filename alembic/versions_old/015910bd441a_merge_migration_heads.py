"""merge migration heads

Revision ID: 015910bd441a
Revises: 003, 4b119b19345e
Create Date: 2026-01-24 15:07:54.427449

"""

from typing import Sequence, Union


# revision identifiers, used by Alembic.
revision: str = "015910bd441a"
down_revision: Union[str, None] = ("003", "4b119b19345e")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
