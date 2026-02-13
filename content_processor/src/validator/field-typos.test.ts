// src/validator/field-typos.test.ts
import { describe, it, expect } from 'vitest';
import { detectFieldTypos, detectFrontmatterTypos } from './field-typos.js';

describe('field typo detection', () => {
  it('suggests correction for misspelled field "contnet" -> "content"', () => {
    const warnings = detectFieldTypos({ contnet: 'value' }, 'test.md', 10);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("'contnet'");
    expect(warnings[0].suggestion).toContain("'content'");
    expect(warnings[0].severity).toBe('warning');
  });

  it('suggests correction for "intructions" -> "instructions"', () => {
    const warnings = detectFieldTypos({ intructions: 'value' }, 'test.md', 10);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].suggestion).toContain("'instructions'");
  });

  it('suggests correction for "souce" -> "source"', () => {
    const warnings = detectFieldTypos({ souce: 'value' }, 'test.md', 10);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].suggestion).toContain("'source'");
  });

  it('ignores valid field names', () => {
    const warnings = detectFieldTypos(
      { content: 'value', optional: 'true', instructions: 'do something' },
      'test.md',
      10
    );

    expect(warnings).toHaveLength(0);
  });

  it('does not suggest for completely unrelated field names', () => {
    // "xyz123" is not close to any known field
    const warnings = detectFieldTypos({ xyz123: 'value' }, 'test.md', 10);

    expect(warnings).toHaveLength(0);
  });

  it('includes file and line in warnings', () => {
    const warnings = detectFieldTypos({ contnet: 'value' }, 'Lenses/myfile.md', 42);

    expect(warnings[0].file).toBe('Lenses/myfile.md');
    expect(warnings[0].line).toBe(42);
  });

  it('handles multiple typos in same fields object', () => {
    const warnings = detectFieldTypos(
      { contnet: 'value', intructions: 'do something' },
      'test.md',
      10
    );

    expect(warnings).toHaveLength(2);
  });

  // Additional typo detection tests for Task 3
  describe('additional typo variants', () => {
    it('suggests correction for "contetnId" -> "contentId"', () => {
      const warnings = detectFieldTypos({ contetnId: 'value' }, 'test.md', 10);

      expect(warnings).toHaveLength(1);
      expect(warnings[0].suggestion).toContain("'contentId'");
    });

    it('suggests correction for "learningOutcomeID" -> "learningOutcomeId"', () => {
      const warnings = detectFieldTypos({ learningOutcomeID: 'value' }, 'test.md', 10);

      expect(warnings).toHaveLength(1);
      expect(warnings[0].suggestion).toContain("'learningOutcomeId'");
    });

    it('suggests correction for "srouce" -> "source"', () => {
      const warnings = detectFieldTypos({ srouce: 'value' }, 'test.md', 10);

      expect(warnings).toHaveLength(1);
      expect(warnings[0].suggestion).toContain("'source'");
    });

    it('suggests correction for "insructions" -> "instructions"', () => {
      const warnings = detectFieldTypos({ insructions: 'value' }, 'test.md', 10);

      expect(warnings).toHaveLength(1);
      expect(warnings[0].suggestion).toContain("'instructions'");
    });

    it('suggests correction for "optoinal" -> "optional"', () => {
      const warnings = detectFieldTypos({ optoinal: 'value' }, 'test.md', 10);

      expect(warnings).toHaveLength(1);
      expect(warnings[0].suggestion).toContain("'optional'");
    });
  });
});

describe('detectFrontmatterTypos', () => {
  const MODULE_FIELDS = ['slug', 'title', 'contentId'];

  it('warns about typo in frontmatter field', () => {
    const warnings = detectFrontmatterTypos(
      { slgu: 'test', title: 'Test' },
      MODULE_FIELDS,
      'modules/test.md'
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("'slgu'");
    expect(warnings[0].suggestion).toContain("'slug'");
  });

  it('does not warn for valid fields', () => {
    const warnings = detectFrontmatterTypos(
      { slug: 'test', title: 'Test', contentId: '123' },
      MODULE_FIELDS,
      'modules/test.md'
    );

    expect(warnings).toHaveLength(0);
  });

  it('warns about completely unknown fields with no close match', () => {
    const warnings = detectFrontmatterTypos(
      { slug: 'test', title: 'Test', foobar: 'value' },
      MODULE_FIELDS,
      'modules/test.md'
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("'foobar'");
    expect(warnings[0].message).toContain('Unrecognized');
  });

  it('warns about tilte -> title', () => {
    const warnings = detectFrontmatterTypos(
      { slug: 'test', tilte: 'Test' },
      MODULE_FIELDS,
      'modules/test.md'
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0].suggestion).toContain("'title'");
  });
});
