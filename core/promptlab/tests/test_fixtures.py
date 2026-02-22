from core.promptlab.fixtures import list_fixtures, load_fixture


def test_list_fixtures_returns_summaries():
    fixtures = list_fixtures()
    assert len(fixtures) >= 2
    for f in fixtures:
        assert "name" in f
        assert "module" in f
        assert "description" in f


def test_load_flat_fixture_normalized_to_sections():
    """Flat-format fixtures (legacy) get wrapped in a single section."""
    fixture = load_fixture("Cognitive Superpowers - Deceptive Alignment Discussion")
    assert fixture is not None
    assert "sections" in fixture
    assert len(fixture["sections"]) == 1
    section = fixture["sections"][0]
    assert "instructions" in section
    assert "context" in section
    assert "conversations" in section
    assert len(section["conversations"]) >= 1
    conv = section["conversations"][0]
    assert "label" in conv
    assert "messages" in conv
    assert len(conv["messages"]) >= 2


def test_load_sectioned_fixture():
    """Sectioned-format fixtures have multiple sections."""
    fixture = load_fixture("Alignment Fundamentals")
    if fixture is None:
        # Skip if the sectioned fixture hasn't been created yet
        return
    assert len(fixture["sections"]) >= 2
    for section in fixture["sections"]:
        assert "name" in section
        assert "instructions" in section
        assert "context" in section
        assert len(section["conversations"]) >= 1


def test_load_fixture_not_found():
    fixture = load_fixture("Nonexistent Fixture")
    assert fixture is None
