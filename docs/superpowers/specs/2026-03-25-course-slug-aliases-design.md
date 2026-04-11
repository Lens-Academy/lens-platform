# Course Slug Aliases

Allow courses to define slug aliases so that old URLs continue to work after a course slug is renamed. The frontend redirects (301) from alias URLs to the canonical slug URL.

## Approach

**Approach B: Alias Resolution with Separate Lookup Map.** Courses are stored in the cache under their canonical slug only. A separate `course_slug_aliases` map (alias -> canonical slug) on `ContentCache` handles resolution. This keeps the cache truthful about which slug is canonical and enables redirect detection (compare requested slug against `course.slug`).

## Design

### 1. Content Schema (TypeScript)

**`content-schema.ts`** - Add `'slug-aliases'` to course optional fields:
```ts
'course': contentSchema(['slug', 'title'], ['id', 'slug-aliases', 'tags']),
```

**`index.ts`** - Add to `Course` interface:
```ts
export interface Course {
  slug: string;
  title: string;
  slugAliases?: string[];
  progression: ProgressionItem[];
  error?: string;
}
```

### 2. Course Parser (TypeScript)

**`parser/course.ts`** - After parsing frontmatter, extract and normalize `slug-aliases`:

```ts
// slug-aliases can be:
// 1. A string: "default"
// 2. A comma-separated string: "default, old-name"
// 3. A YAML list: ["default", "old-name"]
const rawAliases = frontmatter['slug-aliases'];
let slugAliases: string[] = [];
if (Array.isArray(rawAliases)) {
  slugAliases = rawAliases.map(a => String(a).trim()).filter(Boolean);
} else if (typeof rawAliases === 'string') {
  slugAliases = rawAliases.split(',').map(a => a.trim()).filter(Boolean);
}
```

Include `slugAliases` in the returned `Course` object (only if non-empty).

Validate each alias with `validateSlugFormat()` (same rules as primary slugs).

### 3. Alias Collision Validation (TypeScript)

**`index.ts` `processContent()`** - After building all courses, validate that:
- No alias collides with any course's primary slug
- No alias appears in more than one course
- No alias collides with another alias from a different course

This validation runs at the **production** category level (non-WIP), so collisions in WIP content are warnings, not errors.

Implementation: in `processContent()`, after building all courses (around line 515 where tier violations are checked), build a map of all slugs (primary + aliases) -> course file using `courseSlugToFile` as the starting point. Check for collisions and emit errors attributed to the course file declaring the conflicting alias.

### 4. Python Types

**`core/modules/flattened_types.py`** - Add to `ParsedCourse`:
```python
@dataclass
class ParsedCourse:
    slug: str
    title: str
    progression: list[ProgressionItem] = field(default_factory=list)
    slug_aliases: list[str] = field(default_factory=list)
```

### 5. Python Cache

**`core/content/cache.py`** - Add to `ContentCache`:
```python
course_slug_aliases: dict[str, str] = field(default_factory=dict)  # alias -> canonical slug
```

**`core/content/github_fetcher.py`** - In `_convert_ts_course_to_parsed_course()`, read `slugAliases`:
```python
slug_aliases=ts_course.get("slugAliases", [])
```

Pass `slug_aliases` in the `ParsedCourse` constructor call:
```python
return ParsedCourse(
    slug=ts_course["slug"],
    title=ts_course["title"],
    progression=progression,
    slug_aliases=ts_course.get("slugAliases", []),
)
```

In both `fetch_all_content()` and `incremental_refresh()`, after building the courses dict, populate the alias map and pass it to the cache:
```python
course_slug_aliases: dict[str, str] = {}
for course in courses.values():
    for alias in course.slug_aliases:
        course_slug_aliases[alias] = course.slug
```

In `incremental_refresh()`, also update `cache.course_slug_aliases` alongside `cache.courses`.

### 6. Course Loader Resolution

**`core/modules/course_loader.py`** - In `load_course()`, add alias lookup between exact match and single-course fallback:

```python
def load_course(course_slug: str) -> ParsedCourse:
    cache = get_cache()

    # Exact match
    if course_slug in cache.courses:
        return cache.courses[course_slug]

    # Alias lookup
    if course_slug in cache.course_slug_aliases:
        canonical = cache.course_slug_aliases[course_slug]
        return cache.courses[canonical]

    # Fallback: single course
    if len(cache.courses) == 1:
        return next(iter(cache.courses.values()))

    raise CourseNotFoundError(f"Course not found: {course_slug}")
```

No changes needed in `web_api/routes/courses.py` - the endpoint already returns `course.slug` (the canonical slug) in its response. When a client requests `/api/courses/default/progress`, the response contains `"slug": "navigating-asi"`.

### 7. Frontend Redirect

The redirect is handled in the page components rather than `+guard.ts`, because the course pages use `prerender: true, ssr: true` — a guard that calls an API would run at build time and fail.

Instead, the redirect logic lives in the existing page components that already fetch course data:

**`CourseOverview.tsx`** - Already calls `getCourseProgress(courseId)`. After receiving the response, compare `data.course.slug` against the `courseId` prop. If they differ, use `window.location.replace()` to redirect to `/course/${data.course.slug}` (replacing history entry for 301-like behavior).

**`Module.tsx`** - Already calls `getCourseProgress(courseId)`. Same comparison. If alias detected, redirect to `/course/${data.course.slug}/module/${moduleId}`.

This approach:
- Avoids the SSG/prerender conflict (no guard, no build-time API calls)
- Reuses existing API calls (no extra network request for redirect detection)
- Works for both direct navigation and SPA navigation
- The `getCourseProgress` function lives in `@/api/modules` (not `@/api/courses`)

### 8. No Database Migration

Existing `cohorts.course_slug` and `groups.course_slug_override` records with old slugs (e.g., `"default"`) continue to work because `load_course("default")` resolves through the alias map. No data migration needed.

## Data Flow

```
Content YAML (slug-aliases: default)
  → TS Parser (reads frontmatter, normalizes to string[])
  → TS Validator (checks alias collisions)
  → TS Output JSON ({"slugAliases": ["default"]})
  → Python github_fetcher (builds ParsedCourse with slug_aliases)
  → ContentCache (courses["navigating-asi"] + course_slug_aliases["default" → "navigating-asi"])
  → load_course("default") → returns ParsedCourse(slug="navigating-asi")
  → API response: {"course": {"slug": "navigating-asi", ...}}
  → Frontend component: courseId="default" !== slug="navigating-asi" → client-side redirect
```

## Supported Formats

All of these work in course frontmatter:

```yaml
# Single value
slug-aliases: default

# Comma-separated
slug-aliases: default, old-course-name

# YAML list
slug-aliases:
  - default
  - old-course-name
```

## Automatically Covered

These endpoints also accept `course_slug` and work transparently through `load_course()` alias resolution:
- `GET /api/courses/{course_slug}/next-module` - next module endpoint
- All `core/` functions that call `load_course()` (sync, notifications, etc.)

## What This Does NOT Cover

- Module slug aliases (out of scope - course only)
- DB migration of old slug values (aliases handle this transparently)
- Server-side 301 for crawlers (client-side redirect only, can be added later if needed)
