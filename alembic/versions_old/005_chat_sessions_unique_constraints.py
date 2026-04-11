"""Add unique constraints to chat_sessions to prevent race condition duplicates.

Revision ID: 005
Revises: 004
Create Date: 2026-01-29

Adds partial unique indexes on (anonymous_token, content_id) and (user_id, content_id)
for active (non-archived) sessions. This prevents race conditions from creating
duplicate sessions when concurrent requests occur.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # First, clean up existing duplicates (keep the one with most messages)
    # For anonymous sessions
    op.execute("""
        WITH duplicates AS (
            SELECT session_id,
                   ROW_NUMBER() OVER (
                       PARTITION BY anonymous_token, content_id
                       ORDER BY jsonb_array_length(messages) DESC, session_id DESC
                   ) as rn
            FROM chat_sessions
            WHERE anonymous_token IS NOT NULL
              AND archived_at IS NULL
        ),
        to_delete AS (
            SELECT session_id FROM duplicates WHERE rn > 1
        )
        DELETE FROM chat_sessions WHERE session_id IN (SELECT session_id FROM to_delete)
    """)

    # For user sessions
    op.execute("""
        WITH duplicates AS (
            SELECT session_id,
                   ROW_NUMBER() OVER (
                       PARTITION BY user_id, content_id
                       ORDER BY jsonb_array_length(messages) DESC, session_id DESC
                   ) as rn
            FROM chat_sessions
            WHERE user_id IS NOT NULL
              AND archived_at IS NULL
        ),
        to_delete AS (
            SELECT session_id FROM duplicates WHERE rn > 1
        )
        DELETE FROM chat_sessions WHERE session_id IN (SELECT session_id FROM to_delete)
    """)

    # Add unique partial index for anonymous active sessions
    op.create_index(
        "idx_chat_sessions_unique_anon_active",
        "chat_sessions",
        ["anonymous_token", "content_id"],
        unique=True,
        postgresql_where=sa.text("anonymous_token IS NOT NULL AND archived_at IS NULL"),
    )

    # Add unique partial index for user active sessions
    op.create_index(
        "idx_chat_sessions_unique_user_active",
        "chat_sessions",
        ["user_id", "content_id"],
        unique=True,
        postgresql_where=sa.text("user_id IS NOT NULL AND archived_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("idx_chat_sessions_unique_user_active", table_name="chat_sessions")
    op.drop_index("idx_chat_sessions_unique_anon_active", table_name="chat_sessions")
