# Silent Data Loss Fixes — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 5 silent data loss bugs where user content is dropped without any warning.

**Architecture:** Each fix adds a warning in the parser's `else` branch where content currently falls through. Finding #13 is a logic fix (case-insensitive boolean comparison).

**Tech Stack:** TypeScript, Vitest

**Test command:** `cd /home/penguin/code/lens-platform/ws1/content_processor && npx vitest run`

---

## Task 1: Warn when free text appears before first `field::` in section bodies (Finding #4)

This is the root-level fix — `sections.ts` `parseFields()`. Text like prose paragraphs, bullet lists, and markdown content that appears before the first `field::` definition in any section body is silently dropped. The single-colon warning (GAP 11) only catches `word: value` patterns, not ordinary prose.

**Files:**
- Test: `src/parser/sections.test.ts`
- Modify: `src/parser/sections.ts`

**Step 1: Write the failing test**

Add to `src/parser/sections.test.ts` in a new `describe('free text warnings')` block:

```typescript
describe('free text warnings', () => {
  it('warns when free text appears before first field in section body', () => {
    const content = `
# Learning Outcome: Test LO
Here is a description of this learning outcome.
- It covers topic A
- It covers topic B
source:: [[../Learning Outcomes/lo1.md|LO 1]]
`;

    const result = parseSections(content, 1, MODULE_SECTION_TYPES);

    expect(result.sections).toHaveLength(1);
    // The free text before source:: should produce a warning
    expect(result.errors.some(e =>
      e.severity === 'warning' &&
      e.message.includes('ignored')
    )).toBe(true);
  });

  it('does not warn for blank lines before first field', () => {
    const content = `
# Learning Outcome: Test LO

source:: [[../Learning Outcomes/lo1.md|LO 1]]
`;

    const result = parseSections(content, 1, MODULE_SECTION_TYPES);

    expect(result.errors.filter(e =>
      e.message.includes('ignored')
    )).toHaveLength(0);
  });

  it('does not warn for text that is part of a multiline field value', () => {
    const content = `
# Page: Test Page
id:: 550e8400-e29b-41d4-a716-446655440000
Here is continued text that is part of the id field.
`;
    // This should NOT warn — the text is absorbed into the `id` multiline value.
    // (Whether that's valid is a separate question — the point is no "ignored" warning.)
    const result = parseSections(content, 1, MODULE_SECTION_TYPES);

    expect(result.errors.filter(e =>
      e.message.includes('ignored')
    )).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/parser/sections.test.ts`
Expected: First test fails — no warning about "ignored" text.

**Step 3: Write minimal implementation**

In `src/parser/sections.ts`, in `parseFields()` at the `else` block (line ~209), after the single-colon check, add a warning for non-blank lines that don't match the single-colon pattern:

```typescript
} else {
  // Not inside a field — check for single-colon that should be double-colon
  const singleColonMatch = line.match(/^(\w+):\s+(.*)$/);
  if (singleColonMatch && !line.match(/^https?:/)) {
    warnings.push({
      file,
      line: lineNum,
      message: `Found '${singleColonMatch[1]}:' with single colon — did you mean '${singleColonMatch[1]}::'?`,
      suggestion: `Change '${singleColonMatch[1]}:' to '${singleColonMatch[1]}::' (double colon)`,
      severity: 'warning',
    });
  } else if (line.trim()) {
    // Non-blank, non-field text before any field — will be silently ignored
    warnings.push({
      file,
      line: lineNum,
      message: 'Text outside of a field:: definition will be ignored',
      suggestion: 'Place this text inside a field (e.g., content:: your text), or remove it',
      severity: 'warning',
    });
  }
}
```

Only warn once per section (use a `freeTextWarned` boolean, similar to `preHeaderWarned` in `parseSections`). Emit one warning on the first offending line, not one per line, to avoid noise.

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/parser/sections.test.ts`
Expected: All pass.

**Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All pass. Check golden-master fixture — if any existing fixtures have free text before fields, this will produce new warnings that may affect the golden-master expected output. Update golden fixtures if needed.

---

## Task 2: Warn when free text appears before first `field::` in module Page subsections (Finding #2)

This is the same issue as Task 1 but in a different parser: `module.ts` `collectRawSubsections()`. When `current` is set (inside a `## Text` or `## Chat` subsection) but `currentFieldName` is null, non-field lines are silently dropped.

**Files:**
- Test: `src/parser/module.test.ts`
- Modify: `src/parser/module.ts`

**Step 1: Write the failing test**

Add to `src/parser/module.test.ts` inside `describe('parsePageSegments')` (or create it if needed):

```typescript
describe('parsePageSegments', () => {
  it('warns when free text appears before first field in Text subsection', () => {
    const body = `## Text
Here is some introductory text I wanted to add.
content:: The actual content
`;

    const result = parsePageSegments(body, 'modules/test.md', 10);

    // Should warn about the free text line
    expect(result.errors.some(e =>
      e.severity === 'warning' &&
      e.message.includes('ignored')
    )).toBe(true);
    // But should still parse the content:: field
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].type).toBe('text');
  });

  it('warns when free text appears before first field in Chat subsection', () => {
    const body = `## Chat
Please discuss the following topics.
instructions:: Discuss AI safety concepts
`;

    const result = parsePageSegments(body, 'modules/test.md', 10);

    expect(result.errors.some(e =>
      e.severity === 'warning' &&
      e.message.includes('ignored')
    )).toBe(true);
  });

  it('does not warn for blank lines before first field', () => {
    const body = `## Text

content:: The actual content
`;

    const result = parsePageSegments(body, 'modules/test.md', 10);

    expect(result.errors.filter(e =>
      e.message.includes('ignored')
    )).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/parser/module.test.ts`
Expected: First two tests fail — no warning about "ignored" text.

**Step 3: Write minimal implementation**

In `module.ts` `collectRawSubsections()`, add a warnings array and an `else` branch at line ~82-85 where currently non-field lines are silently dropped when `currentFieldName` is null:

The function currently returns `{ subsections, unknownHeaders }`. Change it to also return `warnings: ContentError[]`.

In the `for` loop, after `else if (currentFieldName)` (line 82), add:

```typescript
} else if (line.trim()) {
  // Non-blank text before any field — will be ignored
  warnings.push({
    file: '', // Will be filled in by caller
    line: lineNum,
    message: 'Text outside of a field:: definition will be ignored',
    suggestion: 'Place this text inside a field (e.g., content:: your text), or remove it',
    severity: 'warning' as const,
  });
}
```

Use a `freeTextWarned` boolean to only warn once per subsection to avoid noise.

Update `parsePageSegments()` to consume and forward the new warnings. The `file` parameter can be passed through.

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/parser/module.test.ts`
Expected: All pass.

**Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All pass.

---

## Task 3: Warn when content appears between `###` section header and first `####` segment in lens files (Finding #1)

In `lens.ts` `parseSegments()`, lines before the first `####` header fall through silently when `currentSegment` is null. This is the same pattern as Tasks 1 and 2 but at the segment level.

**Files:**
- Test: `src/parser/lens.test.ts`
- Modify: `src/parser/lens.ts`

**Step 1: Write the failing test**

Add to `src/parser/lens.test.ts`:

```typescript
it('warns about free text between section header and first segment', () => {
  const content = `---
id: 550e8400-e29b-41d4-a716-446655440002
---

### Page: Introduction
This text appears before any #### segment header.
It should not be silently ignored.

#### Text
content:: Actual segment content here.
`;

  const result = parseLens(content, 'Lenses/lens1.md');

  expect(result.errors.some(e =>
    e.severity === 'warning' &&
    e.message.includes('ignored')
  )).toBe(true);
  // Content should still be parsed correctly
  expect(result.lens?.sections[0].segments).toHaveLength(1);
});

it('does not warn about blank lines between section header and first segment', () => {
  const content = `---
id: 550e8400-e29b-41d4-a716-446655440002
---

### Page: Introduction

#### Text
content:: Actual segment content here.
`;

  const result = parseLens(content, 'Lenses/lens1.md');

  expect(result.errors.filter(e =>
    e.message.includes('ignored')
  )).toHaveLength(0);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/parser/lens.test.ts`
Expected: First test fails — no warning about "ignored" text.

**Step 3: Write minimal implementation**

In `lens.ts` `parseSegments()`, add an `else` branch after `else if (currentSegment)` (line 139), for when `currentSegment` is null and the line is not a header:

```typescript
} else if (currentSegment) {
  // ... existing code ...
  currentFieldLines.push(line);
} else if (line.trim()) {
  // Non-blank text before first #### segment — will be ignored
  if (!preSegmentWarned) {
    preSegmentWarned = true;
    errors.push({
      file,
      line: lineNum,
      message: 'Text before first segment header (####) will be ignored',
      suggestion: 'Move this text into a segment (e.g., #### Text with content:: field), or remove it',
      severity: 'warning',
    });
  }
}
```

Add `let preSegmentWarned = false;` at the top of the function. Only warn once per section to avoid noise. Skip lines that are fields (they are handled by `parseSections` at the `###` level — `source::` for example is parsed as a section-level field).

Important: Lines matching `FIELD_PATTERN` (like `source:: ...`) are already parsed by the section-level `parseFields` in `sections.ts`, NOT by `parseSegments`. So `parseSegments` receives the raw body which still contains them. We should NOT warn for field-like lines — only for non-field, non-blank text. Check with `!line.match(FIELD_PATTERN)`.

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/parser/lens.test.ts`
Expected: All pass.

**Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All pass. Carefully check existing lens tests — some fixtures may have `source::` lines in the section body before segments. Those should NOT trigger a warning.

---

## Task 4: Warn when files are in unrecognized directories with near-miss names (Finding #6)

In `index.ts` `processContent()`, files that don't match any routing condition are silently skipped. The most dangerous cases are near-miss directory names like `Module/` instead of `modules/`.

**Files:**
- Test: `src/validator/standalone.test.ts`
- Modify: `src/index.ts`

**Step 1: Write the failing test**

Add to `src/validator/standalone.test.ts`:

```typescript
describe('unrecognized file warnings', () => {
  it('warns about files in near-miss directories', () => {
    const files = new Map([
      ['Module/intro.md', `---
slug: intro
title: Introduction
---
# Page: Intro
`],
    ]);

    const result = processContent(files);

    expect(result.errors.some(e =>
      e.severity === 'warning' &&
      e.file === 'Module/intro.md' &&
      e.message.includes('not recognized')
    )).toBe(true);
  });

  it('suggests correct directory for near-miss names', () => {
    const files = new Map([
      ['course/my-course.md', `---
slug: my-course
title: My Course
---
`],
    ]);

    const result = processContent(files);

    expect(result.errors.some(e =>
      e.file === 'course/my-course.md' &&
      e.suggestion?.includes('courses/')
    )).toBe(true);
  });

  it('does not warn about known non-content files', () => {
    // Files like .timestamps.json are already handled — but things like
    // Templates/, docs/, .obsidian/ should be silently skipped (intentional non-content)
    const files = new Map([
      ['modules/valid.md', `---
slug: valid
title: Valid
---
# Page: Test
## Text
content:: Hello
`],
    ]);

    const result = processContent(files);

    // No unrecognized-file warnings for files that ARE routed
    expect(result.errors.filter(e =>
      e.message.includes('not recognized')
    )).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/validator/standalone.test.ts`
Expected: First two tests fail — no warning about "not recognized".

**Step 3: Write minimal implementation**

At the end of the `if/else if` chain in `processContent()` (after the last `else if` for video_transcripts), add an `else` branch:

```typescript
} else {
  // File didn't match any known directory pattern
  const dir = path.split('/')[0];
  const KNOWN_DIRS: Record<string, string> = {
    'module': 'modules/',
    'course': 'courses/',
    'article': 'articles/',
    'lens': 'Lenses/',
    'lense': 'Lenses/',
    'video_transcript': 'video_transcripts/',
    'learning outcome': 'Learning Outcomes/',
    'learningoutcome': 'Learning Outcomes/',
    'learningoutcomes': 'Learning Outcomes/',
  };
  const suggestion = KNOWN_DIRS[dir.toLowerCase()];
  if (suggestion) {
    errors.push({
      file: path,
      message: `File in directory '${dir}/' not recognized as content`,
      suggestion: `Did you mean '${suggestion}'?`,
      severity: 'warning',
    });
  }
}
```

This approach only warns for near-miss directory names. Intentionally non-content directories (Templates/, docs/, .obsidian/) are silently skipped — that's correct behavior.

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/validator/standalone.test.ts`
Expected: All pass.

**Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All pass.

---

## Task 5: Fix boolean field case sensitivity mismatch (Finding #13)

`validateFieldValues` in `field-values.ts` lowercases for comparison (`value.toLowerCase()`), so `True` and `TRUE` pass validation. But the parsers in `lens.ts` (line 281) and `module.ts` (line 153) use strict `=== 'true'`, so capitalized values silently evaluate to `undefined`/false.

The fix: lowercase the field value when comparing in the parsers.

**Files:**
- Test: `src/parser/lens.test.ts` and `src/parser/module.test.ts`
- Modify: `src/parser/lens.ts` and `src/parser/module.ts`

**Step 1: Write the failing tests**

Add to `src/parser/lens.test.ts`:

```typescript
it('handles capitalized boolean values in chat segment', () => {
  const content = `---
id: 550e8400-e29b-41d4-a716-446655440002
---

### Page: Introduction

#### Chat
instructions:: Discuss the key concepts.
hidePreviousContentFromUser:: True
`;

  const result = parseLens(content, 'Lenses/lens1.md');

  const chatSeg = result.lens?.sections[0].segments[0];
  expect(chatSeg?.type).toBe('chat');
  // 'True' should be treated the same as 'true'
  expect((chatSeg as any).hidePreviousContentFromUser).toBe(true);
});
```

Add to `src/parser/module.test.ts`:

```typescript
it('handles capitalized boolean values in chat subsection', () => {
  const body = `## Chat
instructions:: Discuss the key concepts.
hidePreviousContentFromUser:: True
`;

  const result = parsePageSegments(body, 'modules/test.md', 10);

  const chatSeg = result.segments.find(s => s.type === 'chat');
  expect(chatSeg).toBeDefined();
  // 'True' should be treated the same as 'true'
  expect((chatSeg as any).hidePreviousContentFromUser).toBe(true);
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/parser/lens.test.ts src/parser/module.test.ts`
Expected: Both new tests fail — `hidePreviousContentFromUser` is `undefined` instead of `true`.

**Step 3: Write minimal implementation**

In `lens.ts` `convertSegment()` case `'chat'` (lines 281-283), change:

```typescript
// Before (strict case):
hidePreviousContentFromUser: raw.fields.hidePreviousContentFromUser === 'true' ? true : undefined,
hidePreviousContentFromTutor: raw.fields.hidePreviousContentFromTutor === 'true' ? true : undefined,
optional: raw.fields.optional === 'true' ? true : undefined,

// After (case-insensitive):
hidePreviousContentFromUser: raw.fields.hidePreviousContentFromUser?.toLowerCase() === 'true' ? true : undefined,
hidePreviousContentFromTutor: raw.fields.hidePreviousContentFromTutor?.toLowerCase() === 'true' ? true : undefined,
optional: raw.fields.optional?.toLowerCase() === 'true' ? true : undefined,
```

Apply the same fix to ALL `=== 'true'` comparisons in `lens.ts` (for text, article-excerpt, video-excerpt segments too) and in `module.ts` `convertSubsections()` (lines 153-154).

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/parser/lens.test.ts src/parser/module.test.ts`
Expected: All pass.

**Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All pass.

---

## Final Verification

```bash
cd /home/penguin/code/lens-platform/ws1/content_processor && npx vitest run
```

All tests must pass. Review golden-master output if tasks 1-3 produce new warnings for existing fixtures.
