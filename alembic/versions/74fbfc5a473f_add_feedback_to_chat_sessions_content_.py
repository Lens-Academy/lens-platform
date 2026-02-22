"""add feedback to chat_sessions content_type check

Revision ID: 74fbfc5a473f
Revises: 81cd8b19868b
Create Date: 2026-02-20 13:21:39.589648

"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "74fbfc5a473f"
down_revision: Union[str, None] = "81cd8b19868b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop old CHECK constraint and add new one with 'feedback' included
    # Use raw SQL to avoid naming convention issues with op.drop_constraint
    op.execute("ALTER TABLE chat_sessions DROP CONSTRAINT ck_chat_sessions_valid_chat_content_type")
    op.execute(
        "ALTER TABLE chat_sessions ADD CONSTRAINT ck_chat_sessions_valid_chat_content_type "
        "CHECK (content_type IS NULL OR content_type IN ('module', 'lo', 'lens', 'test', 'feedback'))"
    )


def downgrade() -> None:
    # Revert to old CHECK constraint without 'feedback'
    op.execute("ALTER TABLE chat_sessions DROP CONSTRAINT ck_chat_sessions_valid_chat_content_type")
    op.execute(
        "ALTER TABLE chat_sessions ADD CONSTRAINT ck_chat_sessions_valid_chat_content_type "
        "CHECK (content_type IS NULL OR content_type IN ('module', 'lo', 'lens', 'test'))"
    )
