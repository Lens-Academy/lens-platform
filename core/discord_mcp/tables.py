"""SQLAlchemy Core table definitions for the discord schema."""

from sqlalchemy import (
    BigInteger,
    Column,
    Computed,
    DateTime,
    ForeignKey,
    Index,
    MetaData,
    Table,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR

# Separate metadata for discord schema — not managed by alembic autogenerate
discord_metadata = MetaData(schema="discord")

channels = Table(
    "channels",
    discord_metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=False),
    Column("guild_id", BigInteger, nullable=False),
    Column("name", Text, nullable=False),
    Column("type", Text, nullable=False),
    Column("parent_id", BigInteger),
    Column("topic", Text),
    Column("webhook_id", BigInteger),
    Column("webhook_token", Text),
    Column("synced_at", DateTime(timezone=True)),
)

messages = Table(
    "messages",
    discord_metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=False),
    Column(
        "channel_id",
        BigInteger,
        ForeignKey("discord.channels.id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("thread_id", BigInteger),
    Column("author_id", BigInteger, nullable=False),
    Column("author_name", Text, nullable=False),
    Column("content", Text, nullable=False, server_default=""),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("edited_at", DateTime(timezone=True)),
    Column("reference_id", BigInteger),
    Column("metadata", JSONB),
    Column(
        "search_vector",
        TSVECTOR,
        Computed("to_tsvector('english', content)", persisted=True),
    ),
    Index("ix_discord_messages_channel_created", "channel_id", "created_at"),
    Index(
        "ix_discord_messages_search_vector",
        "search_vector",
        postgresql_using="gin",
    ),
)
