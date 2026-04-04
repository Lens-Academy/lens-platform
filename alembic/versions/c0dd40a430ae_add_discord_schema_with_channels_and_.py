"""add discord schema with channels and messages tables

Revision ID: c0dd40a430ae
Revises: 596f9a3689f0
Create Date: 2026-04-04 07:42:56.247478

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import TSVECTOR


# revision identifiers, used by Alembic.
revision: str = 'c0dd40a430ae'
down_revision: Union[str, None] = '596f9a3689f0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create discord schema
    op.execute("CREATE SCHEMA IF NOT EXISTS discord")

    # Create channels table
    op.create_table(
        "channels",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("guild_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("parent_id", sa.BigInteger(), nullable=True),
        sa.Column("topic", sa.Text(), nullable=True),
        sa.Column("webhook_id", sa.BigInteger(), nullable=True),
        sa.Column("webhook_token", sa.Text(), nullable=True),
        sa.Column(
            "synced_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("id"),
        schema="discord",
    )

    # Create messages table
    op.create_table(
        "messages",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("channel_id", sa.BigInteger(), nullable=False),
        sa.Column("thread_id", sa.BigInteger(), nullable=True),
        sa.Column("author_id", sa.BigInteger(), nullable=False),
        sa.Column("author_name", sa.Text(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reference_id", sa.BigInteger(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(), nullable=True),
        sa.Column(
            "search_vector",
            TSVECTOR(),
            sa.Computed("to_tsvector('english', content)", persisted=True),
        ),
        sa.ForeignKeyConstraint(
            ["channel_id"],
            ["discord.channels.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        schema="discord",
    )

    # Indexes
    op.create_index(
        "ix_discord_messages_channel_created",
        "messages",
        ["channel_id", "created_at"],
        schema="discord",
    )
    op.create_index(
        "ix_discord_messages_search_vector",
        "messages",
        ["search_vector"],
        schema="discord",
        postgresql_using="gin",
    )


def downgrade() -> None:
    op.drop_table("messages", schema="discord")
    op.drop_table("channels", schema="discord")
    op.execute("DROP SCHEMA IF EXISTS discord")
