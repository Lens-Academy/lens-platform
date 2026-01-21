#!/usr/bin/env python3
"""
Transcript lookup tools for AI tutoring system.

Provides two main functions:
- get_text_at_time: Get transcript text between timestamps
- get_time_from_text: Find timestamps for a text passage

NOTE ON DUPLICATION:
This file is intentionally duplicated across two repositories:

1. ai-safety-course-platform/core/transcripts/tools.py (THIS FILE)
   - Production lookups for serving lessons
   - Points to educational_content_deprecated/video_transcripts/

2. youtube-transcripts/transcript_tools.py
   - Verification during transcript correction workflow
   - Points to output/

Both repos need these functions: youtube-transcripts to verify that corrected
transcripts have properly aligned timestamps, and ai-safety-course-platform
to look up text for lessons. The logic is identical; only the default
search directory differs.

If you update the lookup logic, update both files.
"""

from pathlib import Path
import json
import re


# Default directory for transcript files (educational_content_deprecated/video_transcripts/)
# NOTE: This is the deprecated local content directory. Video transcripts are now
# loaded from GitHub and cached in memory via core/content/. This path is kept
# for backwards compatibility with timestamp lookup tools.
TRANSCRIPTS_DIR = (
    Path(__file__).parent.parent.parent
    / "educational_content_deprecated"
    / "video_transcripts"
)


def _parse_timestamp(value: str | float | int) -> float:
    """Parse a timestamp to seconds.

    Accepts:
    - str "M:SS.ms" (e.g., "2:52.25")
    - float/int seconds (for backwards compat during migration)

    Returns:
        Time in seconds as float
    """
    if isinstance(value, (int, float)):
        return float(value)
    parts = value.split(":")
    minutes = int(parts[0])
    seconds = float(parts[1])
    return minutes * 60 + seconds


def find_transcript_timestamps(
    video_id: str, search_dir: Path | str | None = None
) -> Path:
    """
    Find .timestamps.json file for a video ID.

    Args:
        video_id: YouTube video ID (e.g., "pYXy-A4siMw")
        search_dir: Directory to search (default: educational_content_deprecated/video_transcripts/)

    Returns:
        Path to the .timestamps.json file

    Raises:
        FileNotFoundError: If no matching transcript found
    """
    if search_dir is None:
        search_dir = TRANSCRIPTS_DIR
    else:
        search_dir = Path(search_dir)

    # Find files matching video_id prefix with .timestamps.json extension
    pattern = f"{video_id}*.timestamps.json"
    matches = list(search_dir.glob(pattern))

    if not matches:
        raise FileNotFoundError(
            f"No transcript timestamps found for video ID: {video_id}"
        )

    return matches[0]


def get_text_at_time(
    video_id: str,
    start: float,
    end: float,
    search_dir: Path | str | None = None,
) -> str:
    """
    Get transcript text between timestamps.

    Args:
        video_id: YouTube video ID
        start: Start time in seconds
        end: End time in seconds
        search_dir: Directory to search (default: educational_content_deprecated/video_transcripts/)

    Returns:
        Text spoken between start and end times
    """
    timestamps_path = find_transcript_timestamps(video_id, search_dir)
    words = json.loads(timestamps_path.read_text())

    words_in_range = [
        w["text"] for w in words if start <= _parse_timestamp(w["start"]) <= end
    ]

    return " ".join(words_in_range)


def normalize_for_matching(text: str) -> str:
    """Normalize text for fuzzy matching: lowercase, strip punctuation."""
    return re.sub(r"[^\w\s]", "", text).lower()


def flatten_transcript(words: list[dict]) -> list[dict]:
    """
    Flatten transcript to word-level entries.

    For word-level transcripts, returns as-is.
    For sentence-level, splits each entry and interpolates timestamps.

    Returns:
        List of {"text": str, "start": float, "segment_idx": int}
    """
    result = []
    for seg_idx, entry in enumerate(words):
        text = entry["text"]
        start = _parse_timestamp(entry["start"])

        # Split into individual words
        tokens = text.split()
        if len(tokens) <= 1:
            # Already word-level
            result.append({"text": text, "start": start, "segment_idx": seg_idx})
        else:
            # Sentence-level - each word gets same timestamp as segment
            for token in tokens:
                result.append({"text": token, "start": start, "segment_idx": seg_idx})

    return result


def find_anchor_position(
    words: list[dict],
    anchor: str,
    search_from: int = 0,
) -> int | None:
    """
    Find position where anchor text best matches in transcript.

    Uses sliding window to find best match position.

    Args:
        words: List of {"text": str, "start": float}
        anchor: Anchor text to find
        search_from: Start searching from this index

    Returns:
        Index of first word of best match, or None if not found
    """
    anchor_tokens = normalize_for_matching(anchor).split()
    if not anchor_tokens:
        return None

    anchor_len = len(anchor_tokens)
    best_match_idx = None
    best_match_score = 0

    # Sliding window search
    for i in range(search_from, len(words) - anchor_len + 1):
        window_tokens = [
            normalize_for_matching(words[i + j]["text"]) for j in range(anchor_len)
        ]

        # Count matching tokens
        matches = sum(1 for a, b in zip(anchor_tokens, window_tokens) if a == b)

        if matches > best_match_score:
            best_match_score = matches
            best_match_idx = i

        # Perfect match - stop early
        if matches == anchor_len:
            break

    # Require at least 50% match
    if best_match_score >= anchor_len * 0.5:
        return best_match_idx

    return None


def get_time_from_text(
    video_id: str,
    first_words: str,
    last_words: str,
    search_dir: Path | str | None = None,
) -> dict:
    """
    Find timestamps for a text passage identified by its first and last words.

    Args:
        video_id: YouTube video ID
        first_words: First ~5 words of the quote
        last_words: Last ~5 words of the quote
        search_dir: Directory to search (default: educational_content_deprecated/video_transcripts/)

    Returns:
        {"start": float, "end": float}

    Raises:
        ValueError: If anchors cannot be found in transcript
    """
    timestamps_path = find_transcript_timestamps(video_id, search_dir)
    timestamps = json.loads(timestamps_path.read_text())

    # Flatten to word-level for searching
    words = flatten_transcript(timestamps)

    # Find first_words anchor (start of quote)
    start_idx = find_anchor_position(words, first_words)
    if start_idx is None:
        raise ValueError(f"Could not find first_words: {first_words}")

    # Find last_words anchor (must be after start)
    last_anchor_tokens = normalize_for_matching(last_words).split()
    end_idx = find_anchor_position(words, last_words, search_from=start_idx)
    if end_idx is None:
        raise ValueError(f"Could not find last_words: {last_words}")

    # End timestamp is the last word of the last_words anchor
    end_word_idx = end_idx + len(last_anchor_tokens) - 1

    return {
        "start": words[start_idx]["start"],
        "end": words[end_word_idx]["start"],
    }
