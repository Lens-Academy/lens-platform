# Slug/Filename Decoupling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure slugs only ever come from frontmatter, never derived from filenames. A content file can be named anything and the system uses only the frontmatter `slug` field.

**Architecture:** The TS course parser currently extracts a "slug" from the wikilink filename (e.g., `[[../modules/Cognitive Superpowers]]` → `"Cognitive Superpowers"`). This is wrong. Instead, the course parser should store the raw wikilink path, and `processContent` should resolve it to the module's actual frontmatter slug using the already-parsed modules. On the Python side, `ModuleRef` should hold `slug` (the real frontmatter slug) instead of `path` (a fake reconstructed path). The `_extract_slug_from_path` function should be deleted entirely.

**Tech Stack:** TypeScript (content_processor, vitest), Python (FastAPI, pytest)

**Also fixes:** The `module.ts` parser severity check (already fixed in parent change — Task 1 adds test coverage only).

---

## Overview of Changes

### TS side (content_processor/)
1. Add test coverage for module parser severity fix (already applied in parent) (`module.test.ts`)
2. Course parser stores `path` instead of `slug` (`course.ts`)
3. `processContent` resolves wikilink paths → frontmatter slugs (`index.ts`)
4. Update course parser tests (`course.test.ts`)

### Python side
5. Change `ModuleRef.path` → `ModuleRef.slug` (`flattened_types.py`)
6. Simplify `_convert_ts_course_to_parsed_course` (`github_fetcher.py`)
7. Delete `_extract_slug_from_path`, use `item.slug` directly (`course_loader.py`)
8. Update route to use `item.slug` (`courses.py`)
9. Update scheduler to use `item.slug` (`scheduler.py`)
10. Update all tests

---

## Task 1: Add test coverage for module parser severity check

The severity check fix (`errors.some(e => e.severity === 'error')` instead of `errors.length > 0`) was already applied in the parent change. This task just adds test coverage to prevent regression.

**Files:**
- Modify: `content_processor/src/parser/module.test.ts`

**Step 1: Write the test**

Add to `content_processor/src/parser/module.test.ts`:

```typescript
it('returns module when frontmatter has unrecognized fields (warnings only)', () => {
  const content = `---
slug: test-module
title: Test Module
some_unknown_field: hello
---

# Page: Welcome

## Text:
Hello world
`;

  const result = parseModule(content, 'modules/test.md');

  // Module should still be returned — unrecognized fields are warnings, not errors
  expect(result.module).not.toBeNull();
  expect(result.module?.slug).toBe('test-module');
  // Should have a warning about the unrecognized field
  expect(result.errors.some(e => e.severity === 'warning')).toBe(true);
  expect(result.errors.some(e => e.severity === 'error')).toBe(false);
});
```

**Step 2: Run test to verify it passes**

Run: `cd content_processor && npx vitest run src/parser/module.test.ts -t "returns module when frontmatter has unrecognized fields"`
Expected: PASS (the fix is already in place)

**Step 3: No separate commit** — this test will be included in the Task 4 commit with the other TS changes.

---

## Task 2: Course parser stores path, not slug

The course parser currently derives a "slug" from the wikilink filename via `extractSlugFromPath`. Instead, it should store the raw wikilink path and let `processContent` resolve the actual slug.

**Files:**
- Modify: `content_processor/src/parser/course.ts`
- Modify: `content_processor/src/index.ts` (ProgressionItem type)

**Step 1: Update ProgressionItem type**

In `content_processor/src/index.ts`, add `path` field:

```typescript
export interface ProgressionItem {
  type: 'module' | 'meeting';
  slug?: string;      // Frontmatter slug — set by processContent after resolving path
  path?: string;      // Raw wikilink path — set by course parser, removed by processContent
  number?: number;
  optional?: boolean;
}
```

**Step 2: Change course parser to store path**

In `content_processor/src/parser/course.ts`:

a) Delete `extractSlugFromPath` function (lines 19-25).

b) Change `parseModuleSection` return type and body:

```typescript
// BEFORE:
function parseModuleSection(
  section: ParsedSection,
  file: string
): { slug: string; optional: boolean } | { error: ContentError } {
  ...
  const slug = extractSlugFromPath(wikilink.path);
  ...
  return { slug, optional };
}

// AFTER:
function parseModuleSection(
  section: ParsedSection,
  file: string
): { path: string; optional: boolean } | { error: ContentError } {
  ...
  return { path: wikilink.path, optional };
}
```

c) Change progression building (line 143-147):

```typescript
// BEFORE:
progression.push({
  type: 'module',
  slug: result.slug,
  optional: result.optional,
});

// AFTER:
progression.push({
  type: 'module',
  path: result.path,
  optional: result.optional,
});
```

d) Remove the `basename` import (line 6) since `extractSlugFromPath` is gone.

**Step 3: Run course parser tests to see them fail**

Run: `cd content_processor && npx vitest run src/parser/course.test.ts`
Expected: FAIL — tests assert `.slug` which is now undefined.

**Step 4: Don't fix the tests yet** — Task 3 will add the resolution step in `processContent` and Task 4 will update the tests.

**Step 5: Commit (WIP)**

No commit yet — this is an intermediate state. Continue to Task 3.

---

## Task 3: processContent resolves wikilink paths to frontmatter slugs

After parsing all modules and courses, `processContent` has both:
- `slugToPath`: Map<frontmatter_slug, file_path> (line 220)
- Each course's progression with raw wikilink `path` fields

It should resolve each module's wikilink path to the actual file, then look up the frontmatter slug.

**Files:**
- Modify: `content_processor/src/index.ts` (processContent function, around line 268-275)

**Step 1: Track course source files during parsing**

In `processContent`, add a `courseSlugToFile` map at the top (near line 220, alongside `slugToPath`):

```typescript
const courseSlugToFile = new Map<string, string>();
```

Then in the course parsing block (around line 268-275), record the source file:

```typescript
} else if (path.startsWith('courses/')) {
  const result = parseCourse(content, path);

  if (result.course) {
    courses.push(result.course);
    courseSlugToFile.set(result.course.slug, path);  // NEW: track source file
  }

  errors.push(...result.errors);
}
```

**Step 2: Add resolution logic after the main parsing loop**

After the main `for (const [path, content] of files.entries())` loop ends (after line 368), add:

```typescript
// Resolve course module paths to frontmatter slugs.
// Course parser stores raw wikilink paths (e.g., "../modules/Cognitive Superpowers").
// We resolve these to actual files and look up the module's frontmatter slug.
const pathToSlug = new Map<string, string>();
for (const [slug, filePath] of slugToPath.entries()) {
  pathToSlug.set(filePath, slug);
}

for (const course of courses) {
  const courseFile = courseSlugToFile.get(course.slug) ?? 'courses/';

  for (const item of course.progression) {
    if (item.type === 'module' && item.path) {
      // Resolve wikilink path relative to the course file
      const resolved = resolveWikilinkPath(item.path, courseFile);
      const actualFile = findFileWithExtension(resolved, files);

      if (actualFile && pathToSlug.has(actualFile)) {
        item.slug = pathToSlug.get(actualFile)!;
      } else {
        // Try matching just the filename stem against module file stems
        // (handles cases like "modules/Cognitive Superpowers" where the
        // wikilink didn't include ../  prefix)
        const stem = item.path.split('/').pop() ?? item.path;
        let matched = false;
        for (const [filePath, slug] of pathToSlug.entries()) {
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
}
```

Note: `resolveWikilinkPath` and `findFileWithExtension` are already imported at the top of the file (line 102). Using the actual `courseFile` path for `resolveWikilinkPath` means `dirname()` returns the correct directory, and relative wikilinks like `../modules/Foo` resolve correctly. It also means error messages point to the actual course file, not a generic `courses/`.

**Step 2: Run all content processor tests**

Run: `cd content_processor && npx vitest run`
Expected: Course parser tests still fail (they check `.slug` on parse output). Other tests should pass.

**Step 3: Commit (WIP)**

No commit yet — continue to Task 4.

---

## Task 4: Update course parser tests

Now that the course parser stores `path` and `processContent` resolves to `slug`, the course parser tests need updating. The parser-level tests should check for `path`, and we need an integration-level test for the resolution.

**Files:**
- Modify: `content_processor/src/parser/course.test.ts`

**Step 1: Update parser tests to check path instead of slug**

```typescript
// In "parses course with module references" test:
// BEFORE:
expect(result.course?.progression[0].slug).toBe('intro');
expect(result.course?.progression[1].slug).toBe('advanced');
expect(result.course?.progression[3].slug).toBe('conclusion');

// AFTER:
expect(result.course?.progression[0].path).toBe('../modules/intro.md');
expect(result.course?.progression[0].slug).toBeUndefined();
expect(result.course?.progression[1].path).toBe('../modules/advanced.md');
expect(result.course?.progression[3].path).toBe('../modules/conclusion.md');
```

```typescript
// In "validates module references exist" test:
// BEFORE:
expect(result.course?.progression[0].slug).toBe('nonexistent');

// AFTER:
expect(result.course?.progression[0].path).toBe('../modules/nonexistent.md');
```

**Step 2: Add integration test for path→slug resolution in processContent**

Add a new test file `content_processor/src/parser/course-resolution.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { processContent } from '../index.js';

describe('course module path resolution', () => {
  it('resolves wikilink paths to frontmatter slugs', () => {
    const files = new Map<string, string>();

    // Module file — filename has spaces, slug is kebab-case
    files.set('modules/My Cool Module.md', `---
slug: my-cool-module
title: My Cool Module
id: 00000000-0000-0000-0000-000000000001
---

# Page: Welcome

## Text:
Hello
`);

    // Course references the module by filename
    files.set('courses/test.md', `---
slug: test-course
title: Test Course
---

# Module: [[../modules/My Cool Module]]

# Meeting: 1
`);

    const result = processContent(files);

    // Course should have resolved the path to the frontmatter slug
    expect(result.courses).toHaveLength(1);
    const course = result.courses[0];
    expect(course.progression[0].type).toBe('module');
    expect(course.progression[0].slug).toBe('my-cool-module');
    expect(course.progression[0].path).toBeUndefined(); // path should be cleaned up

    // Module should also be in modules list
    expect(result.modules).toHaveLength(1);
    expect(result.modules[0].slug).toBe('my-cool-module');
  });

  it('emits error when module reference cannot be resolved', () => {
    const files = new Map<string, string>();

    files.set('courses/test.md', `---
slug: test-course
title: Test Course
---

# Module: [[../modules/nonexistent]]

# Meeting: 1
`);

    const result = processContent(files);

    expect(result.errors.some(e =>
      e.severity === 'error' && e.message.includes('could not be resolved')
    )).toBe(true);
  });
});
```

**Step 3: Run all content processor tests**

Run: `cd content_processor && npx vitest run`
Expected: ALL PASS

**Step 4: Commit**

```
jj describe -m "fix: course parser uses wikilink path, processContent resolves to frontmatter slug

Course parser no longer derives slugs from filenames. It stores the raw
wikilink path, and processContent resolves it to the module's actual
frontmatter slug by matching against parsed module files. This decouples
filename from slug — a module file can be named anything as long as its
frontmatter slug is correct."
```

---

## Task 5: Change ModuleRef from path to slug

The Python `ModuleRef` dataclass stores `path: str` (a fake reconstructed path like `"modules/introduction"`). Since the TS side now sends the real frontmatter slug, `ModuleRef` should store `slug: str`.

**Files:**
- Modify: `core/modules/flattened_types.py:35-39`

**Step 1: Change the field**

```python
# BEFORE:
@dataclass
class ModuleRef:
    """Reference to a module in a course progression."""

    path: str  # Wiki-link path like "modules/introduction"
    optional: bool = False

# AFTER:
@dataclass
class ModuleRef:
    """Reference to a module in a course progression."""

    slug: str  # Module's frontmatter slug (e.g., "cognitive-superpowers")
    optional: bool = False
```

**Step 2: Run tests to see what breaks**

Run: `../.venv/bin/pytest core/modules/tests/test_courses.py core/content/tests/test_course_progression.py -x`
Expected: FAIL — everything constructs `ModuleRef(path=...)` which is now an invalid kwarg.

**Step 3: Don't fix yet** — Task 6+ will update callers.

---

## Task 6: Simplify _convert_ts_course_to_parsed_course

This function converts the TS output to Python dataclasses. Currently it wraps the slug back into a fake path. Now it should just pass the slug through.

**Files:**
- Modify: `core/content/github_fetcher.py:28-53`

**Step 1: Simplify the conversion**

```python
# BEFORE:
def _convert_ts_course_to_parsed_course(ts_course: dict) -> ParsedCourse:
    progression = []
    for item in ts_course.get("progression", []):
        if item.get("type") == "module":
            progression.append(
                ModuleRef(
                    path=f"modules/{item['slug']}",
                    optional=item.get("optional", False),
                )
            )
        elif item.get("type") == "meeting":
            progression.append(MeetingMarker(number=item["number"]))

    return ParsedCourse(
        slug=ts_course["slug"],
        title=ts_course["title"],
        progression=progression,
    )

# AFTER:
def _convert_ts_course_to_parsed_course(ts_course: dict) -> ParsedCourse:
    progression = []
    for item in ts_course.get("progression", []):
        if item.get("type") == "module":
            progression.append(
                ModuleRef(
                    slug=item["slug"],
                    optional=item.get("optional", False),
                )
            )
        elif item.get("type") == "meeting":
            progression.append(MeetingMarker(number=item["number"]))

    return ParsedCourse(
        slug=ts_course["slug"],
        title=ts_course["title"],
        progression=progression,
    )
```

**Step 2: No commit yet** — continue to Task 7.

---

## Task 7: Delete _extract_slug_from_path, use item.slug directly

`_extract_slug_from_path` is the function that parsed filenames into "slugs". It's no longer needed — `ModuleRef.slug` already has the real slug.

**Files:**
- Modify: `core/modules/course_loader.py`

**Step 1: Delete `_extract_slug_from_path` (lines 40-47 including the bandaid fix)**

**Step 2: Replace all usages with `item.slug`**

In `get_all_module_slugs` (line 51-55):
```python
# BEFORE:
return [
    _extract_slug_from_path(item.path)
    for item in course.progression
    if isinstance(item, ModuleRef)
]

# AFTER:
return [
    item.slug
    for item in course.progression
    if isinstance(item, ModuleRef)
]
```

In `get_next_module` (line 70-75):
```python
# BEFORE:
item_slug = _extract_slug_from_path(item.path)

# AFTER:
item_slug = item.slug
```

Same change at line 89-94 (next module slug lookup):
```python
# BEFORE:
next_slug = _extract_slug_from_path(next_item.path)

# AFTER:
next_slug = next_item.slug
```

In `get_due_by_meeting` (line 148-153):
```python
# BEFORE:
item_slug = _extract_slug_from_path(item.path)

# AFTER:
item_slug = item.slug
```

**Step 3: No commit yet** — continue to Task 8.

---

## Task 8: Update courses.py route

**Files:**
- Modify: `web_api/routes/courses.py`

**Step 1: Remove `_extract_slug_from_path` from import (line 14)**

```python
# BEFORE:
from core.modules.course_loader import (
    load_course,
    get_next_module,
    CourseNotFoundError,
    _extract_slug_from_path,
)

# AFTER:
from core.modules.course_loader import (
    load_course,
    get_next_module,
    CourseNotFoundError,
)
```

**Step 2: Replace usages (lines 137 and 180)**

```python
# BEFORE (line 137):
module_slug = _extract_slug_from_path(item.path)

# AFTER:
module_slug = item.slug
```

```python
# BEFORE (line 180):
module_slug = _extract_slug_from_path(item.path)

# AFTER:
module_slug = item.slug
```

---

## Task 9: Update scheduler.py

**Files:**
- Modify: `core/notifications/scheduler.py`

**Step 1: Remove `_extract_slug_from_path` from import (line 421)**

```python
# BEFORE:
from core.modules.course_loader import (
    load_course,
    get_required_modules,
    get_due_by_meeting,
    _extract_slug_from_path,
)

# AFTER:
from core.modules.course_loader import (
    load_course,
    get_required_modules,
    get_due_by_meeting,
)
```

**Step 2: Replace usage (line 464)**

```python
# BEFORE:
slug = _extract_slug_from_path(m.path)

# AFTER:
slug = m.slug
```

---

## Task 10: Update all Python tests

Every test that constructs `ModuleRef(path="modules/xxx")` must change to `ModuleRef(slug="xxx")`. Every test that uses `_extract_slug_from_path` must be updated or removed.

**Files:**
- Modify: `core/modules/tests/test_courses.py`
- Modify: `core/content/tests/test_course_progression.py`
- Modify: `core/notifications/tests/test_scheduler.py`
- Modify: `web_api/tests/conftest.py`
- Modify: `web_api/tests/test_courses_api.py`
- Modify: `web_api/tests/test_course_fallback.py`

### 10a: `core/modules/tests/test_courses.py`

Remove `_extract_slug_from_path` from import (line 21).

Change all `ModuleRef(path="modules/xxx")` to `ModuleRef(slug="xxx")`:
- Lines 104, 105, 107, 109 → `ModuleRef(slug="module-a")`, etc.
- Lines 217, 218, 220 → `ModuleRef(slug="module-1")`, etc.
- Lines 236, 237, 239, 240 → same pattern
- Lines 255, 256, 258 → same
- Lines 273, 275 → same
- Line 288 → same

Delete `test_extract_slug_from_path` test (lines 204-208).

Change assertions that use `_extract_slug_from_path(modules[0].path)`:
- Lines 225-227 → `assert modules[0].slug == "module-1"`, etc.
- Lines 245-246 → `assert required[0].slug == "module-1"`, etc.
- Line 309 → `assert module_refs[0].slug == "module-a"`

### 10b: `core/content/tests/test_course_progression.py`

Change assertions from `.path` to `.slug`:
- Line 46: `assert course.progression[0].slug == "introduction"` (was `.path == "modules/introduction"`)
- Line 57: `assert course.progression[2].slug == "feedback-loops"` (was `.path == "modules/feedback-loops"`)

### 10c: `core/notifications/tests/test_scheduler.py`

Change `ModuleRef(path="modules/xxx")` to `ModuleRef(slug="xxx")`:
- Lines 1004, 1005, 1007, 1009

### 10d: `web_api/tests/conftest.py`

Change `ModuleRef(path="modules/xxx")` to `ModuleRef(slug="xxx")`:
- Lines 155, 156, 158, 159, 161

### 10e: `web_api/tests/test_courses_api.py`

Remove `_extract_slug_from_path` from import (line 18).

Change helper functions to use `.slug` instead of `_extract_slug_from_path(item.path)`:
- Line 34: `return item.slug`
- Line 45: `return item.slug`
- Line 54: `return item.slug`

### 10f: `web_api/tests/test_course_fallback.py`

Change `ModuleRef(path="modules/intro")` to `ModuleRef(slug="intro")`:
- Line 39

---

## Task 11: Run all tests and verify

**Step 1: Run TS content processor tests**

Run: `cd content_processor && npx vitest run`
Expected: ALL PASS

**Step 2: Run Python tests**

Run: `../.venv/bin/pytest core/modules/tests/test_courses.py core/content/tests/test_course_progression.py core/notifications/tests/test_scheduler.py web_api/tests/test_courses_api.py web_api/tests/test_course_fallback.py -v`
Expected: ALL PASS

**Step 3: Run full test suite**

Run: `../.venv/bin/pytest`
Expected: ALL PASS

**Step 4: Commit everything**

```
jj describe -m "fix: decouple module slug from filename throughout the stack

Course module references used filename-derived slugs instead of frontmatter
slugs, causing lookup failures when filename != slug (e.g., 'Cognitive
Superpowers.md' with slug 'cognitive-superpowers').

Changes:
- course.ts: store raw wikilink path, not filename-derived slug
- index.ts processContent: resolve wikilink path → frontmatter slug via parsed modules
- ModuleRef: changed from path: str to slug: str (the real frontmatter slug)
- Deleted _extract_slug_from_path entirely
- github_fetcher: pass TS slug through directly instead of wrapping in fake path
- Added test for module parser severity check regression"
```

---

## Task 12: Manual smoke test

**Step 1:** Restart dev server and verify:
- `curl http://localhost:8200/api/modules` returns 9 modules
- `curl http://localhost:8200/api/courses/default/progress` returns Unit 4 with cognitive-superpowers
- Load `http://dev.vps:3200/course/default` in Chrome — Unit 4 visible
- Load `http://dev.vps:3200/module/cognitive-superpowers` in Chrome — module loads
