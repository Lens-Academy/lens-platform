"""Add refresh_tokens table for JWT refresh token rotation.

Revision ID: 002
Revises: 001
Create Date: 2026-02-07

Adds a refresh_tokens table to support refresh token rotation,
pairing JWTs with longer-lived refresh tokens (30 days) stored
as SHA-256 hashes.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "refresh_tokens",
        sa.Column("token_id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("family_id", sa.Text(), nullable=False),
        sa.Column("expires_at", postgresql.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("revoked_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.user_id"],
            name=op.f("fk_refresh_tokens_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("token_id", name=op.f("pk_refresh_tokens")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_refresh_tokens_token_hash")),
    )
    op.create_index(
        "idx_refresh_tokens_user_id", "refresh_tokens", ["user_id"], unique=False
    )
    op.create_index(
        "idx_refresh_tokens_family_id", "refresh_tokens", ["family_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("idx_refresh_tokens_family_id", table_name="refresh_tokens")
    op.drop_index("idx_refresh_tokens_user_id", table_name="refresh_tokens")
    op.drop_table("refresh_tokens")
