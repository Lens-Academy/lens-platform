"""Initial schema - MVP baseline.

Revision ID: 001
Revises:
Create Date: 2025-01-14

This is the baseline migration for the MVP launch.
For existing databases, run: alembic stamp 001
For new databases, this creates all tables from SQLAlchemy models.
"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create all tables from SQLAlchemy models."""
    # Import metadata to create tables
    from core.tables import metadata

    # Get connection and create all tables that don't exist
    bind = op.get_bind()
    metadata.create_all(bind, checkfirst=True)


def downgrade() -> None:
    """Drop all tables - use with caution!"""
    from core.tables import metadata

    bind = op.get_bind()
    metadata.drop_all(bind)
