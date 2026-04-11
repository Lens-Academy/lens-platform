"""add cookies_analytics_consent columns to users

Revision ID: 8780fc3b3396
Revises: 79e06d6c97c8
Create Date: 2026-02-24 14:46:49.432410

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "8780fc3b3396"
down_revision: Union[str, None] = "79e06d6c97c8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("cookies_analytics_consent", sa.Text(), nullable=True)
    )
    op.add_column(
        "users",
        sa.Column(
            "cookies_analytics_consent_at",
            postgresql.TIMESTAMP(timezone=True),
            nullable=True,
        ),
    )
    op.create_check_constraint(
        "ck_users_valid_cookies_analytics_consent",
        "users",
        "cookies_analytics_consent IN ('accepted', 'declined')",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_users_valid_cookies_analytics_consent", "users", type_="check"
    )
    op.drop_column("users", "cookies_analytics_consent_at")
    op.drop_column("users", "cookies_analytics_consent")
