// src/validator/duplicates.test.ts
import { describe, it, expect } from 'vitest';
import { detectDuplicateSlugs, type SlugEntry } from './duplicates.js';
import { processContent } from '../index.js';

describe('duplicate slug detection', () => {
  it('returns error when two modules have the same slug', () => {
    const entries: SlugEntry[] = [
      { slug: 'intro-to-ai', file: 'modules/intro.md' },
      { slug: 'intro-to-ai', file: 'modules/duplicate.md' },
    ];

    const errors = detectDuplicateSlugs(entries);

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('intro-to-ai');
    expect(errors[0].message.toLowerCase()).toContain('duplicate');
    expect(errors[0].file).toBe('modules/duplicate.md');
    expect(errors[0].severity).toBe('error');
  });

  it('returns no errors when all slugs are unique', () => {
    const entries: SlugEntry[] = [
      { slug: 'module-1', file: 'modules/m1.md' },
      { slug: 'module-2', file: 'modules/m2.md' },
      { slug: 'module-3', file: 'modules/m3.md' },
    ];

    const errors = detectDuplicateSlugs(entries);

    expect(errors).toHaveLength(0);
  });

  it('returns errors for each duplicate pair when multiple duplicates exist', () => {
    const entries: SlugEntry[] = [
      { slug: 'intro', file: 'modules/intro1.md' },
      { slug: 'intro', file: 'modules/intro2.md' },
      { slug: 'advanced', file: 'modules/advanced1.md' },
      { slug: 'advanced', file: 'modules/advanced2.md' },
    ];

    const errors = detectDuplicateSlugs(entries);

    expect(errors).toHaveLength(2);
    expect(errors.some(e => e.message.includes('intro'))).toBe(true);
    expect(errors.some(e => e.message.includes('advanced'))).toBe(true);
  });

  it('returns empty array for empty input', () => {
    const errors = detectDuplicateSlugs([]);

    expect(errors).toHaveLength(0);
  });

  it('returns empty array for single entry', () => {
    const entries: SlugEntry[] = [
      { slug: 'only-one', file: 'modules/one.md' },
    ];

    const errors = detectDuplicateSlugs(entries);

    expect(errors).toHaveLength(0);
  });

  it('includes suggestion about making slugs unique', () => {
    const entries: SlugEntry[] = [
      { slug: 'dupe', file: 'modules/a.md' },
      { slug: 'dupe', file: 'modules/b.md' },
    ];

    const errors = detectDuplicateSlugs(entries);

    expect(errors[0].suggestion).toBeDefined();
    expect(errors[0].suggestion).toContain('modules/a.md');
  });

  it('detects duplicate when same slug appears three times', () => {
    const entries: SlugEntry[] = [
      { slug: 'common', file: 'modules/a.md' },
      { slug: 'common', file: 'modules/b.md' },
      { slug: 'common', file: 'modules/c.md' },
    ];

    const errors = detectDuplicateSlugs(entries);

    // Should report errors for 2nd and 3rd occurrences
    expect(errors).toHaveLength(2);
    expect(errors[0].file).toBe('modules/b.md');
    expect(errors[1].file).toBe('modules/c.md');
  });
});

describe('duplicate slug detection via processContent', () => {
  it('detects duplicate slugs across modules', () => {
    const files = new Map([
      ['modules/module1.md', `---
slug: duplicate-slug
title: Module One
---

# Page: Welcome
`],
      ['modules/module2.md', `---
slug: duplicate-slug
title: Module Two
---

# Page: Hello
`],
    ]);

    const result = processContent(files);

    const duplicateErrors = result.errors.filter(e =>
      e.message.toLowerCase().includes('duplicate') &&
      e.message.toLowerCase().includes('slug')
    );
    expect(duplicateErrors).toHaveLength(1);
    expect(duplicateErrors[0].message).toContain('duplicate-slug');
    expect(duplicateErrors[0].file).toBe('modules/module2.md');
  });

  it('allows unique slugs across modules', () => {
    const files = new Map([
      ['modules/module1.md', `---
slug: unique-slug-1
title: Module One
---

# Page: Welcome
`],
      ['modules/module2.md', `---
slug: unique-slug-2
title: Module Two
---

# Page: Hello
`],
    ]);

    const result = processContent(files);

    const duplicateErrors = result.errors.filter(e =>
      e.message.toLowerCase().includes('duplicate') &&
      e.message.toLowerCase().includes('slug')
    );
    expect(duplicateErrors).toHaveLength(0);
  });
});
