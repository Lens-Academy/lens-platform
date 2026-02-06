// src/parser/module.test.ts
import { describe, it, expect } from 'vitest';
import { parseModule, parsePageTextSegments } from './module.js';

describe('parseModule', () => {
  describe('empty/whitespace required fields validation', () => {
    it('rejects empty slug', () => {
      const content = `---
slug: ""
title: Valid Title
---
`;
      const result = parseModule(content, 'modules/test.md');

      expect(result.module).toBeNull();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('slug');
      expect(result.errors[0].message).toContain('empty');
    });

    it('rejects whitespace-only slug', () => {
      const content = `---
slug: "   "
title: Valid Title
---
`;
      const result = parseModule(content, 'modules/test.md');

      expect(result.module).toBeNull();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('slug');
      expect(result.errors[0].message).toContain('empty');
    });

    it('rejects empty title', () => {
      const content = `---
slug: valid-slug
title: ""
---
`;
      const result = parseModule(content, 'modules/test.md');

      expect(result.module).toBeNull();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('title');
      expect(result.errors[0].message).toContain('empty');
    });

    it('rejects whitespace-only title', () => {
      const content = `---
slug: valid-slug
title: "   "
---
`;
      const result = parseModule(content, 'modules/test.md');

      expect(result.module).toBeNull();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('title');
      expect(result.errors[0].message).toContain('empty');
    });

    it('rejects both empty slug and title', () => {
      const content = `---
slug: ""
title: ""
---
`;
      const result = parseModule(content, 'modules/test.md');

      expect(result.module).toBeNull();
      expect(result.errors).toHaveLength(2);
    });

    it('accepts valid non-empty slug and title', () => {
      const content = `---
slug: valid-slug
title: Valid Title
---
`;
      const result = parseModule(content, 'modules/test.md');

      expect(result.module).not.toBeNull();
      expect(result.module?.slug).toBe('valid-slug');
      expect(result.module?.title).toBe('Valid Title');
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('slug format validation', () => {
    it('rejects slug with special characters', () => {
      const content = `---
slug: "!!!invalid@@@"
title: Valid Title
---
`;
      const result = parseModule(content, 'modules/test.md');

      expect(result.module).toBeNull();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('slug');
      expect(result.errors[0].severity).toBe('error');
    });

    it('rejects slug with spaces', () => {
      const content = `---
slug: "my slug"
title: Valid Title
---
`;
      const result = parseModule(content, 'modules/test.md');

      expect(result.module).toBeNull();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('slug');
    });

    it('rejects slug starting with hyphen', () => {
      const content = `---
slug: "-invalid"
title: Valid Title
---
`;
      const result = parseModule(content, 'modules/test.md');

      expect(result.module).toBeNull();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('hyphen');
    });

    it('rejects slug ending with hyphen', () => {
      const content = `---
slug: "invalid-"
title: Valid Title
---
`;
      const result = parseModule(content, 'modules/test.md');

      expect(result.module).toBeNull();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('hyphen');
    });

    it('rejects uppercase slug', () => {
      const content = `---
slug: UPPERCASE
title: Valid Title
---
`;
      const result = parseModule(content, 'modules/test.md');

      expect(result.module).toBeNull();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('uppercase');
    });

    it('accepts valid slug with lowercase, numbers, and hyphens', () => {
      const content = `---
slug: intro-101
title: Valid Title
---
`;
      const result = parseModule(content, 'modules/test.md');

      expect(result.module).not.toBeNull();
      expect(result.module?.slug).toBe('intro-101');
      expect(result.errors).toHaveLength(0);
    });
  });

  it('parses complete module', () => {
    const content = `---
slug: intro
title: Introduction
---

# Learning Outcome: First Topic
source:: [[../Learning Outcomes/lo1.md|LO1]]
`;

    const result = parseModule(content, 'modules/intro.md');

    expect(result.module?.slug).toBe('intro');
    expect(result.module?.title).toBe('Introduction');
    expect(result.module?.sections).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
  });

  it('collects errors from all parsing stages', () => {
    const content = `# No frontmatter

# Unknown: Bad Type
`;

    const result = parseModule(content, 'modules/bad.md');

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.message.includes('frontmatter'))).toBe(true);
  });

  it('parses Page section with ## Text content', () => {
    const content = `---
slug: test
title: Test Module
---

# Page: Welcome
id:: d1e2f3a4-5678-90ab-cdef-1234567890ab

## Text
content::
This is the welcome text.
It spans multiple lines.
`;

    const result = parseModule(content, 'modules/test.md');

    expect(result.module?.sections).toHaveLength(1);
    expect(result.module?.sections[0].type).toBe('page');
    expect(result.module?.sections[0].fields.id).toBe('d1e2f3a4-5678-90ab-cdef-1234567890ab');
    // The body should contain the ## Text subsection
    expect(result.module?.sections[0].body).toContain('## Text');
    expect(result.module?.sections[0].body).toContain('content::');
  });
});

describe('parsePageTextSegments', () => {
  it('parses ## Text subsection with multiline content', () => {
    const body = `id:: d1e2f3a4-5678-90ab-cdef-1234567890ab

## Text
content::
This is the welcome text.
It spans multiple lines.
`;

    const result = parsePageTextSegments(body);

    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].type).toBe('text');
    expect(result.segments[0].content).toContain('welcome text');
    expect(result.segments[0].content).toContain('multiple lines');
  });

  it('parses multiple ## Text subsections', () => {
    const body = `id:: some-id

## Text
content::
First text segment.

## Text
content::
Second text segment.
`;

    const result = parsePageTextSegments(body);

    expect(result.segments).toHaveLength(2);
    expect(result.segments[0].content).toContain('First text');
    expect(result.segments[1].content).toContain('Second text');
  });

  it('returns empty array when no ## Text subsections', () => {
    const body = `id:: some-id
no text subsections here
`;

    const result = parsePageTextSegments(body);

    expect(result.segments).toHaveLength(0);
  });

  it('handles content:: on same line', () => {
    const body = `## Text
content:: Single line content.
`;

    const result = parsePageTextSegments(body);

    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].content).toBe('Single line content.');
  });

  it('reports error for unknown ## header like ## Texta', () => {
    const body = `id:: some-id

## Texta
content::
Some text.
`;

    const result = parsePageTextSegments(body, 'modules/test.md', 5);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('Unknown section type');
    expect(result.errors[0].message).toContain('Texta');
    expect(result.errors[0].suggestion).toContain('Text');
    expect(result.errors[0].severity).toBe('error');
    expect(result.errors[0].file).toBe('modules/test.md');
  });

  it('reports error for completely unknown ## header', () => {
    const body = `id:: some-id

## Foobar
content::
Something.
`;

    const result = parsePageTextSegments(body, 'modules/test.md', 5);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('Unknown section type');
    expect(result.errors[0].message).toContain('Foobar');
    expect(result.errors[0].suggestion).toContain('Text');
    expect(result.errors[0].severity).toBe('error');
  });

  it('accepts ## Text without errors', () => {
    const body = `## Text
content:: Hello.
`;

    const result = parsePageTextSegments(body, 'modules/test.md', 5);

    expect(result.segments).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
  });

  it('errors when ## Text has content: (single colon) instead of content::', () => {
    const body = `## Text
content:
We begin by examining the potential of AI.
`;

    const result = parsePageTextSegments(body, 'modules/test.md', 5);

    // content: (single colon) is not a valid field - should error
    expect(result.segments).toHaveLength(0);
    expect(result.errors.some(e =>
      e.severity === 'error' &&
      e.message.toLowerCase().includes('content')
    )).toBe(true);
  });

  it('errors when ## Text section has no content:: field at all', () => {
    const body = `## Text
Just some plain text without any field.
`;

    const result = parsePageTextSegments(body, 'modules/test.md', 5);

    expect(result.segments).toHaveLength(0);
    expect(result.errors.some(e =>
      e.severity === 'error' &&
      e.message.toLowerCase().includes('content')
    )).toBe(true);
  });

  it('reports multiple errors for multiple unknown ## headers', () => {
    const body = `## Texta
content:: Something.

## Banana
content:: Other.

## Text
content:: Valid content.
`;

    const result = parsePageTextSegments(body, 'modules/test.md', 5);

    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].content).toBe('Valid content.');
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0].message).toContain('Texta');
    expect(result.errors[1].message).toContain('Banana');
  });
});
