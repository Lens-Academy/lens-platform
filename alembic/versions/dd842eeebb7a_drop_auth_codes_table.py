"""Drop auth_codes table

Revision ID: dd842eeebb7a
Revises: 002
Create Date: 2026-02-07 13:55:04.509914

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "dd842eeebb7a"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index("idx_auth_codes_code", table_name="auth_codes")
    op.drop_index("idx_auth_codes_user_id", table_name="auth_codes")
    op.drop_table("auth_codes")


def downgrade() -> None:
    op.create_table(
        "auth_codes",
        sa.Column("code_id", sa.INTEGER(), autoincrement=True, nullable=False),
        sa.Column("code", sa.TEXT(), autoincrement=False, nullable=False),
        sa.Column("user_id", sa.INTEGER(), autoincrement=False, nullable=False),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            autoincrement=False,
            nullable=True,
        ),
        sa.Column(
            "expires_at",
            postgresql.TIMESTAMP(timezone=True),
            autoincrement=False,
            nullable=False,
        ),
        sa.Column(
            "used_at",
            postgresql.TIMESTAMP(timezone=True),
            autoincrement=False,
            nullable=True,
        ),
        sa.Column("discord_id", sa.TEXT(), autoincrement=False, nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.user_id"],
            name="fk_auth_codes_user_id_users",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("code_id", name="pk_auth_codes"),
        sa.UniqueConstraint("code", name="uq_auth_codes_code"),
    )
    op.create_index("idx_auth_codes_user_id", "auth_codes", ["user_id"], unique=False)
    op.create_index("idx_auth_codes_code", "auth_codes", ["code"], unique=False)
