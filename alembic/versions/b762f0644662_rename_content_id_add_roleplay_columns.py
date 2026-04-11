"""rename content_id add roleplay columns

Revision ID: b762f0644662
Revises: 79e06d6c97c8
Create Date: 2026-02-25 09:04:41.769380

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision: str = "b762f0644662"
down_revision: Union[str, None] = "79e06d6c97c8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Rename content_id -> module_id
    op.alter_column("chat_sessions", "content_id", new_column_name="module_id")

    # 2. Drop content_type column and its CHECK constraint
    op.execute(
        "ALTER TABLE chat_sessions DROP CONSTRAINT IF EXISTS valid_chat_content_type"
    )
    op.drop_column("chat_sessions", "content_type")

    # 3. Add new columns
    op.add_column("chat_sessions", sa.Column("roleplay_id", sa.UUID(), nullable=True))
    op.add_column(
        "chat_sessions", sa.Column("segment_snapshot", JSONB(), nullable=True)
    )

    # 4. Drop old unique partial indexes
    op.execute("DROP INDEX IF EXISTS idx_chat_sessions_unique_anon_active")
    op.execute("DROP INDEX IF EXISTS idx_chat_sessions_unique_user_active")

    # 5. Drop and recreate non-unique index with new column name
    op.execute("DROP INDEX IF EXISTS idx_chat_sessions_user_content")
    op.create_index(
        "idx_chat_sessions_user_content",
        "chat_sessions",
        ["user_id", "module_id", "archived_at"],
    )

    # 6. Create new partial unique indexes (separate for tutor/roleplay)
    op.execute("""
        CREATE UNIQUE INDEX idx_chat_sessions_unique_user_tutor
        ON chat_sessions (user_id, module_id)
        WHERE user_id IS NOT NULL AND roleplay_id IS NULL AND archived_at IS NULL
    """)
    op.execute("""
        CREATE UNIQUE INDEX idx_chat_sessions_unique_user_roleplay
        ON chat_sessions (user_id, module_id, roleplay_id)
        WHERE user_id IS NOT NULL AND roleplay_id IS NOT NULL AND archived_at IS NULL
    """)
    op.execute("""
        CREATE UNIQUE INDEX idx_chat_sessions_unique_anon_tutor
        ON chat_sessions (anonymous_token, module_id)
        WHERE anonymous_token IS NOT NULL AND roleplay_id IS NULL AND archived_at IS NULL
    """)
    op.execute("""
        CREATE UNIQUE INDEX idx_chat_sessions_unique_anon_roleplay
        ON chat_sessions (anonymous_token, module_id, roleplay_id)
        WHERE anonymous_token IS NOT NULL AND roleplay_id IS NOT NULL AND archived_at IS NULL
    """)

    # 7. Add index for roleplay_id queries
    op.create_index(
        "idx_chat_sessions_roleplay_id",
        "chat_sessions",
        ["roleplay_id"],
        postgresql_where=sa.text("roleplay_id IS NOT NULL"),
    )


def downgrade() -> None:
    # Drop new indexes
    op.drop_index("idx_chat_sessions_roleplay_id", table_name="chat_sessions")
    op.execute("DROP INDEX IF EXISTS idx_chat_sessions_unique_anon_roleplay")
    op.execute("DROP INDEX IF EXISTS idx_chat_sessions_unique_anon_tutor")
    op.execute("DROP INDEX IF EXISTS idx_chat_sessions_unique_user_roleplay")
    op.execute("DROP INDEX IF EXISTS idx_chat_sessions_unique_user_tutor")

    # Drop and recreate non-unique index with old column name
    op.execute("DROP INDEX IF EXISTS idx_chat_sessions_user_content")

    # Recreate old unique indexes
    op.execute("""
        CREATE UNIQUE INDEX idx_chat_sessions_unique_user_active
        ON chat_sessions (user_id, content_id)
        WHERE user_id IS NOT NULL AND archived_at IS NULL
    """)
    op.execute("""
        CREATE UNIQUE INDEX idx_chat_sessions_unique_anon_active
        ON chat_sessions (anonymous_token, content_id)
        WHERE anonymous_token IS NOT NULL AND archived_at IS NULL
    """)

    # Drop new columns
    op.drop_column("chat_sessions", "segment_snapshot")
    op.drop_column("chat_sessions", "roleplay_id")

    # Restore content_type column with CHECK
    op.add_column("chat_sessions", sa.Column("content_type", sa.Text(), nullable=True))
    op.execute("""
        ALTER TABLE chat_sessions ADD CONSTRAINT valid_chat_content_type
        CHECK (content_type IS NULL OR content_type IN ('module', 'lo', 'lens', 'test', 'feedback'))
    """)

    # Rename module_id back to content_id
    op.alter_column("chat_sessions", "module_id", new_column_name="content_id")

    # Recreate old non-unique index
    op.create_index(
        "idx_chat_sessions_user_content",
        "chat_sessions",
        ["user_id", "content_id", "archived_at"],
    )
