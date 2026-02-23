// src/parser/article.test.ts
import { describe, it, expect } from 'vitest';
import { parseArticle } from './article.js';

describe('parseArticle', () => {
  describe('frontmatter validation', () => {
    it('parses valid article with all fields', () => {
      const content = `---
title: "Existential risk from AI"
author: Wikipedia
source_url: https://en.wikipedia.org/wiki/Existential_risk_from_AI
date: 2015-05-01
---

The article body here.
`;
      const result = parseArticle(content, 'articles/test.md');

      expect(result.errors).toHaveLength(0);
      expect(result.article).not.toBeNull();
      expect(result.article!.title).toBe('Existential risk from AI');
      expect(result.article!.author).toBe('Wikipedia');
      expect(result.article!.sourceUrl).toBe('https://en.wikipedia.org/wiki/Existential_risk_from_AI');
      expect(result.article!.date).toBe('2015-05-01');
      expect(result.article!.imageUrls).toEqual([]);
    });

    it('parses multiple authors as comma-separated string', () => {
      const content = `---
title: "AI Is Grown, Not Built"
author:
  - "Eliezer Yudkowsky"
  - "Nate Soares"
source_url: https://example.com/article
---

Body text.
`;
      const result = parseArticle(content, 'articles/test.md');

      expect(result.errors).toHaveLength(0);
      expect(result.article).not.toBeNull();
      expect(result.article!.author).toBe('Eliezer Yudkowsky, Nate Soares');
    });

    it('parses valid article without optional date', () => {
      const content = `---
title: Test Article
author: Jane Doe
source_url: https://example.com/article
---

Body text.
`;
      const result = parseArticle(content, 'articles/test.md');

      expect(result.errors).toHaveLength(0);
      expect(result.article).not.toBeNull();
      expect(result.article!.date).toBeUndefined();
    });

    it('reports error for missing title', () => {
      const content = `---
author: Jane Doe
source_url: https://example.com
---

Body.
`;
      const result = parseArticle(content, 'articles/test.md');

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.message.toLowerCase().includes('title'))).toBe(true);
      expect(result.errors[0].severity).toBe('error');
    });

    it('reports error for missing author', () => {
      const content = `---
title: Test
source_url: https://example.com
---

Body.
`;
      const result = parseArticle(content, 'articles/test.md');

      expect(result.errors.some(e => e.message.toLowerCase().includes('author'))).toBe(true);
    });

    it('reports error for missing source_url', () => {
      const content = `---
title: Test
author: Jane
---

Body.
`;
      const result = parseArticle(content, 'articles/test.md');

      expect(result.errors.some(e => e.message.toLowerCase().includes('source_url'))).toBe(true);
    });

    it('reports error for empty required fields', () => {
      const content = `---
title: ""
author: "  "
source_url: https://example.com
---

Body.
`;
      const result = parseArticle(content, 'articles/test.md');

      expect(result.errors.some(e => e.message.toLowerCase().includes('title'))).toBe(true);
      expect(result.errors.some(e => e.message.toLowerCase().includes('author'))).toBe(true);
    });

    it('reports error for missing frontmatter entirely', () => {
      const content = `Just some text without frontmatter.`;

      const result = parseArticle(content, 'articles/test.md');

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.article).toBeNull();
      expect(result.errors.some(e => e.message.toLowerCase().includes('frontmatter'))).toBe(true);
    });

    it('reports error for unclosed frontmatter', () => {
      const content = `---
title: Test
author: Jane
source_url: https://example.com
This never closes the frontmatter
`;
      const result = parseArticle(content, 'articles/test.md');

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.article).toBeNull();
    });
  });

  describe('wikilinks in frontmatter fields', () => {
    it('reports error when title contains a wikilink', () => {
      const content = `---
title: "[[Some Article]]"
author: Jane
source_url: https://example.com
---

Body.
`;
      const result = parseArticle(content, 'articles/test.md');

      expect(result.errors.some(e =>
        e.message.includes('title') && e.message.toLowerCase().includes('wikilink')
      )).toBe(true);
    });

    it('reports error when author contains a wikilink', () => {
      const content = `---
title: Test
author: "[[Jane Doe]]"
source_url: https://example.com
---

Body.
`;
      const result = parseArticle(content, 'articles/test.md');

      expect(result.errors.some(e =>
        e.message.includes('author') && e.message.toLowerCase().includes('wikilink')
      )).toBe(true);
    });

    it('does not flag source_url containing brackets in URL encoding', () => {
      const content = `---
title: Test
author: Jane
source_url: https://example.com/page?q=[test]
---

Body.
`;
      const result = parseArticle(content, 'articles/test.md');

      // source_url is expected to be a URL, not checked for wikilinks
      const wikilinkErrors = result.errors.filter(e => e.message.toLowerCase().includes('wikilink'));
      expect(wikilinkErrors).toHaveLength(0);
    });
  });

  describe('image validation', () => {
    it('reports error for wiki-link images', () => {
      const content = `---
title: Test
author: Jane
source_url: https://example.com
---

Some text before.

![[image.png]]

Some text after.
`;
      const result = parseArticle(content, 'articles/test.md');

      expect(result.errors.some(e =>
        e.message.toLowerCase().includes('wiki-link') ||
        e.message.toLowerCase().includes('wikilink')
      )).toBe(true);
    });

    it('reports error for wiki-link images with paths', () => {
      const content = `---
title: Test
author: Jane
source_url: https://example.com
---

![[path/to/image.png]]
`;
      const result = parseArticle(content, 'articles/test.md');

      expect(result.errors.some(e =>
        e.message.toLowerCase().includes('wiki-link') ||
        e.message.toLowerCase().includes('wikilink')
      )).toBe(true);
    });

    it('collects standard markdown image URLs', () => {
      const content = `---
title: Test
author: Jane
source_url: https://example.com
---

![alt text](https://example.com/img.png)
`;
      const result = parseArticle(content, 'articles/test.md');

      expect(result.article).not.toBeNull();
      expect(result.article!.imageUrls).toHaveLength(1);
      expect(result.article!.imageUrls[0].url).toBe('https://example.com/img.png');
    });

    it('collects multiple images with correct line numbers', () => {
      const content = `---
title: Test
author: Jane
source_url: https://example.com
---

First paragraph.

![img1](https://example.com/1.png)

More text.

![img2](https://example.com/2.png)
`;
      const result = parseArticle(content, 'articles/test.md');

      expect(result.article!.imageUrls).toHaveLength(2);
      expect(result.article!.imageUrls[0].url).toBe('https://example.com/1.png');
      expect(result.article!.imageUrls[1].url).toBe('https://example.com/2.png');
      // Line numbers should be absolute (frontmatter + body offset)
      expect(result.article!.imageUrls[0].line).toBeGreaterThan(0);
      expect(result.article!.imageUrls[1].line).toBeGreaterThan(result.article!.imageUrls[0].line);
    });

    it('returns empty imageUrls when no images in body', () => {
      const content = `---
title: Test
author: Jane
source_url: https://example.com
---

Just plain text, no images.
`;
      const result = parseArticle(content, 'articles/test.md');

      expect(result.article!.imageUrls).toEqual([]);
    });
  });
});
