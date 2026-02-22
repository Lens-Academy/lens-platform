# Chat-Text Precedence Validation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Validate that every `#### Chat` segment is immediately preceded by a `#### Text` segment, erroring otherwise.

**Architecture:** New validator function `validateChatPrecedence` in its own file (following the pattern of `segment-fields.ts`). Called from `parseLens` after segments are parsed for each section.

**Tech Stack:** TypeScript, Vitest

---

### Task 1: Write failing tests for chat precedence validation

**Files:**
- Create: `content_processor/src/validator/chat-precedence.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/validator/chat-precedence.test.ts
import { describe, it, expect } from 'vitest';
import { validateChatPrecedence } from './chat-precedence.js';

describe('validateChatPrecedence', () => {
  it('allows Chat immediately after Text', () => {
    const errors = validateChatPrecedence(
      [
        { type: 'text', line: 10 },
        { type: 'chat', line: 20 },
      ],
      'test.md'
    );

    expect(errors).toHaveLength(0);
  });

  it('errors when Chat is the first segment', () => {
    const errors = validateChatPrecedence(
      [{ type: 'chat', line: 10 }],
      'test.md'
    );

    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe('error');
    expect(errors[0].message).toContain('Chat');
    expect(errors[0].message).toContain('Text');
    expect(errors[0].line).toBe(10);
  });

  it('errors when Chat follows Article-excerpt', () => {
    const errors = validateChatPrecedence(
      [
        { type: 'text', line: 10 },
        { type: 'article-excerpt', line: 20 },
        { type: 'chat', line: 30 },
      ],
      'test.md'
    );

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('article-excerpt');
  });

  it('errors when Chat follows another Chat', () => {
    const errors = validateChatPrecedence(
      [
        { type: 'text', line: 10 },
        { type: 'chat', line: 20 },
        { type: 'chat', line: 30 },
      ],
      'test.md'
    );

    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(30);
  });

  it('reports multiple violations', () => {
    const errors = validateChatPrecedence(
      [
        { type: 'chat', line: 10 },
        { type: 'text', line: 20 },
        { type: 'video-excerpt', line: 30 },
        { type: 'chat', line: 40 },
      ],
      'test.md'
    );

    expect(errors).toHaveLength(2);
    expect(errors[0].line).toBe(10);
    expect(errors[1].line).toBe(40);
  });

  it('allows sections with no Chat segments', () => {
    const errors = validateChatPrecedence(
      [
        { type: 'text', line: 10 },
        { type: 'article-excerpt', line: 20 },
        { type: 'text', line: 30 },
      ],
      'test.md'
    );

    expect(errors).toHaveLength(0);
  });

  it('allows multiple Text-Chat pairs', () => {
    const errors = validateChatPrecedence(
      [
        { type: 'text', line: 10 },
        { type: 'chat', line: 20 },
        { type: 'text', line: 30 },
        { type: 'chat', line: 40 },
      ],
      'test.md'
    );

    expect(errors).toHaveLength(0);
  });

  it('includes file path in errors', () => {
    const errors = validateChatPrecedence(
      [{ type: 'chat', line: 5 }],
      'Lenses/my-lens.md'
    );

    expect(errors[0].file).toBe('Lenses/my-lens.md');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd content_processor && npx vitest run src/validator/chat-precedence.test.ts`
Expected: FAIL — module `./chat-precedence.js` not found

---

### Task 2: Implement validateChatPrecedence

**Files:**
- Create: `content_processor/src/validator/chat-precedence.ts`

**Step 1: Write minimal implementation**

```typescript
// src/validator/chat-precedence.ts
import type { ContentError } from '../index.js';

/**
 * Validate that every Chat segment is immediately preceded by a Text segment.
 * Students need instructions (Text) before every interactive discussion (Chat).
 */
export function validateChatPrecedence(
  segments: { type: string; line: number }[],
  file: string,
): ContentError[] {
  const errors: ContentError[] = [];

  for (let i = 0; i < segments.length; i++) {
    if (segments[i].type !== 'chat') continue;

    const prev = segments[i - 1];

    if (!prev) {
      errors.push({
        file,
        line: segments[i].line,
        message: "'#### Chat' must be immediately preceded by a '#### Text' segment, but it is the first segment in the section",
        severity: 'error',
      });
    } else if (prev.type !== 'text') {
      errors.push({
        file,
        line: segments[i].line,
        message: `'#### Chat' must be immediately preceded by a '#### Text' segment, but found '#### ${prev.type}' instead`,
        severity: 'error',
      });
    }
  }

  return errors;
}
```

**Step 2: Run tests to verify they pass**

Run: `cd content_processor && npx vitest run src/validator/chat-precedence.test.ts`
Expected: PASS — all 8 tests green

**Step 3: Commit**

`jj desc -m "Add validateChatPrecedence validator" && jj new`

---

### Task 3: Wire validator into parseLens

**Files:**
- Modify: `content_processor/src/parser/lens.ts` — add import and call

**Step 1: Write failing integration test**

There's no separate integration test file needed — the existing `lens.test.ts` tests `parseLens` end-to-end. Add a test there.

Check existing patterns in `lens.test.ts` first, then add:

```typescript
it('errors when Chat is not preceded by Text', () => {
  const content = `---
id: a1b2c3d4-e5f6-7890-abcd-ef1234567890
---

### Page: Test

#### Chat
instructions::
Discuss something.
`;
  const { errors } = parseLens(content, 'test.md');
  const chatError = errors.find(e => e.message.includes("'#### Chat' must be immediately preceded"));
  expect(chatError).toBeDefined();
  expect(chatError!.severity).toBe('error');
});
```

Run: `cd content_processor && npx vitest run src/parser/lens.test.ts -t "errors when Chat is not preceded by Text"`
Expected: FAIL — no such error produced yet

**Step 2: Add import and call in lens.ts**

In `lens.ts`, add import at top:
```typescript
import { validateChatPrecedence } from '../validator/chat-precedence.js';
```

After the segment conversion loop (after line 560, before the "Warn if section has no segments" check), add:
```typescript
    // Validate Chat segments are preceded by Text segments
    const chatErrors = validateChatPrecedence(rawSegments, file);
    errors.push(...chatErrors);
```

**Step 3: Run integration test to verify it passes**

Run: `cd content_processor && npx vitest run src/parser/lens.test.ts -t "errors when Chat is not preceded by Text"`
Expected: PASS

**Step 4: Run full test suite**

Run: `cd content_processor && npx vitest run`
Expected: All tests pass (check no existing fixtures violate the new rule)

**Step 5: Commit**

`jj desc -m "Wire chat precedence validation into parseLens" && jj new`
