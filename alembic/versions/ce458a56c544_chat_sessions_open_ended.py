"""chat_sessions_open_ended

Revision ID: ce458a56c544
Revises: 4fedfe9102c9
Create Date: 2026-04-12 13:09:33.188551

"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "ce458a56c544"
down_revision: Union[str, None] = "4fedfe9102c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "idx_chat_sessions_unique_user_open_ended",
        "chat_sessions",
        ["user_id"],
        unique=True,
        postgresql_where="user_id IS NOT NULL AND module_id IS NULL AND roleplay_id IS NULL AND archived_at IS NULL",
    )


def downgrade() -> None:
    op.drop_index(
        "idx_chat_sessions_unique_user_open_ended", table_name="chat_sessions"
    )
