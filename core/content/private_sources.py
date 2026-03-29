"""Fetch private reference content (e.g. copyrighted books) for tutor search.

Clones a private GitHub repo and reads markdown files into memory.
Content is added to the ContentIndex for search/read but never exposed
to users via the modules API.
"""

import asyncio
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

REPO = "Lens-Academy/tutor-private-sources"
BRANCH = "main"


def _clone_dir() -> Path:
    import os

    port = os.getenv("API_PORT", "8000")
    return Path(f"/tmp/tutor-private-sources-{port}")


async def _run_git(args: list[str], cwd: Path) -> str:
    proc = await asyncio.create_subprocess_exec(
        "git",
        *args,
        cwd=cwd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(
            f"git {' '.join(args)} failed (exit {proc.returncode}): {stderr.decode()}"
        )
    return stdout.decode().strip()


async def fetch_private_sources() -> dict[str, str]:
    """Clone/fetch the private sources repo and return {path: content} for all .md files.

    path format: "IABIED/01 - Chapter 1 - Humanity's Special Power"
    (directory/filename without extension)
    """
    import os

    token = os.getenv("GITHUB_TOKEN", "")
    if not token:
        raise RuntimeError("GITHUB_TOKEN required to fetch private sources")

    clone_dir = _clone_dir()
    repo_url = f"https://x-access-token:{token}@github.com/{REPO}.git"

    if not clone_dir.exists():
        logger.info("Cloning %s to %s", REPO, clone_dir)
        proc = await asyncio.create_subprocess_exec(
            "git",
            "clone",
            "--branch",
            BRANCH,
            "--single-branch",
            repo_url,
            str(clone_dir),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(f"git clone failed: {stderr.decode()}")
    else:
        try:
            await _run_git(["fetch", "origin", BRANCH], cwd=clone_dir)
            await _run_git(["reset", "--hard", f"origin/{BRANCH}"], cwd=clone_dir)
        except RuntimeError as e:
            logger.warning("Failed to update private sources (using cached): %s", e)

    # Read all markdown files
    files: dict[str, str] = {}
    for md_file in clone_dir.rglob("*.md"):
        if md_file.name.startswith("."):
            continue
        relative = md_file.relative_to(clone_dir)
        # Use directory/stem as the path key (e.g. "IABIED/01 - Chapter 1 - ...")
        path_key = str(relative.with_suffix(""))
        try:
            files[path_key] = md_file.read_text(encoding="utf-8")
        except Exception as e:
            logger.warning("Failed to read %s: %s", path_key, e)

    return files
