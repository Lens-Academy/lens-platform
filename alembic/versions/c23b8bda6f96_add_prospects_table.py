"""add prospects table

Revision ID: c23b8bda6f96
Revises: 2fd42752a98f
Create Date: 2026-03-13 21:24:41.092015

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "c23b8bda6f96"
down_revision: Union[str, None] = "2fd42752a98f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "prospects",
        sa.Column("prospect_id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
        sa.Column(
            "unsubscribed_at", postgresql.TIMESTAMP(timezone=True), nullable=True
        ),
        sa.Column("notified_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("prospect_id", name=op.f("pk_prospects")),
        sa.UniqueConstraint("email", name="uq_prospects_email"),
    )
    op.create_index("idx_prospects_email", "prospects", ["email"], unique=False)


def downgrade() -> None:
    op.drop_index("idx_prospects_email", table_name="prospects")
    op.drop_table("prospects")
