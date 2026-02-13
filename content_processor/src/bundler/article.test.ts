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

  describe('special characters in anchors', () => {
    it('handles apostrophes in anchor text', () => {
      const article = `Introduction here.

It's important to understand that AI systems don't always behave as expected.

Conclusion here.`;

      const result = extractArticleExcerpt(
        article,
        "It's important",
        "don't always behave",
        'articles/test.md'
      );

      expect(result.error).toBeUndefined();
      expect(result.content).toContain("It's important");
      expect(result.content).toContain("don't always");
    });

    it('handles ampersand in anchor text', () => {
      const article = `Introduction here.

The relationship between safety & alignment is crucial for AI development.

Conclusion here.`;

      const result = extractArticleExcerpt(
        article,
        'safety & alignment',
        'AI development',
        'articles/test.md'
      );

      expect(result.error).toBeUndefined();
      expect(result.content).toContain('safety & alignment');
    });

    it('handles colons in anchor text', () => {
      const article = `Introduction here.

Key point: this is the main argument we need to consider carefully.

Conclusion here.`;

      const result = extractArticleExcerpt(
        article,
        'Key point:',
        'consider carefully',
        'articles/test.md'
      );

      expect(result.error).toBeUndefined();
      expect(result.content).toContain('Key point:');
    });

    it('handles percent signs in anchor text', () => {
      const article = `Introduction here.

The model achieved 95% accuracy on the benchmark test results.

Conclusion here.`;

      const result = extractArticleExcerpt(
        article,
        '95% accuracy',
        'test results',
        'articles/test.md'
      );

      expect(result.error).toBeUndefined();
      expect(result.content).toContain('95% accuracy');
    });

    it('matches smart/curly quotes against straight quotes', () => {
      // Article from GitHub uses straight apostrophe (U+0027)
      const article = `Introduction here.

giving in to the union's demands.

Conclusion here.`;

      // Anchor in lens file uses curly right quote (U+2019)
      const result = extractArticleExcerpt(
        article,
        'the union\u2019s demands.',
        undefined,
        'articles/test.md'
      );

      expect(result.error).toBeUndefined();
      expect(result.content).toContain("the union's demands.");
    });

    it('matches smart/curly double quotes against straight double quotes', () => {
      const article = `Introduction here.

He said "hello world" to the audience.

Conclusion here.`;

      // Anchors use curly double quotes (U+201C, U+201D)
      const result = extractArticleExcerpt(
        article,
        'said \u201Chello world\u201D',
        undefined,
        'articles/test.md'
      );

      expect(result.error).toBeUndefined();
      expect(result.content).toContain('said "hello world"');
    });

    it('handles multiple special characters together', () => {
      const article = `Introduction here.

Here's the key insight: AI systems won't achieve 100% safety & reliability without careful design.

Conclusion here.`;

      const result = extractArticleExcerpt(
        article,
        "Here's the key insight:",
        "100% safety & reliability",
        'articles/test.md'
      );

      expect(result.error).toBeUndefined();
      expect(result.content).toContain("Here's");
      expect(result.content).toContain("100%");
      expect(result.content).toContain("&");
    });
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

describe('extractArticleExcerpt with optional anchors', () => {
  const articleWithFrontmatter = `---
title: Test Article
author: John Doe
---

Introduction paragraph here.

Start here with the main content that we want to extract.

Middle section content.

End here and this is included.

Conclusion paragraph at the end.
`;

  const articleWithoutFrontmatter = `Introduction paragraph here.

Start here with the main content that we want to extract.

Middle section content.

End here and this is included.

Conclusion paragraph at the end.
`;

  it('extracts from anchor to end of article when toAnchor is undefined', () => {
    const result = extractArticleExcerpt(
      articleWithoutFrontmatter,
      'Start here',
      undefined,
      'articles/test.md'
    );

    expect(result.error).toBeUndefined();
    expect(result.content).toContain('Start here');
    expect(result.content).toContain('Middle section');
    expect(result.content).toContain('End here');
    expect(result.content).toContain('Conclusion paragraph');
  });

  it('extracts from start of article to anchor when fromAnchor is undefined', () => {
    const result = extractArticleExcerpt(
      articleWithoutFrontmatter,
      undefined,
      'End here and this is included.',
      'articles/test.md'
    );

    expect(result.error).toBeUndefined();
    expect(result.content).toContain('Introduction paragraph');
    expect(result.content).toContain('Start here');
    expect(result.content).toContain('End here and this is included.');
    expect(result.content).not.toContain('Conclusion paragraph');
  });

  it('extracts entire article when both anchors are undefined', () => {
    const result = extractArticleExcerpt(
      articleWithoutFrontmatter,
      undefined,
      undefined,
      'articles/test.md'
    );

    expect(result.error).toBeUndefined();
    expect(result.content).toContain('Introduction paragraph');
    expect(result.content).toContain('Conclusion paragraph');
    expect(result.content).toBe(articleWithoutFrontmatter.trim());
  });

  it('strips frontmatter when extracting entire article', () => {
    const result = extractArticleExcerpt(
      articleWithFrontmatter,
      undefined,
      undefined,
      'articles/test.md'
    );

    expect(result.error).toBeUndefined();
    expect(result.content).not.toContain('title:');
    expect(result.content).not.toContain('author:');
    expect(result.content).not.toContain('---');
    expect(result.content).toContain('Introduction paragraph');
    expect(result.content).toContain('Conclusion paragraph');
  });

  it('strips frontmatter when extracting from start to anchor', () => {
    const result = extractArticleExcerpt(
      articleWithFrontmatter,
      undefined,
      'Middle section content.',
      'articles/test.md'
    );

    expect(result.error).toBeUndefined();
    expect(result.content).not.toContain('title:');
    expect(result.content).not.toContain('---');
    expect(result.content).toContain('Introduction paragraph');
    expect(result.content).toContain('Middle section content.');
  });
});
