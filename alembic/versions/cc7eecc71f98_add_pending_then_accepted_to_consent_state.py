"""add pending_then_accepted to consent_state check constraint

Revision ID: cc7eecc71f98
Revises: ff664bf133de
Create Date: 2026-04-02 17:43:19.755121

"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "cc7eecc71f98"
down_revision: Union[str, None] = "ff664bf133de"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE referral_clicks DROP CONSTRAINT ck_referral_clicks_consent_state_values")
    op.execute(
        "ALTER TABLE referral_clicks ADD CONSTRAINT ck_referral_clicks_consent_state_values "
        "CHECK (consent_state IN ('accepted', 'declined', 'pending', 'pending_then_accepted'))"
    )


def downgrade() -> None:
    op.execute("UPDATE referral_clicks SET consent_state = 'accepted' WHERE consent_state = 'pending_then_accepted'")
    op.execute("ALTER TABLE referral_clicks DROP CONSTRAINT ck_referral_clicks_consent_state_values")
    op.execute(
        "ALTER TABLE referral_clicks ADD CONSTRAINT ck_referral_clicks_consent_state_values "
        "CHECK (consent_state IN ('accepted', 'declined', 'pending'))"
    )
