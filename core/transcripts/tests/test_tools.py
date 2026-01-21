#!/usr/bin/env python3
"""Tests for transcript lookup tools."""

import json
import pytest
from core.transcripts import (
    find_transcript_timestamps,
    get_text_at_time,
    get_time_from_text,
)


class TestFindTranscriptTimestamps:
    """Test finding transcript timestamp files by video ID."""

    def test_finds_timestamps_by_video_id(self, tmp_path):
        """Finds .timestamps.json file matching video ID prefix."""
        # Create a test timestamps file
        timestamps = [{"text": "hello", "start": 0.0}]
        test_file = tmp_path / "abc123_Test_Video.timestamps.json"
        test_file.write_text(json.dumps(timestamps))

        result = find_transcript_timestamps("abc123", search_dir=tmp_path)

        assert result == test_file

    def test_raises_when_timestamps_not_found(self, tmp_path):
        """Raises FileNotFoundError when no matching timestamps file."""
        with pytest.raises(FileNotFoundError):
            find_transcript_timestamps("nonexistent", search_dir=tmp_path)

    def test_finds_timestamps_with_complex_filename(self, tmp_path):
        """Finds timestamps file with video ID prefix and additional title text."""
        timestamps = [{"text": "hello", "start": 0.0}, {"text": "world", "start": 1.0}]
        test_file = tmp_path / "pYXy-A4siMw_AI_Safety_Introduction.timestamps.json"
        test_file.write_text(json.dumps(timestamps))

        result = find_transcript_timestamps("pYXy-A4siMw", search_dir=tmp_path)

        assert result.exists()
        assert "pYXy-A4siMw" in result.name


class TestGetTextAtTime:
    """Test getting transcript text between timestamps."""

    def test_returns_text_between_timestamps(self, tmp_path):
        """Returns words that fall within the time range."""
        timestamps = [
            {"text": "Hello", "start": 1.0},
            {"text": "world", "start": 2.0},
            {"text": "how", "start": 3.0},
            {"text": "are", "start": 4.0},
            {"text": "you", "start": 5.0},
        ]
        test_file = tmp_path / "test123_Test.timestamps.json"
        test_file.write_text(json.dumps(timestamps))

        result = get_text_at_time("test123", start=2.0, end=4.5, search_dir=tmp_path)

        assert result == "world how are"

    def test_includes_words_at_exact_boundaries(self, tmp_path):
        """Words at exact start/end times are included."""
        timestamps = [
            {"text": "one", "start": 1.0},
            {"text": "two", "start": 2.0},
            {"text": "three", "start": 3.0},
        ]
        test_file = tmp_path / "test123_Test.timestamps.json"
        test_file.write_text(json.dumps(timestamps))

        result = get_text_at_time("test123", start=1.0, end=3.0, search_dir=tmp_path)

        assert result == "one two three"

    def test_returns_empty_for_no_words_in_range(self, tmp_path):
        """Returns empty string when no words fall in range."""
        timestamps = [
            {"text": "early", "start": 1.0},
            {"text": "late", "start": 10.0},
        ]
        test_file = tmp_path / "test123_Test.timestamps.json"
        test_file.write_text(json.dumps(timestamps))

        result = get_text_at_time("test123", start=5.0, end=8.0, search_dir=tmp_path)

        assert result == ""

    def test_handles_longer_transcript(self, tmp_path):
        """Works with a longer transcript spanning multiple time ranges."""
        # Simulate a transcript with words spread over time
        timestamps = [
            {"text": "Hi.", "start": 0.0},
            {"text": "This", "start": 0.5},
            {"text": "video", "start": 1.0},
            {"text": "is", "start": 1.5},
            {"text": "about", "start": 2.0},
            {"text": "AI", "start": 2.5},
            {"text": "safety.", "start": 3.0},
        ]
        test_file = tmp_path / "vid123_Test_Video.timestamps.json"
        test_file.write_text(json.dumps(timestamps))

        result = get_text_at_time("vid123", start=0.0, end=2.0, search_dir=tmp_path)

        assert "Hi." in result
        assert "This" in result

    def test_respects_time_boundaries(self, tmp_path):
        """Correctly excludes words outside the requested time range."""
        timestamps = [
            {"text": "before", "start": 600.0},
            {"text": "When", "start": 611.0},
            {"text": "a", "start": 612.0},
            {"text": "system", "start": 613.0},
            {"text": "is", "start": 614.0},
            {"text": "goal.", "start": 730.0},
            {"text": "So", "start": 731.0},
            {"text": "after", "start": 733.0},
        ]
        test_file = tmp_path / "vid456_AI_Safety.timestamps.json"
        test_file.write_text(json.dumps(timestamps))

        result = get_text_at_time("vid456", start=611, end=732, search_dir=tmp_path)

        # Verify boundaries - text before/after should NOT be included
        assert "before" not in result  # comes before 611s
        assert "after" not in result  # comes after 732s

        # Verify content at boundaries IS included
        assert "When" in result
        assert "So" in result


class TestGetTimeFromText:
    """Test finding timestamps from anchor words."""

    def test_finds_timestamps_for_quote(self, tmp_path):
        """Finds start and end timestamps for a quote identified by first/last words."""
        timestamps = [
            {"text": "Hello", "start": 1.0},
            {"text": "world", "start": 2.0},
            {"text": "how", "start": 3.0},
            {"text": "are", "start": 4.0},
            {"text": "you", "start": 5.0},
            {"text": "today", "start": 6.0},
        ]
        test_file = tmp_path / "test123_Test.timestamps.json"
        test_file.write_text(json.dumps(timestamps))

        # Quote is "world how are you" - provide first 2 and last 2 words
        result = get_time_from_text(
            "test123",
            first_words="world how",
            last_words="are you",
            search_dir=tmp_path,
        )

        assert result["start"] == 2.0  # "world" starts at 2.0
        assert result["end"] == 5.0  # "you" starts at 5.0

    def test_handles_punctuation_differences(self, tmp_path):
        """Matches despite punctuation differences."""
        timestamps = [
            {"text": "Hello,", "start": 1.0},
            {"text": "world!", "start": 2.0},
            {"text": "How", "start": 3.0},
            {"text": "are", "start": 4.0},
            {"text": "you?", "start": 5.0},
        ]
        test_file = tmp_path / "test123_Test.timestamps.json"
        test_file.write_text(json.dumps(timestamps))

        # Quote without punctuation
        result = get_time_from_text(
            "test123",
            first_words="Hello world",
            last_words="are you",
            search_dir=tmp_path,
        )

        assert result["start"] == 1.0
        assert result["end"] == 5.0

    def test_handles_case_differences(self, tmp_path):
        """Matches despite case differences."""
        timestamps = [
            {"text": "HELLO", "start": 1.0},
            {"text": "World", "start": 2.0},
            {"text": "how", "start": 3.0},
        ]
        test_file = tmp_path / "test123_Test.timestamps.json"
        test_file.write_text(json.dumps(timestamps))

        result = get_time_from_text(
            "test123",
            first_words="hello world",
            last_words="world how",
            search_dir=tmp_path,
        )

        assert result["start"] == 1.0
        assert result["end"] == 3.0

    def test_raises_when_first_words_not_found(self, tmp_path):
        """Raises ValueError when first_words can't be found."""
        timestamps = [{"text": "hello", "start": 1.0}]
        test_file = tmp_path / "test123_Test.timestamps.json"
        test_file.write_text(json.dumps(timestamps))

        with pytest.raises(ValueError, match="first"):
            get_time_from_text(
                "test123",
                first_words="nonexistent words",
                last_words="hello",
                search_dir=tmp_path,
            )

    def test_raises_when_last_words_not_found(self, tmp_path):
        """Raises ValueError when last_words can't be found."""
        timestamps = [{"text": "hello", "start": 1.0}]
        test_file = tmp_path / "test123_Test.timestamps.json"
        test_file.write_text(json.dumps(timestamps))

        with pytest.raises(ValueError, match="last"):
            get_time_from_text(
                "test123",
                first_words="hello",
                last_words="nonexistent words",
                search_dir=tmp_path,
            )

    def test_finds_quote_at_start_of_transcript(self, tmp_path):
        """Finds timestamps for a quote near the beginning of the transcript."""
        timestamps = [
            {"text": "Hi.", "start": 0.5},
            {"text": "This", "start": 1.0},
            {"text": "video", "start": 1.5},
            {"text": "is", "start": 2.0},
            {"text": "a", "start": 2.5},
            {"text": "remaster", "start": 3.0},
            {"text": "of", "start": 3.5},
            {"text": "something", "start": 4.0},
        ]
        test_file = tmp_path / "vid789_Intro.timestamps.json"
        test_file.write_text(json.dumps(timestamps))

        result = get_time_from_text(
            "vid789",
            first_words="Hi This video is",
            last_words="is a remaster of",
            search_dir=tmp_path,
        )

        # Should find timestamps near the beginning
        assert result["start"] < 5.0
        assert result["end"] > result["start"]

    def test_finds_quote_in_middle_of_transcript(self, tmp_path):
        """Finds timestamps for a passage in the middle of a transcript."""
        timestamps = [
            {"text": "earlier", "start": 600.0},
            {"text": "content", "start": 605.0},
            {"text": "When", "start": 611.6},
            {"text": "a", "start": 612.0},
            {"text": "system", "start": 612.5},
            {"text": "is", "start": 613.0},
            {"text": "middle", "start": 700.0},
            {"text": "goal.", "start": 730.5},
            {"text": "So", "start": 731.0},
            {"text": "it", "start": 731.2},
            {"text": "will", "start": 731.5},
            {"text": "later", "start": 740.0},
        ]
        test_file = tmp_path / "vid999_AI_Safety.timestamps.json"
        test_file.write_text(json.dumps(timestamps))

        result = get_time_from_text(
            "vid999",
            first_words="When a system is",
            last_words="goal. So it will",
            search_dir=tmp_path,
        )

        # Should match around 611s to 731s
        assert 610 < result["start"] < 615
        assert 730 < result["end"] < 735
