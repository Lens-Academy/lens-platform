# Implementation Plan: Content Validator Gap Fixes

**Date**: 2026-02-05
**Approach**: Test-Driven Development (Red-Green-Refactor)
**Total Tasks**: 20 validation gaps organized into 6 batches

---

## Overview

This plan addresses 20 validation gaps identified by antagonistic analysis of the content validator test suite. Each gap will be fixed using strict TDD:

1. **RED**: Write a failing test that demonstrates the gap
2. **Verify RED**: Run test, confirm it fails for the right reason
3. **GREEN**: Write minimal code to make test pass
4. **Verify GREEN**: Run test, confirm all tests pass
5. **REFACTOR**: Clean up if needed, verify tests still pass

---

## Batch 1: Critical Field Validation (Gaps 1, 2, 14)

### Task 1.1: Empty/Whitespace Required Fields

**Gap**: `slug: ""` or `title: "   "` passes validation

**File to modify**: `src/validator/field-values.ts` and `src/parser/module.ts`

**Test file**: `src/validator/field-values.test.ts`

#### RED: Write Failing Test

```typescript
describe('required field validation', () => {
  it('returns error for empty slug', () => {
    const result = parseModule(`---
slug: ""
title: Test
---
# Page: Test
#### Text
content:: Hello
`, 'test.md');

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining('slug'),
        severity: 'error',
      })
    );
  });

  it('returns error for whitespace-only title', () => {
    const result = parseModule(`---
slug: test
title: "   "
---
# Page: Test
#### Text
content:: Hello
`, 'test.md');

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining('title'),
        severity: 'error',
      })
    );
  });

  it('returns error for whitespace-only slug', () => {
    const result = parseModule(`---
slug: "   "
title: Test
---
# Page: Test
#### Text
content:: Hello
`, 'test.md');

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining('slug'),
        severity: 'error',
      })
    );
  });
});
```

#### GREEN: Implementation

In `src/parser/module.ts`, after checking field presence:

```typescript
function isEmptyOrWhitespace(value: string | undefined): boolean {
  return !value || value.trim() === '';
}

// In parseModule():
if (isEmptyOrWhitespace(slug)) {
  errors.push({
    file,
    line: 1,
    message: 'Required field "slug" is empty or whitespace-only',
    suggestion: 'Provide a non-empty slug value',
    severity: 'error',
  });
}

if (isEmptyOrWhitespace(title)) {
  errors.push({
    file,
    line: 1,
    message: 'Required field "title" is empty or whitespace-only',
    suggestion: 'Provide a non-empty title value',
    severity: 'error',
  });
}
```

#### Verification

```bash
npm test src/parser/module.test.ts
npm test  # All tests
```

---

### Task 1.2: Slug Format Validation

**Gap**: `slug: "!!!invalid@@@"` is accepted

**File to modify**: `src/validator/field-values.ts`

**Test file**: `src/validator/field-values.test.ts`

#### RED: Write Failing Test

```typescript
describe('slug format validation', () => {
  it('returns error for slug with special characters', () => {
    const result = validateSlugFormat('!!!invalid@@@', 'test.md', 1);

    expect(result).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining('slug'),
        message: expect.stringContaining('invalid'),
        severity: 'error',
      })
    );
  });

  it('returns error for slug with spaces', () => {
    const result = validateSlugFormat('my slug', 'test.md', 1);

    expect(result).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining('spaces'),
        severity: 'error',
      })
    );
  });

  it('accepts valid slug with lowercase letters and hyphens', () => {
    const result = validateSlugFormat('my-valid-slug', 'test.md', 1);
    expect(result).toHaveLength(0);
  });

  it('accepts valid slug with numbers', () => {
    const result = validateSlugFormat('intro-101', 'test.md', 1);
    expect(result).toHaveLength(0);
  });

  it('returns error for slug starting with hyphen', () => {
    const result = validateSlugFormat('-invalid', 'test.md', 1);
    expect(result).toContainEqual(
      expect.objectContaining({
        severity: 'error',
      })
    );
  });

  it('returns error for slug ending with hyphen', () => {
    const result = validateSlugFormat('invalid-', 'test.md', 1);
    expect(result).toContainEqual(
      expect.objectContaining({
        severity: 'error',
      })
    );
  });
});
```

#### GREEN: Implementation

In `src/validator/field-values.ts`:

```typescript
// Valid slug: lowercase letters, numbers, hyphens (not at start/end)
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateSlugFormat(
  slug: string,
  file: string,
  line: number
): ContentError[] {
  const errors: ContentError[] = [];

  if (!SLUG_PATTERN.test(slug)) {
    errors.push({
      file,
      line,
      message: `Invalid slug format: "${slug}"`,
      suggestion: 'Slugs must contain only lowercase letters, numbers, and hyphens (not at start/end)',
      severity: 'error',
    });
  }

  return errors;
}
```

Then integrate into `src/parser/module.ts`:

```typescript
import { validateSlugFormat } from '../validator/field-values.js';

// After validating slug is non-empty:
errors.push(...validateSlugFormat(slug, file, 1));
```

---

### Task 1.3: Frontmatter Typo Detection Enhancement

**Gap**: `contetnId:` instead of `contentId:` not caught (typo detection exists but may miss some)

**File to modify**: `src/validator/field-typos.ts`

**Test file**: `src/validator/field-typos.test.ts`

#### RED: Write Failing Test

```typescript
describe('frontmatter field typo detection', () => {
  it('detects contetnId as typo of contentId', () => {
    const result = detectFieldTypos(
      { contetnId: '123' },
      'test.md',
      1
    );

    expect(result).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining('contetnId'),
        suggestion: expect.stringContaining('contentId'),
        severity: 'warning',
      })
    );
  });

  it('detects learningOutcomeID as typo of learningOutcomeId', () => {
    const result = detectFieldTypos(
      { learningOutcomeID: '123' },
      'test.md',
      1
    );

    expect(result).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining('learningOutcomeID'),
        severity: 'warning',
      })
    );
  });

  it('detects srouce as typo of source', () => {
    const result = detectFieldTypos(
      { srouce: '[[Article]]' },
      'test.md',
      1
    );

    expect(result).toContainEqual(
      expect.objectContaining({
        suggestion: expect.stringContaining('source'),
        severity: 'warning',
      })
    );
  });
});
```

#### GREEN: Verify/Enhance Implementation

Check `KNOWN_FIELDS` in `src/validator/field-typos.ts` includes all expected fields:

```typescript
const KNOWN_FIELDS = new Set([
  // Frontmatter fields
  'id', 'slug', 'title', 'contentId', 'learningOutcomeId', 'videoId',
  // Segment fields
  'content', 'instructions', 'source', 'sourceUrl', 'channel',
  'author', 'from', 'to', 'optional',
  'hidePreviousContentFromUser', 'hidePreviousContentFromTutor',
  // ... ensure all fields present
]);
```

---

## Batch 2: Duplicate Detection (Gap 5)

### Task 2.1: Duplicate Slug Detection

**Gap**: Two modules with same slug are not detected

**File to create**: `src/validator/duplicates.ts`

**Test file to create**: `src/validator/duplicates.test.ts`

#### RED: Write Failing Test

```typescript
// src/validator/duplicates.test.ts
import { describe, it, expect } from 'vitest';
import { detectDuplicateSlugs } from './duplicates.js';

describe('detectDuplicateSlugs', () => {
  it('returns error when two modules have same slug', () => {
    const modules = [
      { slug: 'intro', file: 'modules/intro.md' },
      { slug: 'intro', file: 'modules/intro-copy.md' },
    ];

    const errors = detectDuplicateSlugs(modules);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      message: expect.stringContaining('Duplicate slug'),
      message: expect.stringContaining('intro'),
      severity: 'error',
    });
  });

  it('returns no errors when all slugs are unique', () => {
    const modules = [
      { slug: 'intro', file: 'modules/intro.md' },
      { slug: 'basics', file: 'modules/basics.md' },
    ];

    const errors = detectDuplicateSlugs(modules);

    expect(errors).toHaveLength(0);
  });

  it('detects multiple duplicate pairs', () => {
    const modules = [
      { slug: 'intro', file: 'modules/intro.md' },
      { slug: 'intro', file: 'modules/intro-copy.md' },
      { slug: 'basics', file: 'modules/basics.md' },
      { slug: 'basics', file: 'modules/basics2.md' },
    ];

    const errors = detectDuplicateSlugs(modules);

    expect(errors).toHaveLength(2);
  });
});
```

#### GREEN: Implementation

```typescript
// src/validator/duplicates.ts
import type { ContentError } from '../index.js';

interface SlugEntry {
  slug: string;
  file: string;
}

export function detectDuplicateSlugs(entries: SlugEntry[]): ContentError[] {
  const errors: ContentError[] = [];
  const seen = new Map<string, string>(); // slug -> first file

  for (const entry of entries) {
    const existing = seen.get(entry.slug);
    if (existing) {
      errors.push({
        file: entry.file,
        message: `Duplicate slug "${entry.slug}" (also used in ${existing})`,
        suggestion: 'Each module must have a unique slug',
        severity: 'error',
      });
    } else {
      seen.set(entry.slug, entry.file);
    }
  }

  return errors;
}
```

Then integrate into `src/index.ts` in `processContent()`:

```typescript
import { detectDuplicateSlugs } from './validator/duplicates.js';

// After parsing all modules:
const slugEntries = modules.map(m => ({ slug: m.slug, file: m.file }));
errors.push(...detectDuplicateSlugs(slugEntries));
```

---

## Batch 3: Security Validation (Gap 4)

### Task 3.1: Path Traversal Blocking

**Gap**: `source:: [[../../../../etc/passwd]]` not blocked

**File to modify**: `src/parser/wikilink.ts`

**Test file**: `src/parser/wikilink.test.ts`

#### RED: Write Failing Test

```typescript
describe('path traversal protection', () => {
  it('returns error for path traversal in wikilink', () => {
    const result = parseWikilink('[[../../../../etc/passwd]]');

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('path traversal');
  });

  it('returns error for path traversal with ../', () => {
    const result = parseWikilink('[[../../../secret.md]]');

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('path traversal');
  });

  it('accepts normal relative paths without traversal', () => {
    const result = parseWikilink('[[Articles/my-article]]');

    expect(result.error).toBeUndefined();
    expect(result.target).toBe('Articles/my-article');
  });

  it('accepts paths with legitimate dots', () => {
    const result = parseWikilink('[[file.name.with.dots]]');

    expect(result.error).toBeUndefined();
  });
});
```

#### GREEN: Implementation

In `src/parser/wikilink.ts`:

```typescript
export function parseWikilink(text: string): WikilinkResult {
  // ... existing parsing ...

  // Check for path traversal
  if (target.includes('../') || target.includes('..\\')) {
    return {
      target: null,
      anchor: null,
      error: {
        message: 'Path traversal not allowed in wikilinks',
        suggestion: 'Use paths relative to the vault root without ".."',
      },
    };
  }

  // ... rest of function
}
```

---

## Batch 4: Content Validation (Gaps 7, 12, 13)

### Task 4.1: Empty Segment Validation

**Gap**: `#### Text` with no `content::` is accepted

**File to modify**: `src/parser/lens.ts`

**Test file**: `src/parser/lens.test.ts`

#### RED: Write Failing Test

```typescript
describe('empty segment validation', () => {
  it('returns error for Text segment without content field', () => {
    const result = parseLens(`---
id: 550e8400-e29b-41d4-a716-446655440001
---
### Page: Test
#### Text
`, 'test.md');

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining('content'),
        message: expect.stringContaining('required'),
        severity: 'error',
      })
    );
  });

  it('returns error for Chat segment without instructions field', () => {
    const result = parseLens(`---
id: 550e8400-e29b-41d4-a716-446655440001
---
### Page: Test
#### Chat
`, 'test.md');

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining('instructions'),
        severity: 'error',
      })
    );
  });

  it('returns error for Article-excerpt without source field', () => {
    const result = parseLens(`---
id: 550e8400-e29b-41d4-a716-446655440001
---
### Article: Test
#### Article-excerpt
from:: start
to:: end
`, 'test.md');

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining('source'),
        severity: 'error',
      })
    );
  });
});
```

#### GREEN: Implementation

In `src/parser/lens.ts`, add required field validation per segment type:

```typescript
const REQUIRED_FIELDS: Record<string, string[]> = {
  'text': ['content'],
  'chat': ['instructions'],
  'article-excerpt': ['source'],
  'video-excerpt': ['source'],
};

// In segment parsing:
function validateRequiredSegmentFields(
  segmentType: string,
  fields: Record<string, string>,
  file: string,
  line: number
): ContentError[] {
  const errors: ContentError[] = [];
  const required = REQUIRED_FIELDS[segmentType] || [];

  for (const field of required) {
    if (!fields[field] || fields[field].trim() === '') {
      errors.push({
        file,
        line,
        message: `Required field "${field}" missing in ${segmentType} segment`,
        suggestion: `Add "${field}::" field with a value`,
        severity: 'error',
      });
    }
  }

  return errors;
}
```

---

### Task 4.2: Missing source:: Error Upgrade

**Gap**: Missing `source::` in Article/Video only warns, should error

**File to modify**: `src/parser/lens.ts`

**Test file**: `src/parser/lens.test.ts`

#### RED: Write Failing Test

```typescript
describe('source field severity', () => {
  it('returns ERROR (not warning) for missing source in article-excerpt', () => {
    const result = parseLens(`---
id: 550e8400-e29b-41d4-a716-446655440001
---
### Article: Test
#### Article-excerpt
from:: start
`, 'test.md');

    const sourceError = result.errors.find(e =>
      e.message.toLowerCase().includes('source')
    );

    expect(sourceError).toBeDefined();
    expect(sourceError?.severity).toBe('error'); // Not 'warning'
  });
});
```

#### GREEN: Implementation

Change severity from 'warning' to 'error' for missing source in excerpt segments. (This may already be handled by Task 4.1's required field validation.)

---

### Task 4.3: Unknown Segment Type Detection

**Gap**: `#### UnknownType:` is silently skipped

**File to modify**: `src/parser/lens.ts`

**Test file**: `src/parser/lens.test.ts`

#### RED: Write Failing Test

```typescript
describe('unknown segment type detection', () => {
  it('returns error for unknown H4 segment type', () => {
    const result = parseLens(`---
id: 550e8400-e29b-41d4-a716-446655440001
---
### Page: Test
#### UnknownType
content:: hello
`, 'test.md');

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining('UnknownType'),
        message: expect.stringContaining('nknown'),
        severity: 'error',
      })
    );
  });

  it('returns error for #### Quiz segment (not supported)', () => {
    const result = parseLens(`---
id: 550e8400-e29b-41d4-a716-446655440001
---
### Page: Test
#### Quiz
question:: What is 2+2?
`, 'test.md');

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        suggestion: expect.stringContaining('Text'),
      })
    );
  });
});
```

#### GREEN: Implementation

In `src/parser/lens.ts`:

```typescript
const VALID_SEGMENT_TYPES = new Set([
  'text', 'chat', 'article-excerpt', 'video-excerpt'
]);

// When parsing segment headers:
if (!VALID_SEGMENT_TYPES.has(segmentType.toLowerCase())) {
  errors.push({
    file,
    line: lineNum,
    message: `Unknown segment type: ${segmentType}`,
    suggestion: `Valid segment types: ${[...VALID_SEGMENT_TYPES].join(', ')}`,
    severity: 'error',
  });
}
```

---

## Batch 5: Anchor/Timestamp Validation (Gaps 9, 10)

### Task 5.1: Anchor Whitespace Normalization

**Gap**: `from:: "key insight"` vs `from:: "key  insight"` (double space) causes silent failures

**File to modify**: `src/bundler/article.ts`

**Test file**: `src/bundler/article.test.ts`

#### RED: Write Failing Test

```typescript
describe('anchor whitespace handling', () => {
  it('matches anchor with normalized whitespace', () => {
    const article = 'This is a key insight that matters.';
    const result = extractArticleExcerpt(
      article,
      'key  insight', // double space in anchor
      null,
      'test.md'
    );

    // Should match by normalizing whitespace
    expect(result.error).toBeUndefined();
    expect(result.excerpt).toContain('key insight');
  });

  it('returns helpful error when anchor not found due to whitespace', () => {
    const article = 'This is a key insight.';
    const result = extractArticleExcerpt(
      article,
      'key   insight', // triple space - won't match
      null,
      'test.md'
    );

    // If no match, should suggest whitespace might be the issue
    if (result.error) {
      expect(result.error.suggestion).toContain('whitespace');
    }
  });
});
```

#### GREEN: Implementation

In `src/bundler/article.ts`:

```typescript
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function extractArticleExcerpt(...) {
  // Normalize both anchor and article for matching
  const normalizedAnchor = normalizeWhitespace(fromAnchor);
  const normalizedArticle = normalizeWhitespace(article);

  // Find position in normalized text
  const normalizedIndex = normalizedArticle.indexOf(normalizedAnchor);

  if (normalizedIndex === -1) {
    return {
      excerpt: null,
      error: {
        file,
        message: `Anchor "${fromAnchor}" not found in article`,
        suggestion: 'Check for whitespace differences or typos in the anchor text',
        severity: 'error',
      },
    };
  }

  // Map back to original text position for accurate excerpt
  // ...
}
```

---

### Task 5.2: Timestamp Format Validation

**Gap**: `from:: "not a time"` doesn't error clearly

**File to modify**: `src/bundler/video.ts`

**Test file**: `src/bundler/video.test.ts`

#### RED: Write Failing Test

```typescript
describe('timestamp format validation', () => {
  it('returns clear error for invalid timestamp format', () => {
    const result = parseTimestamp('not a time');

    expect(result).toBeNull();
  });

  it('returns error when from:: has invalid format in excerpt', () => {
    const result = extractVideoExcerpt(
      'transcript content',
      'not a time', // invalid from
      '1:30',
      'test.md'
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('Invalid timestamp');
    expect(result.error?.suggestion).toContain('M:SS');
  });

  it('accepts valid timestamp formats', () => {
    expect(parseTimestamp('1:30')).toBe(90);
    expect(parseTimestamp('01:30')).toBe(90);
    expect(parseTimestamp('1:30:00')).toBe(5400);
    expect(parseTimestamp('1:30.5')).toBe(90.5);
  });
});
```

#### GREEN: Implementation

Enhance error messages in `src/bundler/video.ts`:

```typescript
export function parseTimestamp(str: string): number | null {
  // ... existing parsing logic ...

  // If no format matches:
  return null;
}

// In extractVideoExcerpt:
const fromSeconds = parseTimestamp(fromTime);
if (fromSeconds === null) {
  return {
    excerpt: null,
    error: {
      file,
      message: `Invalid timestamp format: "${fromTime}"`,
      suggestion: 'Use M:SS, MM:SS, H:MM:SS, or M:SS.ms format (e.g., "1:30" or "1:30:45")',
      severity: 'error',
    },
  };
}
```

---

## Batch 6: Cross-File & Structural Validation (Gaps 6, 15, 17, 18, 19, 20)

### Task 6.1: Circular Reference Detection Enhancement

**Gap**: Circular references may not be detected in all cases

**File to modify**: `src/flattener/index.ts`

**Test file**: `src/flattener/index.test.ts`

#### RED: Write Failing Test

```typescript
describe('circular reference detection', () => {
  it('detects direct circular reference: A -> B -> A', () => {
    const files = new Map([
      ['modules/a.md', `---
slug: a
title: A
---
# Learning Outcome: Test
lo:: [[LO/b]]
`],
      ['LO/b.md', `---
id: uuid-b
---
## Lens: Content
lens:: [[Lenses/a-lens]]
`],
      ['Lenses/a-lens.md', `---
id: uuid-lens
---
### Article: Test
#### Article-excerpt
source:: [[modules/a]]
`],
    ]);

    const result = flattenModule('modules/a.md', files);

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining('circular'),
        severity: 'error',
      })
    );
  });
});
```

#### GREEN: Implementation

Ensure the flattener tracks the full resolution chain and detects cycles:

```typescript
function flattenWithCycleDetection(
  path: string,
  files: Map<string, string>,
  visited: Set<string>
): FlattenResult {
  if (visited.has(path)) {
    return {
      result: null,
      errors: [{
        file: path,
        message: `Circular reference detected: ${[...visited, path].join(' -> ')}`,
        severity: 'error',
      }],
    };
  }

  visited.add(path);
  // ... continue flattening
  visited.delete(path); // backtrack
}
```

---

### Task 6.2: Wikilink Syntax Validation

**Gap**: Malformed wikilinks like `[[Article]` (missing bracket) not caught

**File to modify**: `src/parser/wikilink.ts`

**Test file**: `src/parser/wikilink.test.ts`

#### RED: Write Failing Test

```typescript
describe('wikilink syntax validation', () => {
  it('returns error for missing closing bracket', () => {
    const result = parseWikilink('[[Article]');

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('bracket');
  });

  it('returns error for missing opening bracket', () => {
    const result = parseWikilink('[Article]]');

    expect(result.error).toBeDefined();
  });

  it('returns error for empty wikilink', () => {
    const result = parseWikilink('[[]]');

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('empty');
  });
});
```

#### GREEN: Implementation

In `src/parser/wikilink.ts`:

```typescript
export function parseWikilink(text: string): WikilinkResult {
  const trimmed = text.trim();

  if (!trimmed.startsWith('[[')) {
    return {
      target: null,
      anchor: null,
      error: { message: 'Wikilink must start with [[' },
    };
  }

  if (!trimmed.endsWith(']]')) {
    return {
      target: null,
      anchor: null,
      error: { message: 'Wikilink must end with ]]' },
    };
  }

  const inner = trimmed.slice(2, -2);

  if (inner.trim() === '') {
    return {
      target: null,
      anchor: null,
      error: { message: 'Wikilink target cannot be empty' },
    };
  }

  // ... rest of parsing
}
```

---

### Task 6.3: Validate Referenced Files Early

**Gap**: Cross-file references only validated at flatten time, not parse time

**File to modify**: `src/parser/lens.ts` (optional validation)

**Decision**: This is intentional - keep validation at flatten time but ensure errors are clear.

Enhance error messages during flattening to indicate the original file/line:

```typescript
// In flattener, when file not found:
errors.push({
  file: sourceFile,
  line: sourceLine, // Line where source:: field appears
  message: `Referenced file not found: ${referencedPath}`,
  suggestion: formatSuggestion(similarFiles, referencedPath),
  severity: 'error',
});
```

---

### Task 6.4: Section Order Validation (Optional Enhancement)

**Gap**: Invalid section orderings not detected

**Note**: Only implement if there ARE ordering requirements. Check with user.

---

### Task 6.5: UUID Duplication in Lens Files

**Gap**: Same UUID used in multiple Lens files

**File to modify**: Already handled by `src/validator/uuid.ts`

**Verify existing tests cover this case.**

---

### Task 6.6: Content Field Multiline Validation

**Gap**: Broken multiline content syntax not detected

**File to modify**: `src/parser/sections.ts`

**Test file**: `src/parser/sections.test.ts`

#### RED: Write Failing Test

```typescript
describe('multiline field validation', () => {
  it('correctly parses multiline content field', () => {
    const result = parseSections(`
### Page: Test
content::
This is line 1.
This is line 2.
`, 3, new Set(['page']), 'test.md');

    expect(result.sections[0].fields.content).toBe(
      'This is line 1.\nThis is line 2.'
    );
  });

  it('handles content field followed by another field', () => {
    const result = parseSections(`
### Page: Test
content::
Line 1
Line 2
optional:: true
`, 3, new Set(['page']), 'test.md');

    expect(result.sections[0].fields.content).toBe('Line 1\nLine 2');
    expect(result.sections[0].fields.optional).toBe('true');
  });
});
```

---

## Implementation Order

Execute batches in this order:

| Batch | Priority | Gaps | Estimated Tests |
|-------|----------|------|-----------------|
| 1 | Critical | 1, 2, 14 | 12 tests |
| 2 | Critical | 5 | 3 tests |
| 3 | High | 4 | 4 tests |
| 4 | High | 7, 12, 13 | 8 tests |
| 5 | Medium | 9, 10 | 6 tests |
| 6 | Medium | 6, 15, 17+ | 8 tests |

**Total**: ~41 new tests

---

## Verification Commands

After each task:

```bash
# Run specific test file
npm test src/validator/field-values.test.ts

# Run all tests
npm test

# Run with coverage
npm test -- --coverage
```

---

## Files to Create/Modify Summary

| File | Action |
|------|--------|
| `src/validator/field-values.ts` | Add slug validation, empty field checks |
| `src/validator/field-values.test.ts` | Add tests for above |
| `src/validator/duplicates.ts` | **CREATE** - Duplicate slug detection |
| `src/validator/duplicates.test.ts` | **CREATE** - Tests |
| `src/parser/module.ts` | Integrate empty field + slug validation |
| `src/parser/module.test.ts` | Add tests |
| `src/parser/wikilink.ts` | Add path traversal blocking, syntax validation |
| `src/parser/wikilink.test.ts` | Add tests |
| `src/parser/lens.ts` | Add required field validation, unknown segment detection |
| `src/parser/lens.test.ts` | Add tests |
| `src/bundler/article.ts` | Add whitespace normalization |
| `src/bundler/article.test.ts` | Add tests |
| `src/bundler/video.ts` | Enhance timestamp error messages |
| `src/bundler/video.test.ts` | Add tests |
| `src/flattener/index.ts` | Enhance circular detection, error messages |
| `src/flattener/index.test.ts` | Add tests |
| `src/index.ts` | Integrate duplicate slug detection |

---

## TDD Checklist (Per Task)

For each task:

- [ ] Write failing test
- [ ] Run test, verify it fails for the right reason
- [ ] Write minimal implementation
- [ ] Run test, verify it passes
- [ ] Run all tests, verify no regressions
- [ ] Refactor if needed, verify tests still pass

---

## Exit Criteria

All validation gaps addressed when:

1. All ~41 tests written and passing
2. Zero regressions in existing tests
3. Manual verification with sample invalid content shows clear errors
4. `npm test` exits cleanly with no warnings
