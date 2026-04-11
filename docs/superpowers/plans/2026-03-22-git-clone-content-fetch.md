# Git Clone Content Fetch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace GitHub API-based content fetching with git clone/pull to eliminate API rate limit issues (5000 calls/hour shared across all workspaces).

**Architecture:** Clone the content repo once on startup, read all files from disk. On webhook/poll, `git fetch && git reset --hard` then re-read all files from disk. The GitHub Compare API is still used for the frontend diff display (1 API call per webhook — not a rate limit concern). All downstream processing (TypeScript, cache building) stays identical.

**Tech Stack:** git CLI (via asyncio subprocess), Python pathlib for file reading

---

## What Changes

| Component | Before (API) | After (git clone) |
|-----------|-------------|-------------------|
| **Startup** | 6 list-dir + 536 file-fetch API calls | `git clone` + read from disk (0 API calls) |
| **Incremental refresh** | Compare API + N file-fetch API calls | `git fetch && reset` + `read_all_files()` from disk + Compare API for frontend diff (1 API call) |
| **SSE poll** | `GET /repos/.../commits/staging` every 10s | `git ls-remote` (0 API calls, uses git protocol) |
| **`get_latest_commit_sha()`** | GitHub API call | `git ls-remote` (git protocol, no rate limit) |
| **RAM** | Identical — still builds `raw_files: dict[str, str]` for TypeScript processor |

## What Doesn't Change

- `ContentCache` dataclass structure
- TypeScript processor (still receives `dict[str, str]` on stdin)
- Webhook handler flow (`handle_content_update` still calls incremental refresh)
- SSE broadcaster (still broadcasts cache snapshots)
- All API endpoints
- Frontend diff display (still uses GitHub Compare API — 1 call per webhook)

## Key Simplification

The old `incremental_refresh()` had complex logic: fetch only changed files via API, merge into `raw_files` dict, handle add/modify/remove/rename cases. With git, we just:

1. `git fetch && git reset --hard` — working tree is now at new commit
2. `read_all_files()` — re-read everything from disk into fresh `dict[str, str]`
3. Feed to TypeScript processor (same as before)

No merge logic needed. Git handles the file state. We still use the GitHub Compare API for the frontend diff display, which is a single API call.

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `core/content/git_fetcher.py` | Create | Git clone/pull/read operations |
| `core/content/github_fetcher.py` | Modify | Delegates I/O to git_fetcher, keeps public API |
| `core/content/tests/test_git_fetcher.py` | Create | Tests for git operations |
| `core/content/tests/test_github_fetcher.py` | Modify | Update mocks from API → git |

---

### Task 1: Git Clone & Read Files

Create the core git operations module.

**Files:**
- Create: `core/content/git_fetcher.py`
- Test: `core/content/tests/test_git_fetcher.py`

- [ ] **Step 1: Write failing tests**

Tests are unit+1 — they operate on a real temp git repo, not mocks.

```python
# core/content/tests/test_git_fetcher.py
"""Tests for git-based content fetching.

Uses a real temp git repo — no mocking of git operations.
"""
import os
import pytest
from pathlib import Path

from core.content.git_fetcher import (
    read_all_files,
    get_head_sha,
    clone_repo,
    fetch_and_reset,
    fetch_latest_sha,
)


@pytest.fixture
def temp_repo(tmp_path):
    """Create a temporary bare + working git repo pair."""
    import subprocess

    # Create a bare "remote" repo
    bare = tmp_path / "remote.git"
    subprocess.run(["git", "init", "--bare", str(bare)], check=True, capture_output=True)

    # Clone it to create a working repo (simulates the content repo)
    origin = tmp_path / "origin"
    subprocess.run(
        ["git", "clone", str(bare), str(origin)],
        check=True, capture_output=True,
    )
    subprocess.run(
        ["git", "config", "user.email", "test@test.com"],
        cwd=origin, check=True, capture_output=True,
    )
    subprocess.run(
        ["git", "config", "user.name", "Test"],
        cwd=origin, check=True, capture_output=True,
    )

    # Create tracked directory structure
    for d in ["modules", "articles", "courses", "video_transcripts", "Lenses", "Learning Outcomes"]:
        (origin / d).mkdir()

    # Add files
    (origin / "modules" / "intro.md").write_text("---\nslug: intro\n---\n# Intro")
    (origin / "articles" / "article1.md").write_text("---\ntitle: Article 1\n---\nContent")
    (origin / "courses" / "course1.md").write_text("---\nslug: course1\n---\n")
    (origin / "README.md").write_text("# Not tracked")

    subprocess.run(["git", "add", "."], cwd=origin, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "initial"], cwd=origin, check=True, capture_output=True)
    subprocess.run(["git", "push"], cwd=origin, check=True, capture_output=True)

    return {"bare": bare, "origin": origin, "tmp": tmp_path}


@pytest.mark.asyncio
async def test_clone_and_read_all_files(temp_repo):
    """Should clone repo and read all tracked files."""
    clone_dir = temp_repo["tmp"] / "clone"
    await clone_repo(str(temp_repo["bare"]), "main", clone_dir)

    files = await read_all_files(clone_dir)

    assert "modules/intro.md" in files
    assert "articles/article1.md" in files
    assert "courses/course1.md" in files
    assert "README.md" not in files  # Not in a tracked directory
    assert "slug: intro" in files["modules/intro.md"]


@pytest.mark.asyncio
async def test_read_all_files_recursive(temp_repo):
    """Should read files in subdirectories."""
    import subprocess
    origin = temp_repo["origin"]

    (origin / "modules" / "subdir").mkdir()
    (origin / "modules" / "subdir" / "nested.md").write_text("---\nslug: nested\n---\n")
    subprocess.run(["git", "add", "."], cwd=origin, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "add nested"], cwd=origin, check=True, capture_output=True)
    subprocess.run(["git", "push"], cwd=origin, check=True, capture_output=True)

    clone_dir = temp_repo["tmp"] / "clone2"
    await clone_repo(str(temp_repo["bare"]), "main", clone_dir)

    files = await read_all_files(clone_dir)
    assert "modules/subdir/nested.md" in files


@pytest.mark.asyncio
async def test_read_all_files_filters_by_extension(temp_repo):
    """Should skip non-tracked extensions in tracked directories."""
    import subprocess
    origin = temp_repo["origin"]

    (origin / "modules" / ".gitkeep").write_text("")
    (origin / "modules" / "image.png").write_bytes(b"\x89PNG")
    subprocess.run(["git", "add", "."], cwd=origin, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "add non-md files"], cwd=origin, check=True, capture_output=True)
    subprocess.run(["git", "push"], cwd=origin, check=True, capture_output=True)

    clone_dir = temp_repo["tmp"] / "clone_ext"
    await clone_repo(str(temp_repo["bare"]), "main", clone_dir)

    files = await read_all_files(clone_dir)
    assert "modules/.gitkeep" not in files
    assert "modules/image.png" not in files
    assert "modules/intro.md" in files  # .md files still included


@pytest.mark.asyncio
async def test_get_head_sha(temp_repo):
    """Should return 40-char hex SHA."""
    clone_dir = temp_repo["tmp"] / "clone3"
    await clone_repo(str(temp_repo["bare"]), "main", clone_dir)

    sha = await get_head_sha(clone_dir)
    assert len(sha) == 40
    assert all(c in "0123456789abcdef" for c in sha)


@pytest.mark.asyncio
async def test_fetch_and_reset_picks_up_new_content(temp_repo):
    """After a push to origin, fetch_and_reset should get the new files."""
    import subprocess
    origin = temp_repo["origin"]

    # Clone first
    clone_dir = temp_repo["tmp"] / "clone4"
    await clone_repo(str(temp_repo["bare"]), "main", clone_dir)

    old_files = await read_all_files(clone_dir)
    assert "articles/article2.md" not in old_files

    # Push a new file to origin
    (origin / "articles" / "article2.md").write_text("---\ntitle: New\n---\nNew content")
    subprocess.run(["git", "add", "."], cwd=origin, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "add article2"], cwd=origin, check=True, capture_output=True)
    subprocess.run(["git", "push"], cwd=origin, check=True, capture_output=True)

    # Fetch and reset
    new_sha = await fetch_and_reset(clone_dir, "main")
    assert len(new_sha) == 40

    new_files = await read_all_files(clone_dir)
    assert "articles/article2.md" in new_files
    assert "New content" in new_files["articles/article2.md"]


@pytest.mark.asyncio
async def test_fetch_latest_sha(temp_repo):
    """Should return remote HEAD SHA without changing working tree."""
    import subprocess
    origin = temp_repo["origin"]

    clone_dir = temp_repo["tmp"] / "clone5"
    await clone_repo(str(temp_repo["bare"]), "main", clone_dir)

    old_sha = await get_head_sha(clone_dir)

    # Push a commit to origin
    (origin / "modules" / "new.md").write_text("new")
    subprocess.run(["git", "add", "."], cwd=origin, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "new module"], cwd=origin, check=True, capture_output=True)
    subprocess.run(["git", "push"], cwd=origin, check=True, capture_output=True)

    # fetch_latest_sha should see the new commit
    latest = await fetch_latest_sha(clone_dir, "main")
    assert latest != old_sha

    # But working tree should NOT have changed
    local_sha = await get_head_sha(clone_dir)
    assert local_sha == old_sha
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest core/content/tests/test_git_fetcher.py -v`

- [ ] **Step 3: Implement git_fetcher.py**

```python
# core/content/git_fetcher.py
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
    proc = await asyncio.create_subprocess_exec(
        "git", *args,
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


async def clone_repo(repo_url: str, branch: str, clone_dir: Path) -> None:
    """Clone the content repo (single branch)."""
    logger.info("Cloning %s (branch %s) to %s", repo_url, branch, clone_dir)
    proc = await asyncio.create_subprocess_exec(
        "git", "clone", "--branch", branch,
        "--single-branch", repo_url, str(clone_dir),
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

    Returns dict mapping relative path to file content string.
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
```

- [ ] **Step 4: Run tests**

Run: `.venv/bin/pytest core/content/tests/test_git_fetcher.py -v`

- [ ] **Step 5: Commit**

```
jj describe -m "feat: add git-based content fetcher (replaces GitHub API calls)"
jj new
```

---

### Task 2: Wire git_fetcher into github_fetcher

Replace the API-based I/O with git operations. Keep the public API surface identical.

**Files:**
- Modify: `core/content/github_fetcher.py`

- [ ] **Step 1: Add clone directory management and repo URL helper**

At the top of `github_fetcher.py`, add:

```python
from pathlib import Path
from core.content import git_fetcher

# Clone directory: /tmp/lens-edu-relay-{branch}-{port}
# Port differentiates workspaces (each workspace has unique API_PORT)
def _get_clone_dir() -> Path:
    branch = get_content_branch()
    port = os.getenv("API_PORT", "8000")
    return Path(f"/tmp/lens-edu-relay-{branch}-{port}")

def _get_repo_url() -> str:
    token = _get_github_token()
    if token:
        return f"https://x-access-token:{token}@github.com/{CONTENT_REPO}.git"
    return f"https://github.com/{CONTENT_REPO}.git"
```

- [ ] **Step 2: Replace `fetch_all_content()`**

Replace the entire HTTP-based fetch flow with:

```python
async def fetch_all_content() -> ContentCache:
    clone_dir = _get_clone_dir()
    branch = get_content_branch()
    repo_url = _get_repo_url()

    # Clone if not exists, otherwise fetch+reset
    if not (clone_dir / ".git").exists():
        await git_fetcher.clone_repo(repo_url, branch, clone_dir)
    else:
        await git_fetcher.fetch_and_reset(clone_dir, branch)

    commit_sha = await git_fetcher.get_head_sha(clone_dir)

    # Read all files from disk
    all_files = await git_fetcher.read_all_files(clone_dir)
    logger.info("Read %d files from local clone", len(all_files))

    # --- Everything below this line stays exactly the same ---
    # Extract articles, transcripts, timestamps...
    # Run TypeScript processor...
    # Build ContentCache...
```

The code from `articles = {path: content ...}` through to building the `ContentCache` and calling `set_cache()` is unchanged — it operates on the `all_files` dict regardless of source.

- [ ] **Step 3: Replace `get_latest_commit_sha()`**

```python
async def get_latest_commit_sha() -> str:
    clone_dir = _get_clone_dir()
    if not (clone_dir / ".git").exists():
        # Not cloned yet — fall back to API for initial SHA
        async with httpx.AsyncClient() as client:
            return await _get_latest_commit_sha_with_client(client)
    branch = get_content_branch()
    return await git_fetcher.fetch_latest_sha(clone_dir, branch)
```

- [ ] **Step 4: Simplify `incremental_refresh()`**

The big simplification: instead of fetching only changed files and merging, just re-read everything from disk after git updates. The GitHub Compare API is still used for the frontend diff display.

```python
async def incremental_refresh(new_commit_sha: str) -> list[dict]:
    # ... existing fallback checks (cache not initialized, no SHA, etc.) stay the same ...

    # Same commit check stays the same
    if cache.last_commit_sha == new_commit_sha:
        return cache.validation_errors or []

    try:
        clone_dir = _get_clone_dir()
        branch = get_content_branch()

        # Update the local clone
        await git_fetcher.fetch_and_reset(clone_dir, branch)

        # Get diff data for frontend display (still uses GitHub Compare API — 1 call)
        diff_data = []
        tracked_change_count = 0
        try:
            comparison = await compare_commits(cache.last_commit_sha, new_commit_sha)
            diff_data = [
                {
                    "filename": c.path,
                    "status": c.status,
                    "additions": c.additions,
                    "deletions": c.deletions,
                    "patch": c.patch,
                }
                for c in comparison.files
            ]
            # Count tracked file changes for the optimization below
            tracked_change_count = sum(
                1 for c in comparison.files if _get_tracked_directory(c.path) is not None
            )
        except Exception as e:
            logger.warning("Failed to get diff for frontend: %s", e)
            tracked_change_count = -1  # Unknown — assume changes exist

        # Optimization: if no tracked files changed, skip re-read + TypeScript
        if tracked_change_count == 0:
            now = datetime.now(UTC)
            cache.last_commit_sha = new_commit_sha
            cache.fetched_sha = new_commit_sha
            cache.fetched_sha_timestamp = now
            cache.processed_sha = new_commit_sha
            cache.processed_sha_timestamp = now
            cache.last_diff = diff_data
            cache.last_refreshed = now
            return cache.validation_errors or []

        cache.fetched_sha = new_commit_sha
        cache.fetched_sha_timestamp = datetime.now(UTC)

        # Read ALL files fresh from disk (no merge logic needed — git handles state)
        raw_files = await git_fetcher.read_all_files(clone_dir)

        # Re-run TypeScript processing
        # ... (existing code from here: process_content_typescript, build modules/courses,
        #      extract articles/transcripts/timestamps, update cache) ...

        # Update cache with new raw_files
        cache.raw_files = raw_files
        cache.last_diff = diff_data
        # ... rest of cache updates same as before ...
```

This eliminates the entire "merge changes into raw_files" section and the per-file API fetching.

- [ ] **Step 5: Reimplement `fetch_file()` as disk read**

`fetch_file()` is exported from `core/content/__init__.py` and used in integration tests. Reimplement as:

```python
async def fetch_file(path: str) -> str:
    """Fetch a single file from the content repo.

    Reads from the local git clone. Requires initialize_cache() to have been called first.
    """
    clone_dir = _get_clone_dir()
    file_path = clone_dir / path
    if file_path.exists():
        return file_path.read_text(encoding="utf-8")
    raise GitHubFetchError(f"File not found: {path} (clone dir: {clone_dir})")
```

- [ ] **Step 6: Remove unused API helpers**

Remove these functions (no longer called):
- `_list_directory_with_client()`
- `_fetch_file_with_client()`
- `list_directory()` (check usages first — if used outside, keep)
- `_get_contents_api_url()` (only used by `_fetch_file_with_client`)
- `_apply_file_change()` (dead code)

Keep these (still used):
- `_get_raw_url()` — used by fallback `fetch_file()`
- `_get_headers()` — used by fallback `fetch_file()` and `compare_commits()`
- `compare_commits()` — used by `incremental_refresh()` for frontend diff
- `_get_compare_api_url()` — used by `compare_commits()`
- `_get_commit_api_url()` — used by fallback `get_latest_commit_sha()`
- `_get_latest_commit_sha_with_client()` — fallback before first clone
- `_get_github_token()` — used for git URL auth and API fallbacks

Also:
- `list_directory()` — exported from `core/content/__init__.py`. Remove export and function. If tests import it, update them.
- Update `web_api/routes/content.py` `manual_incremental_refresh` endpoint (~line 125-150) to use `get_latest_commit_sha()` instead of making a direct GitHub API call.

Check usages before removing:
```bash
grep -rn "list_directory\|_fetch_file_with_client\|_apply_file_change\|_get_contents_api_url" --include="*.py" | grep -v test | grep -v __pycache__
```

- [ ] **Step 7: Run tests**

Run: `.venv/bin/pytest core/content/tests/ -v --tb=short`

- [ ] **Step 8: Commit**

```
jj describe -m "refactor: replace GitHub API content fetching with git clone/pull"
jj new
```

---

### Task 3: Verify SSE Poller

The validation broadcaster polls `get_latest_commit_sha()` every 10 seconds. This now uses `git ls-remote` (lightweight, git protocol) instead of GitHub API.

**Files:**
- Verify: `core/content/validation_broadcaster.py`

- [ ] **Step 1: Verify the poller uses `get_latest_commit_sha()` (already replaced)**

The poller at `validation_broadcaster.py:98-103` calls `get_latest_commit_sha()` which now does `git ls-remote`. This is lightweight (just checks refs, doesn't download objects) and uses git protocol (no API rate limit). No code change needed.

- [ ] **Step 2: Run broadcaster tests**

Run: `.venv/bin/pytest core/content/tests/test_validation_broadcaster.py -v`

If tests mock `get_latest_commit_sha`, they should still work since the function signature is unchanged.

---

### Task 4: Update Existing Tests

The existing `test_github_fetcher.py` mocks HTTP calls. Update to mock git operations.

**Files:**
- Modify: `core/content/tests/test_github_fetcher.py`

- [ ] **Step 1: Audit existing tests**

Run: `.venv/bin/pytest core/content/tests/test_github_fetcher.py -v --tb=short`

Identify which tests fail.

- [ ] **Step 2: Update mocks**

For tests of `fetch_all_content()`: mock `git_fetcher.clone_repo`, `git_fetcher.read_all_files`, `git_fetcher.get_head_sha`

For tests of `incremental_refresh()`: mock `git_fetcher.fetch_and_reset`, `git_fetcher.read_all_files` (replaces the complex per-file fetch mocks)

For tests of `get_latest_commit_sha()`: mock `git_fetcher.fetch_latest_sha`

- [ ] **Step 3: Run full test suite**

Run: `.venv/bin/pytest core/content/tests/ core/modules/tests/ web_api/tests/ -v --tb=short`

- [ ] **Step 4: Commit**

```
jj describe -m "test: update content fetcher tests for git-based fetching"
jj new
```

---

## Notes

**Clone directory lifecycle:**
- Path: `/tmp/lens-edu-relay-{branch}-{port}` (workspace-specific via API_PORT)
- Persists across server restarts (no re-clone needed on local dev)
- Railway: fresh clone per deploy (containers are ephemeral) — replaces 536 API calls with one git clone

**Why full clone (not shallow):**
- Shallow clone would be faster but is fine for a markdown-only repo (~50MB)
- Full history is available if needed for future features

**Railway git availability:**
- Railway Nixpacks images include git by default
- Add a check in `_run_git()`: if `FileNotFoundError` is raised by `create_subprocess_exec`, convert it to a clear error: `"git is not installed. Install git to use content fetching."`

**Branch change edge case:**
- Clone uses `--single-branch`. If `EDUCATIONAL_CONTENT_BRANCH` changes (e.g., staging → main), the existing clone won't have the new branch.
- Fix: in `fetch_all_content()`, before `fetch_and_reset`, verify the clone's configured branch matches. If not, delete the clone dir and re-clone.
- Simple check: `git config --get remote.origin.fetch` or just check `_run_git(["branch", "--show-current"])` matches.

**Git token in process listing:**
- The token is embedded in the clone URL (`https://x-access-token:TOKEN@github.com/...`) and visible in `ps aux` during clone. It's also stored in `.git/config`.
- Accepted tradeoff: Railway containers are ephemeral, VPS is single-user. The token is already in environment variables anyway.

**`fetch_file()` backward compatibility:**
- Reimplemented as disk read from clone, with HTTP fallback before first clone
- Exported from `core/content/__init__.py` — callers unchanged

**`compare_commits()` kept for frontend:**
- Still makes 1 GitHub API call per webhook to get additions/deletions/patch for `/validate` page
- This is not a rate limit concern (happens once per content push, not on startup)
