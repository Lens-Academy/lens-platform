// src/parser/sections.test.ts
import { describe, it, expect } from 'vitest';
import { parseSections, MODULE_SECTION_TYPES, LENS_SECTION_TYPES, LO_SECTION_TYPES } from './sections.js';

describe('parseSections', () => {
  it('splits content by H1 headers for modules', () => {
    const content = `
# Learning Outcome: First Section
source:: [[../Learning Outcomes/lo1.md|LO1]]

# Page: Second Section
id:: 123

Some content here.
`;

    const result = parseSections(content, 1, MODULE_SECTION_TYPES);

    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].type).toBe('learning-outcome');
    expect(result.sections[0].title).toBe('First Section');
    expect(result.sections[1].type).toBe('page');
    expect(result.sections[1].title).toBe('Second Section');
  });

  it('splits content by H3 headers for lens files', () => {
    const content = `
### Text: Introduction

#### Text
content:: Hello world.

### Article: Deep Dive
source:: [[../articles/deep.md|Article]]
`;

    const result = parseSections(content, 3, LENS_SECTION_TYPES);

    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].type).toBe('text');
    expect(result.sections[1].type).toBe('article');
  });

  it('extracts fields from section body', () => {
    const content = `
# Learning Outcome: Test
source:: [[../Learning Outcomes/lo1.md|LO1]]
optional:: true
`;

    const result = parseSections(content, 1, MODULE_SECTION_TYPES);

    expect(result.sections[0].fields.source).toBe('[[../Learning Outcomes/lo1.md|LO1]]');
    expect(result.sections[0].fields.optional).toBe('true');
  });

  it('returns error for unknown section type', () => {
    const content = `
# Unknown: Bad Section
content:: here
`;

    const result = parseSections(content, 1, MODULE_SECTION_TYPES);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('Unknown section type');
  });

  describe('multiline fields', () => {
    it('parses content:: spanning multiple lines', () => {
      const content = `
### Text: Intro

#### Text
content::
This is line one.
This is line two.
This is line three.

#### Chat
instructions:: Next segment
`;

      const result = parseSections(content, 3, LENS_SECTION_TYPES);

      // The section body should contain the multiline content
      expect(result.sections[0].body).toContain('content::\nThis is line one.');
    });

    it('parses field with value on next line after ::', () => {
      const content = `
## Lens:
source::
![[../Lenses/test]]
`;

      const result = parseSections(content, 2, LO_SECTION_TYPES);

      expect(result.sections[0].fields.source).toBe('![[../Lenses/test]]');
    });

    it('parses multiline field that continues until next field', () => {
      const content = `
## Lens: Test
instructions::
First line.
Second line.
Third line.
source:: [[test.md|Test]]
`;

      const result = parseSections(content, 2, LO_SECTION_TYPES);

      expect(result.sections[0].fields.instructions).toBe('First line.\nSecond line.\nThird line.');
      expect(result.sections[0].fields.source).toBe('[[test.md|Test]]');
    });

    it('parses multiline field that continues until end of section', () => {
      const content = `
### Text: Notes

#### Text
content::
Line one.
Line two.
Line three.
`;

      const result = parseSections(content, 3, LENS_SECTION_TYPES);

      // The parseFields function should extract multiline content
      // Note: body contains subsections too, we need to test fields parsing
      expect(result.sections[0].body).toContain('content::\nLine one.');
    });

    it('handles field with empty value followed by content on next line', () => {
      const content = `
# Page: Welcome
id:: abc-123
content::
Welcome to the course.
This is the intro text.
`;

      const result = parseSections(content, 1, MODULE_SECTION_TYPES);

      expect(result.sections[0].fields.id).toBe('abc-123');
      expect(result.sections[0].fields.content).toBe('Welcome to the course.\nThis is the intro text.');
    });
  });

  describe('empty section titles', () => {
    it('handles empty section title (colon with no title after)', () => {
      const content = `
## Lens:
source:: [[../Lenses/test.md|Test]]

## Lens:
source:: [[../Lenses/other.md|Other]]
`;

      const result = parseSections(content, 2, LO_SECTION_TYPES);

      expect(result.sections).toHaveLength(2);
      expect(result.sections[0].title).toBe('');
      expect(result.sections[0].type).toBe('lens');
      expect(result.sections[1].title).toBe('');
    });

    it('handles empty section title with trailing whitespace', () => {
      const content = `
## Lens:
source:: [[../Lenses/test.md|Test]]
`;

      const result = parseSections(content, 2, LO_SECTION_TYPES);

      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].title).toBe('');
      expect(result.sections[0].type).toBe('lens');
    });
  });

  describe('duplicate field warnings', () => {
    it('warns about duplicate field definitions', () => {
      const content = `
# Page: Test
content:: First value
content:: Second value
`;

      const result = parseSections(content, 1, MODULE_SECTION_TYPES, 'test.md');

      expect(result.errors.some(e =>
        e.severity === 'warning' &&
        e.message.includes('Duplicate')
      )).toBe(true);
    });

    it('uses the last value when field is duplicated', () => {
      const content = `
# Page: Test
id:: first-id
id:: second-id
`;

      const result = parseSections(content, 1, MODULE_SECTION_TYPES, 'test.md');

      // The last value should win
      expect(result.sections[0].fields.id).toBe('second-id');
    });

    it('does not warn when different fields are defined', () => {
      const content = `
# Page: Test
id:: some-id
content:: Some content
`;

      const result = parseSections(content, 1, MODULE_SECTION_TYPES, 'test.md');

      // No warnings about duplicates
      expect(result.errors.filter(e =>
        e.severity === 'warning' &&
        e.message.includes('Duplicate')
      )).toHaveLength(0);
    });

    it('does not warn about duplicate fields when they are in different sub-sections', () => {
      // This is the real-world case: a Lens file with multiple Text segments,
      // each with their own content:: field. These are NOT duplicates.
      const content = `
### Article: Cascades and Cycles
source:: [[../articles/cascades.md]]

#### Text
content::
Introduction paragraph explaining cybernetics and feedback loops.

#### Article-excerpt
from:: "Cascades are when"
to:: "neutron multiplication factor"

#### Text
content::
What are the properties that make something a cycle rather than a cascade?

#### Chat: Discussion
instructions::
TLDR of what the user just read about cascades and cycles.
Discuss the difference between cascades and cycles.

### Video: Intelligence Explosion
source:: [[../video_transcripts/intelligence.md]]

#### Text
content::
Watch this video about intelligence feedback loops.

#### Video-excerpt
from:: 0:00
to:: 14:49

#### Text
content::
What surprised you about the video?

#### Chat: Video Discussion
instructions::
Discuss what the user learned from the video.
`;

      const result = parseSections(content, 3, LENS_SECTION_TYPES, 'test-lens.md');

      // Should have 2 sections (Article and Video)
      expect(result.sections).toHaveLength(2);

      // Should NOT have any duplicate field warnings
      const duplicateWarnings = result.errors.filter(e =>
        e.severity === 'warning' &&
        e.message.includes('Duplicate')
      );
      expect(duplicateWarnings).toHaveLength(0);

      // Verify the sections were parsed correctly
      expect(result.sections[0].type).toBe('article');
      expect(result.sections[0].title).toBe('Cascades and Cycles');
      expect(result.sections[0].fields.source).toBe('[[../articles/cascades.md]]');

      expect(result.sections[1].type).toBe('video');
      expect(result.sections[1].title).toBe('Intelligence Explosion');
      expect(result.sections[1].fields.source).toBe('[[../video_transcripts/intelligence.md]]');
    });

    it('still warns about actual duplicates within the same sub-section', () => {
      const content = `
### Text: Intro

#### Text
content:: First paragraph
content:: Second paragraph that overwrites the first
`;

      const result = parseSections(content, 3, LENS_SECTION_TYPES, 'test.md');

      // This IS a real duplicate - same field twice within the same #### Text segment
      const duplicateWarnings = result.errors.filter(e =>
        e.severity === 'warning' &&
        e.message.includes('Duplicate')
      );
      expect(duplicateWarnings).toHaveLength(1);
      expect(duplicateWarnings[0].message).toContain("content");
    });
  });

  describe('special characters in titles', () => {
    it('handles ampersand in section title', () => {
      const content = `
# Page: Safety & Alignment
content:: This section covers both topics.
`;

      const result = parseSections(content, 1, MODULE_SECTION_TYPES, 'test.md');

      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].title).toBe('Safety & Alignment');
      expect(result.sections[0].type).toBe('page');
      expect(result.errors).toHaveLength(0);
    });

    it('handles apostrophe in section title', () => {
      const content = `
# Page: What's Next
content:: Looking ahead.
`;

      const result = parseSections(content, 1, MODULE_SECTION_TYPES, 'test.md');

      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].title).toBe("What's Next");
    });

    it('handles colon in section title', () => {
      const content = `
# Page: Part 1: Introduction
content:: The beginning.
`;

      const result = parseSections(content, 1, MODULE_SECTION_TYPES, 'test.md');

      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].title).toBe('Part 1: Introduction');
    });

    it('handles multiple special characters in section title', () => {
      const content = `
# Page: AI Safety & Alignment: What's at Stake?
content:: Important questions.
`;

      const result = parseSections(content, 1, MODULE_SECTION_TYPES, 'test.md');

      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].title).toBe("AI Safety & Alignment: What's at Stake?");
    });
  });
});
