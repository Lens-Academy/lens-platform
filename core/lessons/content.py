# core/lessons/content.py
"""Content loading and extraction utilities."""

import re
from dataclasses import dataclass
from pathlib import Path


# Path to content files (educational_content at project root)
CONTENT_DIR = Path(__file__).parent.parent.parent / "educational_content"


@dataclass
class ArticleMetadata:
    """Metadata extracted from article frontmatter."""
    title: str | None = None
    author: str | None = None
    source_url: str | None = None  # Original article URL


@dataclass
class VideoTranscriptMetadata:
    """Metadata extracted from video transcript frontmatter."""
    video_id: str | None = None
    title: str | None = None
    url: str | None = None  # YouTube URL


@dataclass
class VideoTranscriptContent:
    """Video transcript content with metadata."""
    transcript: str
    metadata: VideoTranscriptMetadata
    is_excerpt: bool = False  # True if time-based extraction was used


@dataclass
class ArticleContent:
    """Article content with metadata."""
    content: str
    metadata: ArticleMetadata
    is_excerpt: bool = False  # True if from/to were used to extract a section


def parse_frontmatter(text: str) -> tuple[ArticleMetadata, str]:
    """
    Parse YAML frontmatter from markdown text.

    Args:
        text: Full markdown text, possibly with frontmatter

    Returns:
        Tuple of (metadata, content_without_frontmatter)
    """
    # Match frontmatter: starts with ---, ends with ---
    pattern = r'^---\s*\n(.*?)\n---\s*\n'
    match = re.match(pattern, text, re.DOTALL)

    if not match:
        return ArticleMetadata(), text

    frontmatter_text = match.group(1)
    content = text[match.end():]

    # Simple YAML parsing (just key: value pairs)
    metadata = ArticleMetadata()
    for line in frontmatter_text.split('\n'):
        line = line.strip()
        if ':' in line:
            key, value = line.split(':', 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key == 'title':
                metadata.title = value
            elif key == 'author':
                metadata.author = value
            elif key == 'source_url':
                metadata.source_url = value

    return metadata, content


def load_article(source_url: str) -> str:
    """
    Load article content from file (without metadata).

    Args:
        source_url: Relative path from content directory (e.g., "articles/foo.md")

    Returns:
        Full markdown content as string (frontmatter stripped)
    """
    article_path = CONTENT_DIR / source_url

    if not article_path.exists():
        raise FileNotFoundError(f"Article not found: {source_url}")

    raw_text = article_path.read_text()
    _, content = parse_frontmatter(raw_text)
    return content


def load_article_with_metadata(
    source_url: str,
    from_text: str | None = None,
    to_text: str | None = None,
) -> ArticleContent:
    """
    Load article content with metadata.

    Args:
        source_url: Relative path from content directory
        from_text: Starting anchor phrase (inclusive), or None for start
        to_text: Ending anchor phrase (inclusive), or None for end

    Returns:
        ArticleContent with metadata and content
    """
    article_path = CONTENT_DIR / source_url

    if not article_path.exists():
        raise FileNotFoundError(f"Article not found: {source_url}")

    raw_text = article_path.read_text()
    metadata, full_content = parse_frontmatter(raw_text)

    # Check if we're extracting an excerpt
    is_excerpt = from_text is not None or to_text is not None

    if is_excerpt:
        content = extract_article_section(full_content, from_text, to_text)
    else:
        content = full_content

    return ArticleContent(
        content=content,
        metadata=metadata,
        is_excerpt=is_excerpt,
    )


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


def parse_video_frontmatter(text: str) -> tuple[VideoTranscriptMetadata, str]:
    """
    Parse YAML frontmatter from video transcript markdown.

    Args:
        text: Full markdown text, possibly with frontmatter

    Returns:
        Tuple of (metadata, transcript_without_frontmatter)
    """
    # Match frontmatter: starts with ---, ends with ---
    pattern = r'^---\s*\n(.*?)\n---\s*\n'
    match = re.match(pattern, text, re.DOTALL)

    if not match:
        return VideoTranscriptMetadata(), text

    frontmatter_text = match.group(1)
    content = text[match.end():]

    # Simple YAML parsing (just key: value pairs)
    metadata = VideoTranscriptMetadata()
    for line in frontmatter_text.split('\n'):
        line = line.strip()
        if ':' in line:
            key, value = line.split(':', 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key == 'video_id':
                metadata.video_id = value
            elif key == 'title':
                metadata.title = value
            elif key == 'url':
                metadata.url = value

    return metadata, content


def load_video_transcript(source_url: str) -> str:
    """
    Load video transcript from file (without metadata).

    Args:
        source_url: Relative path from content directory

    Returns:
        Full transcript as string (frontmatter stripped)
    """
    transcript_path = CONTENT_DIR / source_url

    if not transcript_path.exists():
        raise FileNotFoundError(f"Transcript not found: {source_url}")

    raw_text = transcript_path.read_text()
    _, transcript = parse_video_frontmatter(raw_text)
    return transcript


def load_video_transcript_with_metadata(source_url: str) -> VideoTranscriptContent:
    """
    Load video transcript with metadata.

    Args:
        source_url: Relative path from content directory

    Returns:
        VideoTranscriptContent with metadata and transcript
    """
    transcript_path = CONTENT_DIR / source_url

    if not transcript_path.exists():
        raise FileNotFoundError(f"Transcript not found: {source_url}")

    raw_text = transcript_path.read_text()
    metadata, transcript = parse_video_frontmatter(raw_text)

    return VideoTranscriptContent(
        transcript=transcript,
        metadata=metadata,
        is_excerpt=False,
    )
