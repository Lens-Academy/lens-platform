"""merge heads: is_guest + question snapshots

Revision ID: 37934a5f4509
Revises: 2cc96810aa36, d5bcaa57dfdc
Create Date: 2026-02-23 10:06:50.984292

"""

from typing import Sequence, Union


# revision identifiers, used by Alembic.
revision: str = "37934a5f4509"
down_revision: Union[str, None] = ("2cc96810aa36", "d5bcaa57dfdc")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
