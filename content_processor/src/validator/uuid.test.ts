// src/validator/uuid.test.ts
import { describe, it, expect } from 'vitest';
import { processContent } from '../index.js';

describe('UUID validation', () => {
  describe('format validation', () => {
    it('accepts valid UUIDv4 format', () => {
      const files = new Map([
        ['modules/test.md', `---
slug: test
title: Test Module
contentId: 550e8400-e29b-41d4-a716-446655440000
---

# Page: Welcome
`],
      ]);

      const result = processContent(files);

      const uuidErrors = result.errors.filter(e =>
        e.message.toLowerCase().includes('uuid') ||
        e.message.toLowerCase().includes('invalid') && e.message.toLowerCase().includes('id')
      );
      expect(uuidErrors).toHaveLength(0);
    });

    it('rejects invalid UUID format in module contentId', () => {
      const files = new Map([
        ['modules/test.md', `---
slug: test
title: Test Module
contentId: not-a-valid-uuid
---

# Page: Welcome
`],
      ]);

      const result = processContent(files);

      expect(result.errors.some(e =>
        e.message.toLowerCase().includes('uuid') ||
        e.message.toLowerCase().includes('invalid')
      )).toBe(true);
    });

    it('rejects UUID with wrong number of characters', () => {
      const files = new Map([
        ['modules/test.md', `---
slug: test
title: Test Module
contentId: 550e8400-e29b-41d4-a716
---

# Page: Welcome
`],
      ]);

      const result = processContent(files);

      expect(result.errors.some(e =>
        e.message.toLowerCase().includes('uuid') ||
        e.message.toLowerCase().includes('invalid')
      )).toBe(true);
    });

    it('rejects UUID with invalid characters', () => {
      const files = new Map([
        ['modules/test.md', `---
slug: test
title: Test Module
contentId: 550e8400-e29b-41d4-a716-44665544ZZZZ
---

# Page: Welcome
`],
      ]);

      const result = processContent(files);

      expect(result.errors.some(e =>
        e.message.toLowerCase().includes('uuid') ||
        e.message.toLowerCase().includes('invalid')
      )).toBe(true);
    });

    it('rejects invalid UUID in Learning Outcome id', () => {
      const files = new Map([
        ['Learning Outcomes/lo1.md', `---
id: bad-uuid
---

## Lens: Test
source:: [[../Lenses/lens1.md]]
`],
        ['Lenses/lens1.md', `---
id: 550e8400-e29b-41d4-a716-446655440001
---
### Page: Intro

#### Text
content:: Hello
`],
      ]);

      const result = processContent(files);

      expect(result.errors.some(e =>
        e.message.toLowerCase().includes('uuid') ||
        e.message.toLowerCase().includes('invalid')
      )).toBe(true);
    });

    it('rejects invalid UUID in Lens id', () => {
      const files = new Map([
        ['Lenses/lens1.md', `---
id: this-is-not-a-uuid
---
### Page: Intro

#### Text
content:: Hello
`],
      ]);

      const result = processContent(files);

      expect(result.errors.some(e =>
        e.message.toLowerCase().includes('uuid') ||
        e.message.toLowerCase().includes('invalid')
      )).toBe(true);
    });
  });

  describe('duplicate detection', () => {
    it('detects duplicate contentId across modules', () => {
      const files = new Map([
        ['modules/module1.md', `---
slug: module1
title: Module One
contentId: 550e8400-e29b-41d4-a716-446655440000
---

# Page: Welcome
`],
        ['modules/module2.md', `---
slug: module2
title: Module Two
contentId: 550e8400-e29b-41d4-a716-446655440000
---

# Page: Hello
`],
      ]);

      const result = processContent(files);

      expect(result.errors.some(e =>
        e.message.toLowerCase().includes('duplicate') &&
        e.message.toLowerCase().includes('id')
      )).toBe(true);
    });

    it('detects duplicate id across Learning Outcomes', () => {
      const files = new Map([
        ['Learning Outcomes/lo1.md', `---
id: 550e8400-e29b-41d4-a716-446655440001
---

## Lens: Test
source:: [[../Lenses/lens1.md]]
`],
        ['Learning Outcomes/lo2.md', `---
id: 550e8400-e29b-41d4-a716-446655440001
---

## Lens: Test
source:: [[../Lenses/lens1.md]]
`],
        ['Lenses/lens1.md', `---
id: 550e8400-e29b-41d4-a716-446655440002
---
### Page: Intro

#### Text
content:: Hello
`],
      ]);

      const result = processContent(files);

      expect(result.errors.some(e =>
        e.message.toLowerCase().includes('duplicate') &&
        e.message.toLowerCase().includes('id')
      )).toBe(true);
    });

    it('detects duplicate id across Lenses', () => {
      const files = new Map([
        ['Lenses/lens1.md', `---
id: 550e8400-e29b-41d4-a716-446655440001
---
### Page: Intro

#### Text
content:: Hello
`],
        ['Lenses/lens2.md', `---
id: 550e8400-e29b-41d4-a716-446655440001
---
### Page: Intro

#### Text
content:: World
`],
      ]);

      const result = processContent(files);

      expect(result.errors.some(e =>
        e.message.toLowerCase().includes('duplicate') &&
        e.message.toLowerCase().includes('id')
      )).toBe(true);
    });

    it('detects same UUID used in different contexts (module contentId vs lens id)', () => {
      const files = new Map([
        ['modules/test.md', `---
slug: test
title: Test Module
contentId: 550e8400-e29b-41d4-a716-446655440000
---

# Page: Welcome
`],
        ['Lenses/lens1.md', `---
id: 550e8400-e29b-41d4-a716-446655440000
---
### Page: Intro

#### Text
content:: Hello
`],
      ]);

      const result = processContent(files);

      expect(result.errors.some(e =>
        e.message.toLowerCase().includes('duplicate') &&
        e.message.toLowerCase().includes('id')
      )).toBe(true);
    });

    it('allows different UUIDs across files', () => {
      const files = new Map([
        ['modules/module1.md', `---
slug: module1
title: Module One
contentId: 550e8400-e29b-41d4-a716-446655440001
---

# Page: Welcome
`],
        ['modules/module2.md', `---
slug: module2
title: Module Two
contentId: 550e8400-e29b-41d4-a716-446655440002
---

# Page: Hello
`],
      ]);

      const result = processContent(files);

      const duplicateErrors = result.errors.filter(e =>
        e.message.toLowerCase().includes('duplicate')
      );
      expect(duplicateErrors).toHaveLength(0);
    });
  });

  describe('section-level id:: field validation', () => {
    it('rejects invalid UUID in section id:: field', () => {
      const files = new Map([
        ['modules/test.md', `---
slug: test
title: Test Module
---

# Page: Welcome
id:: d1e2f3a4-b5c6-7890-d1e2-f3a4b5c67890-aaaa

## Text
content:: Hello
`],
      ]);

      const result = processContent(files);

      expect(result.errors.some(e =>
        e.message.toLowerCase().includes('uuid') &&
        e.message.includes('d1e2f3a4-b5c6-7890-d1e2-f3a4b5c67890-aaaa')
      )).toBe(true);
    });

    it('accepts valid UUID in section id:: field', () => {
      const files = new Map([
        ['modules/test.md', `---
slug: test
title: Test Module
---

# Page: Welcome
id:: 550e8400-e29b-41d4-a716-446655440000

## Text
content:: Hello
`],
      ]);

      const result = processContent(files);

      const uuidErrors = result.errors.filter(e =>
        e.message.toLowerCase().includes('uuid') &&
        e.message.includes('550e8400')
      );
      expect(uuidErrors).toHaveLength(0);
    });

    it('detects duplicate UUID between section id:: and frontmatter contentId', () => {
      const files = new Map([
        ['modules/module1.md', `---
slug: module1
title: Module One
contentId: 550e8400-e29b-41d4-a716-446655440000
---

# Page: Welcome
id:: 550e8400-e29b-41d4-a716-446655440099

## Text
content:: Hello
`],
        ['modules/module2.md', `---
slug: module2
title: Module Two
---

# Page: Hello
id:: 550e8400-e29b-41d4-a716-446655440000

## Text
content:: World
`],
      ]);

      const result = processContent(files);

      expect(result.errors.some(e =>
        e.message.toLowerCase().includes('duplicate') &&
        e.message.includes('550e8400-e29b-41d4-a716-446655440000')
      )).toBe(true);
    });
  });
});
