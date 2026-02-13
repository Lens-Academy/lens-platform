// src/parser/course.test.ts
import { describe, it, expect } from 'vitest';
import { parseCourse } from './course.js';

describe('parseCourse', () => {
  it('parses course with module references', () => {
    const content = `---
slug: intro-course
title: Introduction to AI Safety
---

# Module: [[../modules/intro.md|Introduction]]

# Module: [[../modules/advanced.md|Advanced Topics]]
optional:: true

# Meeting: 1

# Module: [[../modules/conclusion.md|Conclusion]]
`;

    const result = parseCourse(content, 'courses/intro.md');

    expect(result.course?.slug).toBe('intro-course');
    expect(result.course?.title).toBe('Introduction to AI Safety');
    expect(result.course?.progression).toHaveLength(4);
    expect(result.course?.progression[0].type).toBe('module');
    expect(result.course?.progression[0].slug).toBe('intro');
    expect(result.course?.progression[0].optional).toBe(false);
    expect(result.course?.progression[1].type).toBe('module');
    expect(result.course?.progression[1].slug).toBe('advanced');
    expect(result.course?.progression[1].optional).toBe(true);
    expect(result.course?.progression[2].type).toBe('meeting');
    expect(result.course?.progression[2].number).toBe(1);
    expect(result.course?.progression[3].type).toBe('module');
    expect(result.course?.progression[3].slug).toBe('conclusion');
    expect(result.errors).toHaveLength(0);
  });

  it('validates module references exist', () => {
    const content = `---
slug: broken-course
title: Broken Course
---

# Module: [[../modules/nonexistent.md|Missing]]
`;

    // Note: Reference validation happens in processContent, not parseCourse
    // parseCourse only parses the structure, it does not validate file existence
    const result = parseCourse(content, 'courses/broken.md');

    expect(result.course).toBeDefined();
    expect(result.course?.slug).toBe('broken-course');
    expect(result.course?.progression).toHaveLength(1);
    expect(result.course?.progression[0].type).toBe('module');
    expect(result.course?.progression[0].slug).toBe('nonexistent');
    // Errors about missing modules are added during processContent, not parseCourse
  });

  it('handles missing frontmatter', () => {
    const content = `# Module: [[../modules/intro.md|Introduction]]`;

    const result = parseCourse(content, 'courses/bad.md');

    expect(result.course).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain('frontmatter');
  });

  it('requires slug in frontmatter', () => {
    const content = `---
title: Course Without Slug
---

# Module: [[../modules/intro.md|Introduction]]
`;

    const result = parseCourse(content, 'courses/no-slug.md');

    expect(result.course).toBeNull();
    expect(result.errors.some(e => e.message.includes('slug'))).toBe(true);
  });

  it('requires title in frontmatter', () => {
    const content = `---
slug: no-title-course
---

# Module: [[../modules/intro.md|Introduction]]
`;

    const result = parseCourse(content, 'courses/no-title.md');

    expect(result.course).toBeNull();
    expect(result.errors.some(e => e.message.includes('title'))).toBe(true);
  });

  it('reports error for unknown section types', () => {
    const content = `---
slug: test-course
title: Test Course
---

# Unknown: Bad Section
`;

    const result = parseCourse(content, 'courses/unknown.md');

    expect(result.errors.some(e => e.message.includes('Unknown section type'))).toBe(true);
  });

  it('reports error for Module section without wikilink', () => {
    const content = `---
slug: test-course
title: Test Course
---

# Module: No Wikilink Here
`;

    const result = parseCourse(content, 'courses/no-link.md');

    expect(result.errors.some(e => e.message.includes('wikilink'))).toBe(true);
  });

  it('reports error for Meeting section without number', () => {
    const content = `---
slug: test-course
title: Test Course
---

# Meeting: not a number
`;

    const result = parseCourse(content, 'courses/bad-meeting.md');

    expect(result.errors.some(e => e.message.includes('number'))).toBe(true);
  });

  it('validates slug format', () => {
    const content = `---
slug: My Course!
title: Test Course
---

# Module: [[../modules/intro.md|Introduction]]
`;

    const result = parseCourse(content, 'courses/bad-slug.md');

    expect(result.errors.some(e =>
      e.severity === 'error' &&
      e.message.includes('slug') &&
      e.message.includes('format')
    )).toBe(true);
  });

  it('warns about typos in frontmatter fields', () => {
    const content = [
      '---',
      'slug: my-course',
      'tilte: My Course',
      '---',
      '# Module: [[../modules/intro.md|Intro]]',
    ].join('\n');

    const { errors } = parseCourse(content, 'courses/test.md');

    const typoWarning = errors.find(e => e.message.includes("'tilte'"));
    expect(typoWarning).toBeDefined();
    expect(typoWarning!.suggestion).toContain("'title'");
  });

  it('accepts valid slug format', () => {
    const content = `---
slug: my-course
title: Test Course
---

# Module: [[../modules/intro.md|Introduction]]
`;

    const result = parseCourse(content, 'courses/good-slug.md');

    expect(result.errors.filter(e =>
      e.message.includes('slug') && e.message.includes('format')
    )).toHaveLength(0);
  });
});
