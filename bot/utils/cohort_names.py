"""
Cohort name generation utility.
"""

# Cohort names - CS/math/rationalist pioneers
COHORT_NAMES = [ "Turing", "Lovelace", "Dijkstra", 
                "Hopper", "Bayes", "Euler", 
                "Gödel", "Hamming", "Chomsky",
                ]


class CohortNameGenerator:
    """Generates cohort names by cycling through the names list."""

    def __init__(self):
        self._counter = 0

    def next_name(self) -> str:
        """Get the next cohort name in the cycle."""
        name = COHORT_NAMES[self._counter % len(COHORT_NAMES)]
        self._counter += 1
        return name

    def reset(self):
        """Reset the counter to start from the beginning."""
        self._counter = 0

    @property
    def counter(self) -> int:
        """Current position in the name cycle."""
        return self._counter
