"""Refresh token database queries using SQLAlchemy Core."""

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete, insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from ..tables import refresh_tokens


REFRESH_TOKEN_EXPIRES_DAYS = 30


async def store_refresh_token(
    conn: AsyncConnection,
    token_hash: str,
    user_id: int,
    family_id: str,
    expires_days: int = REFRESH_TOKEN_EXPIRES_DAYS,
) -> dict[str, Any]:
    """Store a new refresh token and return the created record."""
    expires_at = datetime.now(timezone.utc) + timedelta(days=expires_days)

    result = await conn.execute(
        insert(refresh_tokens)
        .values(
            token_hash=token_hash,
            user_id=user_id,
            family_id=family_id,
            expires_at=expires_at,
        )
        .returning(refresh_tokens)
    )
    row = result.mappings().first()
    return dict(row)


async def get_refresh_token_by_hash(
    conn: AsyncConnection,
    token_hash: str,
    for_update: bool = False,
) -> dict[str, Any] | None:
    """Look up a refresh token by its hash.

    Args:
        for_update: If True, acquires a row lock (SELECT FOR UPDATE) to
            prevent concurrent rotation of the same token.
    """
    query = select(refresh_tokens).where(refresh_tokens.c.token_hash == token_hash)
    if for_update:
        query = query.with_for_update()
    result = await conn.execute(query)
    row = result.mappings().first()
    return dict(row) if row else None


async def revoke_token(
    conn: AsyncConnection,
    token_id: int,
) -> None:
    """Revoke a single refresh token by setting revoked_at."""
    await conn.execute(
        update(refresh_tokens)
        .where(refresh_tokens.c.token_id == token_id)
        .values(revoked_at=datetime.now(timezone.utc))
    )


async def revoke_family(
    conn: AsyncConnection,
    family_id: str,
) -> None:
    """Revoke all non-revoked tokens in a rotation family."""
    await conn.execute(
        update(refresh_tokens)
        .where(refresh_tokens.c.family_id == family_id)
        .where(refresh_tokens.c.revoked_at.is_(None))
        .values(revoked_at=datetime.now(timezone.utc))
    )


async def revoke_all_user_tokens(
    conn: AsyncConnection,
    user_id: int,
) -> None:
    """Revoke all refresh tokens for a user (logout everywhere)."""
    await conn.execute(
        update(refresh_tokens)
        .where(refresh_tokens.c.user_id == user_id)
        .where(refresh_tokens.c.revoked_at.is_(None))
        .values(revoked_at=datetime.now(timezone.utc))
    )


async def cleanup_expired_tokens(
    conn: AsyncConnection,
) -> int:
    """Delete tokens that expired more than 7 days ago. Returns count deleted."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    result = await conn.execute(
        delete(refresh_tokens).where(refresh_tokens.c.expires_at < cutoff)
    )
    return result.rowcount
