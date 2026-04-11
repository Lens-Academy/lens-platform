# core/modules/tests/test_path_resolver.py
"""Tests for wiki-link path resolution."""

from core.modules.path_resolver import resolve_wiki_link, extract_filename_stem


def test_extract_filename_stem_simple():
    assert extract_filename_stem("Lenses/Video Lens") == "Video Lens"


def test_extract_filename_stem_with_parent_refs():
    assert extract_filename_stem("../Learning Outcomes/Some Outcome") == "Some Outcome"


def test_extract_filename_stem_with_extension():
    assert extract_filename_stem("../Lenses/My Lens.md") == "My Lens"


def test_resolve_wiki_link_learning_outcome():
    result = resolve_wiki_link("[[../Learning Outcomes/AI Risks]]")
    assert result == ("learning_outcomes", "AI Risks")


def test_resolve_wiki_link_lens():
    result = resolve_wiki_link("[[../Lenses/Video Intro]]")
    assert result == ("lenses", "Video Intro")


def test_resolve_wiki_link_video_transcript():
    result = resolve_wiki_link("[[../video_transcripts/kurzgesagt]]")
    assert result == ("video_transcripts", "kurzgesagt")


def test_resolve_wiki_link_article():
    result = resolve_wiki_link("[[../articles/deep_dive]]")
    assert result == ("articles", "deep_dive")


def test_resolve_wiki_link_embed_syntax():
    # ![[...]] is embed syntax, should work the same
    result = resolve_wiki_link("![[../Lenses/My Lens]]")
    assert result == ("lenses", "My Lens")


def test_resolve_wiki_link_with_display_name():
    """Obsidian display name syntax [[path|display]] should strip display name."""
    result = resolve_wiki_link("[[../Learning Outcomes/AI Risks|AI Risk Overview]]")
    assert result == ("learning_outcomes", "AI Risks")


def test_resolve_wiki_link_embed_with_display_name():
    """Embed with display name ![[path|display]] should strip display name."""
    result = resolve_wiki_link("![[../Lenses/My Lens|Custom Title]]")
    assert result == ("lenses", "My Lens")


def test_resolve_wiki_link_bare_path_with_pipe():
    """Bare path (without brackets) containing pipe should strip display name."""
    result = resolve_wiki_link("../articles/deep_dive|Article Title")
    assert result == ("articles", "deep_dive")
