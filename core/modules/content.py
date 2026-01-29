# core/modules/content.py
"""Content loading and extraction utilities."""

import logging
import re
from dataclasses import dataclass

logger = logging.getLogger(__name__)


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
    match = re.search(
        r"(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/embed/)([a-zA-Z0-9_-]+)",
        url,
    )
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
    channel: str | None = None


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
    pattern = r"^---\s*\n(.*?)\n---\s*\n"
    match = re.match(pattern, text, re.DOTALL)

    if not match:
        return {}, text

    frontmatter_text = match.group(1)
    content = text[match.end() :]

    metadata = {}
    for line in frontmatter_text.split("\n"):
        line = line.strip()
        if ":" in line:
            key, value = line.split(":", 1)
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


def load_article(source_path: str) -> str:
    """
    Load article content from cache (without metadata).

    Args:
        source_path: Path like "articles/foo" (without .md extension)

    Returns:
        Full markdown content as string (frontmatter stripped)
    """
    from core.content import get_cache

    cache = get_cache()

    # Normalize path - add .md if needed, ensure articles/ prefix
    if not source_path.endswith(".md"):
        source_path = f"{source_path}.md"
    # Handle relative paths like ../articles/...
    if "../articles/" in source_path:
        source_path = "articles/" + source_path.split("../articles/")[-1]
    elif not source_path.startswith("articles/"):
        source_path = f"articles/{source_path}"

    if source_path not in cache.articles:
        raise FileNotFoundError(f"Article not found in cache: {source_path}")

    raw_text = cache.articles[source_path]
    _, content = parse_frontmatter(raw_text)
    return content


def load_article_with_metadata(
    source_path: str,
    from_text: str | None = None,
    to_text: str | None = None,
) -> ArticleContent:
    """
    Load article content with metadata from cache.

    Args:
        source_path: Path like "articles/foo" (without .md extension)
        from_text: Starting anchor phrase (inclusive), or None for start
        to_text: Ending anchor phrase (inclusive), or None for end

    Returns:
        ArticleContent with metadata and content
    """
    from core.content import get_cache

    cache = get_cache()

    # Normalize path - add .md if needed, ensure articles/ prefix
    if not source_path.endswith(".md"):
        source_path = f"{source_path}.md"
    # Handle relative paths like ../articles/...
    if "../articles/" in source_path:
        source_path = "articles/" + source_path.split("../articles/")[-1]
    elif not source_path.startswith("articles/"):
        source_path = f"articles/{source_path}"

    if source_path not in cache.articles:
        raise FileNotFoundError(f"Article not found in cache: {source_path}")

    raw_text = cache.articles[source_path]
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


class AnchorNotFoundError(Exception):
    """Raised when an anchor text is not found in the content."""

    pass


class AnchorNotUniqueError(Exception):
    """Raised when an anchor text appears multiple times (case-insensitive)."""

    pass


def _find_case_insensitive(content: str, anchor: str, start: int = 0) -> int:
    """Find anchor in content case-insensitively. Returns -1 if not found."""
    return content.lower().find(anchor.lower(), start)


def _count_case_insensitive(content: str, anchor: str) -> int:
    """Count occurrences of anchor in content case-insensitively."""
    return content.lower().count(anchor.lower())


def find_excerpt_bounds(
    content: str,
    from_text: str | None,
    to_text: str | None,
) -> tuple[int, int]:
    """
    Find the start and end positions of an excerpt in the content.

    Matching is case-insensitive. Anchors must be unique within the content
    (case-insensitively) to avoid ambiguity.

    Args:
        content: Full article content
        from_text: Starting anchor phrase (inclusive), or None for start
        to_text: Ending anchor phrase (inclusive), or None for end

    Returns:
        (start_idx, end_idx) positions in content

    Raises:
        AnchorNotFoundError: If anchor text not found
        AnchorNotUniqueError: If anchor appears multiple times
    """
    start_idx = 0
    end_idx = len(content)

    if from_text:
        count = _count_case_insensitive(content, from_text)
        if count == 0:
            raise AnchorNotFoundError(f"'from' anchor not found: {from_text[:50]}...")
        if count > 1:
            raise AnchorNotUniqueError(
                f"'from' anchor appears {count} times (case-insensitive): {from_text[:50]}..."
            )
        start_idx = _find_case_insensitive(content, from_text)

    if to_text:
        count = _count_case_insensitive(content, to_text)
        if count == 0:
            raise AnchorNotFoundError(f"'to' anchor not found: {to_text[:50]}...")
        if count > 1:
            raise AnchorNotUniqueError(
                f"'to' anchor appears {count} times (case-insensitive): {to_text[:50]}..."
            )
        # Search from start_idx to find the ending anchor
        idx = _find_case_insensitive(content, to_text, start_idx)
        if idx != -1:
            end_idx = idx + len(to_text)

    return start_idx, end_idx


def extract_article_section(
    content: str,
    from_text: str | None,
    to_text: str | None,
) -> str:
    """
    Extract a section of text between two anchor phrases.

    Matching is case-insensitive. Anchors must be unique within the content
    (case-insensitively) to avoid ambiguity.

    Args:
        content: Full article content
        from_text: Starting anchor phrase (inclusive), or None for start
        to_text: Ending anchor phrase (inclusive), or None for end

    Returns:
        Extracted section including the anchor phrases

    Raises:
        AnchorNotFoundError: If an anchor is not found in the content
        AnchorNotUniqueError: If an anchor appears multiple times
    """
    if from_text is None and to_text is None:
        return content

    start_idx = 0
    end_idx = len(content)

    if from_text:
        count = _count_case_insensitive(content, from_text)
        if count == 0:
            raise AnchorNotFoundError(f"'from' anchor not found: {from_text[:50]}...")
        if count > 1:
            raise AnchorNotUniqueError(
                f"'from' anchor appears {count} times (case-insensitive): {from_text[:50]}..."
            )
        idx = _find_case_insensitive(content, from_text)
        start_idx = idx

    if to_text:
        count = _count_case_insensitive(content, to_text)
        if count == 0:
            raise AnchorNotFoundError(f"'to' anchor not found: {to_text[:50]}...")
        if count > 1:
            raise AnchorNotUniqueError(
                f"'to' anchor appears {count} times (case-insensitive): {to_text[:50]}..."
            )
        # Search from start_idx to find the ending anchor
        idx = _find_case_insensitive(content, to_text, start_idx)
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
        "channel": "channel",
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
        channel=raw_metadata.get("channel"),
    ), content


def load_video_transcript(source_path: str) -> str:
    """
    Load video transcript from cache (without metadata).

    Args:
        source_path: Path like "video_transcripts/foo" (without .md extension)

    Returns:
        Full transcript as string (frontmatter stripped)
    """
    from core.content import get_cache

    cache = get_cache()

    # Normalize path - add .md if needed, ensure video_transcripts/ prefix
    if not source_path.endswith(".md"):
        source_path = f"{source_path}.md"
    # Handle relative paths like ../video_transcripts/...
    if "../video_transcripts/" in source_path:
        source_path = (
            "video_transcripts/" + source_path.split("../video_transcripts/")[-1]
        )
    elif not source_path.startswith("video_transcripts/"):
        source_path = f"video_transcripts/{source_path}"

    if source_path not in cache.video_transcripts:
        raise FileNotFoundError(f"Transcript not found in cache: {source_path}")

    raw_text = cache.video_transcripts[source_path]
    _, transcript = parse_video_frontmatter(raw_text)
    return transcript


def load_video_transcript_with_metadata(source_path: str) -> VideoTranscriptContent:
    """
    Load video transcript with metadata from cache.

    Args:
        source_path: Path like "video_transcripts/foo" (without .md extension)

    Returns:
        VideoTranscriptContent with metadata and transcript
    """
    from core.content import get_cache

    cache = get_cache()

    # Normalize path - add .md if needed, ensure video_transcripts/ prefix
    if not source_path.endswith(".md"):
        source_path = f"{source_path}.md"
    # Handle relative paths like ../video_transcripts/...
    if "../video_transcripts/" in source_path:
        source_path = (
            "video_transcripts/" + source_path.split("../video_transcripts/")[-1]
        )
    elif not source_path.startswith("video_transcripts/"):
        source_path = f"video_transcripts/{source_path}"

    if source_path not in cache.video_transcripts:
        raise FileNotFoundError(f"Transcript not found in cache: {source_path}")

    raw_text = cache.video_transcripts[source_path]
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
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    # Remove markdown images ![alt](url)
    text = re.sub(r"!\[[^\]]*\]\([^)]+\)", "", text)
    # Remove markdown formatting characters
    text = re.sub(r"[#*_`~>\-|]", " ", text)
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


def bundle_article_section(section) -> dict:
    """
    Bundle an article section with collapsed content for excerpts.

    Processes all article-excerpt segments together to compute collapsed
    content (omitted sections) that can be shown in collapsed UI elements.

    Args:
        section: ArticleSection with source and segments

    Returns:
        Dict with type, meta, segments (with collapsed_before/collapsed_after), optional
    """
    from .markdown_parser import (
        ArticleExcerptSegment,
        TextSegment,
        ChatSegment,
        LensArticleExcerptSegment,
        LensTextSegment,
        LensChatSegment,
    )
    from .path_resolver import resolve_wiki_link

    # Resolve wiki-link to get cache key (e.g., "[[../articles/foo]]" -> "foo")
    _, article_key = resolve_wiki_link(section.source)
    # Reconstruct path for load function
    article_path = f"articles/{article_key}"

    # 1. Load full article once
    full_result = load_article_with_metadata(article_path)
    full_content = full_result.content

    # 2. Find positions for all article-excerpt segments (handle both regular and Lens types)
    excerpt_data = []
    for seg in section.segments:
        if isinstance(seg, (ArticleExcerptSegment, LensArticleExcerptSegment)):
            start, end = find_excerpt_bounds(full_content, seg.from_text, seg.to_text)
            excerpt_data.append(
                {
                    "segment": seg,
                    "start": start,
                    "end": end,
                    "content": full_content[start:end].strip(),
                }
            )

    # 3. Sort by position (defensive - should already be in order)
    excerpt_data.sort(key=lambda x: x["start"])

    # 4. Compute collapsed content
    for i, ep in enumerate(excerpt_data):
        prev_end = 0 if i == 0 else excerpt_data[i - 1]["end"]
        collapsed = full_content[prev_end : ep["start"]].strip()
        ep["collapsed_before"] = collapsed if collapsed else None

        if i == len(excerpt_data) - 1:
            trailing = full_content[ep["end"] :].strip()
            ep["collapsed_after"] = trailing if trailing else None
        else:
            ep["collapsed_after"] = None

    # 5. Build bundled segments (preserving original order with non-excerpt segments)
    excerpt_map = {id(ep["segment"]): ep for ep in excerpt_data}
    bundled_segments = []

    for seg in section.segments:
        if isinstance(seg, (ArticleExcerptSegment, LensArticleExcerptSegment)):
            ep = excerpt_map[id(seg)]
            bundled_segments.append(
                {
                    "type": "article-excerpt",
                    "content": ep["content"],
                    "collapsed_before": ep["collapsed_before"],
                    "collapsed_after": ep["collapsed_after"],
                }
            )
        elif isinstance(seg, (TextSegment, LensTextSegment)):
            bundled_segments.append({"type": "text", "content": seg.content})
        elif isinstance(seg, (ChatSegment, LensChatSegment)):
            bundled_segments.append(
                {
                    "type": "chat",
                    "instructions": seg.instructions,
                    "hidePreviousContentFromUser": seg.hide_previous_content_from_user,
                    "hidePreviousContentFromTutor": seg.hide_previous_content_from_tutor,
                }
            )

    return {
        "type": "article",
        "meta": {
            "title": section.title or full_result.metadata.title,
            "author": full_result.metadata.author,
            "sourceUrl": full_result.metadata.source_url,
        },
        "segments": bundled_segments,
        "optional": getattr(section, "optional", False),
    }


def bundle_video_section(section) -> dict:
    """
    Bundle a video section with transcript excerpts.

    Args:
        section: VideoSection or LensVideoSection with source and segments

    Returns:
        Dict with type, videoId, meta, segments, optional
    """
    from .markdown_parser import (
        TextSegment,
        ChatSegment,
        VideoExcerptSegment,
        LensTextSegment,
        LensChatSegment,
        LensVideoExcerptSegment,
    )
    from .path_resolver import resolve_wiki_link
    from core.transcripts import get_text_at_time

    def _parse_time_to_seconds(time_str: str) -> int:
        """Convert time string (e.g., '1:30' or '1:30:45') to seconds."""
        if not time_str:
            return 0
        time_str = time_str.strip().split("\n")[0].strip()
        try:
            parts = time_str.split(":")
            if len(parts) == 2:
                minutes, seconds = int(parts[0]), int(parts[1])
                return minutes * 60 + seconds
            elif len(parts) == 3:
                hours, minutes, seconds = int(parts[0]), int(parts[1]), int(parts[2])
                return hours * 3600 + minutes * 60 + seconds
            else:
                return int(time_str)
        except ValueError:
            return 0

    # Resolve wiki-link to get cache key (e.g., "[[../video_transcripts/foo]]" -> "foo")
    _, video_key = resolve_wiki_link(section.source)
    # Reconstruct path for load function
    video_path = f"video_transcripts/{video_key}"

    # Load video metadata
    try:
        result = load_video_transcript_with_metadata(video_path)
        video_id = result.metadata.video_id
        meta = {
            "title": section.title or result.metadata.title,
            "channel": result.metadata.channel,
        }
    except FileNotFoundError:
        video_id = None
        meta = {"title": section.title or None, "channel": None}

    # Bundle segments (handle both regular and Lens segment types)
    bundled_segments = []
    for seg in section.segments:
        if isinstance(seg, (TextSegment, LensTextSegment)):
            bundled_segments.append({"type": "text", "content": seg.content})
        elif isinstance(seg, (VideoExcerptSegment, LensVideoExcerptSegment)):
            from_seconds = _parse_time_to_seconds(seg.from_time) if seg.from_time else 0
            to_seconds = _parse_time_to_seconds(seg.to_time) if seg.to_time else 99999
            try:
                transcript = get_text_at_time(video_id, from_seconds, to_seconds)
            except (FileNotFoundError, TypeError) as e:
                logger.warning(
                    f"Failed to load transcript for video {video_id} "
                    f"(time {from_seconds}-{to_seconds}): {e}"
                )
                transcript = ""
            bundled_segments.append(
                {
                    "type": "video-excerpt",
                    "from": from_seconds,
                    "to": to_seconds if seg.to_time else None,
                    "transcript": transcript,
                }
            )
        elif isinstance(seg, (ChatSegment, LensChatSegment)):
            bundled_segments.append(
                {
                    "type": "chat",
                    "instructions": seg.instructions,
                    "hidePreviousContentFromUser": seg.hide_previous_content_from_user,
                    "hidePreviousContentFromTutor": seg.hide_previous_content_from_tutor,
                }
            )

    return {
        "type": "video",
        "videoId": video_id,
        "meta": meta,
        "segments": bundled_segments,
        "optional": getattr(section, "optional", False),
    }


def bundle_narrative_module(module) -> dict:
    """
    Bundle a narrative module with all content extracted.

    Resolves all article excerpts and video transcripts inline.

    Args:
        module: NarrativeModule dataclass

    Returns:
        Dict ready for JSON serialization
    """
    from .markdown_parser import (
        TextSection,
        ArticleSection,
        VideoSection,
        ChatSection,
        PageSection,
        LearningOutcomeRef,
        UncategorizedSection,
        TextSegment,
        ArticleExcerptSegment,
        VideoExcerptSegment,
        ChatSegment,
    )
    from core.transcripts import get_text_at_time

    def _parse_time_to_seconds(time_str: str) -> int:
        """Convert time string (e.g., '1:30' or '1:30:45') to seconds."""
        # Strip any extra content (defensive - content parsing issue)
        time_str = time_str.strip().split("\n")[0].strip()
        try:
            parts = time_str.split(":")
            if len(parts) == 2:
                # MM:SS format
                minutes, seconds = int(parts[0]), int(parts[1])
                return minutes * 60 + seconds
            elif len(parts) == 3:
                # HH:MM:SS format
                hours, minutes, seconds = int(parts[0]), int(parts[1]), int(parts[2])
                return hours * 3600 + minutes * 60 + seconds
            else:
                # Single number assumed to be seconds
                return int(time_str)
        except ValueError:
            # If parsing fails, return 0 as fallback
            return 0

    def bundle_segment(segment, section) -> dict:
        """Bundle a single segment with content."""
        if isinstance(segment, TextSegment):
            return {"type": "text", "content": segment.content}

        elif isinstance(segment, ArticleExcerptSegment):
            # Extract content from parent article
            if isinstance(section, ArticleSection):
                result = load_article_with_metadata(
                    section.source,
                    segment.from_text,
                    segment.to_text,
                )
                return {"type": "article-excerpt", "content": result.content}
            return {"type": "article-excerpt", "content": ""}

        elif isinstance(segment, VideoExcerptSegment):
            # Extract transcript from parent video
            # Convert time strings (e.g., "1:30") to seconds
            from_seconds = (
                _parse_time_to_seconds(segment.from_time) if segment.from_time else 0
            )
            # Use a large value for "until the end" when to_time is not specified
            to_seconds = (
                _parse_time_to_seconds(segment.to_time) if segment.to_time else 99999
            )

            if isinstance(section, VideoSection):
                video_result = load_video_transcript_with_metadata(section.source)
                video_id = video_result.metadata.video_id
                try:
                    transcript = get_text_at_time(
                        video_id,
                        from_seconds,
                        to_seconds,
                    )
                except FileNotFoundError as e:
                    logger.warning(
                        f"Failed to load transcript for video {video_id} "
                        f"(time {from_seconds}-{to_seconds}): {e}"
                    )
                    transcript = ""
                return {
                    "type": "video-excerpt",
                    "from": from_seconds,
                    "to": to_seconds if segment.to_time else None,
                    "transcript": transcript,
                }
            return {"type": "video-excerpt", "from": 0, "to": None, "transcript": ""}

        elif isinstance(segment, ChatSegment):
            return {
                "type": "chat",
                "instructions": segment.instructions,
                "hidePreviousContentFromUser": segment.hide_previous_content_from_user,
                "hidePreviousContentFromTutor": segment.hide_previous_content_from_tutor,
            }

        return {}

    def bundle_section(section) -> dict:
        """Bundle a single section with metadata and content."""
        # Helper to get content_id as string if present (not all section types have it)
        content_id = None
        if hasattr(section, "content_id") and section.content_id:
            content_id = str(section.content_id)

        if isinstance(section, PageSection):
            # v2 Page section with Text/Chat segments
            segments = [bundle_segment(s, section) for s in section.segments]
            return {
                "type": "page",
                "meta": {"title": section.title or None},
                "segments": segments,
                "contentId": content_id,
            }

        elif isinstance(section, LearningOutcomeRef):
            # v2 Learning Outcome reference - resolve to actual content
            return {
                "type": "learning-outcome",
                "source": section.source,
                "optional": section.optional,
            }

        elif isinstance(section, UncategorizedSection):
            # v2 Uncategorized section with Lens references
            return {
                "type": "uncategorized",
                "lenses": [
                    {"source": lens.source, "optional": lens.optional}
                    for lens in section.lenses
                ],
            }

        elif isinstance(section, TextSection):
            return {
                "type": "text",
                "meta": {"title": section.title or None},
                "content": section.content,
                "contentId": content_id,
            }

        elif isinstance(section, ArticleSection):
            # Use bundle_article_section for collapsed content support
            bundled = bundle_article_section(section)
            bundled["contentId"] = content_id
            return bundled

        elif isinstance(section, VideoSection):
            # Load video metadata
            try:
                result = load_video_transcript_with_metadata(section.source)
                video_id = result.metadata.video_id
                meta = {
                    "title": section.title or result.metadata.title,
                    "channel": result.metadata.channel,
                }
            except FileNotFoundError:
                video_id = None
                meta = {"title": section.title or None, "channel": None}

            segments = [bundle_segment(s, section) for s in section.segments]
            return {
                "type": "video",
                "videoId": video_id,
                "meta": meta,
                "segments": segments,
                "optional": section.optional,
                "contentId": content_id,
            }

        elif isinstance(section, ChatSection):
            return {
                "type": "chat",
                "meta": {"title": section.title or "Discussion"},
                "instructions": section.instructions,
                "hidePreviousContentFromUser": section.hide_previous_content_from_user,
                "hidePreviousContentFromTutor": section.hide_previous_content_from_tutor,
                "contentId": content_id,
            }

        return {}

    return {
        "slug": module.slug,
        "title": module.title,
        "sections": [bundle_section(s) for s in module.sections],
    }
