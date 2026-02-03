// src/parser/frontmatter.test.ts
import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from './frontmatter';

describe('parseFrontmatter', () => {
  it('extracts frontmatter fields', () => {
    const content = `---
slug: my-module
title: My Module Title
---

# Content here`;

    const result = parseFrontmatter(content);

    expect(result.frontmatter).toEqual({
      slug: 'my-module',
      title: 'My Module Title',
    });
    expect(result.body).toBe('\n# Content here');
    expect(result.bodyStartLine).toBe(5);
  });

  it('returns error for missing frontmatter', () => {
    const content = '# No frontmatter here';

    const result = parseFrontmatter(content);

    expect(result.error).toBeDefined();
    expect(result.error?.message).toBe('Missing frontmatter');
    expect(result.error?.line).toBe(1);
  });

  it('returns error for unclosed frontmatter', () => {
    const content = `---
slug: broken
title: Never Closed`;

    const result = parseFrontmatter(content);

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('Unclosed frontmatter');
  });

  it('includes file path in error when provided', () => {
    const content = '# No frontmatter here';

    const result = parseFrontmatter(content, 'modules/test.md');

    expect(result.error).toBeDefined();
    expect(result.error?.file).toBe('modules/test.md');
  });

  it('handles invalid YAML syntax', () => {
    const content = `---
slug: test
title: [invalid yaml
---

# Content`;

    const result = parseFrontmatter(content);

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('Invalid YAML');
    expect(result.error?.line).toBe(2);
  });
});
