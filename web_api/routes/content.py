"""
Content management API routes.

Endpoints:
- POST /api/content/webhook - Handle GitHub push webhook to refresh cache
- POST /api/content/refresh - Manual refresh for development
"""

import logging
import sys
from pathlib import Path

from fastapi import APIRouter, Request, HTTPException

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.content import refresh_cache

router = APIRouter(prefix="/api/content", tags=["content"])

logger = logging.getLogger(__name__)


@router.post("/webhook")
async def github_webhook(request: Request):
    """
    Handle GitHub push webhook to refresh content cache.

    Called by GitHub when content repo is pushed to.
    TODO: Add webhook signature verification with GITHUB_WEBHOOK_SECRET
    """
    logger.info("GitHub webhook received, refreshing content cache...")

    try:
        await refresh_cache()
        logger.info("Content cache refreshed successfully via webhook")
        return {"status": "ok", "message": "Cache refreshed"}
    except Exception as e:
        logger.error(f"Cache refresh failed: {e}")
        raise HTTPException(status_code=500, detail=f"Cache refresh failed: {e}")


@router.post("/refresh")
async def manual_refresh():
    """
    Manually refresh the content cache.

    For local development when webhooks aren't available.
    TODO: Add admin authentication
    """
    logger.info("Manual cache refresh requested...")

    try:
        await refresh_cache()
        logger.info("Content cache refreshed successfully via manual request")
        return {"status": "ok", "message": "Cache refreshed"}
    except Exception as e:
        logger.error(f"Cache refresh failed: {e}")
        raise HTTPException(status_code=500, detail=f"Cache refresh failed: {e}")
