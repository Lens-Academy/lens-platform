"""add consent_state to referral_clicks

Revision ID: ff664bf133de
Revises: 596f9a3689f0
Create Date: 2026-03-30 16:37:23.357205

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'ff664bf133de'
down_revision: Union[str, None] = '596f9a3689f0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('referral_clicks', sa.Column('consent_state', sa.Text(), server_default=sa.text("'pending'"), nullable=False))
    op.create_check_constraint('consent_state_values', 'referral_clicks', "consent_state IN ('accepted', 'declined', 'pending')")


def downgrade() -> None:
    op.drop_constraint('consent_state_values', 'referral_clicks', type_='check')
    op.drop_column('referral_clicks', 'consent_state')
