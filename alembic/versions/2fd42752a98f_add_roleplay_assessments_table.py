"""add roleplay_assessments table

Revision ID: 2fd42752a98f
Revises: a8f9a97a3d5e
Create Date: 2026-03-02 15:42:25.883836

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '2fd42752a98f'
down_revision: Union[str, None] = 'a8f9a97a3d5e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('roleplay_assessments',
    sa.Column('assessment_id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('session_id', sa.Integer(), nullable=False),
    sa.Column('score_data', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('model_id', sa.Text(), nullable=True),
    sa.Column('prompt_version', sa.Text(), nullable=True),
    sa.Column('created_at', postgresql.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['session_id'], ['chat_sessions.session_id'], name=op.f('fk_roleplay_assessments_session_id_chat_sessions'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('assessment_id', name=op.f('pk_roleplay_assessments'))
    )
    op.create_index('idx_roleplay_assessments_session_id', 'roleplay_assessments', ['session_id'], unique=False)


def downgrade() -> None:
    op.drop_index('idx_roleplay_assessments_session_id', table_name='roleplay_assessments')
    op.drop_table('roleplay_assessments')
