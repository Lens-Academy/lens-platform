# core/lessons/content.py
"""Content loading and extraction utilities."""

from pathlib import Path


# Path to content files (educational_content at project root)
CONTENT_DIR = Path(__file__).parent.parent.parent / "educational_content"


def load_article(source_url: str) -> str:
    """
    Load article content from file.

    Args:
        source_url: Relative path from content directory (e.g., "articles/foo.md")

    Returns:
        Full markdown content as string
    """
    article_path = CONTENT_DIR / source_url

    if not article_path.exists():
        raise FileNotFoundError(f"Article not found: {source_url}")

    return article_path.read_text()


def extract_article_section(
    content: str,
    from_text: str | None,
    to_text: str | None,
) -> str:
    """
    Extract a section of text between two anchor phrases.

    Args:
        content: Full article content
        from_text: Starting anchor phrase (inclusive), or None for start
        to_text: Ending anchor phrase (inclusive), or None for end

    Returns:
        Extracted section including the anchor phrases
    """
    if from_text is None and to_text is None:
        return content

    start_idx = 0
    end_idx = len(content)

    if from_text:
        idx = content.find(from_text)
        if idx != -1:
            start_idx = idx

    if to_text:
        # Search from start_idx to find the ending anchor
        idx = content.find(to_text, start_idx)
        if idx != -1:
            end_idx = idx + len(to_text)

    return content[start_idx:end_idx].strip()


def load_video_transcript(source_url: str) -> str:
    """
    Load video transcript from file.

    Args:
        source_url: Relative path from content directory

    Returns:
        Full transcript as string
    """
    transcript_path = CONTENT_DIR / source_url

    if not transcript_path.exists():
        raise FileNotFoundError(f"Transcript not found: {source_url}")

    return transcript_path.read_text()
