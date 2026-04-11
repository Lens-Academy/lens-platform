# Content Schema Consolidation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace 7 scattered field/header/validation definitions with a single `content-schema.ts` source of truth, eliminating ~500 lines of duplication and fixing the missing course frontmatter typo detection bug.

**Architecture:** Define one schema object per content type (module, course, lens, learning-outcome, article, video-transcript) and one per segment type (text, chat, article-excerpt, video-excerpt). Write generic `validateFrontmatter()` and derive `KNOWN_FIELDS` / `BOOLEAN_FIELDS` / `VALID_FIELDS_BY_SEGMENT_TYPE` from the schema instead of maintaining them independently. Each parser then imports and uses the schema instead of defining its own field lists.

**Tech Stack:** TypeScript, Vitest

**Baseline:** All 411 tests pass before starting. Run `npm run test` from `content_processor/` to verify at any point.

---

## Task 1: Create content-schema.ts with frontmatter schemas

**Files:**
- Create: `content_processor/src/content-schema.ts`
- Test: `content_processor/src/content-schema.test.ts`

### Step 1: Write the failing test

```typescript
// content_processor/src/content-schema.test.ts
import { describe, it, expect } from 'vitest';
import { CONTENT_SCHEMAS, SEGMENT_SCHEMAS } from './content-schema.js';

describe('CONTENT_SCHEMAS', () => {
  it('defines schemas for all 6 content types', () => {
    expect(Object.keys(CONTENT_SCHEMAS)).toEqual(
      expect.arrayContaining(['module', 'course', 'lens', 'learning-outcome', 'article', 'video-transcript'])
    );
    expect(Object.keys(CONTENT_SCHEMAS)).toHaveLength(6);
  });

  it('module schema has correct required and optional fields', () => {
    const schema = CONTENT_SCHEMAS['module'];
    expect(schema.requiredFields).toEqual(['slug', 'title']);
    expect(schema.optionalFields).toEqual(['contentId', 'id', 'discussion']);
  });

  it('course schema has correct required and optional fields', () => {
    const schema = CONTENT_SCHEMAS['course'];
    expect(schema.requiredFields).toEqual(['slug', 'title']);
    expect(schema.optionalFields).toEqual([]);
  });

  it('lens schema has correct required and optional fields', () => {
    const schema = CONTENT_SCHEMAS['lens'];
    expect(schema.requiredFields).toEqual(['id']);
    expect(schema.optionalFields).toEqual([]);
  });

  it('learning-outcome schema has correct required and optional fields', () => {
    const schema = CONTENT_SCHEMAS['learning-outcome'];
    expect(schema.requiredFields).toEqual(['id']);
    expect(schema.optionalFields).toEqual(['discussion']);
  });

  it('article schema has correct required and optional fields', () => {
    const schema = CONTENT_SCHEMAS['article'];
    expect(schema.requiredFields).toEqual(['title', 'author', 'source_url']);
    expect(schema.optionalFields).toEqual(['date']);
  });

  it('video-transcript schema has correct required and optional fields', () => {
    const schema = CONTENT_SCHEMAS['video-transcript'];
    expect(schema.requiredFields).toEqual(['title', 'channel', 'url']);
    expect(schema.optionalFields).toEqual([]);
  });

  it('allFields returns combined required + optional', () => {
    const schema = CONTENT_SCHEMAS['module'];
    expect(schema.allFields).toEqual(['slug', 'title', 'contentId', 'id', 'discussion']);
  });
});

describe('SEGMENT_SCHEMAS', () => {
  it('defines schemas for all 4 segment types', () => {
    expect(Object.keys(SEGMENT_SCHEMAS)).toEqual(
      expect.arrayContaining(['text', 'chat', 'article-excerpt', 'video-excerpt'])
    );
    expect(Object.keys(SEGMENT_SCHEMAS)).toHaveLength(4);
  });

  it('text segment has correct fields', () => {
    const schema = SEGMENT_SCHEMAS['text'];
    expect(schema.requiredFields).toEqual(['content']);
    expect(schema.optionalFields).toEqual(['optional']);
  });

  it('chat segment has correct fields', () => {
    const schema = SEGMENT_SCHEMAS['chat'];
    expect(schema.requiredFields).toEqual(['instructions']);
    expect(schema.optionalFields).toEqual(
      expect.arrayContaining(['optional', 'hidePreviousContentFromUser', 'hidePreviousContentFromTutor'])
    );
  });

  it('article-excerpt segment has correct fields', () => {
    const schema = SEGMENT_SCHEMAS['article-excerpt'];
    expect(schema.requiredFields).toEqual([]);
    expect(schema.optionalFields).toEqual(expect.arrayContaining(['from', 'to', 'optional']));
  });

  it('video-excerpt segment has correct fields', () => {
    const schema = SEGMENT_SCHEMAS['video-excerpt'];
    expect(schema.requiredFields).toEqual(['to']);
    expect(schema.optionalFields).toEqual(expect.arrayContaining(['from', 'optional']));
  });

  it('booleanFields lists the boolean fields', () => {
    const schema = SEGMENT_SCHEMAS['chat'];
    expect(schema.booleanFields).toEqual(
      expect.arrayContaining(['optional', 'hidePreviousContentFromUser', 'hidePreviousContentFromTutor'])
    );
    const textSchema = SEGMENT_SCHEMAS['text'];
    expect(textSchema.booleanFields).toEqual(['optional']);
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd content_processor && npx vitest run src/content-schema.test.ts`
Expected: FAIL — module `./content-schema.js` not found

### Step 3: Write minimal implementation

```typescript
// content_processor/src/content-schema.ts

export interface ContentTypeSchema {
  /** Fields that must be present and non-empty in frontmatter */
  requiredFields: string[];
  /** Fields that may be present in frontmatter */
  optionalFields: string[];
  /** Combined required + optional (derived, for convenience) */
  allFields: string[];
}

export interface SegmentTypeSchema {
  /** Fields that must be present in this segment type */
  requiredFields: string[];
  /** Fields that may be present in this segment type */
  optionalFields: string[];
  /** Combined required + optional (derived, for convenience) */
  allFields: string[];
  /** Fields that must be 'true' or 'false' */
  booleanFields: string[];
}

function contentSchema(required: string[], optional: string[]): ContentTypeSchema {
  return { requiredFields: required, optionalFields: optional, allFields: [...required, ...optional] };
}

function segmentSchema(required: string[], optional: string[], booleanFields: string[]): SegmentTypeSchema {
  return { requiredFields: required, optionalFields: optional, allFields: [...required, ...optional], booleanFields };
}

export const CONTENT_SCHEMAS: Record<string, ContentTypeSchema> = {
  'module': contentSchema(['slug', 'title'], ['contentId', 'id', 'discussion']),
  'course': contentSchema(['slug', 'title'], []),
  'lens': contentSchema(['id'], []),
  'learning-outcome': contentSchema(['id'], ['discussion']),
  'article': contentSchema(['title', 'author', 'source_url'], ['date']),
  'video-transcript': contentSchema(['title', 'channel', 'url'], []),
};

export const SEGMENT_SCHEMAS: Record<string, SegmentTypeSchema> = {
  'text': segmentSchema(['content'], ['optional'], ['optional']),
  'chat': segmentSchema(
    ['instructions'],
    ['optional', 'hidePreviousContentFromUser', 'hidePreviousContentFromTutor'],
    ['optional', 'hidePreviousContentFromUser', 'hidePreviousContentFromTutor'],
  ),
  'article-excerpt': segmentSchema([], ['from', 'to', 'optional'], ['optional']),
  'video-excerpt': segmentSchema(['to'], ['from', 'optional'], ['optional']),
};
```

### Step 4: Run test to verify it passes

Run: `cd content_processor && npx vitest run src/content-schema.test.ts`
Expected: PASS

### Step 5: Run all tests to verify no regressions

Run: `cd content_processor && npm run test`
Expected: 411 tests pass (new file doesn't touch anything yet)

### Step 6: Commit

```
feat(content-processor): add content-schema.ts as single source of truth

Defines frontmatter schemas for all 6 content types and field schemas
for all 4 segment types. Upcoming tasks will wire parsers/validators
to use these instead of their own scattered definitions.
```

---

## Task 2: Derive KNOWN_FIELDS and BOOLEAN_FIELDS from schema

Replace the hand-maintained lists in `field-typos.ts` and `field-values.ts` with derivations from the schema.

**Files:**
- Modify: `content_processor/src/content-schema.ts`
- Modify: `content_processor/src/validator/field-typos.ts`
- Modify: `content_processor/src/validator/field-values.ts`
- Test: `content_processor/src/content-schema.test.ts` (add tests)

### Step 1: Write the failing test

Add to `content-schema.test.ts`:

```typescript
import { ALL_KNOWN_FIELDS, ALL_BOOLEAN_FIELDS } from './content-schema.js';

describe('derived field lists', () => {
  it('ALL_KNOWN_FIELDS includes all frontmatter fields from all content types', () => {
    // Spot-check: fields from different content types
    expect(ALL_KNOWN_FIELDS).toContain('slug');       // module, course
    expect(ALL_KNOWN_FIELDS).toContain('author');      // article
    expect(ALL_KNOWN_FIELDS).toContain('channel');     // video-transcript
    expect(ALL_KNOWN_FIELDS).toContain('discussion');  // module, learning-outcome
  });

  it('ALL_KNOWN_FIELDS includes all segment fields', () => {
    expect(ALL_KNOWN_FIELDS).toContain('content');       // text
    expect(ALL_KNOWN_FIELDS).toContain('instructions');   // chat
    expect(ALL_KNOWN_FIELDS).toContain('hidePreviousContentFromUser'); // chat
    expect(ALL_KNOWN_FIELDS).toContain('from');           // excerpt
    expect(ALL_KNOWN_FIELDS).toContain('to');             // excerpt
  });

  it('ALL_KNOWN_FIELDS includes section-level fields not in segments', () => {
    // source:: is used in sections (LO, lens), not in segments
    expect(ALL_KNOWN_FIELDS).toContain('source');
    expect(ALL_KNOWN_FIELDS).toContain('learningOutcomeId');
  });

  it('ALL_KNOWN_FIELDS has no duplicates', () => {
    const unique = new Set(ALL_KNOWN_FIELDS);
    expect(unique.size).toBe(ALL_KNOWN_FIELDS.length);
  });

  it('ALL_BOOLEAN_FIELDS includes optional and hide fields', () => {
    expect(ALL_BOOLEAN_FIELDS).toContain('optional');
    expect(ALL_BOOLEAN_FIELDS).toContain('hidePreviousContentFromUser');
    expect(ALL_BOOLEAN_FIELDS).toContain('hidePreviousContentFromTutor');
  });

  it('ALL_BOOLEAN_FIELDS has no duplicates', () => {
    const unique = new Set(ALL_BOOLEAN_FIELDS);
    expect(unique.size).toBe(ALL_BOOLEAN_FIELDS.length);
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd content_processor && npx vitest run src/content-schema.test.ts`
Expected: FAIL — `ALL_KNOWN_FIELDS` is not exported

### Step 3: Write minimal implementation

Add to `content-schema.ts`:

```typescript
/**
 * Section-level fields used in body sections (not frontmatter, not segments).
 * These are fields like source:: and learningOutcomeId:: used in LO/lens sections.
 */
const SECTION_LEVEL_FIELDS = ['source', 'learningOutcomeId', 'sourceUrl'];

/**
 * All known field names across all content types, derived from schemas.
 * Used by typo detection to suggest corrections for unrecognized fields.
 */
export const ALL_KNOWN_FIELDS: string[] = (() => {
  const fields = new Set<string>();

  // Frontmatter fields from all content types
  for (const schema of Object.values(CONTENT_SCHEMAS)) {
    for (const field of schema.allFields) fields.add(field);
  }

  // Segment fields from all segment types
  for (const schema of Object.values(SEGMENT_SCHEMAS)) {
    for (const field of schema.allFields) fields.add(field);
  }

  // Section-level fields
  for (const field of SECTION_LEVEL_FIELDS) fields.add(field);

  return [...fields];
})();

/**
 * All boolean fields across all segment types, derived from schemas.
 */
export const ALL_BOOLEAN_FIELDS: string[] = (() => {
  const fields = new Set<string>();
  for (const schema of Object.values(SEGMENT_SCHEMAS)) {
    for (const field of schema.booleanFields) fields.add(field);
  }
  return [...fields];
})();
```

### Step 4: Run test to verify it passes

Run: `cd content_processor && npx vitest run src/content-schema.test.ts`
Expected: PASS

### Step 5: Wire field-typos.ts to use ALL_KNOWN_FIELDS

In `content_processor/src/validator/field-typos.ts`:
- Delete the `KNOWN_FIELDS` constant (lines 8-33)
- Add: `import { ALL_KNOWN_FIELDS } from '../content-schema.js';`
- Replace all references to `KNOWN_FIELDS` with `ALL_KNOWN_FIELDS` (lines 88, 96)

### Step 6: Wire field-values.ts to use ALL_BOOLEAN_FIELDS

In `content_processor/src/validator/field-values.ts`:
- Delete the `BOOLEAN_FIELDS` constant (lines 78-82)
- Add: `import { ALL_BOOLEAN_FIELDS } from '../content-schema.js';`
- Change line 102 from `BOOLEAN_FIELDS.has(name)` to `ALL_BOOLEAN_FIELDS.includes(name)`

### Step 7: Run all tests

Run: `cd content_processor && npm run test`
Expected: All 411 tests pass. The derived lists contain the same values as the old hand-maintained lists, so behavior is identical.

### Step 8: Commit

```
refactor(content-processor): derive KNOWN_FIELDS and BOOLEAN_FIELDS from schema

Replaces hand-maintained field lists in field-typos.ts and field-values.ts
with derivations from content-schema.ts. No behavioral change — the derived
lists contain exactly the same fields as before.
```

---

## Task 3: Derive VALID_FIELDS_BY_SEGMENT_TYPE from schema

Replace the hand-maintained `VALID_FIELDS_BY_SEGMENT_TYPE` in `segment-fields.ts`.

**Files:**
- Modify: `content_processor/src/content-schema.ts`
- Modify: `content_processor/src/validator/segment-fields.ts`
- Test: `content_processor/src/content-schema.test.ts` (add test)

### Step 1: Write the failing test

Add to `content-schema.test.ts`:

```typescript
import { VALID_FIELDS_BY_SEGMENT_TYPE } from './content-schema.js';

describe('VALID_FIELDS_BY_SEGMENT_TYPE (derived)', () => {
  it('text segment allows content and optional', () => {
    expect(VALID_FIELDS_BY_SEGMENT_TYPE['text']).toEqual(new Set(['content', 'optional']));
  });

  it('chat segment allows instructions, optional, and hide fields', () => {
    expect(VALID_FIELDS_BY_SEGMENT_TYPE['chat']).toEqual(new Set([
      'instructions', 'optional', 'hidePreviousContentFromUser', 'hidePreviousContentFromTutor',
    ]));
  });

  it('article-excerpt allows from, to, optional', () => {
    expect(VALID_FIELDS_BY_SEGMENT_TYPE['article-excerpt']).toEqual(new Set(['from', 'to', 'optional']));
  });

  it('video-excerpt allows from, to, optional', () => {
    expect(VALID_FIELDS_BY_SEGMENT_TYPE['video-excerpt']).toEqual(new Set(['from', 'to', 'optional']));
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd content_processor && npx vitest run src/content-schema.test.ts`
Expected: FAIL — `VALID_FIELDS_BY_SEGMENT_TYPE` not exported from content-schema

### Step 3: Write minimal implementation

Add to `content-schema.ts`:

```typescript
/**
 * Valid fields per segment type, derived from SEGMENT_SCHEMAS.
 * Used by segment-fields.ts to check for misplaced fields.
 */
export const VALID_FIELDS_BY_SEGMENT_TYPE: Record<string, Set<string>> = Object.fromEntries(
  Object.entries(SEGMENT_SCHEMAS).map(([type, schema]) => [type, new Set(schema.allFields)])
);
```

### Step 4: Run test to verify it passes

Run: `cd content_processor && npx vitest run src/content-schema.test.ts`
Expected: PASS

### Step 5: Wire segment-fields.ts to use derived version

In `content_processor/src/validator/segment-fields.ts`:
- Delete the local `VALID_FIELDS_BY_SEGMENT_TYPE` constant (lines 8-18)
- Add: `import { VALID_FIELDS_BY_SEGMENT_TYPE } from '../content-schema.js';`

### Step 6: Run all tests

Run: `cd content_processor && npm run test`
Expected: All 411 tests pass

### Step 7: Commit

```
refactor(content-processor): derive VALID_FIELDS_BY_SEGMENT_TYPE from schema

segment-fields.ts now imports the derived set from content-schema.ts
instead of defining its own. Identical behavior.
```

---

## Task 4: Wire parsers to use schema for frontmatter valid-fields lists

Replace the per-parser `VALID_*_FIELDS` arrays with `CONTENT_SCHEMAS[type].allFields`.

**Files:**
- Modify: `content_processor/src/parser/module.ts`
- Modify: `content_processor/src/parser/course.ts`
- Modify: `content_processor/src/parser/lens.ts`
- Modify: `content_processor/src/parser/learning-outcome.ts`
- Modify: `content_processor/src/parser/article.ts`
- Modify: `content_processor/src/parser/video-transcript.ts`
- Test: existing tests + `content_processor/src/parser/course.test.ts` (add test for bug fix)

### Step 1: Write the failing test for the course.ts bug

The course parser never calls `detectFrontmatterTypos()`. Add a test that exposes this.

Add to `content_processor/src/parser/course.test.ts`:

```typescript
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
```

### Step 2: Run test to verify it fails

Run: `cd content_processor && npx vitest run src/parser/course.test.ts`
Expected: FAIL — no warning about `tilte` (this is the bug: course.ts doesn't call `detectFrontmatterTypos`)

### Step 3: Wire all 6 parsers to use schema

**module.ts** — Replace lines 245-247:
```typescript
// Before:
const VALID_MODULE_FIELDS = ['slug', 'title', 'contentId', 'id', 'discussion'];
errors.push(...detectFrontmatterTypos(frontmatter, VALID_MODULE_FIELDS, file));

// After:
import { CONTENT_SCHEMAS } from '../content-schema.js';
// ...
errors.push(...detectFrontmatterTypos(frontmatter, CONTENT_SCHEMAS['module'].allFields, file));
```
Delete the local `VALID_MODULE_FIELDS` constant.

**course.ts** — Add typo detection (this is the bug fix). After `const { frontmatter, body, bodyStartLine } = frontmatterResult;` (line 100), add:
```typescript
import { CONTENT_SCHEMAS } from '../content-schema.js';
import { detectFrontmatterTypos } from '../validator/field-typos.js';
// ...
errors.push(...detectFrontmatterTypos(frontmatter, CONTENT_SCHEMAS['course'].allFields, file));
```

**lens.ts** — Replace lines 432-434:
```typescript
// Before:
const VALID_LENS_FIELDS = ['id'];
errors.push(...detectFrontmatterTypos(frontmatter, VALID_LENS_FIELDS, file));

// After:
import { CONTENT_SCHEMAS } from '../content-schema.js';
// ...
errors.push(...detectFrontmatterTypos(frontmatter, CONTENT_SCHEMAS['lens'].allFields, file));
```

**learning-outcome.ts** — Replace lines 44-45:
```typescript
// Before:
const VALID_LO_FIELDS = ['id', 'discussion'];
errors.push(...detectFrontmatterTypos(frontmatter, VALID_LO_FIELDS, file));

// After:
import { CONTENT_SCHEMAS } from '../content-schema.js';
// ...
errors.push(...detectFrontmatterTypos(frontmatter, CONTENT_SCHEMAS['learning-outcome'].allFields, file));
```

**article.ts** — Replace lines 31-32:
```typescript
// Before:
const VALID_ARTICLE_FIELDS = ['title', 'author', 'source_url', 'date'];
errors.push(...detectFrontmatterTypos(frontmatter, VALID_ARTICLE_FIELDS, file));

// After:
import { CONTENT_SCHEMAS } from '../content-schema.js';
// ...
errors.push(...detectFrontmatterTypos(frontmatter, CONTENT_SCHEMAS['article'].allFields, file));
```

**video-transcript.ts** — Replace lines 29-30:
```typescript
// Before:
const VALID_VT_FIELDS = ['title', 'channel', 'url'];
errors.push(...detectFrontmatterTypos(frontmatter, VALID_VT_FIELDS, file));

// After:
import { CONTENT_SCHEMAS } from '../content-schema.js';
// ...
errors.push(...detectFrontmatterTypos(frontmatter, CONTENT_SCHEMAS['video-transcript'].allFields, file));
```

### Step 4: Run the course test to verify bug fix

Run: `cd content_processor && npx vitest run src/parser/course.test.ts`
Expected: PASS — the new test catches the `tilte` typo

### Step 5: Run all tests

Run: `cd content_processor && npm run test`
Expected: All tests pass (411 existing + 1 new = 412)

### Step 6: Commit

```
refactor(content-processor): wire all parsers to use schema for frontmatter fields

Replaces 5 local VALID_*_FIELDS arrays with CONTENT_SCHEMAS[type].allFields.
Also fixes bug: course.ts now calls detectFrontmatterTypos() (previously
it was the only parser that didn't, so frontmatter typos were silently ignored).
```

---

## Task 5: Deduplicate levenshtein

**Files:**
- Modify: `content_processor/src/parser/wikilink.ts`
- Test: existing wikilink tests cover this

### Step 1: Run wikilink tests as baseline

Run: `cd content_processor && npx vitest run src/parser/wikilink.test.ts`
Expected: PASS

### Step 2: Replace duplicate with import

In `content_processor/src/parser/wikilink.ts`:
- Delete the local `levenshtein` function (lines 142-168)
- Add import: `import { levenshtein } from '../validator/field-typos.js';`
- The existing `findSimilarFiles()` function at line 235 already calls `levenshtein()` — it will now use the imported version.

### Step 3: Run wikilink tests

Run: `cd content_processor && npx vitest run src/parser/wikilink.test.ts`
Expected: PASS (43 tests)

### Step 4: Run all tests

Run: `cd content_processor && npm run test`
Expected: All tests pass

### Step 5: Commit

```
refactor(content-processor): deduplicate levenshtein function

wikilink.ts now imports levenshtein from field-typos.ts instead of
having its own identical copy.
```

---

## Task 6: Add generic validateFrontmatter helper

Create a generic function that handles the common frontmatter validation pattern (check required fields, check empty, detect typos) used by all 6 parsers.

**IMPORTANT: This lives in a NEW file `validator/validate-frontmatter.ts`, NOT in `content-schema.ts`.** Putting it in `content-schema.ts` would create a circular dependency: `content-schema.ts` → `field-typos.ts` (for detectFrontmatterTypos) → `content-schema.ts` (for ALL_KNOWN_FIELDS). A separate file breaks the cycle.

**Files:**
- Create: `content_processor/src/validator/validate-frontmatter.ts`
- Test: `content_processor/src/validator/validate-frontmatter.test.ts`

### Step 1: Write the failing test

```typescript
// content_processor/src/validator/validate-frontmatter.test.ts
import { describe, it, expect } from 'vitest';
import { validateFrontmatter } from './validate-frontmatter.js';

describe('validateFrontmatter', () => {
  it('returns no errors for valid module frontmatter', () => {
    const errors = validateFrontmatter(
      { slug: 'intro', title: 'Introduction' },
      'module',
      'modules/intro.md'
    );
    expect(errors).toHaveLength(0);
  });

  it('reports missing required fields', () => {
    const errors = validateFrontmatter(
      { title: 'Introduction' },
      'module',
      'modules/intro.md'
    );
    const slugError = errors.find(e => e.message.includes('slug'));
    expect(slugError).toBeDefined();
    expect(slugError!.severity).toBe('error');
  });

  it('reports empty required fields', () => {
    const errors = validateFrontmatter(
      { slug: '', title: 'Introduction' },
      'module',
      'modules/intro.md'
    );
    const slugError = errors.find(e => e.message.includes('slug') && e.message.includes('empty'));
    expect(slugError).toBeDefined();
  });

  it('reports whitespace-only required fields', () => {
    const errors = validateFrontmatter(
      { slug: '   ', title: 'Introduction' },
      'module',
      'modules/intro.md'
    );
    const slugError = errors.find(e => e.message.includes('slug') && e.message.includes('empty'));
    expect(slugError).toBeDefined();
  });

  it('detects frontmatter typos', () => {
    const errors = validateFrontmatter(
      { slug: 'intro', tilte: 'Introduction' },
      'module',
      'modules/intro.md'
    );
    const typoWarning = errors.find(e => e.message.includes("'tilte'"));
    expect(typoWarning).toBeDefined();
    expect(typoWarning!.severity).toBe('warning');
  });

  it('works for article content type', () => {
    const errors = validateFrontmatter(
      { title: 'My Article', author: 'Jane', source_url: 'https://example.com' },
      'article',
      'articles/test.md'
    );
    expect(errors).toHaveLength(0);
  });

  it('reports all missing required fields at once', () => {
    const errors = validateFrontmatter(
      {},
      'article',
      'articles/test.md'
    );
    const missingErrors = errors.filter(e => e.message.includes('Missing required'));
    expect(missingErrors.length).toBe(3); // title, author, source_url
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd content_processor && npx vitest run src/validator/validate-frontmatter.test.ts`
Expected: FAIL — module `./validate-frontmatter.js` not found

### Step 3: Write minimal implementation

```typescript
// content_processor/src/validator/validate-frontmatter.ts
import type { ContentError } from '../index.js';
import { CONTENT_SCHEMAS } from '../content-schema.js';
import { detectFrontmatterTypos } from './field-typos.js';

/**
 * Generic frontmatter validation against the schema for a content type.
 * Checks required fields (present + non-empty) and detects typos.
 *
 * Note: This does NOT handle type-specific validation like slug format
 * or id-must-be-string. Parsers still handle those themselves.
 */
export function validateFrontmatter(
  frontmatter: Record<string, unknown>,
  contentType: string,
  file: string,
): ContentError[] {
  const schema = CONTENT_SCHEMAS[contentType];
  if (!schema) return [];

  const errors: ContentError[] = [];

  // Detect typos in field names
  errors.push(...detectFrontmatterTypos(frontmatter, schema.allFields, file));

  // Check required fields
  for (const field of schema.requiredFields) {
    const value = frontmatter[field];
    if (value === undefined || value === null) {
      errors.push({
        file,
        line: 2,
        message: `Missing required field: ${field}`,
        suggestion: `Add '${field}' to frontmatter`,
        severity: 'error',
      });
    } else if (typeof value === 'string' && value.trim() === '') {
      errors.push({
        file,
        line: 2,
        message: `Field '${field}' must not be empty`,
        suggestion: `Provide a value for '${field}'`,
        severity: 'error',
      });
    }
  }

  return errors;
}
```

### Step 4: Run test to verify it passes

Run: `cd content_processor && npx vitest run src/validator/validate-frontmatter.test.ts`
Expected: PASS

### Step 5: Run all tests

Run: `cd content_processor && npm run test`
Expected: All tests pass

### Step 6: Commit

```
feat(content-processor): add generic validateFrontmatter helper

Lives in validator/validate-frontmatter.ts (not content-schema.ts) to
avoid circular dependency with field-typos.ts.

Provides consistent required-field checking and typo detection for all
content types. Parsers can use this instead of ad-hoc per-field checks.
```

---

## Task 7: Wire article.ts and video-transcript.ts to use validateFrontmatter

These two parsers already use the clean loop pattern, so they are the easiest to migrate. The migration should be behavior-preserving.

**Files:**
- Modify: `content_processor/src/parser/article.ts`
- Modify: `content_processor/src/parser/video-transcript.ts`

### Step 1: Run existing tests as baseline

Run: `cd content_processor && npx vitest run src/parser/article.test.ts src/parser/video-transcript.test.ts`
Expected: PASS (16 + 8 = 24 tests)

### Step 2: Refactor article.ts

Replace the frontmatter validation block (lines 31-63) with:

```typescript
import { validateFrontmatter } from '../validator/validate-frontmatter.js';
// Remove: import { detectFrontmatterTypos } from '../validator/field-typos.js';
// (only if no other usages remain in the file)

// Replace the old block with:
const frontmatterErrors = validateFrontmatter(frontmatter, 'article', file);
errors.push(...frontmatterErrors);

const hasRequiredError = frontmatterErrors.some(e => e.severity === 'error');
if (hasRequiredError) {
  return { article: null, errors };
}
```

Keep the rest of `parseArticle()` unchanged (wikilink checks, image scanning, article construction).

### Step 3: Run article tests

Run: `cd content_processor && npx vitest run src/parser/article.test.ts`
Expected: PASS (16 tests)

### Step 4: Refactor video-transcript.ts

Same pattern — replace lines 29-61 with:

```typescript
import { validateFrontmatter } from '../validator/validate-frontmatter.js';

const frontmatterErrors = validateFrontmatter(frontmatter, 'video-transcript', file);
errors.push(...frontmatterErrors);

const hasRequiredError = frontmatterErrors.some(e => e.severity === 'error');
if (hasRequiredError) {
  return { transcript: null, errors };
}
```

### Step 5: Run video-transcript tests

Run: `cd content_processor && npx vitest run src/parser/video-transcript.test.ts`
Expected: PASS (8 tests)

### Step 6: Run all tests

Run: `cd content_processor && npm run test`
Expected: All tests pass

### Step 7: Commit

```
refactor(content-processor): use validateFrontmatter in article + video-transcript parsers

Replaces ad-hoc required-field loops with the generic schema-based helper.
Same behavior, less code.
```

---

## Task 8: Wire remaining parsers to use validateFrontmatter

The module, course, lens, and learning-outcome parsers need more care because they have type-specific validation (slug format, id-must-be-string) that runs after the generic checks.

**Files:**
- Modify: `content_processor/src/parser/module.ts`
- Modify: `content_processor/src/parser/course.ts`
- Modify: `content_processor/src/parser/lens.ts`
- Modify: `content_processor/src/parser/learning-outcome.ts`

### Step 1: Run existing tests as baseline

Run: `cd content_processor && npx vitest run src/parser/module.test.ts src/parser/course.test.ts src/parser/lens.test.ts src/parser/learning-outcome.test.ts`
Expected: PASS

### Step 2: Refactor module.ts

Replace lines 245-296 (typo detection + slug/title validation) with:

```typescript
import { validateFrontmatter } from '../validator/validate-frontmatter.js';

// Generic frontmatter validation (typos + required fields)
const frontmatterErrors = validateFrontmatter(frontmatter, 'module', file);
errors.push(...frontmatterErrors);

// Module-specific: validate slug format (only if slug is present and non-empty)
const slug = frontmatter.slug;
if (typeof slug === 'string' && slug.trim() !== '') {
  const slugFormatError = validateSlugFormat(slug, file, 2);
  if (slugFormatError) {
    errors.push(slugFormatError);
  }
}

if (errors.length > 0) {
  return { module: null, errors };
}
```

**Fixture update required:** The file `fixtures/invalid/missing-slug/expected-errors.json` checks exact error strings via `toEqual()` in `process-fixtures.test.ts:281`. The old suggestion was `"Add 'slug: your-module-slug' to frontmatter"` but the generic helper produces `"Add 'slug' to frontmatter"`. Update the fixture:

```json
{
  "modules": [],
  "courses": [],
  "errors": [
    {
      "file": "modules/no-slug.md",
      "line": 2,
      "message": "Missing required field: slug",
      "suggestion": "Add 'slug' to frontmatter",
      "severity": "error"
    }
  ]
}
```

**Unit tests are safe:** The module unit tests only use `.toContain('slug')` / `.toContain('empty')` — the new generic messages still contain both words. No unit test changes needed.

### Step 3: Run module tests

Run: `cd content_processor && npx vitest run src/parser/module.test.ts`
Expected: PASS

### Step 3b: Run fixture tests

Run: `cd content_processor && npx vitest run tests/process-fixtures.test.ts`
Expected: PASS (after fixture update)

### Step 4: Refactor course.ts

Replace lines 102-133 with:

```typescript
import { validateFrontmatter } from '../validator/validate-frontmatter.js';

const frontmatterErrors = validateFrontmatter(frontmatter, 'course', file);
errors.push(...frontmatterErrors);

// Course-specific: validate slug format
const slug = frontmatter.slug;
if (typeof slug === 'string' && slug.trim() !== '') {
  const slugFormatError = validateSlugFormat(slug as string, file, 2);
  if (slugFormatError) {
    errors.push(slugFormatError);
  }
}

if (errors.length > 0) {
  return { course: null, errors };
}
```

Remove the now-unused individual slug/title checks.

### Step 5: Run course tests

Run: `cd content_processor && npx vitest run src/parser/course.test.ts`
Expected: PASS

### Step 6: Refactor lens.ts

Replace lines 432-457 with:

```typescript
import { validateFrontmatter } from '../validator/validate-frontmatter.js';

const frontmatterErrors = validateFrontmatter(frontmatter, 'lens', file);
errors.push(...frontmatterErrors);

if (frontmatterErrors.some(e => e.severity === 'error')) {
  return { lens: null, errors };
}

// Lens-specific: id must be a string (YAML might parse UUIDs as numbers)
if (typeof frontmatter.id !== 'string') {
  errors.push({
    file,
    line: 2,
    message: `Field 'id' must be a string, got ${typeof frontmatter.id}`,
    suggestion: "Use quotes: id: '12345'",
    severity: 'error',
  });
  return { lens: null, errors };
}
```

### Step 7: Run lens tests

Run: `cd content_processor && npx vitest run src/parser/lens.test.ts`
Expected: PASS

### Step 8: Refactor learning-outcome.ts

Replace lines 44-68 with:

```typescript
import { validateFrontmatter } from '../validator/validate-frontmatter.js';

const frontmatterErrors = validateFrontmatter(frontmatter, 'learning-outcome', file);
errors.push(...frontmatterErrors);

if (frontmatterErrors.some(e => e.severity === 'error')) {
  return { learningOutcome: null, errors };
}

// LO-specific: id must be a string
if (typeof frontmatter.id !== 'string') {
  errors.push({
    file,
    line: 2,
    message: `Field 'id' must be a string, got ${typeof frontmatter.id}`,
    suggestion: "Use quotes: id: '12345'",
    severity: 'error',
  });
  return { learningOutcome: null, errors };
}
```

### Step 9: Run all tests

Run: `cd content_processor && npm run test`
Expected: All tests pass. If any test checks exact error message text that changed, fix the test expectations to match the generic messages — but do not weaken the assertions.

### Step 10: Commit

```
refactor(content-processor): use validateFrontmatter in all remaining parsers

module, course, lens, and learning-outcome parsers now use the generic
schema-based validation for required fields and typo detection.
Type-specific checks (slug format, id-must-be-string) are preserved
as post-validation steps.
```

---

## Task 9: Final cleanup and verification

**Files:**
- Review all modified files for dead imports

### Step 1: Remove dead imports

Check each modified parser file for imports that are no longer used:
- `detectFrontmatterTypos` — only needed if the parser still calls it directly (it shouldn't after Task 8)
- Local `VALID_*_FIELDS` constants — should all be deleted by now

### Step 2: Run all tests one final time

Run: `cd content_processor && npm run test`
Expected: All tests pass

### Step 3: Verify the golden master tests

The golden master tests in `tests/golden-master.test.ts` compare actual output against snapshots. These are the strongest guarantee that behavior is unchanged.

Run: `cd content_processor && npx vitest run tests/golden-master.test.ts`
Expected: PASS

### Step 4: Commit

```
chore(content-processor): remove dead imports after schema consolidation
```

---

## Summary of changes

| What changed | Before | After |
|---|---|---|
| Frontmatter field definitions | 5 local arrays in 5 parsers | 1 schema in `content-schema.ts` |
| Course typo detection | Missing (bug) | Fixed via schema |
| KNOWN_FIELDS | Hand-maintained in field-typos.ts | Derived from schema |
| BOOLEAN_FIELDS | Hand-maintained in field-values.ts | Derived from schema |
| VALID_FIELDS_BY_SEGMENT_TYPE | Hand-maintained in segment-fields.ts | Derived from schema |
| Required field checking | 5 different patterns across parsers | 1 generic `validateFrontmatter()` |
| Levenshtein | Duplicated in 2 files | Single implementation in field-typos.ts |

**Lines removed:** ~200 lines of scattered definitions and ad-hoc validation
**Lines added:** ~100 lines of schema + generic validator
**Net reduction:** ~100 lines
**Bug fixed:** Course frontmatter typo detection

## Not in scope (future work)

These were identified in the code review but are separate refactoring tasks:

1. **Consolidate field parsing** — The 3 implementations of `fieldname:: value` parsing (sections.ts, lens.ts, module.ts) could share a single parser. Left for a future task because it touches more complex parsing logic.

2. **Deduplicate lens flattening** — `flattenLearningOutcomeSection()` and `flattenUncategorizedSection()` in `flattener/index.ts` share ~200 lines. Left for a future task because it's in the flattener, not the validator.
