# Merge Conflict Resolution: Tier System + Course Wikilink Resolution

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Resolve the 3 merge conflicts in `content_processor/src/index.ts` so both the frontmatter-based tier system (side 2) and the course wikilink-to-slug resolution (side 1) coexist correctly.

**Architecture:** The merge commit `onrxwuno` has two parents that independently added course-slug-to-file-path maps with different names (`courseSlugToFile` vs `coursePathMap`) and different post-processing loops. We unify the variable name and concatenate both loops in the correct dependency order (path resolution first, then tier checking).

**Tech Stack:** TypeScript, Vitest

---

## Context

**File:** `content_processor/src/index.ts`

**Side 1** (parent `nwnwwvpt` — "z-index fix" branch): Added course wikilink path → frontmatter slug resolution. Introduces `filePathToSlug` and `courseSlugToFile` maps, plus a resolution loop with fallback stem matching.

**Side 2** (parent `ytqpvwvu` — "tier system" branch): Added `buildTierMap`, tier violation checking, and the `category` field on errors. Introduces `coursePathMap` and `tierMap` maps, plus a tier-checking loop for Course → Module references.

**Already auto-merged (non-conflicting):** The merged file already references both `tierMap` (lines 245, 250) and `filePathToSlug` (line 255) outside conflict markers, confirming both are needed. The function signature is already resolved to side 2's form (no `ProcessOptions`).

**Unified variable name:** Both `courseSlugToFile` (side 1) and `coursePathMap` (side 2) map `course.slug → file path`. We keep `courseSlugToFile` as the single name.

---

### Task 1: Resolve Conflict 1 — Variable Declarations

**Files:**
- Modify: `content_processor/src/index.ts:231-240`

**Step 1: Replace conflict 1 markers with merged declarations**

Replace lines 231–240 (the entire `<<<<<<< Conflict 1 of 3` block) with:

```typescript
  const filePathToSlug = new Map<string, string>();  // Reverse: file path → slug (survives duplicate slugs)
  const courseSlugToFile = new Map<string, string>();

  // Pre-scan: build tier map from frontmatter tags
  const tierMap = buildTierMap(files);
```

This keeps:
- `filePathToSlug` from side 1 (already used at line 255)
- `courseSlugToFile` from side 1 (unified name for both sides' course map)
- `tierMap` initialization from side 2 (already used at lines 245, 250)

**Step 2: Verify no syntax errors**

Run: `cd /home/penguin/code/lens-platform/ws2/content_processor && npx tsc --noEmit 2>&1 | head -20`

Expected: Still shows errors from remaining conflicts 2 and 3, but NOT from conflict 1 area.

---

### Task 2: Resolve Conflict 2 — Course Map Population

**Files:**
- Modify: `content_processor/src/index.ts:294-299` (line numbers will have shifted after task 1 — find by conflict marker)

**Step 1: Replace conflict 2 markers with unified variable name**

Replace the entire `<<<<<<< Conflict 2 of 3` block with:

```typescript
        courseSlugToFile.set(result.course.slug, path);
```

This uses the unified `courseSlugToFile` name (instead of side 2's `coursePathMap`).

---

### Task 3: Resolve Conflict 3 — Post-Processing Loops

**Files:**
- Modify: `content_processor/src/index.ts` (find by `<<<<<<< Conflict 3 of 3`)

**Step 1: Replace conflict 3 markers with both loops in correct order**

Replace the entire `<<<<<<< Conflict 3 of 3` block with:

```typescript
  // Resolve course module paths to frontmatter slugs.
  // Use filePathToSlug (built during module parsing) instead of inverting slugToPath,
  // because slugToPath loses entries when duplicate slugs exist.
  for (const course of courses) {
    const courseFile = courseSlugToFile.get(course.slug) ?? 'courses/';

    for (const item of course.progression) {
      if (item.type === 'module' && item.path) {
        // Resolve wikilink path relative to the course file
        const resolved = resolveWikilinkPath(item.path, courseFile);
        const actualFile = findFileWithExtension(resolved, files);

        if (actualFile && filePathToSlug.has(actualFile)) {
          item.slug = filePathToSlug.get(actualFile)!;
        } else {
          // Try matching just the filename stem against module file stems
          const stem = item.path.split('/').pop() ?? item.path;
          let matched = false;
          for (const [filePath, slug] of filePathToSlug.entries()) {
            const fileStem = filePath.replace(/\.md$/, '').split('/').pop() ?? '';
            if (fileStem === stem) {
              item.slug = slug;
              matched = true;
              break;
            }
          }

          if (!matched) {
            errors.push({
              file: courseFile,
              message: `Module reference could not be resolved: "${item.path}"`,
              suggestion: 'Check that the wikilink path points to an existing module file',
              severity: 'error',
            });
          }
        }

        // Clean up internal path field from output
        delete item.path;
      }
    }

    // Remove unresolved module items (no slug after resolution)
    course.progression = course.progression.filter(
      item => item.type !== 'module' || item.slug !== undefined
    );
  }

  // Check tier violations: Course → Module
  for (const course of courses) {
    const coursePath = courseSlugToFile.get(course.slug);
    if (!coursePath) continue;

    for (const item of course.progression) {
      if (item.type !== 'module' || !item.slug) continue;

      // Construct expected module path and find it in files
      const expectedModulePath = `modules/${item.slug}.md`;
      const modulePath = findFileWithExtension(expectedModulePath, files) ?? expectedModulePath;

      if (tierMap.has(modulePath)) {
        const parentTier = tierMap.get(coursePath) ?? 'production';
        const childTier = tierMap.get(modulePath) ?? 'production';
        const violation = checkTierViolation(coursePath, parentTier, modulePath, childTier, 'module');
        if (violation) {
          errors.push(violation);
        }
      }
    }
  }

```

Key ordering rationale: The path-resolution loop runs first because it populates `item.slug` from `item.path`. The tier-checking loop runs second because it reads `item.slug` to construct the module path for tier comparison.

Variable rename: `coursePathMap` → `courseSlugToFile` in the tier-checking loop.

---

### Task 4: Type Check

**Step 1: Run TypeScript compiler**

Run: `cd /home/penguin/code/lens-platform/ws2/content_processor && npx tsc --noEmit`

Expected: No errors (or only pre-existing errors unrelated to index.ts).

---

### Task 5: Run Tests

**Step 1: Run full test suite**

Run: `cd /home/penguin/code/lens-platform/ws2/content_processor && npm run test`

Expected: 392 tests passing (1 pre-existing failure in `cli.test.ts` is unrelated).

**Step 2: Verify no conflict markers remain**

Run: `grep -n '<<<<<<\|>>>>>>>\|%%%%%%%\|+++++++' /home/penguin/code/lens-platform/ws2/content_processor/src/index.ts`

Expected: No output (zero conflict markers).

---

### Task 6: Commit

**Step 1: Check jj status**

Run: `jj st`

**Step 2: Describe the merge**

Run: `jj describe -m 'merge: resolve conflict between tier system and course wikilink resolution'`

**Step 3: Verify clean status**

Run: `jj st`

Expected: No conflicts reported.
