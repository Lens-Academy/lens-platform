"""Substack subscriber sync — runs as a scheduled job.

Uses cloudscraper to POST to Substack's publisher API, adding pending
prospects as free subscribers.  Requires SUBSTACK_COOKIES env var with
a valid session (substack.sid + cf_clearance + substack.lli).
"""

import asyncio
import logging
import os
import random

import cloudscraper

from .prospects import get_pending_substack_emails, mark_substack_synced

log = logging.getLogger(__name__)

SUBSTACK_URL = "https://lensacademy.substack.com"
SUBSCRIBER_ADD_ENDPOINT = f"{SUBSTACK_URL}/api/v1/subscriber/add"


def _parse_cookies(cookie_string: str) -> dict[str, str]:
    """Parse a cookie header string into a dict."""
    cookies = {}
    for pair in cookie_string.split(";"):
        pair = pair.strip()
        if "=" in pair:
            name, value = pair.split("=", 1)
            cookies[name.strip()] = value.strip()
    return cookies


def _add_subscriber(
    scraper: cloudscraper.CloudScraper,
    cookies: dict[str, str],
    email: str,
) -> tuple[bool, str]:
    """Add a single subscriber. Returns (success, message)."""
    resp = scraper.post(
        SUBSCRIBER_ADD_ENDPOINT,
        json={"email": email, "subscription": False, "sendEmail": True},
        headers={
            "Accept": "application/json",
            "Origin": SUBSTACK_URL,
            "Referer": f"{SUBSTACK_URL}/publish/subscribers/add",
        },
        cookies=cookies,
        allow_redirects=False,
    )

    if resp.status_code == 403:
        return False, "403 Forbidden — cookies may be expired"

    content_type = resp.headers.get("content-type", "")
    if "text/html" in content_type:
        return (
            False,
            "got HTML response — cookies may be expired or Cloudflare challenge",
        )

    if resp.status_code != 200:
        return False, f"HTTP {resp.status_code}: {resp.text[:200]}"

    return True, "ok"


async def sync_substack_subscribers() -> None:
    """Sync pending prospects to Substack as free subscribers."""
    jitter = random.randint(0, 1800)  # 0-30 minutes
    await asyncio.sleep(jitter)

    cookie_string = os.environ.get("SUBSTACK_COOKIES", "")
    if not cookie_string:
        log.warning("SUBSTACK_COOKIES not set — skipping Substack sync")
        return

    emails = await get_pending_substack_emails()
    if not emails:
        log.info("No pending Substack subscribers to sync.")
        return

    log.info("%d email(s) to sync to Substack.", len(emails))

    cookies = _parse_cookies(cookie_string)
    scraper = cloudscraper.create_scraper()

    synced = 0
    failed = 0

    for i, email in enumerate(emails):
        ok, msg = await asyncio.to_thread(_add_subscriber, scraper, cookies, email)

        if ok:
            await mark_substack_synced(email)
            log.info("  OK %s", email)
            synced += 1
        else:
            log.error("  FAIL %s: %s", email, msg)
            failed += 1
            # Stop on auth errors — no point continuing with bad cookies
            if "cookies may be expired" in msg:
                log.error("Stopping sync — cookies appear expired.")
                break

        # Random delay between requests (2-10 seconds)
        if i < len(emails) - 1:
            await asyncio.sleep(random.uniform(2, 10))

    log.info("Done. Synced: %d, Failed: %d", synced, failed)
