"""add referral tables and marketing consent

Revision ID: 596f9a3689f0
Revises: f511f3fcf68a
Create Date: 2026-03-28 18:54:24.156870

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '596f9a3689f0'
down_revision: Union[str, None] = 'f511f3fcf68a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create referral_links table
    op.create_table('referral_links',
    sa.Column('link_id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('name', sa.Text(), nullable=False),
    sa.Column('slug', sa.Text(), nullable=False),
    sa.Column('is_default', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('created_at', postgresql.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.Column('deleted_at', postgresql.TIMESTAMP(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.user_id'], name=op.f('fk_referral_links_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('link_id', name=op.f('pk_referral_links')),
    sa.UniqueConstraint('slug', name=op.f('uq_referral_links_slug'))
    )
    op.create_index('idx_referral_links_one_default_per_user', 'referral_links', ['user_id'], unique=True, postgresql_where=sa.text('is_default IS true'))
    op.create_index('idx_referral_links_user_id', 'referral_links', ['user_id'], unique=False)

    # Create referral_clicks table
    op.create_table('referral_clicks',
    sa.Column('click_id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('link_id', sa.Integer(), nullable=False),
    sa.Column('clicked_at', postgresql.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['link_id'], ['referral_links.link_id'], name=op.f('fk_referral_clicks_link_id_referral_links'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('click_id', name=op.f('pk_referral_clicks'))
    )
    op.create_index('idx_referral_clicks_link_id', 'referral_clicks', ['link_id'], unique=False)

    # Add marketing consent and referral columns to users
    op.add_column('users', sa.Column('cookies_marketing_consent', sa.Text(), nullable=True))
    op.add_column('users', sa.Column('cookies_marketing_consent_at', postgresql.TIMESTAMP(timezone=True), nullable=True))
    op.add_column('users', sa.Column('referred_by_link_id', sa.Integer(), nullable=True))
    op.create_check_constraint('ck_users_valid_cookies_marketing_consent', 'users', "cookies_marketing_consent IN ('accepted', 'declined')")
    op.create_foreign_key(op.f('fk_users_referred_by_link_id_referral_links'), 'users', 'referral_links', ['referred_by_link_id'], ['link_id'], ondelete='SET NULL')


def downgrade() -> None:
    op.drop_constraint(op.f('fk_users_referred_by_link_id_referral_links'), 'users', type_='foreignkey')
    op.drop_constraint('ck_users_valid_cookies_marketing_consent', 'users', type_='check')
    op.drop_column('users', 'referred_by_link_id')
    op.drop_column('users', 'cookies_marketing_consent_at')
    op.drop_column('users', 'cookies_marketing_consent')
    op.drop_index('idx_referral_clicks_link_id', table_name='referral_clicks')
    op.drop_table('referral_clicks')
    op.drop_index('idx_referral_links_user_id', table_name='referral_links')
    op.drop_index('idx_referral_links_one_default_per_user', table_name='referral_links', postgresql_where=sa.text('is_default IS true'))
    op.drop_table('referral_links')
