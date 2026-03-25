"""Git-based content fetching.

Replaces GitHub API calls with local git operations.
Clone on first use, fetch/reset on updates, read files from disk.
"""

import asyncio
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

TRACKED_DIRECTORIES = (
    "modules",
    "courses",
    "articles",
    "video_transcripts",
    "Learning Outcomes",
    "Lenses",
)

TRACKED_EXTENSIONS = (".md", ".timestamps.json")


async def _run_git(args: list[str], cwd: Path) -> str:
    """Run a git command and return stdout."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "git",
            *args,
            cwd=cwd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError:
        raise RuntimeError("git is not installed. Install git to use content fetching.")
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(
            f"git {' '.join(args)} failed (exit {proc.returncode}): {stderr.decode()}"
        )
    return stdout.decode().strip()


async def clone_repo(repo_url: str, branch: str, clone_dir: Path) -> None:
    """Clone the content repo (single branch)."""
    logger.info("Cloning %s (branch %s) to %s", repo_url, branch, clone_dir)
    proc = await asyncio.create_subprocess_exec(
        "git",
        "clone",
        "--branch",
        branch,
        "--single-branch",
        repo_url,
        str(clone_dir),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"git clone failed: {stderr.decode()}")
    logger.info("Clone complete")


async def fetch_and_reset(clone_dir: Path, branch: str) -> str:
    """Fetch latest and hard-reset to remote HEAD. Returns new HEAD SHA."""
    await _run_git(["fetch", "origin", branch], cwd=clone_dir)
    await _run_git(["reset", "--hard", f"origin/{branch}"], cwd=clone_dir)
    return await get_head_sha(clone_dir)


async def get_head_sha(clone_dir: Path) -> str:
    """Get the current HEAD commit SHA."""
    return await _run_git(["rev-parse", "HEAD"], cwd=clone_dir)


async def fetch_latest_sha(clone_dir: Path, branch: str) -> str:
    """Check latest remote SHA without changing the working tree.

    Uses git ls-remote (lightweight — just checks refs, no object download).
    """
    output = await _run_git(
        ["ls-remote", "origin", f"refs/heads/{branch}"], cwd=clone_dir
    )
    if output:
        return output.split("\t")[0]
    raise RuntimeError(f"Branch {branch} not found on remote")


async def read_all_files(clone_dir: Path) -> dict[str, str]:
    """Read all tracked files from the cloned repo.

    Returns dict mapping relative path (forward slashes) to file content string.
    Only includes files in TRACKED_DIRECTORIES with TRACKED_EXTENSIONS.
    """
    files: dict[str, str] = {}

    for dir_name in TRACKED_DIRECTORIES:
        dir_path = clone_dir / dir_name
        if not dir_path.exists():
            continue

        for file_path in dir_path.rglob("*"):
            if not file_path.is_file():
                continue
            if not any(file_path.name.endswith(ext) for ext in TRACKED_EXTENSIONS):
                continue

            relative_path = file_path.relative_to(clone_dir).as_posix()
            try:
                files[relative_path] = file_path.read_text(encoding="utf-8")
            except Exception as e:
                logger.warning("Failed to read %s: %s", relative_path, e)

    return files
