// src/validator/uuid.test.ts
import { describe, it, expect } from 'vitest';
import { processContent } from '../index.js';
import { validateUuids } from './uuid.js';

describe('UUID validation', () => {
  describe('format validation', () => {
    it('accepts valid UUIDv4 format', () => {
      const files = new Map([
        ['modules/test.md', `---
slug: test
title: Test Module
contentId: 550e8400-e29b-41d4-a716-446655440000
---

# Lens: Welcome
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

# Lens: Welcome
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

# Lens: Welcome
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

# Lens: Welcome
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
### Lens: Intro

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
### Lens: Intro

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

# Lens: Welcome
`],
        ['modules/module2.md', `---
slug: module2
title: Module Two
contentId: 550e8400-e29b-41d4-a716-446655440000
---

# Lens: Hello
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
### Lens: Intro

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
### Lens: Intro

#### Text
content:: Hello
`],
        ['Lenses/lens2.md', `---
id: 550e8400-e29b-41d4-a716-446655440001
---
### Lens: Intro

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

# Lens: Welcome
`],
        ['Lenses/lens1.md', `---
id: 550e8400-e29b-41d4-a716-446655440000
---
### Lens: Intro

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

# Lens: Welcome
`],
        ['modules/module2.md', `---
slug: module2
title: Module Two
contentId: 550e8400-e29b-41d4-a716-446655440002
---

# Lens: Hello
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

# Lens: Welcome
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

# Lens: Welcome
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

# Lens: Welcome
id:: 550e8400-e29b-41d4-a716-446655440099

## Text
content:: Hello
`],
        ['modules/module2.md', `---
slug: module2
title: Module Two
---

# Lens: Hello
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

  describe('same-file duplicate handling', () => {
    it('allows same-file same-field duplicate UUIDs', () => {
      const result = validateUuids([
        { uuid: '550e8400-e29b-41d4-a716-446655440000', file: 'modules/test.md', field: 'contentId' },
        { uuid: '550e8400-e29b-41d4-a716-446655440000', file: 'modules/test.md', field: 'contentId' },
      ]);
      expect(result.errors).toHaveLength(0);
    });

    it('still catches same-file different-field duplicate UUIDs', () => {
      const result = validateUuids([
        { uuid: '550e8400-e29b-41d4-a716-446655440000', file: 'modules/test.md', field: 'contentId' },
        { uuid: '550e8400-e29b-41d4-a716-446655440000', file: 'modules/test.md', field: 'id' },
      ]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('Duplicate');
    });

    it('still catches cross-file duplicate UUIDs', () => {
      const result = validateUuids([
        { uuid: '550e8400-e29b-41d4-a716-446655440000', file: 'modules/a.md', field: 'contentId' },
        { uuid: '550e8400-e29b-41d4-a716-446655440000', file: 'modules/b.md', field: 'contentId' },
      ]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('Duplicate');
    });
  });
});
