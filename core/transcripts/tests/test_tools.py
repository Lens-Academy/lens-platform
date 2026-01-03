#!/usr/bin/env python3
"""Tests for transcript lookup tools."""

import json
import pytest
from pathlib import Path
from core.transcripts import find_transcript_timestamps, get_text_at_time, get_time_from_text


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

    def test_finds_timestamps_in_default_dir(self):
        """Finds real timestamps in educational_content/video_transcripts/."""
        # Use a real transcript we know exists
        result = find_transcript_timestamps("pYXy-A4siMw")

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

    def test_works_with_real_transcript(self):
        """Works with real transcript from educational_content/video_transcripts/."""
        # Get text from known timestamp range in real transcript
        result = get_text_at_time("pYXy-A4siMw", start=0.0, end=2.0)

        assert "Hi" in result or "This" in result

    def test_real_transcript_10m11s_to_12m11s(self):
        """Gets correct text from 10:11-12:11 of AI Safety Intro video."""
        # 10:11 = 611s, 12:11 = 731s
        result = get_text_at_time("pYXy-A4siMw", start=611, end=732)

        # Verify boundaries - text before/after should NOT be included
        assert "Stuart Russell" not in result      # comes before 611s
        assert "now it values the vase" not in result  # comes after 732s

        # Verify content at boundaries IS included
        assert "When a system is" in result
        assert "goal. So it will" in result


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
        assert result["end"] == 5.0    # "you" starts at 5.0

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

    def test_works_with_real_transcript(self):
        """Works with real transcript from educational_content/video_transcripts/."""
        # Quote: "Hi. This video is a remaster of" - first 4 and last 4 words
        result = get_time_from_text(
            "pYXy-A4siMw",
            first_words="Hi This video is",
            last_words="is a remaster of",
        )

        # Should find timestamps near the beginning
        assert result["start"] < 5.0
        assert result["end"] > result["start"]

    def test_real_transcript_when_a_system_is(self):
        """Finds timestamps for 'When a system is...goal. So it will' passage."""
        result = get_time_from_text(
            "pYXy-A4siMw",
            first_words="When a system is",
            last_words="goal. So it will",
        )

        # Should match 10:11 (611s) to 12:11 (731s)
        assert 610 < result["start"] < 613  # ~611.60s
        assert 730 < result["end"] < 733    # ~731.20s
