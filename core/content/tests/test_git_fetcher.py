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
    subprocess.run(["git", "init", "--bare", "-b", "main", str(bare)], check=True, capture_output=True)

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
