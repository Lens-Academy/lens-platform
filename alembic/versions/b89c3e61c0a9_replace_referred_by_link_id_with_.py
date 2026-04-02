"""replace referred_by_link_id with referred_by_click_id

Revision ID: b89c3e61c0a9
Revises: cc7eecc71f98
Create Date: 2026-04-02 18:14:48.447337

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "b89c3e61c0a9"
down_revision: Union[str, None] = "cc7eecc71f98"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("referred_by_click_id", sa.Integer(), nullable=True)
    )
    op.create_foreign_key(
        op.f("fk_users_referred_by_click_id_referral_clicks"),
        "users",
        "referral_clicks",
        ["referred_by_click_id"],
        ["click_id"],
        ondelete="SET NULL",
    )
    op.drop_constraint(
        "fk_users_referred_by_link_id_referral_links", "users", type_="foreignkey"
    )
    op.drop_column("users", "referred_by_link_id")


def downgrade() -> None:
    op.add_column(
        "users", sa.Column("referred_by_link_id", sa.Integer(), nullable=True)
    )
    op.create_foreign_key(
        "fk_users_referred_by_link_id_referral_links",
        "users",
        "referral_links",
        ["referred_by_link_id"],
        ["link_id"],
        ondelete="SET NULL",
    )
    op.drop_constraint(
        op.f("fk_users_referred_by_click_id_referral_clicks"),
        "users",
        type_="foreignkey",
    )
    op.drop_column("users", "referred_by_click_id")
