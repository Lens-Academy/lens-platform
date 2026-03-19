// src/parser/sections.test.ts
import { describe, it, expect } from 'vitest';
import { parseSections, MODULE_SECTION_TYPES, LENS_SECTION_TYPES, LO_SECTION_TYPES } from './sections.js';

describe('parseSections', () => {
  it('splits content by H1 headers for modules', () => {
    const content = `
# Learning Outcome: First Section
source:: [[../Learning Outcomes/lo1.md|LO1]]

# Lens: Second Section
source:: [[../Lenses/lens1.md|Lens]]
`;

    const result = parseSections(content, 0, MODULE_SECTION_TYPES);

    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].type).toBe('learning-outcome');
    expect(result.sections[0].title).toBe('First Section');
    expect(result.sections[1].type).toBe('lens');
    expect(result.sections[1].title).toBe('Second Section');
  });

  it('splits content by H3 headers for lens files', () => {
    const content = `
### Page: Introduction

#### Text
content:: Hello world.

### Article: Deep Dive
source:: [[../articles/deep.md|Article]]
`;

    const result = parseSections(content, 2, LENS_SECTION_TYPES);

    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].type).toBe('page');
    expect(result.sections[1].type).toBe('article');
  });

  it('extracts fields from section body', () => {
    const content = `
# Learning Outcome: Test
source:: [[../Learning Outcomes/lo1.md|LO1]]
optional:: true
`;

    const result = parseSections(content, 0, MODULE_SECTION_TYPES);

    expect(result.sections[0].fields.source).toBe('[[../Learning Outcomes/lo1.md|LO1]]');
    expect(result.sections[0].fields.optional).toBe('true');
  });

  it('returns error for unknown section type', () => {
    const content = `
# Unknown: Bad Section
content:: here
`;

    const result = parseSections(content, 0, MODULE_SECTION_TYPES);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('Unknown section type');
  });

  describe('multiline fields', () => {
    it('parses content:: spanning multiple lines', () => {
      const content = `
### Page: Intro

#### Text
content::
This is line one.
This is line two.
This is line three.

#### Chat
instructions:: Next segment
`;

      const result = parseSections(content, 2, LENS_SECTION_TYPES);

      // The section body should contain the multiline content
      expect(result.sections[0].body).toContain('content::\nThis is line one.');
    });

    it('parses field with value on next line after ::', () => {
      const content = `
## Lens:
source::
![[../Lenses/test]]
`;

      const result = parseSections(content, 1, LO_SECTION_TYPES);

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

      const result = parseSections(content, 1, LO_SECTION_TYPES);

      expect(result.sections[0].fields.instructions).toBe('First line.\nSecond line.\nThird line.');
      expect(result.sections[0].fields.source).toBe('[[test.md|Test]]');
    });

    it('parses multiline field that continues until end of section', () => {
      const content = `
### Page: Notes

#### Text
content::
Line one.
Line two.
Line three.
`;

      const result = parseSections(content, 2, LENS_SECTION_TYPES);

      // The parseFields function should extract multiline content
      // Note: body contains subsections too, we need to test fields parsing
      expect(result.sections[0].body).toContain('content::\nLine one.');
    });

    it('handles field with empty value followed by content on next line', () => {
      const content = `
# Lens: Welcome
id:: abc-123
content::
Welcome to the course.
This is the intro text.
`;

      const result = parseSections(content, 0, MODULE_SECTION_TYPES);

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

      const result = parseSections(content, 1, LO_SECTION_TYPES);

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

      const result = parseSections(content, 1, LO_SECTION_TYPES);

      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].title).toBe('');
      expect(result.sections[0].type).toBe('lens');
    });
  });

  describe('duplicate field warnings', () => {
    it('warns about duplicate field definitions', () => {
      const content = `
# Lens: Test
content:: First value
content:: Second value
`;

      const result = parseSections(content, 0, MODULE_SECTION_TYPES, 'test.md');

      expect(result.errors.some(e =>
        e.severity === 'error' &&
        e.message.includes('Duplicate')
      )).toBe(true);
    });

    it('uses the last value when field is duplicated', () => {
      const content = `
# Lens: Test
id:: first-id
id:: second-id
`;

      const result = parseSections(content, 0, MODULE_SECTION_TYPES, 'test.md');

      // The last value should win
      expect(result.sections[0].fields.id).toBe('second-id');
    });

    it('does not warn when different fields are defined', () => {
      const content = `
# Lens: Test
id:: some-id
content:: Some content
`;

      const result = parseSections(content, 0, MODULE_SECTION_TYPES, 'test.md');

      // No errors about duplicates
      expect(result.errors.filter(e =>
        e.severity === 'error' &&
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

      const result = parseSections(content, 2, LENS_SECTION_TYPES, 'test-lens.md');

      // Should have 2 sections (Article and Video)
      expect(result.sections).toHaveLength(2);

      // Should NOT have any duplicate field errors
      const duplicateWarnings = result.errors.filter(e =>
        e.severity === 'error' &&
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
### Page: Intro

#### Text
content:: First paragraph
content:: Second paragraph that overwrites the first
`;

      const result = parseSections(content, 2, LENS_SECTION_TYPES, 'test.md');

      // This IS a real duplicate - same field twice within the same #### Text segment
      const duplicateWarnings = result.errors.filter(e =>
        e.severity === 'error' &&
        e.message.includes('Duplicate')
      );
      expect(duplicateWarnings).toHaveLength(1);
      expect(duplicateWarnings[0].message).toContain("content");
    });
  });

  describe('special characters in titles', () => {
    it('handles ampersand in section title', () => {
      const content = `
# Lens: Safety & Alignment
source:: [[../Lenses/safety.md]]
`;

      const result = parseSections(content, 0, MODULE_SECTION_TYPES, 'test.md');

      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].title).toBe('Safety & Alignment');
      expect(result.sections[0].type).toBe('lens');
      expect(result.errors).toHaveLength(0);
    });

    it('handles apostrophe in section title', () => {
      const content = `
# Lens: What's Next
content:: Looking ahead.
`;

      const result = parseSections(content, 0, MODULE_SECTION_TYPES, 'test.md');

      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].title).toBe("What's Next");
    });

    it('handles colon in section title', () => {
      const content = `
# Lens: Part 1: Introduction
content:: The beginning.
`;

      const result = parseSections(content, 0, MODULE_SECTION_TYPES, 'test.md');

      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].title).toBe('Part 1: Introduction');
    });

    it('warns when content appears before first section header', () => {
      const content = `
This text is before any section header.
It should trigger a warning.

# Lens: First Section
source:: [[../Lenses/test.md]]
`;

      const result = parseSections(content, 0, MODULE_SECTION_TYPES, 'test.md');

      expect(result.sections).toHaveLength(1);
      expect(result.errors.some(e =>
        e.message.includes('before') &&
        e.severity === 'error'
      )).toBe(true);
    });

    it('matches section headers at any level deeper than parentLevel', () => {
      // With flexible levels, ## Page is valid when parentLevel=1
      const content = `
## Page: Introduction
content:: Hello world.
`;
      const result = parseSections(content, 1, LENS_SECTION_TYPES, 'Lenses/test.md');
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].type).toBe('page');
    });

    it('matches module sections at H2 when parentLevel=0', () => {
      const content = `
## Learning Outcome: First Topic
source:: [[../Learning Outcomes/lo1.md|LO1]]
`;
      const result = parseSections(content, 0, MODULE_SECTION_TYPES, 'modules/test.md');
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].type).toBe('learning-outcome');
    });

    it('does not warn for blank lines before first section header', () => {
      const content = `

# Lens: First Section
source:: [[../Lenses/test.md]]
`;

      const result = parseSections(content, 0, MODULE_SECTION_TYPES, 'test.md');

      expect(result.errors.filter(e => e.message.includes('before'))).toHaveLength(0);
    });

    it('handles multiple special characters in section title', () => {
      const content = `
# Lens: AI Safety & Alignment: What's at Stake?
source:: [[../Lenses/safety.md]]
`;

      const result = parseSections(content, 0, MODULE_SECTION_TYPES, 'test.md');

      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].title).toBe("AI Safety & Alignment: What's at Stake?");
    });
  });

  describe('single-colon field detection', () => {
    it('errors when known field uses single colon instead of double colon', () => {
      const content = `## Lens: Test\nsource: [[../Lenses/lens1.md|Lens]]`;

      const result = parseSections(content, 1, LO_SECTION_TYPES, 'test.md');

      expect(result.errors.some(e =>
        e.severity === 'error' &&
        e.message.includes('source') &&
        e.message.includes('::')
      )).toBe(true);
    });

    it('does NOT warn for unknown words with single colon (just markdown text)', () => {
      // "Summary" is not a known field name, so "Summary: text" is just prose
      const content = `## Lens: Test\nSummary: This is a summary of the topic.`;

      const result = parseSections(content, 1, LO_SECTION_TYPES, 'test.md');

      const singleColonWarnings = result.errors.filter(e =>
        e.severity === 'error' &&
        e.message.includes("'Summary:'")
      );
      expect(singleColonWarnings).toHaveLength(0);
    });

    it('does NOT warn for unknown single-colon words after heading breaks content:: field', () => {
      // Real-world case: a content:: field contains a markdown heading,
      // which resets currentField. Subsequent "Summary: text" is still
      // conceptually part of the content, not a mistyped field.
      const content = `
### Page: Security Mindset

#### Text
content::
Some intro text about security.

# Detailed Analysis
Summary: The key points about security mindset are important.
`;

      const result = parseSections(content, 2, LENS_SECTION_TYPES, 'test.md');

      const summaryWarnings = result.errors.filter(e =>
        e.severity === 'error' &&
        e.message.includes("'Summary:'")
      );
      expect(summaryWarnings).toHaveLength(0);
    });

    it('still warns for known fields with single colon after heading breaks content:: field', () => {
      // "source" IS a known field, so "source: value" should still warn
      const content = `
### Page: Intro

#### Text
content::
Some text here.

# A Heading
source: [[../Lenses/lens1.md|Lens]]
`;

      const result = parseSections(content, 2, LENS_SECTION_TYPES, 'test.md');

      expect(result.errors.some(e =>
        e.severity === 'error' &&
        e.message.includes("'source:'") &&
        e.message.includes('::')
      )).toBe(true);
    });
  });

  describe('markdown heading detection in content/instructions fields', () => {
    // When a # header inside a content:: or instructions:: multiline field
    // is NOT a known structural type, it's probably a markdown heading.
    // The parser should warn and suggest escaping.

    it('warns when a markdown heading terminates a content:: field', () => {
      // "# Understanding Existential Risk" is not a known section/segment type
      const body = `
### Page: Intro

#### Text
content::
# Understanding Existential Risk
This text gets orphaned.
`;
      const result = parseSections(body, 2, LENS_SECTION_TYPES, 'test.md');
      const warning = result.errors.find(e =>
        e.message.includes('looks like a Markdown heading')
      );
      expect(warning).toBeDefined();
      expect(warning!.suggestion).toContain('!#');
      expect(warning!.severity).toBe('warning');
    });

    it('warns when a markdown heading terminates an instructions:: field', () => {
      const body = `
### Page: Discussion

#### Chat
instructions::
## Discussion Topic
Talk about this.
`;
      const result = parseSections(body, 2, LENS_SECTION_TYPES, 'test.md');
      const warning = result.errors.find(e =>
        e.message.includes('looks like a Markdown heading')
      );
      expect(warning).toBeDefined();
      expect(warning!.suggestion).toContain('!#');
    });

    it('does NOT warn when a known segment type header follows a content:: field', () => {
      // "#### Chat" is a known type — it's structural, not markdown
      const body = `
### Page: Mixed

#### Text
content:: Some text.
#### Chat
instructions:: Do something.
`;
      const result = parseSections(body, 2, LENS_SECTION_TYPES, 'test.md');
      const warning = result.errors.find(e =>
        e.message.includes('looks like a Markdown heading')
      );
      expect(warning).toBeUndefined();
    });

    it('does NOT warn for headers outside a content/instructions field', () => {
      // The header appears after source::, not content/instructions
      const body = `
### Page: Intro

#### Text
source:: [[../foo.md]]
# Some Heading
orphan text
`;
      const result = parseSections(body, 2, LENS_SECTION_TYPES, 'test.md');
      const warning = result.errors.find(e =>
        e.message.includes('looks like a Markdown heading')
      );
      expect(warning).toBeUndefined();
    });

    it('does NOT warn for typos of structural types (e.g., #### CHTA → Chat)', () => {
      const body = `
### Page: Test

#### Text
content::
Some intro text.

#### CHTA
instructions:: Do something.
`;
      const result = parseSections(body, 2, LENS_SECTION_TYPES, 'test.md');
      const warning = result.errors.find(e =>
        e.message.includes('looks like a Markdown heading')
      );
      expect(warning).toBeUndefined();
    });

    it('includes the heading text in the warning', () => {
      const body = `
### Page: Intro

#### Text
content::
## Why AI Safety Matters
`;
      const result = parseSections(body, 2, LENS_SECTION_TYPES, 'test.md');
      const warning = result.errors.find(e =>
        e.message.includes('looks like a Markdown heading')
      );
      expect(warning).toBeDefined();
      expect(warning!.message).toContain('Why AI Safety Matters');
    });
  });

  describe('free text warnings', () => {
    it('errors when free text appears before first field in section body', () => {
      const content = `
# Learning Outcome: Test LO
Here is a description of this learning outcome.
- It covers topic A
source:: [[../Learning Outcomes/lo1.md|LO 1]]
`;

      const result = parseSections(content, 0, MODULE_SECTION_TYPES);

      expect(result.sections).toHaveLength(1);
      expect(result.errors.some(e =>
        e.severity === 'error' &&
        e.message.includes('ignored')
      )).toBe(true);
    });

    it('does not warn for blank lines before first field', () => {
      const content = `
# Learning Outcome: Test LO

source:: [[../Learning Outcomes/lo1.md|LO 1]]
`;

      const result = parseSections(content, 0, MODULE_SECTION_TYPES);

      expect(result.errors.filter(e =>
        e.message.includes('ignored')
      )).toHaveLength(0);
    });

    it('does not warn for text that is part of a multiline field value', () => {
      const content = `
# Lens: Test Lens
id:: 550e8400-e29b-41d4-a716-446655440000
Here is continued text that is part of the id field.
`;
      const result = parseSections(content, 0, MODULE_SECTION_TYPES);

      expect(result.errors.filter(e =>
        e.message.includes('ignored')
      )).toHaveLength(0);
    });

    it('only warns once per section for multiple free text lines', () => {
      const content = `
# Learning Outcome: Test LO
Line one of free text.
Line two of free text.
Line three of free text.
source:: [[../Learning Outcomes/lo1.md|LO 1]]
`;

      const result = parseSections(content, 0, MODULE_SECTION_TYPES);

      const freeTextWarnings = result.errors.filter(e =>
        e.message.includes('ignored')
      );
      expect(freeTextWarnings).toHaveLength(1);
    });
  });

  describe('submodule sections', () => {
    it('parses # Submodule: Title at H1', () => {
      const content = `
# Submodule: Welcome
slug:: welcome

## Lens: Welcome Lens
source:: [[../Lenses/welcome.md]]

## Learning Outcome:
source:: [[../Learning Outcomes/trial for Testing]]
`;

      const validTypes = new Set([...MODULE_SECTION_TYPES, 'submodule']);
      const result = parseSections(content, 0, validTypes);

      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].type).toBe('submodule');
      expect(result.sections[0].title).toBe('Welcome');
      expect(result.sections[0].level).toBe(1);
    });

    it('parses ## Submodule: at H2 (LO context)', () => {
      const content = `
## Submodule: Basics

### Lens:
source:: [[../Lenses/lens-1]]

## Submodule: Deep Dive

### Lens:
source:: [[../Lenses/lens-2]]
`;

      const validTypes = new Set([...LO_SECTION_TYPES, 'submodule']);
      const result = parseSections(content, 1, validTypes);

      expect(result.sections).toHaveLength(2);
      expect(result.sections[0].type).toBe('submodule');
      expect(result.sections[0].title).toBe('Basics');
      expect(result.sections[0].level).toBe(2);
      expect(result.sections[1].type).toBe('submodule');
      expect(result.sections[1].title).toBe('Deep Dive');
      expect(result.sections[1].level).toBe(2);
    });

    it('recursively parses children at level+1', () => {
      const content = `
# Submodule: Welcome

## Lens: Welcome Lens
id:: abc-123

## Learning Outcome:
source:: [[../Learning Outcomes/lo1.md|LO1]]
`;

      const validTypes = new Set([...MODULE_SECTION_TYPES, 'submodule']);
      const result = parseSections(content, 0, validTypes);

      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].type).toBe('submodule');
      expect(result.sections[0].children).toBeDefined();
      expect(result.sections[0].children).toHaveLength(2);
      expect(result.sections[0].children![0].type).toBe('lens');
      expect(result.sections[0].children![0].title).toBe('Welcome Lens');
      expect(result.sections[0].children![0].level).toBe(2);
      expect(result.sections[0].children![1].type).toBe('learning-outcome');
      expect(result.sections[0].children![1].level).toBe(2);
    });

    it('extracts slug:: field from submodule', () => {
      const content = `
# Submodule: Research Methods
slug:: research
`;

      const validTypes = new Set([...MODULE_SECTION_TYPES, 'submodule']);
      const result = parseSections(content, 0, validTypes);

      expect(result.sections[0].fields.slug).toBe('research');
    });

    it('reports level on each ParsedSection', () => {
      const content = `
# Lens: First
source:: [[../Lenses/first.md]]

# Learning Outcome: Second
source:: [[../Learning Outcomes/lo1.md|LO1]]
`;

      const result = parseSections(content, 0, MODULE_SECTION_TYPES);

      expect(result.sections[0].level).toBe(1);
      expect(result.sections[1].level).toBe(1);
    });

    it('finds submodules at any level via flexible matching', () => {
      // With parentLevel=0, # Submodule: at H1 is found directly
      const content = `
# Submodule: Basics

## Lens:
source:: [[../Lenses/lens-1]]

# Submodule: Deep Dive

## Lens:
source:: [[../Lenses/lens-2]]
`;

      const validTypes = new Set([...LO_SECTION_TYPES, 'submodule']);
      const result = parseSections(content, 0, validTypes);

      expect(result.sections).toHaveLength(2);
      expect(result.sections[0].type).toBe('submodule');
      expect(result.sections[0].title).toBe('Basics');
      expect(result.sections[0].level).toBe(1);
      expect(result.sections[0].children).toBeDefined();
      expect(result.sections[0].children).toHaveLength(1);
      expect(result.sections[0].children![0].type).toBe('lens');
      expect(result.sections[0].children![0].level).toBe(2);
      expect(result.sections[1].type).toBe('submodule');
      expect(result.sections[1].title).toBe('Deep Dive');
      expect(result.sections[1].children).toHaveLength(1);
    });

    it('submodule children are parsed from body via hierarchy', () => {
      const content = `
# Submodule: Group A

## Lens:
source:: [[../Lenses/lens-1]]
`;

      const validTypes = new Set([...LO_SECTION_TYPES, 'submodule']);
      const result = parseSections(content, 0, validTypes);

      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].type).toBe('submodule');
      expect(result.sections[0].children).toHaveLength(1);
      expect(result.sections[0].children![0].type).toBe('lens');
    });

    it('non-submodule types at shallower levels are still sections', () => {
      // # Lens: at H1 when parentLevel=0 → valid section
      const content = `
# Lens: Stray
source:: [[../Lenses/lens-1]]
`;

      const validTypes = new Set([...LO_SECTION_TYPES, 'submodule']);
      const result = parseSections(content, 0, validTypes);

      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].type).toBe('lens');
    });

    it('rejects ## Submodule inside # Submodule (no nesting)', () => {
      const content = `
# Submodule: Outer

## Submodule: Inner
`;

      const validTypes = new Set([...MODULE_SECTION_TYPES, 'submodule']);
      const result = parseSections(content, 0, validTypes);

      // The inner ## Submodule should be rejected as an unknown type
      // because children exclude 'submodule' from valid types
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].type).toBe('submodule');
      expect(result.sections[0].children).toBeDefined();
      // The inner submodule should produce an error, not a child section
      const innerErrors = result.errors.filter(e =>
        e.message.includes('Unknown section type') &&
        e.message.includes('Submodule')
      );
      expect(innerErrors.length).toBeGreaterThan(0);
    });
  });

  describe('flexible header levels (parentLevel)', () => {
    it('finds ### Lens: as a child when parentLevel=1', () => {
      const content = `
### Lens:
source:: [[../Lenses/lens1.md]]
`;
      const result = parseSections(content, 1, LO_SECTION_TYPES);
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].type).toBe('lens');
      expect(result.errors.filter(e => e.severity === 'error')).toHaveLength(0);
    });

    it('parses children at mixed header levels the same as uniform levels', () => {
      const mixedContent = `
### Test: Quiz
source:: [[../Tests/quiz1.md]]

### Lens:
source:: [[../Lenses/lens1.md]]

## Lens:
source:: [[../Lenses/lens2.md]]

## Lens:
source:: [[../Lenses/lens3.md]]
`;
      const uniformContent = `
## Test: Quiz
source:: [[../Tests/quiz1.md]]

## Lens:
source:: [[../Lenses/lens1.md]]

## Lens:
source:: [[../Lenses/lens2.md]]

## Lens:
source:: [[../Lenses/lens3.md]]
`;

      const mixedResult = parseSections(mixedContent, 1, LO_SECTION_TYPES);
      const uniformResult = parseSections(uniformContent, 1, LO_SECTION_TYPES);

      expect(mixedResult.sections.length).toBe(4);
      expect(uniformResult.sections.length).toBe(4);
      expect(mixedResult.sections.map(s => s.type)).toEqual(uniformResult.sections.map(s => s.type));
      expect(mixedResult.sections.map(s => s.title)).toEqual(uniformResult.sections.map(s => s.title));
      expect(mixedResult.sections.map(s => s.fields.source))
        .toEqual(uniformResult.sections.map(s => s.fields.source));
      expect(mixedResult.errors.filter(e => e.severity === 'error')).toHaveLength(0);
      expect(uniformResult.errors.filter(e => e.severity === 'error')).toHaveLength(0);
    });

    it('treats deeper header as body of preceding sibling in hierarchical mode', () => {
      const content = `
## Lens: First
source:: [[../Lenses/first.md]]

### Lens: Nested
source:: [[../Lenses/nested.md]]

## Lens: Third
source:: [[../Lenses/third.md]]
`;

      const result = parseSections(content, 1, LO_SECTION_TYPES);

      expect(result.sections).toHaveLength(2);
      expect(result.sections[0].title).toBe('First');
      expect(result.sections[1].title).toBe('Third');
      expect(result.sections.every(s => s.title !== 'Nested')).toBe(true);
    });

    it('records actual header level on each section', () => {
      const content = `
### Lens: Deep
source:: [[../Lenses/deep.md]]

## Lens: Shallow
source:: [[../Lenses/shallow.md]]
`;
      const result = parseSections(content, 1, LO_SECTION_TYPES);

      expect(result.sections).toHaveLength(2);
      expect(result.sections[0].level).toBe(3);
      expect(result.sections[1].level).toBe(2);
    });

    it('does not match headers at or above parentLevel', () => {
      const content = `
# Lens: Too Shallow
source:: [[../Lenses/shallow.md]]

## Lens: Just Right
source:: [[../Lenses/right.md]]
`;
      const result = parseSections(content, 1, LO_SECTION_TYPES);

      // # Lens is at level 1 = parentLevel, should NOT be matched
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].title).toBe('Just Right');
    });
  });

  describe('flat mode for segments', () => {
    const SEGMENT_TYPES = new Set(['text', 'chat', 'article', 'video', 'question', 'roleplay']);

    it('parses segments at ### the same as ####', () => {
      const h3Content = `
### Text
content:: Welcome.
### Chat
instructions:: Ask something.
`;
      const h4Content = `
#### Text
content:: Welcome.
#### Chat
instructions:: Ask something.
`;

      const h3Result = parseSections(h3Content, 2, SEGMENT_TYPES, '', true);
      const h4Result = parseSections(h4Content, 3, SEGMENT_TYPES, '', true);

      expect(h3Result.sections.map(s => s.type)).toEqual(['text', 'chat']);
      expect(h4Result.sections.map(s => s.type)).toEqual(['text', 'chat']);
      expect(h3Result.sections[0].fields.content).toBe('Welcome.');
      expect(h4Result.sections[0].fields.content).toBe('Welcome.');
      expect(h3Result.errors.filter(e => e.severity === 'error')).toHaveLength(0);
      expect(h4Result.errors.filter(e => e.severity === 'error')).toHaveLength(0);
    });

    it('treats all valid-type headers as siblings regardless of level in flat mode', () => {
      const content = `
### Text
content:: Hello.
#### Chat
instructions:: Ask.
`;
      const result = parseSections(content, 2, SEGMENT_TYPES, '', true);

      // Both should be siblings in flat mode
      expect(result.sections).toHaveLength(2);
      expect(result.sections[0].type).toBe('text');
      expect(result.sections[1].type).toBe('chat');
    });

    it('finds segments at any level deeper than parent', () => {
      const content = `
#### Text
content:: Hello from H4.
#### Chat
instructions:: Ask something.
`;
      const result = parseSections(content, 1, SEGMENT_TYPES, '', true);

      expect(result.sections.map(s => s.type)).toEqual(['text', 'chat']);
      expect(result.sections[0].fields.content).toBe('Hello from H4.');
      expect(result.errors.filter(e => e.severity === 'error')).toHaveLength(0);
    });

    it('preserves multiline content:: through unified parsing', () => {
      const content = `
### Text
content::
Line one.
Line two.
Line three.
### Chat
instructions:: Next.
`;
      const result = parseSections(content, 2, SEGMENT_TYPES, '', true);

      expect(result.sections[0].fields.content).toBe('Line one.\nLine two.\nLine three.');
      expect(result.sections[1].fields.instructions).toBe('Next.');
      expect(result.errors.filter(e => e.severity === 'error')).toHaveLength(0);
    });

    it('does not warn about field:: lines before first child header', () => {
      const content = `
id:: abc-123
title:: My Title
### Text
content:: Welcome.
`;
      const result = parseSections(content, 2, SEGMENT_TYPES, '', true);

      const preHeaderErrors = result.errors.filter(e =>
        e.message.includes('before first section header')
      );
      expect(preHeaderErrors).toHaveLength(0);
      expect(result.sections).toHaveLength(1);
    });
  });
});
