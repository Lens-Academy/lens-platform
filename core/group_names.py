"""Group name generation -- assigns memorable names to study groups."""

import random

from sqlalchemy import and_, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncConnection

from .tables import groups

# 50 notable thinkers spanning math, CS, philosophy, and science.
# Diverse across gender, era, and geography.
GROUP_NAMES = [
    "Al-Khwarizmi",
    "Archimedes",
    "Aristotle",
    "Babbage",
    "Bayes",
    "Bose",
    "Brahmagupta",
    "Chomsky",
    "Curie",
    "Darwin",
    "Descartes",
    "Dijkstra",
    "Einstein",
    "Euclid",
    "Euler",
    "Faraday",
    "Feynman",
    "Franklin",
    "Galileo",
    "Gauss",
    "Godel",
    "Hawking",
    "Hopper",
    "Hypatia",
    "Ibn Sina",
    "Johnson",
    "Kepler",
    "Khayyam",
    "Knuth",
    "Kolmogorov",
    "Lamarr",
    "Lovelace",
    "Maxwell",
    "Mirzakhani",
    "Newton",
    "Noether",
    "Pascal",
    "Planck",
    "Ramanujan",
    "Riemann",
    "Russell",
    "Seki",
    "Shannon",
    "Socrates",
    "Tesla",
    "Turing",
    "Vaughan",
    "Von Neumann",
    "Wiener",
    "Wu",
    "Zhang Heng",
]

COOLDOWN_DAYS = 30


async def pick_available_name(conn: AsyncConnection) -> str:
    """
    Pick a random group name not currently in use.

    A name is "in use" if:
    - An active or preview group uses it, OR
    - A completed/merged/cancelled group uses it and ended within the last
      30 days (based on actual_end_date, falling back to expected_end_date)

    Falls back to "Group N" if all names are exhausted.
    """
    # Find names currently in use
    recently_ended = and_(
        groups.c.status.in_(["completed", "merged", "cancelled"]),
        or_(
            func.coalesce(groups.c.actual_end_date, groups.c.expected_end_date)
            > text(f"CURRENT_DATE - INTERVAL '{COOLDOWN_DAYS} days'"),
            # No end date recorded — treat as still in cooldown
            and_(
                groups.c.actual_end_date.is_(None),
                groups.c.expected_end_date.is_(None),
            ),
        ),
    )

    active_or_preview = groups.c.status.in_(["active", "preview"])

    query = select(groups.c.group_name).where(or_(active_or_preview, recently_ended))
    result = await conn.execute(query)
    used_names = {row.group_name for row in result}

    available = [n for n in GROUP_NAMES if n not in used_names]

    if available:
        return random.choice(available)

    # Fallback: find next unused number
    n = 1
    while f"Group {n}" in used_names:
        n += 1
    return f"Group {n}"
