// src/bundler/article.test.ts
import { describe, it, expect } from 'vitest';
import { extractArticleExcerpt, bundleArticleWithCollapsed } from './article.js';

describe('extractArticleExcerpt', () => {
  it('extracts content between anchors', () => {
    const article = `# Article Title

Some intro text.

The key insight is that AI alignment requires careful consideration
of human values. This is a complex problem that involves
understanding this concept.

More content after.
`;

    const result = extractArticleExcerpt(
      article,
      'The key insight is',
      'understanding this concept.',
      'articles/test.md'
    );

    expect(result.content).toContain('AI alignment');
    expect(result.content).toContain('human values');
    expect(result.error).toBeUndefined();
  });

  it('returns error for missing start anchor', () => {
    const article = 'Some content without the anchor.';

    const result = extractArticleExcerpt(
      article,
      'nonexistent anchor',
      'also missing',
      'articles/test.md'
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('not found');
    expect(result.error?.suggestion).toContain('anchor');
  });

  it('returns error for duplicate anchor', () => {
    const article = `First occurrence of the phrase here.

And another occurrence of the phrase here.`;

    const result = extractArticleExcerpt(
      article,
      'occurrence of the phrase',
      'here',
      'articles/test.md'
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('multiple');
  });

  it('is case-insensitive for matching', () => {
    const article = 'THE KEY INSIGHT is important.';

    const result = extractArticleExcerpt(
      article,
      'the key insight',
      'important.',
      'articles/test.md'
    );

    expect(result.content).toBeDefined();
    expect(result.error).toBeUndefined();
  });
});

describe('bundleArticleWithCollapsed', () => {
  it('computes collapsed_before for non-first excerpt', () => {
    const article = `# Article

Intro paragraph.

First important section that we want to show.

Middle content that gets collapsed.

Second important section to show.

Conclusion.
`;
    const excerpts = [
      { from: 'First important', to: 'want to show.' },
      { from: 'Second important', to: 'section to show.' },
    ];

    const result = bundleArticleWithCollapsed(article, excerpts, 'articles/test.md');

    expect(result[0].collapsed_before).toBeUndefined(); // First excerpt has no collapsed_before
    expect(result[1].collapsed_before).toContain('Middle content');
  });

  it('computes collapsed_after for last excerpt', () => {
    const article = `Intro.

Main content here.

Conclusion paragraph at the end.
`;
    const excerpts = [
      { from: 'Main content', to: 'content here.' },
    ];

    const result = bundleArticleWithCollapsed(article, excerpts, 'articles/test.md');

    expect(result[0].collapsed_after).toContain('Conclusion paragraph');
  });

  it('handles adjacent excerpts with no collapsed content', () => {
    const article = `First sentence. Second sentence.`;
    const excerpts = [
      { from: 'First', to: 'sentence.' },
      { from: 'Second', to: 'sentence.' },
    ];

    const result = bundleArticleWithCollapsed(article, excerpts, 'articles/test.md');

    // Adjacent excerpts have minimal or no collapsed content
    expect(result[0].collapsed_after).toBeUndefined();
    expect(result[1].collapsed_before).toBeUndefined();
  });
});
