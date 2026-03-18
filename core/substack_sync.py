"""Substack subscriber sync — runs as a scheduled job."""

import asyncio
import os
import random
import subprocess
from pathlib import Path


async def sync_substack_subscribers():
    """Run Substack sync script with random jitter to avoid bot detection."""
    jitter = random.randint(0, 1800)  # 0-30 minutes
    await asyncio.sleep(jitter)

    project_root = Path(__file__).parent.parent
    api_port = os.environ.get("API_PORT", "8000")
    env = {**os.environ, "API_PORT": api_port}
    subprocess.run(
        ["node", "scripts/sync-substack.mjs"],
        cwd=str(project_root),
        env=env,
    )
