// content_processor/src/validator/validate-frontmatter.test.ts
import { describe, it, expect } from 'vitest';
import { validateFrontmatter } from './validate-frontmatter.js';

describe('validateFrontmatter', () => {
  it('returns no errors for valid module frontmatter', () => {
    const errors = validateFrontmatter(
      { slug: 'intro', title: 'Introduction' },
      'module',
      'modules/intro.md'
    );
    expect(errors).toHaveLength(0);
  });

  it('reports missing required fields', () => {
    const errors = validateFrontmatter(
      { title: 'Introduction' },
      'module',
      'modules/intro.md'
    );
    const slugError = errors.find(e => e.message.includes('slug'));
    expect(slugError).toBeDefined();
    expect(slugError!.severity).toBe('error');
  });

  it('reports empty required fields', () => {
    const errors = validateFrontmatter(
      { slug: '', title: 'Introduction' },
      'module',
      'modules/intro.md'
    );
    const slugError = errors.find(e => e.message.includes('slug') && e.message.includes('empty'));
    expect(slugError).toBeDefined();
  });

  it('reports whitespace-only required fields', () => {
    const errors = validateFrontmatter(
      { slug: '   ', title: 'Introduction' },
      'module',
      'modules/intro.md'
    );
    const slugError = errors.find(e => e.message.includes('slug') && e.message.includes('empty'));
    expect(slugError).toBeDefined();
  });

  it('detects frontmatter typos', () => {
    const errors = validateFrontmatter(
      { slug: 'intro', tilte: 'Introduction' },
      'module',
      'modules/intro.md'
    );
    const typoWarning = errors.find(e => e.message.includes("'tilte'"));
    expect(typoWarning).toBeDefined();
    expect(typoWarning!.severity).toBe('warning');
  });

  it('works for article content type', () => {
    const errors = validateFrontmatter(
      { title: 'My Article', author: 'Jane', source_url: 'https://example.com' },
      'article',
      'articles/test.md'
    );
    expect(errors).toHaveLength(0);
  });

  it('suggests similar field when required field is missing but similar one exists', () => {
    const errors = validateFrontmatter(
      { title: 'My Article', author: 'Jane', url: 'https://example.com' },
      'article',
      'articles/test.md'
    );
    const sourceUrlError = errors.find(e => e.message.includes('source_url'));
    expect(sourceUrlError).toBeDefined();
    expect(sourceUrlError!.suggestion).toBe("Did you mean 'source_url' instead of 'url'?");
  });

  it('reports all missing required fields at once', () => {
    const errors = validateFrontmatter(
      {},
      'article',
      'articles/test.md'
    );
    const missingErrors = errors.filter(e => e.message.includes('Missing required'));
    expect(missingErrors.length).toBe(3); // title, author, source_url
  });
});
