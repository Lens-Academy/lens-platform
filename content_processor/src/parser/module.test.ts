// src/parser/module.test.ts
import { describe, it, expect } from 'vitest';
import { parseModule, parsePageTextSegments } from './module.js';

describe('parseModule', () => {
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

    const segments = parsePageTextSegments(body);

    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe('text');
    expect(segments[0].content).toContain('welcome text');
    expect(segments[0].content).toContain('multiple lines');
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

    const segments = parsePageTextSegments(body);

    expect(segments).toHaveLength(2);
    expect(segments[0].content).toContain('First text');
    expect(segments[1].content).toContain('Second text');
  });

  it('returns empty array when no ## Text subsections', () => {
    const body = `id:: some-id
no text subsections here
`;

    const segments = parsePageTextSegments(body);

    expect(segments).toHaveLength(0);
  });

  it('handles content:: on same line', () => {
    const body = `## Text
content:: Single line content.
`;

    const segments = parsePageTextSegments(body);

    expect(segments).toHaveLength(1);
    expect(segments[0].content).toBe('Single line content.');
  });
});
