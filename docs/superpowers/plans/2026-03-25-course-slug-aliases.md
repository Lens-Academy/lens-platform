# Course Slug Aliases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow courses to define slug aliases so old URLs still work after a slug rename, with client-side redirects to the canonical slug.

**Architecture:** Aliases are defined in course YAML frontmatter, parsed by the TypeScript content processor, stored in a separate lookup map on the Python cache, and resolved transparently by `load_course()`. Frontend components detect alias usage by comparing the URL slug against the canonical slug from the API response.

**Tech Stack:** TypeScript (content processor, vitest), Python (FastAPI, pytest), React (Vike framework)

**Spec:** `docs/superpowers/specs/2026-03-25-course-slug-aliases-design.md`

---

### Task 1: Add `slug-aliases` to TS content schema and Course interface

**Files:**
- Modify: `content_processor/src/content-schema.ts:33`
- Modify: `content_processor/src/index.ts:26-31`

- [ ] **Step 1: Add `slug-aliases` to course optional fields**

In `content_processor/src/content-schema.ts`, change line 33:

```ts
'course': contentSchema(['slug', 'title'], ['id', 'slug-aliases', 'tags']),
```

- [ ] **Step 2: Add `slugAliases` to `Course` interface**

In `content_processor/src/index.ts`, add `slugAliases` to the `Course` interface (after `title`):

```ts
export interface Course {
  slug: string;
  title: string;
  slugAliases?: string[];
  progression: ProgressionItem[];
  error?: string;
}
```

- [ ] **Step 3: Commit**

```bash
jj commit -m "feat: add slug-aliases to course content schema and Course interface"
```

---

### Task 2: Parse `slug-aliases` in course parser

**Files:**
- Modify: `content_processor/src/parser/course.ts:81-162`
- Test: `content_processor/src/parser/course.test.ts`

- [ ] **Step 1: Write failing tests for slug-aliases parsing**

Append to `content_processor/src/parser/course.test.ts`:

```ts
it('parses slug-aliases as string', () => {
  const content = `---
slug: navigating-asi
title: Navigating ASI
slug-aliases: default
---

# Module: [[../modules/intro.md|Introduction]]
`;

  const result = parseCourse(content, 'courses/nav.md');
  expect(result.course?.slugAliases).toEqual(['default']);
});

it('parses slug-aliases as comma-separated string', () => {
  const content = `---
slug: navigating-asi
title: Navigating ASI
slug-aliases: default, old-name
---

# Module: [[../modules/intro.md|Introduction]]
`;

  const result = parseCourse(content, 'courses/nav.md');
  expect(result.course?.slugAliases).toEqual(['default', 'old-name']);
});

it('parses slug-aliases as YAML list', () => {
  const content = `---
slug: navigating-asi
title: Navigating ASI
slug-aliases:
  - default
  - old-name
---

# Module: [[../modules/intro.md|Introduction]]
`;

  const result = parseCourse(content, 'courses/nav.md');
  expect(result.course?.slugAliases).toEqual(['default', 'old-name']);
});

it('returns empty slugAliases when not specified', () => {
  const content = `---
slug: my-course
title: My Course
---

# Module: [[../modules/intro.md|Introduction]]
`;

  const result = parseCourse(content, 'courses/test.md');
  expect(result.course?.slugAliases).toEqual([]);
});

it('validates slug-alias format', () => {
  const content = `---
slug: my-course
title: My Course
slug-aliases: Bad Alias!
---

# Module: [[../modules/intro.md|Introduction]]
`;

  const result = parseCourse(content, 'courses/test.md');
  expect(result.errors.some(e =>
    e.severity === 'error' && e.message.includes('slug') && e.message.includes('format')
  )).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd content_processor && npx vitest run src/parser/course.test.ts
```

Expected: FAIL — `slugAliases` is not set on the returned course.

- [ ] **Step 3: Implement slug-aliases parsing in course parser**

In `content_processor/src/parser/course.ts`, add a helper function before `parseCourse`:

```ts
/**
 * Normalize slug-aliases from frontmatter.
 * Accepts: string ("default"), comma-separated ("a, b"), or YAML list (["a", "b"]).
 */
function parseSlugAliases(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map(a => String(a).trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw.split(',').map(a => a.trim()).filter(Boolean);
  }
  return [];
}
```

At the end of `parseCourse`, after building the `progression` array and before the `return`, add alias parsing and validation:

```ts
const slugAliases = parseSlugAliases(frontmatter['slug-aliases']);

// Validate each alias format
for (const alias of slugAliases) {
  const aliasError = validateSlugFormat(alias, file, 2);
  if (aliasError) {
    aliasError.message = aliasError.message.replace('slug format', 'slug-alias format');
    errors.push(aliasError);
  }
}

const course: Course = {
  slug: frontmatter.slug as string,
  title: frontmatter.title as string,
  slugAliases: slugAliases.length > 0 ? slugAliases : [],
  progression,
};
```

Note: Update the existing `course` object construction — don't create a second one.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd content_processor && npx vitest run src/parser/course.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
jj commit -m "feat: parse slug-aliases in course frontmatter"
```

---

### Task 3: Add alias collision validation in `processContent`

**Files:**
- Modify: `content_processor/src/index.ts:516-536`
- Test: `content_processor/src/parser/course-resolution.test.ts` (or new test file)

- [ ] **Step 1: Write failing tests for alias collision detection**

Create test file `content_processor/src/validator/course-alias-collisions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { processContent } from '../index.js';

describe('course slug alias collision detection', () => {
  const makeLens = (id: string) => `---
id: ${id}
---

# Lens: Test Lens
## Text
content`;

  const makeModule = (slug: string, lensPath: string) => `---
slug: ${slug}
title: ${slug}
---

# Lens: Test
source:: [[${lensPath}]]`;

  it('errors when alias collides with another course primary slug', () => {
    const files = new Map([
      ['courses/a.md', `---
slug: course-a
title: Course A
slug-aliases: course-b
---

# Module: [[../modules/mod-a.md|Mod A]]
`],
      ['courses/b.md', `---
slug: course-b
title: Course B
---

# Module: [[../modules/mod-b.md|Mod B]]
`],
      ['modules/mod-a.md', makeModule('mod-a', '../Lenses/lens-a.md')],
      ['modules/mod-b.md', makeModule('mod-b', '../Lenses/lens-b.md')],
      ['Lenses/lens-a.md', makeLens('00000000-0000-0000-0000-000000000001')],
      ['Lenses/lens-b.md', makeLens('00000000-0000-0000-0000-000000000002')],
    ]);

    const result = processContent(files);
    const aliasErrors = result.errors.filter(e =>
      e.message.includes('alias') && e.message.includes('course-b')
    );
    expect(aliasErrors.length).toBeGreaterThan(0);
    expect(aliasErrors[0].severity).toBe('error');
  });

  it('errors when two courses share the same alias', () => {
    const files = new Map([
      ['courses/a.md', `---
slug: course-a
title: Course A
slug-aliases: shared-alias
---

# Module: [[../modules/mod-a.md|Mod A]]
`],
      ['courses/b.md', `---
slug: course-b
title: Course B
slug-aliases: shared-alias
---

# Module: [[../modules/mod-b.md|Mod B]]
`],
      ['modules/mod-a.md', makeModule('mod-a', '../Lenses/lens-a.md')],
      ['modules/mod-b.md', makeModule('mod-b', '../Lenses/lens-b.md')],
      ['Lenses/lens-a.md', makeLens('00000000-0000-0000-0000-000000000001')],
      ['Lenses/lens-b.md', makeLens('00000000-0000-0000-0000-000000000002')],
    ]);

    const result = processContent(files);
    const aliasErrors = result.errors.filter(e =>
      e.message.includes('alias') && e.message.includes('shared-alias')
    );
    expect(aliasErrors.length).toBeGreaterThan(0);
  });

  it('errors when alias matches own primary slug', () => {
    const files = new Map([
      ['courses/a.md', `---
slug: course-a
title: Course A
slug-aliases: course-a
---

# Module: [[../modules/mod-a.md|Mod A]]
`],
      ['modules/mod-a.md', makeModule('mod-a', '../Lenses/lens-a.md')],
      ['Lenses/lens-a.md', makeLens('00000000-0000-0000-0000-000000000001')],
    ]);

    const result = processContent(files);
    const aliasErrors = result.errors.filter(e =>
      e.message.includes('alias') && e.message.includes('course-a')
    );
    expect(aliasErrors.length).toBeGreaterThan(0);
  });

  it('allows valid aliases with no collisions', () => {
    const files = new Map([
      ['courses/a.md', `---
slug: course-a
title: Course A
slug-aliases: old-course-a
---

# Module: [[../modules/mod-a.md|Mod A]]
`],
      ['modules/mod-a.md', makeModule('mod-a', '../Lenses/lens-a.md')],
      ['Lenses/lens-a.md', makeLens('00000000-0000-0000-0000-000000000001')],
    ]);

    const result = processContent(files);
    const aliasErrors = result.errors.filter(e => e.message.includes('alias'));
    expect(aliasErrors).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd content_processor && npx vitest run src/validator/course-alias-collisions.test.ts
```

Expected: FAIL — no collision detection exists yet.

- [ ] **Step 3: Implement alias collision validation**

In `content_processor/src/index.ts`, add the validation block after the existing tier violation checks for courses (around line 536, before UUID validation). The `slugAliases` field is already on the `Course` objects at this point because the parser set it. Use `tierMap` to downgrade severity to `'warning'` for WIP content (matching the spec's requirement):

```ts
// Validate course slug alias collisions
{
  // Map of all course slugs (primary + aliases) -> source file
  const allCourseSlugs = new Map<string, string>(); // slug -> file

  // Register primary slugs first
  for (const course of courses) {
    const file = courseSlugToFile.get(course.slug) ?? 'courses/';
    allCourseSlugs.set(course.slug, file);
  }

  // Check each alias against all known slugs
  for (const course of courses) {
    const file = courseSlugToFile.get(course.slug) ?? 'courses/';
    const tier = tierMap.get(file) ?? 'production';
    for (const alias of course.slugAliases ?? []) {
      const existing = allCourseSlugs.get(alias);
      if (existing) {
        errors.push({
          file,
          message: `Course slug alias '${alias}' collides with ${existing === file ? 'its own primary slug' : `slug in ${existing}`}`,
          suggestion: `Choose a different alias or remove the conflicting slug`,
          severity: tier === 'wip' ? 'warning' : 'error',
        });
      } else {
        allCourseSlugs.set(alias, file);
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd content_processor && npx vitest run src/validator/course-alias-collisions.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
cd content_processor && npx vitest run
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
jj commit -m "feat: validate course slug alias collisions"
```

---

### Task 4: Add `slug_aliases` to Python `ParsedCourse` and `ContentCache`

**Files:**
- Modify: `core/modules/flattened_types.py:55-60`
- Modify: `core/content/cache.py:17-35`

- [ ] **Step 1: Add `slug_aliases` field to `ParsedCourse`**

In `core/modules/flattened_types.py`, add to `ParsedCourse`:

```python
@dataclass
class ParsedCourse:
    slug: str
    title: str
    progression: list[ProgressionItem] = field(default_factory=list)
    slug_aliases: list[str] = field(default_factory=list)
```

- [ ] **Step 2: Add `course_slug_aliases` field to `ContentCache`**

In `core/content/cache.py`, add to `ContentCache` dataclass (after `courses`):

```python
course_slug_aliases: dict[str, str] = field(default_factory=dict)  # alias -> canonical slug
```

- [ ] **Step 3: Commit**

```bash
jj commit -m "feat: add slug_aliases to ParsedCourse and ContentCache"
```

---

### Task 5: Wire up alias data flow from TS output to Python cache

**Files:**
- Modify: `core/content/github_fetcher.py:34-59` (converter function)
- Modify: `core/content/github_fetcher.py:364-367` (full fetch cache building)
- Modify: `core/content/github_fetcher.py:582-626` (incremental refresh cache building)
- Test: `core/content/tests/test_course_progression.py`

- [ ] **Step 1: Write failing test for slug_aliases in converter**

Append to `core/content/tests/test_course_progression.py`:

```python
def test_slug_aliases_parsed_from_ts_output(self):
    """slug_aliases should be extracted from TypeScript slugAliases field."""
    ts_course = {
        "slug": "navigating-asi",
        "title": "Navigating ASI",
        "slugAliases": ["default", "old-name"],
        "progression": [],
    }
    from core.content.github_fetcher import _convert_ts_course_to_parsed_course

    course = _convert_ts_course_to_parsed_course(ts_course)
    assert course.slug_aliases == ["default", "old-name"]

def test_slug_aliases_empty_when_not_present(self):
    """slug_aliases should be empty list when TypeScript output has no aliases."""
    ts_course = {
        "slug": "my-course",
        "title": "My Course",
        "progression": [],
    }
    from core.content.github_fetcher import _convert_ts_course_to_parsed_course

    course = _convert_ts_course_to_parsed_course(ts_course)
    assert course.slug_aliases == []
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
.venv/bin/pytest core/content/tests/test_course_progression.py -v
```

Expected: FAIL — `slug_aliases` not set or `slugAliases` not read.

- [ ] **Step 3: Update `_convert_ts_course_to_parsed_course` to read `slugAliases`**

In `core/content/github_fetcher.py`, update the return statement in `_convert_ts_course_to_parsed_course` (around line 55):

```python
return ParsedCourse(
    slug=ts_course["slug"],
    title=ts_course["title"],
    progression=progression,
    slug_aliases=ts_course.get("slugAliases", []),
)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
.venv/bin/pytest core/content/tests/test_course_progression.py -v
```

Expected: All tests PASS.

- [ ] **Step 5: Build alias map in `fetch_all_content`**

In `core/content/github_fetcher.py`, after the courses dict is built (around line 367), build the alias map:

```python
course_slug_aliases: dict[str, str] = {}
for course in courses.values():
    for alias in course.slug_aliases:
        course_slug_aliases[alias] = course.slug
```

Pass `course_slug_aliases=course_slug_aliases` to the `ContentCache` constructor (around line 372).

- [ ] **Step 6: Build alias map in `incremental_refresh`**

In `core/content/github_fetcher.py`, in the incremental refresh function (around line 626 where `cache.courses = courses`), add:

```python
course_slug_aliases: dict[str, str] = {}
for course in courses.values():
    for alias in course.slug_aliases:
        course_slug_aliases[alias] = course.slug
cache.course_slug_aliases = course_slug_aliases
```

- [ ] **Step 7: Commit**

```bash
jj commit -m "feat: wire slug aliases from TS output through Python cache"
```

---

### Task 6: Add alias resolution to `load_course`

**Files:**
- Modify: `core/modules/course_loader.py:15-37`
- Test: `core/modules/tests/test_courses.py`

- [ ] **Step 1: Write failing tests for alias resolution**

Append to `core/modules/tests/test_courses.py`:

```python
@pytest.fixture
def cache_with_aliases():
    """Set up a cache with a course that has slug aliases."""
    courses = {
        "navigating-asi": ParsedCourse(
            slug="navigating-asi",
            title="Navigating ASI",
            progression=[ModuleRef(slug="module-a")],
            slug_aliases=["default", "old-course-name"],
        ),
    }

    cache = ContentCache(
        courses=courses,
        flattened_modules={
            "module-a": FlattenedModule(
                slug="module-a",
                title="Module A",
                content_id=None,
                sections=[],
            ),
        },
        parsed_learning_outcomes={},
        parsed_lenses={},
        articles={},
        video_transcripts={},
        last_refreshed=datetime.now(),
        course_slug_aliases={"default": "navigating-asi", "old-course-name": "navigating-asi"},
    )
    set_cache(cache)
    yield cache
    clear_cache()


def test_load_course_by_alias(cache_with_aliases):
    """Should resolve alias to canonical course."""
    course = load_course("default")
    assert course.slug == "navigating-asi"
    assert course.title == "Navigating ASI"


def test_load_course_by_second_alias(cache_with_aliases):
    """Should resolve any alias to canonical course."""
    course = load_course("old-course-name")
    assert course.slug == "navigating-asi"


def test_load_course_canonical_still_works(cache_with_aliases):
    """Canonical slug should still work when aliases exist."""
    course = load_course("navigating-asi")
    assert course.slug == "navigating-asi"


def test_load_course_nonexistent_with_aliases(cache_with_aliases):
    """Non-existent slug that isn't an alias should use single-course fallback."""
    # Only one course exists, so fallback should return it
    course = load_course("totally-unknown")
    assert course.slug == "navigating-asi"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
.venv/bin/pytest core/modules/tests/test_courses.py::test_load_course_by_alias -v
```

Expected: FAIL — alias resolution not implemented yet.

- [ ] **Step 3: Add alias lookup to `load_course`**

In `core/modules/course_loader.py`, update `load_course` to add alias resolution between exact match and single-course fallback:

```python
def load_course(course_slug: str) -> ParsedCourse:
    cache = get_cache()

    # Exact match - return it
    if course_slug in cache.courses:
        return cache.courses[course_slug]

    # Alias lookup
    if course_slug in cache.course_slug_aliases:
        canonical = cache.course_slug_aliases[course_slug]
        return cache.courses[canonical]

    # Fallback: if only one course exists, return it regardless of slug
    if len(cache.courses) == 1:
        only_course = next(iter(cache.courses.values()))
        return only_course

    # Multiple courses but slug not found - that's a real 404
    raise CourseNotFoundError(f"Course not found: {course_slug}")
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
.venv/bin/pytest core/modules/tests/test_courses.py -v
```

Expected: All tests PASS (new and existing).

- [ ] **Step 5: Commit**

```bash
jj commit -m "feat: resolve course slug aliases in load_course"
```

---

### Task 7: Add frontend client-side redirect for alias URLs

**Files:**
- Modify: `web_frontend/src/views/CourseOverview.tsx:38-71`
- Modify: `web_frontend/src/views/Module.tsx:207-260`

- [ ] **Step 1: Add redirect logic to CourseOverview**

In `web_frontend/src/views/CourseOverview.tsx`, inside the `load` function in the `useEffect` (after `setCourseProgress(data)` on line 43), add:

```tsx
// Redirect if viewing via alias slug
if (data.course?.slug && data.course.slug !== courseId) {
  window.location.replace(`/course/${data.course.slug}`);
  return;
}
```

This should go right after `setCourseProgress(data);` and before the auto-select logic. The `return` prevents the rest of the load function from executing since we're navigating away.

- [ ] **Step 2: Add redirect logic to Module**

In `web_frontend/src/views/Module.tsx`, inside the `load` function in the `useEffect` (after `setCourseProgress(courseResult)` on line 228), add:

```tsx
// Redirect if viewing via alias slug
if (courseResult?.course?.slug && courseId && courseResult.course.slug !== courseId) {
  window.location.replace(`/course/${courseResult.course.slug}/module/${moduleId}`);
  return;
}
```

This should go right after `setCourseProgress(courseResult);` and before the `initialCompletedRef` logic.

- [ ] **Step 3: Verify by running lint and build**

```bash
cd web_frontend && npm run lint && npm run build
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
jj commit -m "feat: client-side redirect from course alias URLs to canonical slug"
```

---

### Task 8: Manual end-to-end verification

- [ ] **Step 1: Start dev servers**

```bash
./scripts/list-servers
# If not running, start backend and frontend
```

- [ ] **Step 2: Verify alias resolution works in API**

```bash
curl -s http://localhost:8300/api/courses/default/progress | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['course']['slug'])"
```

Expected: prints the canonical slug (e.g., `navigating-asi`), not `default`.

- [ ] **Step 3: Verify frontend redirect in browser**

Navigate to `http://dev.vps:3300/course/default` in Chrome DevTools.

Expected: URL should change to `http://dev.vps:3300/course/navigating-asi` (or whatever the canonical slug is).

- [ ] **Step 4: Verify module URL redirect**

Navigate to `http://dev.vps:3300/course/default/module/introduction` in Chrome DevTools.

Expected: URL should change to `http://dev.vps:3300/course/navigating-asi/module/introduction`.

- [ ] **Step 5: Verify canonical URL still works**

Navigate directly to `http://dev.vps:3300/course/navigating-asi`.

Expected: Page loads normally, no redirect loop.
