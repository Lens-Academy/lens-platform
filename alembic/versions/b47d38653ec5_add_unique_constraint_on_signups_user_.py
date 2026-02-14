"""add unique constraint on signups user_id cohort_id

Revision ID: b47d38653ec5
Revises: 84435d4682c3
Create Date: 2026-02-14 09:41:59.592253

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b47d38653ec5"
down_revision: Union[str, None] = "84435d4682c3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_unique_constraint(
        "uq_signups_user_id_cohort_id", "signups", ["user_id", "cohort_id"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_signups_user_id_cohort_id", "signups", type_="unique")
