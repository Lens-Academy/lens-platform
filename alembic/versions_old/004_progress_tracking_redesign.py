"""Progress tracking redesign - new tables.

Revision ID: 004
Revises: 015910bd441a
Create Date: 2026-01-27

Creates user_content_progress and chat_sessions tables.
Does NOT drop old tables - they remain for migration/rollback.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision: str = "004"
down_revision: Union[str, None] = "015910bd441a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create user_content_progress table
    op.create_table(
        "user_content_progress",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("anonymous_token", UUID(as_uuid=True), nullable=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.user_id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("content_id", UUID(as_uuid=True), nullable=False),
        sa.Column("content_type", sa.Text(), nullable=False),
        sa.Column("content_title", sa.Text(), nullable=False),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "time_to_complete_s", sa.Integer(), server_default="0", nullable=False
        ),
        sa.Column(
            "total_time_spent_s", sa.Integer(), server_default="0", nullable=False
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "content_type IN ('module', 'lo', 'lens', 'test')",
            name="valid_content_type",
        ),
    )

    # Partial unique index for authenticated users
    op.create_index(
        "idx_user_content_progress_user",
        "user_content_progress",
        ["user_id", "content_id"],
        unique=True,
        postgresql_where=sa.text("user_id IS NOT NULL"),
    )

    # Partial unique index for anonymous users
    op.create_index(
        "idx_user_content_progress_anon",
        "user_content_progress",
        ["anonymous_token", "content_id"],
        unique=True,
        postgresql_where=sa.text("anonymous_token IS NOT NULL"),
    )

    # Index for claiming (UPDATE WHERE anonymous_token = ?)
    op.create_index(
        "idx_user_content_progress_token",
        "user_content_progress",
        ["anonymous_token"],
        postgresql_where=sa.text("anonymous_token IS NOT NULL"),
    )

    # Create chat_sessions table
    op.create_table(
        "chat_sessions",
        sa.Column("session_id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("anonymous_token", UUID(as_uuid=True), nullable=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.user_id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("content_id", UUID(as_uuid=True), nullable=True),
        sa.Column("content_type", sa.Text(), nullable=True),
        sa.Column("messages", JSONB(), server_default="[]", nullable=False),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "last_active_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("session_id"),
        sa.CheckConstraint(
            "content_type IS NULL OR content_type IN ('module', 'lo', 'lens', 'test')",
            name="valid_chat_content_type",
        ),
    )

    # Index for finding active chat by user + content
    op.create_index(
        "idx_chat_sessions_user_content",
        "chat_sessions",
        ["user_id", "content_id", "archived_at"],
    )

    # Index for claiming
    op.create_index(
        "idx_chat_sessions_token",
        "chat_sessions",
        ["anonymous_token"],
    )


def downgrade() -> None:
    op.drop_table("chat_sessions")
    op.drop_table("user_content_progress")
