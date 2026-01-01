"""add_lesson_sessions

Revision ID: d448668f9f24
Revises: 39e3de01c3b8
Create Date: 2026-01-01 12:49:44.940208

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'd448668f9f24'
down_revision: Union[str, None] = '39e3de01c3b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'lesson_sessions',
        sa.Column('session_id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('lesson_id', sa.Text(), nullable=False),
        sa.Column('current_stage_index', sa.Integer(), server_default='0', nullable=True),
        sa.Column('messages', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=True),
        sa.Column('started_at', postgresql.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('last_active_at', postgresql.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('completed_at', postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.user_id'], name=op.f('fk_lesson_sessions_user_id_users'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('session_id', name=op.f('pk_lesson_sessions'))
    )
    op.create_index('idx_lesson_sessions_lesson_id', 'lesson_sessions', ['lesson_id'], unique=False)
    op.create_index('idx_lesson_sessions_user_id', 'lesson_sessions', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index('idx_lesson_sessions_user_id', table_name='lesson_sessions')
    op.drop_index('idx_lesson_sessions_lesson_id', table_name='lesson_sessions')
    op.drop_table('lesson_sessions')
