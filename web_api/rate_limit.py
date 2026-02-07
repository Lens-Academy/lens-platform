"""Simple in-memory rate limiter for auth endpoints."""

import time
from collections import defaultdict

from fastapi import HTTPException, Request


class RateLimiter:
    """
    Token-bucket rate limiter keyed by client IP.

    Args:
        max_requests: Maximum requests allowed in the window.
        window_seconds: Time window in seconds.
    """

    def __init__(self, max_requests: int, window_seconds: int):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        # {ip: [timestamp, ...]}
        self._requests: dict[str, list[float]] = defaultdict(list)

    def _get_client_ip(self, request: Request) -> str:
        """Extract client IP, respecting X-Forwarded-For behind reverse proxy."""
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            # First IP in the chain is the original client
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    def check(self, request: Request) -> None:
        """Raise 429 if rate limit exceeded."""
        ip = self._get_client_ip(request)
        now = time.monotonic()
        cutoff = now - self.window_seconds

        # Prune old entries
        entries = self._requests[ip]
        self._requests[ip] = [t for t in entries if t > cutoff]

        if len(self._requests[ip]) >= self.max_requests:
            raise HTTPException(status_code=429, detail="Too many requests")

        self._requests[ip].append(now)


# Auth endpoint rate limiters
# OAuth start: 10 requests per minute (normal browsing)
oauth_start_limiter = RateLimiter(max_requests=10, window_seconds=60)

# Token refresh: 5 per minute (legitimate clients do 1 per 15 min)
refresh_limiter = RateLimiter(max_requests=5, window_seconds=60)
