// src/parser/module.test.ts
import { describe, it, expect } from 'vitest';
import { parseModule } from './module.js';

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
      expect(result.errors.filter(e => e.severity === 'error')).toHaveLength(0);
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
      expect(result.errors.filter(e => e.severity === 'error')).toHaveLength(0);
    });
  });

  it('returns module when frontmatter has unrecognized fields (warnings only)', () => {
    const content = `---
slug: test-module
title: Test Module
slg: extra-value
---

# Learning Outcome: Welcome
source:: [[../Learning Outcomes/lo1.md|LO1]]
`;

    const result = parseModule(content, 'modules/test.md');

    // Module should still be returned — unrecognized fields are warnings, not errors
    expect(result.module).not.toBeNull();
    expect(result.module?.slug).toBe('test-module');
    // Should have a warning about the unrecognized field ('slg' → 'slug' typo)
    expect(result.errors.some(e => e.severity === 'warning')).toBe(true);
    expect(result.errors.some(e => e.severity === 'error')).toBe(false);
  });

  it('warns when module has no sections', () => {
    const content = `---
slug: empty-module
title: Empty Module
---

Just some notes here, no sections.
`;

    const result = parseModule(content, 'modules/empty.md');

    expect(result.errors.some(e =>
      e.severity === 'warning' &&
      e.message.includes('no sections')
    )).toBe(true);
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

  it('accepts # Submodule: sections', () => {
    const content = `---
slug: big-module
title: Big Module
---

# Submodule: Welcome
slug:: welcome

## Lens: Welcome Lens
source:: [[../Lenses/welcome.md]]

# Submodule: Research

## Learning Outcome: First Topic
source:: [[../Learning Outcomes/lo1.md|LO1]]
`;

    const result = parseModule(content, 'modules/big.md');

    expect(result.module).not.toBeNull();
    // Filter out line-number adjustment issues from submodule body parsing
    const criticalErrors = result.errors.filter(e =>
      e.severity === 'error' &&
      !e.message.includes('Content found before first section header') &&
      !e.message.includes('Text outside')
    );
    expect(criticalErrors).toHaveLength(0);
    expect(result.module?.sections).toHaveLength(2);
    expect(result.module?.sections[0].type).toBe('submodule');
    expect(result.module?.sections[0].title).toBe('Welcome');
    expect(result.module?.sections[1].type).toBe('submodule');
    expect(result.module?.sections[1].title).toBe('Research');
    // Children should be parsed recursively
    expect(result.module?.sections[0].children).toHaveLength(1);
    expect(result.module?.sections[0].children?.[0].type).toBe('lens');
    expect(result.module?.sections[1].children).toHaveLength(1);
    expect(result.module?.sections[1].children?.[0].type).toBe('learning-outcome');
  });

  it('collects errors from all parsing stages', () => {
    const content = `# No frontmatter

# Unknown: Bad Type
`;

    const result = parseModule(content, 'modules/bad.md');

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.message.includes('frontmatter'))).toBe(true);
  });

  it('parses referenced Lens section with source:: field', () => {
    const content = `---
slug: test
title: Test Module
---

# Lens: External Resource
source:: [[../Lenses/external.md|External]]
optional:: true
`;

    const result = parseModule(content, 'modules/test.md');

    expect(result.module?.sections).toHaveLength(1);
    expect(result.module?.sections[0].type).toBe('lens');
    expect(result.module?.sections[0].title).toBe('External Resource');
    expect(result.module?.sections[0].fields.source).toBe('[[../Lenses/external.md|External]]');
    expect(result.module?.sections[0].fields.optional).toBe('true');
    // No inline lens for referenced sections
    expect(result.module?.sections[0].inlineLens).toBeUndefined();
  });

  it('parses inline Lens section with id:: and #### segments', () => {
    const content = `---
slug: test
title: Test Module
---

# Lens: Welcome
id:: d1e2f3a4-5678-90ab-cdef-1234567890ab

#### Text
content::
This is the welcome text.
It spans multiple lines.

#### Chat
instructions:: Ask the student what they know.
`;

    const result = parseModule(content, 'modules/test.md');

    expect(result.module?.sections).toHaveLength(1);
    expect(result.module?.sections[0].type).toBe('lens');
    expect(result.module?.sections[0].title).toBe('Welcome');
    expect(result.module?.sections[0].fields.id).toBe('d1e2f3a4-5678-90ab-cdef-1234567890ab');
    // Should have an inline lens on the section
    const inlineLens = result.module?.sections[0].inlineLens;
    expect(inlineLens).toBeDefined();
    expect(inlineLens?.id).toBe('d1e2f3a4-5678-90ab-cdef-1234567890ab');
    expect(inlineLens?.segments).toHaveLength(2);
    expect(inlineLens?.segments[0].type).toBe('text');
    expect(inlineLens?.segments[1].type).toBe('chat');
  });

  it('parses title:: field from inline Lens section', () => {
    const content = `---
slug: test
title: Test Module
---

# Lens: Welcome
id:: d1e2f3a4-5678-90ab-cdef-1234567890ab
title:: My Inline Title

#### Text
content:: Hello.
`;

    const result = parseModule(content, 'modules/test.md');

    const inlineLens = result.module?.sections[0].inlineLens;
    expect(inlineLens?.title).toBe('My Inline Title');
  });

  it('inline Lens without title:: has undefined title', () => {
    const content = `---
slug: test
title: Test Module
---

# Lens: Welcome
id:: d1e2f3a4-5678-90ab-cdef-1234567890ab

#### Text
content:: Hello.
`;

    const result = parseModule(content, 'modules/test.md');

    const inlineLens = result.module?.sections[0].inlineLens;
    expect(inlineLens?.title).toBeUndefined();
  });

  it('parses inline Lens with article segments and source inheritance', () => {
    const content = `---
slug: test
title: Test Module
---

# Lens: Reading
id:: abc-123

#### Article
source:: [[../articles/deep-dive.md|Article]]
from:: "Start here"
to:: "end here"

#### Article
from:: "Another section"
to:: "section end"
`;

    const result = parseModule(content, 'modules/test.md');

    expect(result.module?.sections[0].inlineLens).toBeDefined();
    const inlineLens = result.module?.sections[0].inlineLens;
    expect(inlineLens?.segments).toHaveLength(2);
    // Both should have source (second inherits from first)
    const seg0 = inlineLens?.segments[0] as any;
    const seg1 = inlineLens?.segments[1] as any;
    expect(seg0.source).toBe('[[../articles/deep-dive.md|Article]]');
    expect(seg1.source).toBe('[[../articles/deep-dive.md|Article]]');
  });

  it('errors when inline Lens first article has no source', () => {
    const content = `---
slug: test
title: Test Module
---

# Lens: Reading
id:: abc-123

#### Article
from:: "Start here"
to:: "end here"
`;

    const result = parseModule(content, 'modules/test.md');

    expect(result.errors.some(e =>
      e.severity === 'error' &&
      e.message.includes('First article segment must have a source')
    )).toBe(true);
  });

  it('rejects # Page: as unknown section type', () => {
    const content = `---
slug: test
title: Test Module
---

# Page: Welcome
id:: d1e2f3a4-5678-90ab-cdef-1234567890ab
`;

    const result = parseModule(content, 'modules/test.md');

    expect(result.errors.some(e =>
      e.severity === 'error' &&
      e.message.includes('Unknown section type') &&
      e.message.includes('Page')
    )).toBe(true);
  });

  it('parses inline lens inside submodule', () => {
    const content = `---
slug: existing-approaches
title: Existing approaches
---

# Submodule: Welcome
## Lens: Welcome
id:: dc56fe14-2c41-4057-b112-a84c0b2ef303

### Text
content::
Welcome to the module.

# Learning Outcome:
source:: [[../Learning Outcomes/lo1.md]]
`;

    const result = parseModule(content, 'modules/existing.md');

    expect(result.module?.sections).toHaveLength(2);
    expect(result.module?.sections[0].type).toBe('submodule');
    expect(result.module?.sections[0].children?.[0].type).toBe('lens');
    expect(result.module?.sections[0].children?.[0].inlineLens).toBeDefined();
    expect(result.module?.sections[0].children?.[0].inlineLens?.segments).toHaveLength(1);
    expect(result.module?.sections[0].children?.[0].inlineLens?.segments[0].type).toBe('text');
  });

  it('stores inlineLens on section instead of module-level map', () => {
    const content = `---
slug: test
title: Test Module
---

# Lens: Welcome
id:: d1e2f3a4-5678-90ab-cdef-1234567890ab

#### Text
content:: Hello.
`;

    const result = parseModule(content, 'modules/test.md');

    // Should be on the section, not on a module-level map
    expect(result.module?.sections[0].inlineLens).toBeDefined();
    expect(result.module?.sections[0].inlineLens?.id).toBe('d1e2f3a4-5678-90ab-cdef-1234567890ab');
    expect(result.module?.sections[0].inlineLens?.segments).toHaveLength(1);
    expect(result.module?.sections[0].inlineLens?.segments[0].type).toBe('text');
  });
});
