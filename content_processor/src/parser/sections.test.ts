// src/parser/sections.test.ts
import { describe, it, expect } from 'vitest';
import { parseSections, MODULE_SECTION_TYPES, LENS_SECTION_TYPES } from './sections.js';

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
});
