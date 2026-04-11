"""Rename lesson_sessions to module_sessions.

Revision ID: 002
Revises: 001
Create Date: 2026-01-19

This migration renames:
- Table: lesson_sessions -> module_sessions
- Column: lesson_slug -> module_slug (in both module_sessions and content_events)
- Indexes accordingly
"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Rename lesson_sessions table and lesson_slug columns to module variants."""
    # 1. Drop foreign key constraint from content_events referencing lesson_sessions
    op.drop_constraint(
        "fk_content_events_session_id_lesson_sessions",
        "content_events",
        type_="foreignkey",
    )

    # 2. Rename the table
    op.rename_table("lesson_sessions", "module_sessions")

    # 3. Rename the column in module_sessions
    op.alter_column(
        "module_sessions",
        "lesson_slug",
        new_column_name="module_slug",
    )

    # 4. Rename the column in content_events
    op.alter_column(
        "content_events",
        "lesson_slug",
        new_column_name="module_slug",
    )

    # 5. Recreate foreign key constraint with new table name
    op.create_foreign_key(
        "fk_content_events_session_id_module_sessions",
        "content_events",
        "module_sessions",
        ["session_id"],
        ["session_id"],
        ondelete="CASCADE",
    )

    # 6. Drop old indexes
    op.drop_index("idx_lesson_sessions_user_id", table_name="module_sessions")
    op.drop_index("idx_lesson_sessions_lesson_slug", table_name="module_sessions")
    op.drop_index("idx_content_events_lesson_slug", table_name="content_events")

    # 7. Create new indexes with updated names
    op.create_index(
        "idx_module_sessions_user_id",
        "module_sessions",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "idx_module_sessions_module_slug",
        "module_sessions",
        ["module_slug"],
        unique=False,
    )
    op.create_index(
        "idx_content_events_module_slug",
        "content_events",
        ["module_slug"],
        unique=False,
    )


def downgrade() -> None:
    """Revert: rename module_sessions back to lesson_sessions."""
    # 1. Drop foreign key constraint
    op.drop_constraint(
        "fk_content_events_session_id_module_sessions",
        "content_events",
        type_="foreignkey",
    )

    # 2. Drop new indexes
    op.drop_index("idx_module_sessions_user_id", table_name="module_sessions")
    op.drop_index("idx_module_sessions_module_slug", table_name="module_sessions")
    op.drop_index("idx_content_events_module_slug", table_name="content_events")

    # 3. Rename columns back
    op.alter_column(
        "module_sessions",
        "module_slug",
        new_column_name="lesson_slug",
    )
    op.alter_column(
        "content_events",
        "module_slug",
        new_column_name="lesson_slug",
    )

    # 4. Rename table back
    op.rename_table("module_sessions", "lesson_sessions")

    # 5. Recreate foreign key constraint with old table name
    op.create_foreign_key(
        "fk_content_events_session_id_lesson_sessions",
        "content_events",
        "lesson_sessions",
        ["session_id"],
        ["session_id"],
        ondelete="CASCADE",
    )

    # 6. Recreate old indexes
    op.create_index(
        "idx_lesson_sessions_user_id",
        "lesson_sessions",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "idx_lesson_sessions_lesson_slug",
        "lesson_sessions",
        ["lesson_slug"],
        unique=False,
    )
    op.create_index(
        "idx_content_events_lesson_slug",
        "content_events",
        ["lesson_slug"],
        unique=False,
    )
