import { describe, it, expect } from 'vitest';
import { processContent } from '../index.js';

describe('course module path resolution', () => {
  it('resolves wikilink paths to frontmatter slugs', () => {
    const files = new Map<string, string>();

    // Module file — filename has spaces, slug is kebab-case
    files.set('modules/My Cool Module.md', `---
slug: my-cool-module
title: My Cool Module
id: 00000000-0000-0000-0000-000000000001
---

# Page: Welcome

## Text:
Hello
`);

    // Course references the module by filename
    files.set('courses/test.md', `---
slug: test-course
title: Test Course
---

# Module: [[../modules/My Cool Module]]

# Meeting: Week 1
`);

    const result = processContent(files);

    // Course should have resolved the path to the frontmatter slug
    expect(result.courses).toHaveLength(1);
    const course = result.courses[0];
    expect(course.progression[0].type).toBe('module');
    expect(course.progression[0].slug).toBe('my-cool-module');
    expect(course.progression[0].path).toBeUndefined(); // path should be cleaned up

    // Module should also be in modules list
    expect(result.modules).toHaveLength(1);
    expect(result.modules[0].slug).toBe('my-cool-module');
  });

  it('emits error when module reference cannot be resolved', () => {
    const files = new Map<string, string>();

    files.set('courses/test.md', `---
slug: test-course
title: Test Course
---

# Module: [[../modules/nonexistent]]

# Meeting: Week 1
`);

    const result = processContent(files);

    expect(result.errors.some(e =>
      e.severity === 'error' && e.message.includes('could not be resolved')
    )).toBe(true);
  });
});
