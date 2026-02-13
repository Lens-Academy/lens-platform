# Validator Gap Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix remaining validator gaps identified by code review — improve error messages, catch silent data loss, and prevent runtime crashes.

**Architecture:** All changes are within `content_processor/src/`. Each task modifies 1-2 source files + their test files. Strict TDD: failing test first, then minimal implementation.

**Tech Stack:** TypeScript, Vitest

**Working directory:** `/home/penguin/code/lens-platform/ws1/content_processor`

**Test command:** `npx vitest run` (all tests) or `npx vitest run <path>` (specific file)

**Current state:** 373 tests passing. All changes go into the current jj change (no new commits needed between tasks — commit at the end).

---

### Task 1: GAP 18 — Numeric `start` in timestamps.json causes runtime crash

The timestamps validator silently passes when `start` is a number (e.g., `0.4`) instead of a string (e.g., `"0:00.40"`). This causes a runtime crash in `parseTimestamp()` during excerpt extraction.

**Files:**
- Test: `src/validator/timestamps.test.ts`
- Modify: `src/validator/timestamps.ts`

**Step 1: Write failing test**

Add to `src/validator/timestamps.test.ts`:

```typescript
it('reports error when start field is a number instead of string', () => {
  const content = JSON.stringify([
    { text: 'Hello', start: 0.4 },
    { text: 'World', start: 0.88 },
  ]);

  const errors = validateTimestamps(content, 'video_transcripts/test.timestamps.json');
  expect(errors.some(e =>
    e.severity === 'error' &&
    e.message.includes('Entry 0') &&
    e.message.includes('string')
  )).toBe(true);
});
```

**Step 2: Run test, verify RED**

Run: `npx vitest run src/validator/timestamps.test.ts`
Expected: FAIL — numeric start passes silently (falls through both branches).

**Step 3: Implement fix**

In `src/validator/timestamps.ts`, after the `typeof entry.start === 'string'` branch (around line 66), add an `else` branch:

```typescript
} else {
  errors.push({
    file,
    message: `Entry ${i}: 'start' must be a string, got ${typeof entry.start}`,
    suggestion: "Use string format like '0:01.32' instead of a number",
    severity: 'error',
  });
}
```

**Step 4: Run test, verify GREEN**

Run: `npx vitest run src/validator/timestamps.test.ts`
Expected: All pass.

---

### Task 2: GAP 9 — Non-string `id` values produce confusing error

YAML parses `id: 12345` as number and `id: true` as boolean. These pass the `!frontmatter.id` falsy check but produce confusing "Invalid UUID format" errors downstream. Need early type check in lens, learning-outcome, and module parsers.

**Files:**
- Test: `src/parser/lens.test.ts`
- Modify: `src/parser/lens.ts`
- Test: `src/parser/learning-outcome.test.ts`
- Modify: `src/parser/learning-outcome.ts`

**Step 1: Write failing tests**

Add to `src/parser/lens.test.ts`:

```typescript
describe('non-string id validation', () => {
  it('errors when id is a number', () => {
    const content = `---
id: 12345
---

### Page: Test
#### Text
content:: Hello.
`;

    const result = parseLens(content, 'Lenses/test.md');

    expect(result.errors.some(e =>
      e.severity === 'error' &&
      e.message.includes('id') &&
      e.message.includes('string')
    )).toBe(true);
  });

  it('errors when id is a boolean', () => {
    const content = `---
id: true
---

### Page: Test
#### Text
content:: Hello.
`;

    const result = parseLens(content, 'Lenses/test.md');

    expect(result.errors.some(e =>
      e.severity === 'error' &&
      e.message.includes('id') &&
      e.message.includes('string')
    )).toBe(true);
  });
});
```

Add to `src/parser/learning-outcome.test.ts`:

```typescript
it('errors when id is a number', () => {
  const content = `---
id: 12345
---

## Lens: Test
source:: [[../Lenses/lens1.md|Lens]]
`;

  const result = parseLearningOutcome(content, 'Learning Outcomes/bad.md');

  expect(result.errors.some(e =>
    e.severity === 'error' &&
    e.message.includes('id') &&
    e.message.includes('string')
  )).toBe(true);
});
```

**Step 2: Run tests, verify RED**

Run: `npx vitest run src/parser/lens.test.ts src/parser/learning-outcome.test.ts`
Expected: FAIL — numeric/boolean ids pass falsy check, no string type error.

**Step 3: Implement fix**

In `src/parser/lens.ts`, after the `if (!frontmatter.id)` block (around line 393), add:

```typescript
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

Apply identical fix in `src/parser/learning-outcome.ts` after its `if (!frontmatter.id)` block (around line 57).

**Step 4: Run tests, verify GREEN**

Run: `npx vitest run src/parser/lens.test.ts src/parser/learning-outcome.test.ts`
Expected: All pass.

---

### Task 3: GAP 11 — Single colon `field:` poorly diagnosed

When a user writes `content: text` instead of `content:: text`, the parser treats it as regular body text because the `FIELD_PATTERN` requires `::`. The error says "missing content:: field" without hinting the single colon was detected.

This needs to be detected in two places:
1. `src/parser/sections.ts` — `parseFields()` which handles H1/H2/H3 section fields (used by modules, LOs, courses, and lens sections)
2. `src/parser/lens.ts` — `parseFieldsIntoSegment()` which handles H4 segment fields

**Files:**
- Test: `src/parser/sections.test.ts`
- Modify: `src/parser/sections.ts`
- Test: `src/parser/lens.test.ts`
- Modify: `src/parser/lens.ts`

**Step 1: Write failing test in sections.test.ts**

Add to `src/parser/sections.test.ts`:

```typescript
it('warns when single colon field: is used instead of field::', () => {
  const content = `## Lens: Test\nsource: [[../Lenses/lens1.md|Lens]]`;

  const result = parseSections(content, 2, LO_SECTION_TYPES, 'test.md');

  expect(result.errors.some(e =>
    e.severity === 'warning' &&
    e.message.includes('source') &&
    (e.message.includes('single colon') || e.message.includes('::'))
  )).toBe(true);
});
```

Add to `src/parser/lens.test.ts`:

```typescript
it('warns when single colon is used instead of :: in segment fields', () => {
  const content = `---
id: test-id
---

### Page: Test

#### Text
content: This uses single colon.
`;

  const result = parseLens(content, 'Lenses/test.md');

  expect(result.errors.some(e =>
    e.severity === 'warning' &&
    e.message.includes('content') &&
    (e.message.includes('single colon') || e.message.includes('::'))
  )).toBe(true);
});
```

**Step 2: Run tests, verify RED**

Run: `npx vitest run src/parser/sections.test.ts src/parser/lens.test.ts`
Expected: FAIL — single colon is silently ignored.

**Step 3: Implement fix**

In `src/parser/sections.ts` `parseFields()` function, in the else branch where `FIELD_PATTERN` doesn't match (around line 206), add a secondary check:

```typescript
} else if (currentField) {
  // Continue multiline value
  currentValue.push(line);
} else {
  // Check for single-colon field that should be double-colon
  const singleColonMatch = line.match(/^(\w+):\s+(.*)$/);
  if (singleColonMatch && !line.match(/^https?:/)) {
    warnings.push({
      file,
      line: lineNum,
      message: `Found '${singleColonMatch[1]}:' with single colon — did you mean '${singleColonMatch[1]}::'?`,
      suggestion: `Change '${singleColonMatch[1]}:' to '${singleColonMatch[1]}::' (double colon)`,
      severity: 'warning',
    });
  }
}
```

**Important edge case:** The check `!line.match(/^https?:/)` avoids false positives on URLs. Also, only trigger when not currently inside a multiline field value (i.e. `currentField` is null).

In `src/parser/lens.ts` `parseFieldsIntoSegment()` function (around line 165), add similar logic in the else branch:

```typescript
} else if (currentField) {
  // Continue multiline value
  currentValue.push(line);
} else {
  // Check for single-colon field
  const singleColonMatch = line.match(/^(\w+):\s+(.*)$/);
  if (singleColonMatch && !line.match(/^https?:/)) {
    // Store warning info on the segment for the caller to handle
    // Since parseFieldsIntoSegment doesn't return errors, we need
    // to add this detection in parseSegments instead
  }
}
```

**Alternative approach (simpler):** Instead of modifying `parseFieldsIntoSegment` which has no error return, add the single-colon detection in `parseSegments()` where `currentSegment` is active and the line isn't matching `FIELD_PATTERN`. The lines collected for field parsing are available there.

Actually, the cleanest approach: add the check in `parseSegments()` in the `else if (currentSegment)` branch. When a line doesn't match FIELD_PATTERN but matches single-colon pattern, emit a warning in the `errors` array that `parseSegments` already returns.

```typescript
} else if (currentSegment) {
  // Check for single-colon field before adding to field lines
  const singleColonMatch = line.match(/^(\w+):\s+(.*)$/);
  if (singleColonMatch && !line.match(/^https?:/) && !FIELD_PATTERN.test(line)) {
    errors.push({
      file,
      line: lineNum,
      message: `Found '${singleColonMatch[1]}:' with single colon — did you mean '${singleColonMatch[1]}::'?`,
      suggestion: `Change '${singleColonMatch[1]}:' to '${singleColonMatch[1]}::' (double colon)`,
      severity: 'warning',
    });
  }
  currentFieldLines.push(line);
}
```

**Step 4: Run tests, verify GREEN**

Run: `npx vitest run src/parser/sections.test.ts src/parser/lens.test.ts`
Expected: All pass.

**Step 5: Run full suite**

Run: `npx vitest run`
Expected: All 373+ tests pass. No existing test should break because single-colon lines previously weren't triggering any behavior.

---

### Task 4: GAP 2 — Segment type / section type mismatch not detected

An `#### article-excerpt` segment inside a `### Page:` section is nonsensical but silently accepted. The segment would never be able to extract content because Page sections have no source file.

**Files:**
- Test: `src/parser/lens.test.ts`
- Modify: `src/parser/lens.ts`

**Step 1: Write failing test**

Add to `src/parser/lens.test.ts`:

```typescript
describe('segment/section type mismatch', () => {
  it('warns about article-excerpt in a Page section', () => {
    const content = `---
id: test-id
---

### Page: Introduction

#### Article-excerpt
from:: "Start"
to:: "End"
`;

    const result = parseLens(content, 'Lenses/test.md');

    expect(result.errors.some(e =>
      e.severity === 'warning' &&
      e.message.includes('article-excerpt') &&
      e.message.includes('Page')
    )).toBe(true);
  });

  it('warns about video-excerpt in a Page section', () => {
    const content = `---
id: test-id
---

### Page: Introduction

#### Video-excerpt
from:: 0:00
to:: 5:00
`;

    const result = parseLens(content, 'Lenses/test.md');

    expect(result.errors.some(e =>
      e.severity === 'warning' &&
      e.message.includes('video-excerpt') &&
      e.message.includes('Page')
    )).toBe(true);
  });

  it('warns about video-excerpt in an Article section', () => {
    const content = `---
id: test-id
---

### Article: Test
source:: [[../articles/test.md|Article]]

#### Video-excerpt
from:: 0:00
to:: 5:00
`;

    const result = parseLens(content, 'Lenses/test.md');

    expect(result.errors.some(e =>
      e.severity === 'warning' &&
      e.message.includes('video-excerpt') &&
      e.message.includes('Article')
    )).toBe(true);
  });

  it('does not warn about article-excerpt in Article section', () => {
    const content = `---
id: test-id
---

### Article: Test
source:: [[../articles/test.md|Article]]

#### Article-excerpt
from:: "Start"
to:: "End"
`;

    const result = parseLens(content, 'Lenses/test.md');

    expect(result.errors.filter(e =>
      e.message.includes('mismatch') || (e.message.includes('excerpt') && e.message.includes('section'))
    )).toHaveLength(0);
  });
});
```

**Step 2: Run tests, verify RED**

Run: `npx vitest run src/parser/lens.test.ts`
Expected: FAIL — mismatched segments accepted silently.

**Step 3: Implement fix**

In `src/parser/lens.ts`, in the section processing loop (after raw segments are converted, around line 479), add mismatch detection:

```typescript
// Define valid segment types per section type
const VALID_SEGMENTS_PER_SECTION: Record<string, Set<string>> = {
  'page': new Set(['text', 'chat']),
  'lens-article': new Set(['text', 'chat', 'article-excerpt']),
  'lens-video': new Set(['text', 'chat', 'video-excerpt']),
};
```

Place this constant near the top of the file (e.g., after `LENS_SEGMENT_TYPES`), then in the segment loop:

```typescript
const validSegs = VALID_SEGMENTS_PER_SECTION[outputType];
if (validSegs && !validSegs.has(rawSeg.type)) {
  errors.push({
    file,
    line: rawSeg.line,
    message: `Segment type '${rawSeg.type}' is not valid in a ${rawSection.rawType} section`,
    suggestion: `Valid segment types for ${rawSection.rawType}: ${[...(validSegs ?? [])].join(', ')}`,
    severity: 'warning',
  });
}
```

Add this check before `convertSegment()` so the warning is always produced even if conversion fails.

**Step 4: Run tests, verify GREEN**

Run: `npx vitest run src/parser/lens.test.ts`
Expected: All pass.

---

### Task 5: GAP 7 — Empty module produces no warning

A module with valid frontmatter but zero `# Page:` / `# Learning Outcome:` / `# Uncategorized:` sections silently produces empty output.

**Files:**
- Test: `src/parser/module.test.ts`
- Modify: `src/parser/module.ts`

**Step 1: Write failing test**

Add to `src/parser/module.test.ts`:

```typescript
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
```

**Step 2: Run test, verify RED**

Run: `npx vitest run src/parser/module.test.ts`
Expected: FAIL — no warning for empty sections.

**Step 3: Implement fix**

In `src/parser/module.ts`, after the sections are parsed and line-adjusted (around line 294, before constructing the `module` object), add:

```typescript
if (sectionsResult.sections.length === 0) {
  errors.push({
    file,
    line: bodyStartLine,
    message: 'Module has no sections',
    suggestion: "Add sections like '# Page:', '# Learning Outcome:', or '# Uncategorized:'",
    severity: 'warning',
  });
}
```

**Step 4: Run test, verify GREEN**

Run: `npx vitest run src/parser/module.test.ts`
Expected: All pass.

---

### Task 6: GAP 17 — Empty Uncategorized section silently produces no output

An `# Uncategorized:` section with no `## Lens:` references produces zero output sections with no warning.

**Files:**
- Test: `src/flattener/index.test.ts`
- Modify: `src/flattener/index.ts`

**Step 1: Write failing test**

Add to `src/flattener/index.test.ts`. Find the Uncategorized test section (or create one):

```typescript
it('warns when Uncategorized section has no lens references', () => {
  const files = new Map<string, string>();
  files.set('modules/test.md', `---
slug: test
title: Test Module
id: 550e8400-e29b-41d4-a716-446655440099
---

# Uncategorized:
Just some notes, no ## Lens: references here.
`);

  const result = flattenModule('modules/test.md', files);

  expect(result.errors.some(e =>
    e.severity === 'warning' &&
    (e.message.includes('no') && e.message.includes('Lens')) ||
    e.message.includes('Uncategorized')
  )).toBe(true);
});
```

**Step 2: Run test, verify RED**

Run: `npx vitest run src/flattener/index.test.ts`
Expected: FAIL — no warning produced.

**Step 3: Implement fix**

In `src/flattener/index.ts`, in `flattenUncategorizedSection()`, after the `if (lensRefs.length === 0)` check (around line 424), change it from silently returning empty to also warning:

```typescript
if (lensRefs.length === 0) {
  errors.push({
    file: modulePath,
    line: section.line,
    message: 'Uncategorized section has no ## Lens: references — this section will produce no output',
    suggestion: "Add '## Lens: [[../Lenses/lens-name.md|Display]]' references",
    severity: 'warning',
  });
  return { sections: [], errors };
}
```

**Step 4: Run test, verify GREEN**

Run: `npx vitest run src/flattener/index.test.ts`
Expected: All pass.

---

### Task 7: GAP 21 — Course slug format not validated

Modules validate slug format via `validateSlugFormat()`, but courses don't. A course with `slug: My Course!` is accepted.

**Files:**
- Test: `src/parser/course.test.ts`
- Modify: `src/parser/course.ts`

**Step 1: Write failing test**

Add to `src/parser/course.test.ts`:

```typescript
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
```

**Step 2: Run test, verify RED**

Run: `npx vitest run src/parser/course.test.ts`
Expected: FAIL — bad slug passes with no format error.

**Step 3: Implement fix**

In `src/parser/course.ts`:

1. Add import at top:
```typescript
import { validateSlugFormat } from '../validator/field-values.js';
```

2. After the slug existence check (around line 110, before the `if (errors.length > 0)` early return), add:
```typescript
if (frontmatter.slug && typeof frontmatter.slug === 'string' && frontmatter.slug.trim() !== '') {
  const slugFormatError = validateSlugFormat(frontmatter.slug as string, file, 2);
  if (slugFormatError) {
    errors.push(slugFormatError);
  }
}
```

**Step 4: Run test, verify GREEN**

Run: `npx vitest run src/parser/course.test.ts`
Expected: All pass.

---

### Task 8: GAP 6 — Timestamp format not validated at parse time in lens

Video-excerpt `from::` and `to::` timestamps are stored as raw strings in the lens parser. Format validation only happens during bundling, producing errors with poor location info (pointing to the video transcript file, not the lens file where the bad timestamp was written).

**Files:**
- Test: `src/parser/lens.test.ts`
- Modify: `src/parser/lens.ts`

**Step 1: Write failing test**

Add to `src/parser/lens.test.ts`:

```typescript
describe('timestamp format validation', () => {
  it('warns about invalid from:: timestamp format', () => {
    const content = `---
id: test-id
---

### Video: Test
source:: [[../video_transcripts/test.md|Video]]

#### Video-excerpt
from:: 1 hour 30 min
to:: 5:45
`;

    const result = parseLens(content, 'Lenses/test.md');

    expect(result.errors.some(e =>
      e.severity === 'warning' &&
      e.message.includes('from') &&
      e.message.includes('timestamp')
    )).toBe(true);
  });

  it('warns about invalid to:: timestamp format', () => {
    const content = `---
id: test-id
---

### Video: Test
source:: [[../video_transcripts/test.md|Video]]

#### Video-excerpt
from:: 0:00
to:: five minutes
`;

    const result = parseLens(content, 'Lenses/test.md');

    expect(result.errors.some(e =>
      e.severity === 'warning' &&
      e.message.includes('to') &&
      e.message.includes('timestamp')
    )).toBe(true);
  });

  it('accepts valid timestamp formats', () => {
    const content = `---
id: test-id
---

### Video: Test
source:: [[../video_transcripts/test.md|Video]]

#### Video-excerpt
from:: 1:30
to:: 5:45
`;

    const result = parseLens(content, 'Lenses/test.md');

    expect(result.errors.filter(e =>
      e.message.includes('timestamp')
    )).toHaveLength(0);
  });
});
```

**Step 2: Run test, verify RED**

Run: `npx vitest run src/parser/lens.test.ts`
Expected: FAIL — invalid timestamps not caught at parse time.

**Step 3: Implement fix**

In `src/parser/lens.ts`:

1. Add import at top:
```typescript
import { parseTimestamp } from '../bundler/video.js';
```

2. In `convertSegment()`, case `'video-excerpt'` (around line 307), after the `toField` required check, add timestamp format validation before constructing the segment:

```typescript
// Validate timestamp formats at parse time for better error reporting
const fromStr = fromField || '0:00';
if (parseTimestamp(fromStr) === null) {
  errors.push({
    file,
    line: raw.line,
    message: `Invalid timestamp format in from:: field: '${fromStr}'`,
    suggestion: "Expected format: M:SS (e.g., 1:30) or H:MM:SS (e.g., 1:30:00)",
    severity: 'warning',
  });
}
if (parseTimestamp(toField) === null) {
  errors.push({
    file,
    line: raw.line,
    message: `Invalid timestamp format in to:: field: '${toField}'`,
    suggestion: "Expected format: M:SS (e.g., 5:45) or H:MM:SS (e.g., 1:30:00)",
    severity: 'warning',
  });
}
```

Note: Use `warning` severity (not error) so the segment is still created and downstream validation can give additional context. The parse-time check gives the user a fast, well-located error.

**Step 4: Run test, verify GREEN**

Run: `npx vitest run src/parser/lens.test.ts`
Expected: All pass.

---

### Final Verification

After all tasks:

```bash
npx vitest run
```

Expected: All tests pass (373 + new tests ≈ ~390+).

Then run against real content:

```bash
npx tsx src/cli.ts fixtures/golden/actual-content/input/
```

Verify no unexpected new warnings on real content.

## Files Summary

**Modify (test first, then implementation):**
- `src/validator/timestamps.test.ts` + `src/validator/timestamps.ts` — Task 1
- `src/parser/lens.test.ts` + `src/parser/lens.ts` — Tasks 2, 4, 8
- `src/parser/learning-outcome.test.ts` + `src/parser/learning-outcome.ts` — Task 2
- `src/parser/sections.test.ts` + `src/parser/sections.ts` — Task 3
- `src/parser/module.test.ts` + `src/parser/module.ts` — Task 5
- `src/flattener/index.test.ts` + `src/flattener/index.ts` — Task 6
- `src/parser/course.test.ts` + `src/parser/course.ts` — Task 7
