# core/modules/path_resolver.py
"""Resolve wiki-link paths to cache keys."""

import re


def extract_filename_stem(path: str) -> str:
    """Extract the filename stem (without extension) from a path.

    Examples:
        "Lenses/Video Lens" -> "Video Lens"
        "../Learning Outcomes/Some Outcome" -> "Some Outcome"
        "../Lenses/My Lens.md" -> "My Lens"
    """
    # Get the last path component
    filename = path.split("/")[-1]
    # Remove .md extension if present
    if filename.endswith(".md"):
        filename = filename[:-3]
    return filename


def resolve_wiki_link(wiki_link: str) -> tuple[str, str]:
    """Resolve a wiki-link to (content_type, cache_key).

    Args:
        wiki_link: A wiki-link like "[[../Learning Outcomes/AI Risks]]"

    Returns:
        Tuple of (content_type, cache_key) where:
        - content_type is one of: "learning_outcomes", "lenses", "video_transcripts", "articles"
        - cache_key is the filename stem used as the cache dictionary key

    Raises:
        ValueError: If the wiki-link format is not recognized
    """
    # Extract path from [[...]] or ![[...]]
    match = re.search(r"!?\[\[([^\]]+)\]\]", wiki_link)
    if not match:
        raise ValueError(f"Invalid wiki-link format: {wiki_link}")

    path = match.group(1)

    # Determine content type from path
    path_lower = path.lower()
    if "learning outcomes" in path_lower or "learning_outcomes" in path_lower:
        content_type = "learning_outcomes"
    elif "lenses" in path_lower:
        content_type = "lenses"
    elif "video_transcripts" in path_lower:
        content_type = "video_transcripts"
    elif "articles" in path_lower:
        content_type = "articles"
    else:
        raise ValueError(f"Unknown content type in path: {path}")

    cache_key = extract_filename_stem(path)
    return (content_type, cache_key)
