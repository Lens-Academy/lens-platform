# core/lessons/content.py
"""Content loading and extraction utilities."""

import re
from dataclasses import dataclass
from pathlib import Path


# Path to content files (educational_content at project root)
CONTENT_DIR = Path(__file__).parent.parent.parent / "educational_content"


def extract_video_id_from_url(url: str) -> str:
    """
    Extract YouTube video ID from a YouTube URL.

    Supported formats:
    - https://www.youtube.com/watch?v=VIDEO_ID
    - https://youtube.com/watch?v=VIDEO_ID
    - https://youtu.be/VIDEO_ID
    - https://www.youtube.com/embed/VIDEO_ID

    Args:
        url: YouTube URL

    Returns:
        Video ID string

    Raises:
        ValueError: If URL format is not recognized
    """
    # Pattern for youtube.com/watch?v=ID
    match = re.search(r'(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/embed/)([a-zA-Z0-9_-]+)', url)
    if match:
        return match.group(1)

    raise ValueError(f"Could not extract video ID from URL: {url}")

# In-memory cache for stage durations (calculated once per server process)
# Key: (source, from_text/from_seconds, to_text/to_seconds)
# Value: duration string like "5 min" or "3 min"
_duration_cache: dict[tuple, str] = {}


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


def _parse_frontmatter_generic(
    text: str,
    field_mapping: dict[str, str],
) -> tuple[dict[str, str], str]:
    """
    Generic YAML frontmatter parser.

    Args:
        text: Full markdown text, possibly with frontmatter
        field_mapping: Dict mapping YAML keys to output field names
                       e.g., {"source_url": "source_url", "video_id": "video_id"}

    Returns:
        Tuple of (metadata_dict, content_without_frontmatter)
    """
    pattern = r'^---\s*\n(.*?)\n---\s*\n'
    match = re.match(pattern, text, re.DOTALL)

    if not match:
        return {}, text

    frontmatter_text = match.group(1)
    content = text[match.end():]

    metadata = {}
    for line in frontmatter_text.split('\n'):
        line = line.strip()
        if ':' in line:
            key, value = line.split(':', 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key in field_mapping:
                metadata[field_mapping[key]] = value

    return metadata, content


def parse_frontmatter(text: str) -> tuple[ArticleMetadata, str]:
    """
    Parse YAML frontmatter from markdown text.

    Args:
        text: Full markdown text, possibly with frontmatter

    Returns:
        Tuple of (metadata, content_without_frontmatter)
    """
    field_mapping = {
        "title": "title",
        "author": "author",
        "source_url": "source_url",
    }
    raw_metadata, content = _parse_frontmatter_generic(text, field_mapping)

    return ArticleMetadata(
        title=raw_metadata.get("title"),
        author=raw_metadata.get("author"),
        source_url=raw_metadata.get("source_url"),
    ), content


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

    The video_id is derived from the url field, not stored separately.

    Args:
        text: Full markdown text, possibly with frontmatter

    Returns:
        Tuple of (metadata, transcript_without_frontmatter)

    Raises:
        ValueError: If url is missing or cannot be parsed for video ID
    """
    field_mapping = {
        "title": "title",
        "url": "url",
    }
    raw_metadata, content = _parse_frontmatter_generic(text, field_mapping)

    url = raw_metadata.get("url")
    if not url:
        raise ValueError("Video transcript frontmatter missing required 'url' field")

    video_id = extract_video_id_from_url(url)

    return VideoTranscriptMetadata(
        video_id=video_id,
        title=raw_metadata.get("title"),
        url=url,
    ), content


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


def get_stage_title(stage) -> str:
    """Extract display title from a stage using actual content metadata.

    Args:
        stage: A stage object (ArticleStage, VideoStage, or ChatStage)

    Returns:
        Display title string for the stage
    """
    from .types import ArticleStage, VideoStage

    if isinstance(stage, ArticleStage):
        try:
            result = load_article_with_metadata(stage.source)
            return result.metadata.title or "Article"
        except FileNotFoundError:
            return "Article"
    elif isinstance(stage, VideoStage):
        try:
            result = load_video_transcript_with_metadata(stage.source)
            return result.metadata.title or "Video"
        except FileNotFoundError:
            return "Video"
    return "Discussion"


# Average reading speed in words per minute
WORDS_PER_MINUTE = 200


def _count_words(text: str) -> int:
    """Count words in text, ignoring markdown syntax."""
    # Remove markdown links [text](url) -> text
    text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)
    # Remove markdown images ![alt](url)
    text = re.sub(r'!\[[^\]]*\]\([^)]+\)', '', text)
    # Remove markdown formatting characters
    text = re.sub(r'[#*_`~>\-|]', ' ', text)
    # Split on whitespace and count non-empty tokens
    return len([w for w in text.split() if w])


def _calculate_article_duration(stage) -> str:
    """Calculate reading time for an article stage."""
    from .types import ArticleStage

    if not isinstance(stage, ArticleStage):
        return ""

    try:
        result = load_article_with_metadata(
            stage.source,
            stage.from_text,
            stage.to_text,
        )
        word_count = _count_words(result.content)
        minutes = max(1, round(word_count / WORDS_PER_MINUTE))
        return f"{minutes} min"
    except FileNotFoundError:
        return ""


def _calculate_video_duration(stage) -> str:
    """Calculate duration for a video stage from timestamps."""
    from .types import VideoStage

    if not isinstance(stage, VideoStage):
        return ""

    from_sec = stage.from_seconds or 0
    to_sec = stage.to_seconds

    if to_sec is None:
        # Unknown end time - can't calculate
        return ""

    duration_sec = to_sec - from_sec
    if duration_sec <= 0:
        return ""

    minutes = max(1, round(duration_sec / 60))
    return f"{minutes} min"


def get_stage_duration(stage) -> str:
    """Get duration string for a stage, with caching.

    Args:
        stage: A stage object (ArticleStage, VideoStage, or ChatStage)

    Returns:
        Duration string like "5 min", or empty string if not applicable
    """
    from .types import ArticleStage, VideoStage, ChatStage

    if isinstance(stage, ChatStage):
        return ""  # Chat stages have no fixed duration

    # Build cache key based on stage type
    if isinstance(stage, ArticleStage):
        cache_key = ("article", stage.source, stage.from_text, stage.to_text)
    elif isinstance(stage, VideoStage):
        cache_key = ("video", stage.source, stage.from_seconds, stage.to_seconds)
    else:
        return ""

    # Check cache
    if cache_key in _duration_cache:
        return _duration_cache[cache_key]

    # Calculate and cache
    if isinstance(stage, ArticleStage):
        duration = _calculate_article_duration(stage)
    else:
        duration = _calculate_video_duration(stage)

    _duration_cache[cache_key] = duration
    return duration
