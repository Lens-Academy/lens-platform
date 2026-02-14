# WIP Pass-Through Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the flattener include WIP content in the output even when a tier violation occurs, while still reporting the tier violation as an error.

**Architecture:** At 5 locations in the flattener, tier violations currently cause early returns that drop content. We remove those early returns so processing continues. The `validator-ignore` skip behavior is unchanged. Existing tests that check for tier violation errors still pass; new tests verify that content is present alongside those errors.

**Tech Stack:** TypeScript, Vitest

---

## Context

**File to modify:** `content_processor/src/flattener/index.ts`
**Test file to modify:** `content_processor/src/validator/standalone.test.ts`

The flattener has 5 tier violation checkpoints. Each follows this pattern:

```typescript
if (violation) {
    errors.push(violation);
    return { sections: [], errors };  // or: continue; or: return { segment: null, errors };
}
```

We change each to:

```typescript
if (violation) {
    errors.push(violation);
    // Do NOT return/continue — let content processing proceed
}
```

The `if (childTier === 'ignored')` blocks that follow each violation check remain unchanged — ignored content is still skipped.

---

### Task 1: Write failing tests for WIP pass-through in module→LO chain

**Files:**
- Modify: `content_processor/src/validator/standalone.test.ts`

**Step 1: Write the failing test**

Add this test inside the `'tier violations: module → LO'` describe block (after the existing tests, around line 612):

```typescript
    it('includes WIP content in output even when tier violation is reported', () => {
      const files = new Map([
        ['modules/prod-mod-passthrough.md', `---
slug: prod-mod-passthrough
title: Production Module
---
# Learning Outcome: WIP LO
source:: [[../Learning Outcomes/wip-lo-passthrough.md|WIP LO]]
`],
        ['Learning Outcomes/wip-lo-passthrough.md', `---
id: 550e8400-e29b-41d4-a716-446655440060
tags: [wip]
---
## Lens: Test Lens
source:: [[../Lenses/passthrough-lens.md]]
`],
        ['Lenses/passthrough-lens.md', `---
id: 550e8400-e29b-41d4-a716-446655440061
---
### Page: Intro
#### Text
content:: Hello from WIP content
`],
      ]);

      const result = processContent(files);

      // Tier violation error IS reported
      const tierError = result.errors.find(e =>
        e.file === 'modules/prod-mod-passthrough.md' &&
        e.message.includes('WIP')
      );
      expect(tierError).toBeDefined();
      expect(tierError?.category).toBe('production');

      // But content IS still present in output
      const mod = result.modules.find(m => m.slug === 'prod-mod-passthrough');
      expect(mod).toBeDefined();
      expect(mod!.sections.length).toBeGreaterThan(0);
      expect(mod!.sections.some(s =>
        s.segments.some(seg => seg.type === 'text' && seg.content.includes('Hello from WIP content'))
      )).toBe(true);
    });
```

**Step 2: Run test to verify it fails**

Run: `cd /home/penguin/code/lens-platform/ws2/content_processor && npx vitest run src/validator/standalone.test.ts -t 'includes WIP content in output even when tier violation is reported'`

Expected: FAIL — the module will have 0 sections because the flattener currently drops content on tier violation.

---

### Task 2: Write failing tests for WIP pass-through in Lens→Article and Lens→Video

**Files:**
- Modify: `content_processor/src/validator/standalone.test.ts`

**Step 1: Write the failing tests**

Add these two tests inside the `'tier violations: Lens → Article/Video'` describe block (after the existing tests, around line 845):

```typescript
    it('includes WIP article content in output even when tier violation is reported', () => {
      const files = new Map([
        ['modules/prod-lens-article-passthrough.md', `---
slug: prod-lens-article-passthrough
title: Prod Module With Lens Article
---
# Learning Outcome: Test LO
source:: [[../Learning Outcomes/lo-article-passthrough.md|Test LO]]
`],
        ['Learning Outcomes/lo-article-passthrough.md', `---
id: 550e8400-e29b-41d4-a716-446655440070
---
## Lens: Test Lens
source:: [[../Lenses/lens-article-passthrough.md]]
`],
        ['Lenses/lens-article-passthrough.md', `---
id: 550e8400-e29b-41d4-a716-446655440071
---
### Article: WIP Article
source:: [[../articles/wip-article-passthrough.md]]
from:: anchor-start
to:: anchor-end
`],
        ['articles/wip-article-passthrough.md', `---
source_url: https://example.com/article
tags: [wip]
---
<!--anchor-start-->
This is WIP article content between anchors.
<!--anchor-end-->
`],
      ]);

      const result = processContent(files);

      // Tier violation error IS reported
      const tierError = result.errors.find(e =>
        e.message.includes('WIP') && e.message.includes('article')
      );
      expect(tierError).toBeDefined();

      // But article excerpt content IS present in output
      const mod = result.modules.find(m => m.slug === 'prod-lens-article-passthrough');
      expect(mod).toBeDefined();
      expect(mod!.sections.length).toBeGreaterThan(0);
      expect(mod!.sections.some(s =>
        s.segments.some(seg => seg.type === 'article-excerpt')
      )).toBe(true);
    });

    it('includes WIP video content in output even when tier violation is reported', () => {
      const files = new Map([
        ['modules/prod-lens-video-passthrough.md', `---
slug: prod-lens-video-passthrough
title: Prod Module With Lens Video
---
# Learning Outcome: Test LO
source:: [[../Learning Outcomes/lo-video-passthrough.md|Test LO]]
`],
        ['Learning Outcomes/lo-video-passthrough.md', `---
id: 550e8400-e29b-41d4-a716-446655440080
---
## Lens: Test Lens
source:: [[../Lenses/lens-video-passthrough.md]]
`],
        ['Lenses/lens-video-passthrough.md', `---
id: 550e8400-e29b-41d4-a716-446655440081
---
### Video: WIP Video
source:: [[../video_transcripts/wip-video-passthrough.md]]
from:: 0:00
to:: 0:10
`],
        ['video_transcripts/wip-video-passthrough.md', `---
url: https://youtube.com/watch?v=test123
tags: [wip]
---
0:00 This is WIP video transcript content.
0:05 More WIP content here.
0:10 End of excerpt.
`],
        ['video_transcripts/wip-video-passthrough.timestamps.json', JSON.stringify([
          { start: 0.0, end: 5.0, text: "This is WIP video transcript content." },
          { start: 5.0, end: 10.0, text: "More WIP content here." },
          { start: 10.0, end: 15.0, text: "End of excerpt." },
        ])],
      ]);

      const result = processContent(files);

      // Tier violation error IS reported
      const tierError = result.errors.find(e =>
        e.message.includes('WIP') && e.message.includes('video')
      );
      expect(tierError).toBeDefined();

      // But video excerpt content IS present in output
      const mod = result.modules.find(m => m.slug === 'prod-lens-video-passthrough');
      expect(mod).toBeDefined();
      expect(mod!.sections.length).toBeGreaterThan(0);
      expect(mod!.sections.some(s =>
        s.segments.some(seg => seg.type === 'video-excerpt')
      )).toBe(true);
    });
```

**Step 2: Run tests to verify they fail**

Run: `cd /home/penguin/code/lens-platform/ws2/content_processor && npx vitest run src/validator/standalone.test.ts -t 'includes WIP'`

Expected: FAIL — both tests should fail because article-excerpt and video-excerpt segments are null'd out by tier violations.

---

### Task 3: Remove early return on tier violation at Module→LO (location 1)

**Files:**
- Modify: `content_processor/src/flattener/index.ts:246-249`

**Step 1: Change the tier violation handler**

At line 246-249, change:

```typescript
    if (violation) {
      errors.push(violation);
      return { sections: [], errors };
    }
```

To:

```typescript
    if (violation) {
      errors.push(violation);
    }
```

This removes the early return. The `if (childTier === 'ignored')` block on lines 250-253 remains unchanged.

**Step 2: Run the Task 1 test to verify it passes**

Run: `cd /home/penguin/code/lens-platform/ws2/content_processor && npx vitest run src/validator/standalone.test.ts -t 'includes WIP content in output even when tier violation is reported'`

Expected: PASS

**Step 3: Run the full existing tier violation tests to verify they still pass**

Run: `cd /home/penguin/code/lens-platform/ws2/content_processor && npx vitest run src/validator/standalone.test.ts -t 'tier violations'`

Expected: All existing tier violation tests still PASS (they only check for error presence, not empty sections).

---

### Task 4: Remove continue on tier violation at LO→Lens (location 2) and Module→Lens (location 3)

**Files:**
- Modify: `content_processor/src/flattener/index.ts:302-304` and `497-499`

**Step 1: Change the LO→Lens tier violation handler**

At lines 302-304, change:

```typescript
      if (violation) {
        errors.push(violation);
        continue;
      }
```

To:

```typescript
      if (violation) {
        errors.push(violation);
      }
```

**Step 2: Change the Module→Lens tier violation handler**

At lines 497-499 (line numbers may have shifted by -1 after Task 3), change:

```typescript
      if (violation) {
        errors.push(violation);
        continue;
      }
```

To:

```typescript
      if (violation) {
        errors.push(violation);
      }
```

**Step 3: Run full tier violation tests**

Run: `cd /home/penguin/code/lens-platform/ws2/content_processor && npx vitest run src/validator/standalone.test.ts -t 'tier violations'`

Expected: All PASS.

---

### Task 5: Remove early return on tier violation at Lens→Article (location 4) and Lens→Video (location 5)

**Files:**
- Modify: `content_processor/src/flattener/index.ts:860-862` and `954-956` (approximate — line numbers shift after earlier edits)

**Step 1: Change the Lens→Article tier violation handler**

Find this block (search for `Check tier violation (Lens → Article)`):

```typescript
        if (violation) {
          errors.push(violation);
          return { segment: null, errors };
        }
```

Change to:

```typescript
        if (violation) {
          errors.push(violation);
        }
```

**Step 2: Change the Lens→Video tier violation handler**

Find this block (search for `Check tier violation (Lens → Video)`):

```typescript
        if (violation) {
          errors.push(violation);
          return { segment: null, errors };
        }
```

Change to:

```typescript
        if (violation) {
          errors.push(violation);
        }
```

**Step 3: Run the Task 2 tests to verify they pass**

Run: `cd /home/penguin/code/lens-platform/ws2/content_processor && npx vitest run src/validator/standalone.test.ts -t 'includes WIP'`

Expected: All 3 "includes WIP" tests PASS.

---

### Task 6: Run full test suite and type check

**Step 1: Type check**

Run: `cd /home/penguin/code/lens-platform/ws2/content_processor && npx tsc --noEmit`

Expected: Clean (no errors).

**Step 2: Run full content_processor test suite**

Run: `cd /home/penguin/code/lens-platform/ws2/content_processor && npm run test`

Expected: All tests pass. If any golden-master or fixture tests fail, the expected output files may need updating to include the previously-dropped WIP content — check the diff and update if the new output is correct.

---

### Task 7: Commit

**Step 1: Check status**

Run: `jj st`

**Step 2: Describe the change**

Run: `jj describe -m 'feat: include WIP content in flattened output alongside tier violation errors'`

**Step 3: Verify**

Run: `jj st`

Expected: Clean working copy, no conflicts.
