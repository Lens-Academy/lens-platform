# TypeScript Content Processor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a TypeScript content processor that parses, flattens, and bundles educational markdown content, producing JSON output with comprehensive error reporting.

**Architecture:** Pure function `processContent(files: Map<string, string>) → ProcessResult`. No I/O inside the processor—it receives all markdown as strings, returns structured JSON. Same code runs in Node (backend subprocess), CI (validation), and eventually Obsidian (browser).

**Tech Stack:** TypeScript, Node.js, Vitest for testing, tsx for running

---

## Guiding Principle: Fixture-Driven TDD

**Every feature starts with a test fixture.** A fixture is a mini-vault: input markdown files + expected JSON output (or expected errors).

```
content_processor/
  fixtures/
    valid/
      simple-module/
        input/
          modules/intro.md
          Learning Outcomes/lo1.md
          Lenses/lens1.md
        expected.json
      module-with-article/
        input/
          modules/reading.md
          Learning Outcomes/lo-reading.md
          Lenses/lens-article.md
          articles/sample-article.md
        expected.json
    invalid/
      missing-frontmatter/
        input/
          modules/bad.md
        expected-errors.json
      broken-wikilink/
        input/
          modules/broken.md
          Learning Outcomes/lo1.md
        expected-errors.json
      missing-anchor/
        input/
          modules/m.md
          Learning Outcomes/lo.md
          Lenses/lens.md
          articles/article.md
        expected-errors.json
```

**The test runner:**
1. Loads all `.md` files from `input/`
2. Calls `processContent(files)`
3. Compares result to `expected.json` or `expected-errors.json`

**Why fixtures over inline test data:**
- Fixtures ARE the spec—if the fixture is wrong, the spec is wrong
- Easy to add new test cases without touching code
- Can run the same fixtures in multiple contexts (unit test, integration, manual inspection)
- Course developers can contribute fixtures without knowing TypeScript

---

## File Type Header Hierarchy

Different file types use different header levels. The parser must handle this:

| File Type | Location | Section Headers | Segment Headers |
|-----------|----------|-----------------|-----------------|
| **Module** | `modules/*.md` | H1 (`# Learning Outcome:`, `# Page:`, `# Uncategorized:`) | N/A (fields only) |
| **Learning Outcome** | `Learning Outcomes/*.md` | H2 (`## Lens:`, `## Test:`) | N/A (fields only) |
| **Lens** | `Lenses/*.md` | H3 (`### Text:`, `### Article:`, `### Video:`) | H4 (`#### Text`, `#### Chat`, `#### Article-excerpt`, `#### Video-excerpt`) |

Note: Lens `### Article:` sections become `lens-article` type in output; `### Video:` becomes `lens-video`. This is v2 format (no backward compatibility with v1 `article`/`video` types).
| **Course** | `courses/*.md` | H1 (`# Module:`, `# Meeting:`) | N/A |

The section parser must be parameterized by header level, not hardcoded to H1.

---

## Error Recovery Strategy

**Design decision: Partial success with error field.**

When a module fails to process (e.g., missing anchor, broken reference):
1. **Include the module in output** with an `error` field
2. **Continue processing other modules** - don't fail the entire batch
3. **Collect all errors** in both `module.error` and global `errors[]`

This allows:
- Frontend to display what it can, showing errors for broken modules
- CI to report ALL errors at once, not fail on the first one
- Course developers to see the full scope of issues

**Example output for partial failure:**
```json
{
  "modules": [
    {
      "slug": "broken-module",
      "title": "Broken Module",
      "contentId": null,
      "sections": [],
      "error": "Anchor 'missing text' not found in articles/deep-dive.md"
    },
    {
      "slug": "working-module",
      "title": "Working Module",
      "contentId": null,
      "sections": [...]
    }
  ],
  "errors": [
    {
      "file": "modules/broken-module.md",
      "line": 15,
      "message": "Anchor 'missing text' not found in articles/deep-dive.md",
      "suggestion": "Check that the anchor text exists in the article",
      "severity": "error"
    }
  ]
}
```

---

## Phase 0: Project Setup

### Task 0.1: Initialize TypeScript Package

**Files:**
- Create: `content_processor/package.json`
- Create: `content_processor/tsconfig.json`
- Create: `content_processor/vitest.config.ts`
- Create: `content_processor/src/index.ts`

**Step 1: Create package.json**

```json
{
  "name": "@lens/content-processor",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "validate": "tsx src/cli.ts validate",
    "process": "tsx src/cli.ts process"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "tsx": "^4.0.0",
    "@types/node": "^22.0.0"
  },
  "dependencies": {
    "yaml": "^2.5.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "fixtures"]
}
```

**Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    globals: true,
  },
});
```

**Step 4: Create minimal src/index.ts**

```typescript
export interface ProcessResult {
  modules: FlattenedModule[];
  courses: Course[];
  errors: ContentError[];
}

export interface FlattenedModule {
  slug: string;
  title: string;
  contentId: string | null;
  sections: Section[];
  error?: string;
  warnings?: string[];
}

export interface Course {
  slug: string;
  title: string;
  progression: ProgressionItem[];
  error?: string;
}

export interface Section {
  type: 'page' | 'lens-video' | 'lens-article';
  meta: SectionMeta;
  segments: Segment[];
  optional?: boolean;
  contentId?: string;
  learningOutcomeId?: string | null;
  videoId?: string;  // video sections only
}

export interface SectionMeta {
  title?: string;
  author?: string;      // article sections only
  sourceUrl?: string;   // article sections only
  channel?: string;     // video sections only
}

export interface ProgressionItem {
  type: 'module' | 'meeting';
  slug?: string;
  number?: number;
  optional?: boolean;
}

export interface ContentError {
  file: string;
  line?: number;
  message: string;
  suggestion?: string;
  severity: 'error' | 'warning';
}

// Segment types with their specific fields
export interface TextSegment {
  type: 'text';
  content: string;
  optional?: boolean;
}

export interface ChatSegment {
  type: 'chat';
  instructions?: string;
  hidePreviousContentFromUser?: boolean;
  hidePreviousContentFromTutor?: boolean;
  optional?: boolean;
}

export interface ArticleExcerptSegment {
  type: 'article-excerpt';
  content: string;              // Extracted excerpt content
  collapsed_before?: string;    // Content between previous excerpt and this one (snake_case for Python compat)
  collapsed_after?: string;     // Content after this excerpt to end/next excerpt
  optional?: boolean;
}

export interface VideoExcerptSegment {
  type: 'video-excerpt';
  from: number;                 // Start time in seconds
  to: number | null;            // End time in seconds (null = until end)
  transcript: string;           // Extracted transcript content
  optional?: boolean;
}

export type Segment = TextSegment | ChatSegment | ArticleExcerptSegment | VideoExcerptSegment;

export function processContent(files: Map<string, string>): ProcessResult {
  // Stub - will be implemented via TDD
  return {
    modules: [],
    courses: [],
    errors: [],
  };
}
```

**Step 5: Install dependencies**

Run: `cd content_processor && npm install`

**Step 6: Verify setup**

Run: `cd content_processor && npm test`
Expected: Vitest runs, 0 tests found, exits cleanly

**Step 7: Commit**

```bash
git add content_processor/
git commit -m "chore: initialize TypeScript content processor package"
```

---

## Phase 1: Fixture Infrastructure

### Task 1.1: Create Fixture Loader

**Files:**
- Create: `content_processor/tests/fixture-loader.ts`
- Create: `content_processor/tests/fixtures.test.ts`

**Step 1: Write failing test for fixture loading**

```typescript
// tests/fixtures.test.ts
import { describe, it, expect } from 'vitest';
import { loadFixture, listFixtures } from './fixture-loader';

describe('fixture loader', () => {
  it('lists available fixtures', async () => {
    const fixtures = await listFixtures();
    expect(fixtures.length).toBeGreaterThan(0);
    expect(fixtures).toContain('valid/minimal-module');
  });

  it('loads fixture input files', async () => {
    const fixture = await loadFixture('valid/minimal-module');
    expect(fixture.input.size).toBeGreaterThan(0);
    expect(fixture.input.has('modules/intro.md')).toBe(true);
  });

  it('loads expected output', async () => {
    const fixture = await loadFixture('valid/minimal-module');
    expect(fixture.expected).toBeDefined();
    expect(fixture.expected.modules).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd content_processor && npm test`
Expected: FAIL - cannot find module './fixture-loader'

**Step 3: Create fixture loader**

```typescript
// tests/fixture-loader.ts
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import type { ProcessResult } from '../src/index';

const FIXTURES_DIR = join(import.meta.dirname, '../fixtures');

export interface Fixture {
  name: string;
  input: Map<string, string>;
  expected: ProcessResult;
  expectErrors?: boolean;
}

export async function listFixtures(): Promise<string[]> {
  const fixtures: string[] = [];

  for (const category of ['valid', 'invalid']) {
    const categoryDir = join(FIXTURES_DIR, category);
    try {
      const entries = await readdir(categoryDir);
      for (const entry of entries) {
        fixtures.push(`${category}/${entry}`);
      }
    } catch {
      // Category doesn't exist yet
    }
  }

  return fixtures;
}

export async function loadFixture(name: string): Promise<Fixture> {
  const fixtureDir = join(FIXTURES_DIR, name);
  const inputDir = join(fixtureDir, 'input');

  // Load all .md files from input/
  const input = new Map<string, string>();
  await loadFilesRecursive(inputDir, '', input);

  // Load expected output
  const expectedPath = name.startsWith('invalid/')
    ? join(fixtureDir, 'expected-errors.json')
    : join(fixtureDir, 'expected.json');

  const expectedContent = await readFile(expectedPath, 'utf-8');
  const expected = JSON.parse(expectedContent) as ProcessResult;

  return {
    name,
    input,
    expected,
    expectErrors: name.startsWith('invalid/'),
  };
}

async function loadFilesRecursive(
  dir: string,
  prefix: string,
  result: Map<string, string>
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      await loadFilesRecursive(fullPath, relativePath, result);
    } else if (entry.name.endsWith('.md')) {
      const content = await readFile(fullPath, 'utf-8');
      result.set(relativePath, content);
    }
  }
}
```

**Step 4: Create first fixture (minimal valid module)**

Create directory structure:
```
content_processor/fixtures/valid/minimal-module/
  input/
    modules/intro.md
    Learning Outcomes/lo1.md
    Lenses/lens1.md
  expected.json
```

**modules/intro.md:**
```markdown
---
slug: intro
title: Introduction to AI Safety
---

# Learning Outcome: What is AI Safety?
source:: [[../Learning Outcomes/lo1.md|LO1]]
```

**Learning Outcomes/lo1.md:**
```markdown
---
id: 550e8400-e29b-41d4-a716-446655440001
---

## Lens: Basic Understanding
source:: [[../Lenses/lens1.md|Lens 1]]
```

**Lenses/lens1.md:**
```markdown
---
id: 550e8400-e29b-41d4-a716-446655440002
---

### Text: Core Concepts

#### Text
content:: This is the core content about AI Safety.
```

Note: Lens files use H3 (`###`) for section headers (Text, Article, Video) and H4 (`####`) for segment headers.

**expected.json:**
```json
{
  "modules": [
    {
      "slug": "intro",
      "title": "Introduction to AI Safety",
      "contentId": null,
      "sections": [
        {
          "type": "page",
          "meta": {
            "title": "What is AI Safety?"
          },
          "segments": [
            {
              "type": "text",
              "content": "This is the core content about AI Safety."
            }
          ],
          "learningOutcomeId": "550e8400-e29b-41d4-a716-446655440001",
          "optional": false
        }
      ]
    }
  ],
  "courses": [],
  "errors": []
}
```

**Step 5: Run tests to verify fixture loading works**

Run: `cd content_processor && npm test`
Expected: PASS

**Step 6: Commit**

```bash
git add content_processor/
git commit -m "feat: add fixture loader infrastructure"
```

---

### Task 1.2: Create Fixture Test Runner

**Files:**
- Create: `content_processor/tests/process-fixtures.test.ts`

**Step 1: Write test that runs all fixtures through processor**

```typescript
// tests/process-fixtures.test.ts
import { describe, it, expect } from 'vitest';
import { listFixtures, loadFixture } from './fixture-loader';
import { processContent } from '../src/index';

describe('fixture processing', () => {
  it('processes all valid fixtures without errors', async () => {
    const fixtures = await listFixtures();
    const validFixtures = fixtures.filter(f => f.startsWith('valid/'));

    for (const fixtureName of validFixtures) {
      const fixture = await loadFixture(fixtureName);
      const result = processContent(fixture.input);

      expect(result.errors, `Fixture ${fixtureName} should have no errors`).toEqual([]);
    }
  });

  it('matches expected output for each valid fixture', async () => {
    const fixtures = await listFixtures();
    const validFixtures = fixtures.filter(f => f.startsWith('valid/'));

    for (const fixtureName of validFixtures) {
      const fixture = await loadFixture(fixtureName);
      const result = processContent(fixture.input);

      expect(result, `Fixture ${fixtureName}`).toEqual(fixture.expected);
    }
  });

  it('produces expected errors for invalid fixtures', async () => {
    const fixtures = await listFixtures();
    const invalidFixtures = fixtures.filter(f => f.startsWith('invalid/'));

    for (const fixtureName of invalidFixtures) {
      const fixture = await loadFixture(fixtureName);
      const result = processContent(fixture.input);

      expect(result.errors.length, `Fixture ${fixtureName} should have errors`).toBeGreaterThan(0);
      expect(result.errors, `Fixture ${fixtureName}`).toEqual(fixture.expected.errors);
    }
  });
});
```

**Step 2: Run tests - they should fail**

Run: `cd content_processor && npm test`
Expected: FAIL - processContent returns empty result, doesn't match expected

This is the RED state. The rest of the plan implements the processor to make these tests pass.

**Step 3: Commit the failing test**

```bash
git add content_processor/
git commit -m "test: add fixture-based processor tests (RED)"
```

---

### Task 1.3: Create Invalid Fixtures

**Files:**
- Create: `content_processor/fixtures/invalid/missing-frontmatter/`
- Create: `content_processor/fixtures/invalid/missing-slug/`
- Create: `content_processor/fixtures/invalid/broken-wikilink/`
- Create: `content_processor/fixtures/invalid/missing-lo-source/`

**Step 1: Create missing-frontmatter fixture**

**input/modules/bad.md:**
```markdown
# Learning Outcome: No Frontmatter
source:: [[../Learning Outcomes/lo1.md|LO1]]
```

**expected-errors.json:**
```json
{
  "modules": [],
  "courses": [],
  "errors": [
    {
      "file": "modules/bad.md",
      "line": 1,
      "message": "Missing frontmatter",
      "suggestion": "Add YAML frontmatter with 'slug' and 'title' fields",
      "severity": "error"
    }
  ]
}
```

**Step 2: Create missing-slug fixture**

**input/modules/no-slug.md:**
```markdown
---
title: Has Title But No Slug
---

# Learning Outcome: Test
source:: [[../Learning Outcomes/lo1.md|LO1]]
```

**expected-errors.json:**
```json
{
  "modules": [],
  "courses": [],
  "errors": [
    {
      "file": "modules/no-slug.md",
      "line": 2,
      "message": "Missing required field: slug",
      "suggestion": "Add 'slug: your-module-slug' to frontmatter",
      "severity": "error"
    }
  ]
}
```

**Step 3: Create broken-wikilink fixture**

**input/modules/broken.md:**
```markdown
---
slug: broken
title: Broken Reference
---

# Learning Outcome: Missing Reference
source:: [[../Learning Outcomes/nonexistent.md|Missing]]
```

**input/Learning Outcomes/lo1.md:**
```markdown
---
id: 550e8400-e29b-41d4-a716-446655440001
---

## Lens: Test
source:: [[../Lenses/lens1.md|Lens]]
```

**expected-errors.json:**
```json
{
  "modules": [
    {
      "slug": "broken",
      "title": "Broken Reference",
      "contentId": null,
      "sections": [],
      "error": "Referenced file not found: Learning Outcomes/nonexistent.md"
    }
  ],
  "courses": [],
  "errors": [
    {
      "file": "modules/broken.md",
      "line": 7,
      "message": "Referenced file not found: Learning Outcomes/nonexistent.md",
      "suggestion": "Check the file path in the wiki-link",
      "severity": "error"
    }
  ]
}
```

**Step 4: Commit fixtures**

```bash
git add content_processor/fixtures/
git commit -m "test: add invalid fixtures for error cases"
```

---

### Task 1.4: Golden Master Test

Golden master tests use real educational content processed by the Python parser as the expected output. The TypeScript processor must produce identical JSON.

**Files:**
- Create: `content_processor/tests/golden-master.test.ts`
- Existing: `content_processor/fixtures/golden/actual-content/` (28 files from course)
- Existing: `content_processor/fixtures/golden/software-demo/` (11 files with alternative formatting)

**Step 1: Write golden master test**

```typescript
// tests/golden-master.test.ts
import { describe, it, expect } from 'vitest';
import { loadFixture } from './fixture-loader';
import { processContent } from '../src/index';

describe('golden master - Python compatibility', () => {
  it('matches Python output for actual-content fixture', async () => {
    const fixture = await loadFixture('golden/actual-content');
    const result = processContent(fixture.input);

    // Deep equality check against Python-generated expected.json
    expect(result).toEqual(fixture.expected);
  });

  it('matches Python output for software-demo fixture', async () => {
    const fixture = await loadFixture('golden/software-demo');
    const result = processContent(fixture.input);

    expect(result).toEqual(fixture.expected);
  });
});
```

**Step 2: Update fixture loader to handle golden fixtures**

The golden fixtures are in `fixtures/golden/` instead of `fixtures/valid/` or `fixtures/invalid/`. Update `listFixtures()` to include them:

```typescript
export async function listFixtures(): Promise<string[]> {
  const fixtures: string[] = [];

  for (const category of ['valid', 'invalid', 'golden']) {
    const categoryDir = join(FIXTURES_DIR, category);
    try {
      const entries = await readdir(categoryDir);
      for (const entry of entries) {
        fixtures.push(`${category}/${entry}`);
      }
    } catch {
      // Category doesn't exist yet
    }
  }

  return fixtures;
}
```

**Step 3: Run test to verify it fails**

Run: `cd content_processor && npm test -- golden-master`
Expected: FAIL - processContent returns empty result, doesn't match expected

This is the ultimate RED state. When this test passes, we have confidence the TypeScript processor matches Python behavior.

**Step 4: Commit**

```bash
git add content_processor/tests/
git commit -m "test: add golden master tests for Python compatibility (RED)"
```

**Why golden master tests matter:**
- Synthetic fixtures test individual features
- Golden master tests catch subtle differences in real content
- If TypeScript matches Python on real content, we can safely replace Python

**Regenerating expected.json:**
If the Python parser changes, regenerate with:
```bash
python scripts/generate_golden_expected.py
```

---

## Phase 2: Core Parser

**Note on file organization:** The plan shows separate files for each parser component for clarity. During implementation, you may consolidate into fewer files (e.g., a single `src/parser.ts`) if the total stays under ~300 lines. The API should remain the same regardless of file structure.

### Task 2.1: Frontmatter Parser

**Files:**
- Create: `content_processor/src/parser/frontmatter.ts`
- Create: `content_processor/src/parser/frontmatter.test.ts`

**Step 1: Write failing test**

```typescript
// src/parser/frontmatter.test.ts
import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from './frontmatter';

describe('parseFrontmatter', () => {
  it('extracts frontmatter fields', () => {
    const content = `---
slug: my-module
title: My Module Title
---

# Content here`;

    const result = parseFrontmatter(content);

    expect(result.frontmatter).toEqual({
      slug: 'my-module',
      title: 'My Module Title',
    });
    expect(result.body).toBe('\n# Content here');
    expect(result.bodyStartLine).toBe(5);
  });

  it('returns error for missing frontmatter', () => {
    const content = '# No frontmatter here';

    const result = parseFrontmatter(content);

    expect(result.error).toBeDefined();
    expect(result.error?.message).toBe('Missing frontmatter');
    expect(result.error?.line).toBe(1);
  });

  it('returns error for unclosed frontmatter', () => {
    const content = `---
slug: broken
title: Never Closed`;

    const result = parseFrontmatter(content);

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('Unclosed frontmatter');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd content_processor && npm test -- frontmatter`
Expected: FAIL - module not found

**Step 3: Implement frontmatter parser**

```typescript
// src/parser/frontmatter.ts
import { parse as parseYaml } from 'yaml';
import type { ContentError } from '../index';

export interface FrontmatterResult {
  frontmatter: Record<string, unknown>;
  body: string;
  bodyStartLine: number;
  error?: ContentError;
}

// Matches: ---\n<yaml>\n---\n<body>
const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export function parseFrontmatter(content: string, file: string = ''): FrontmatterResult {
  const match = content.match(FRONTMATTER_PATTERN);

  if (!match) {
    // Check if it starts with --- but doesn't close
    if (content.startsWith('---\n') && !content.includes('\n---\n')) {
      return {
        frontmatter: {},
        body: content,
        bodyStartLine: 1,
        error: {
          file,
          line: 1,
          message: 'Unclosed frontmatter - missing closing ---',
          suggestion: 'Add --- on its own line after frontmatter fields',
          severity: 'error',
        },
      };
    }
    return {
      frontmatter: {},
      body: content,
      bodyStartLine: 1,
      error: {
        file,
        line: 1,
        message: 'Missing frontmatter',
        suggestion: "Add YAML frontmatter with 'slug' and 'title' fields",
        severity: 'error',
      },
    };
  }

  const yamlContent = match[1];
  const body = match[2];
  const bodyStartLine = yamlContent.split('\n').length + 3; // 1 for opening ---, N for yaml, 1 for closing ---

  try {
    const frontmatter = parseYaml(yamlContent) ?? {};
    return { frontmatter, body, bodyStartLine };
  } catch (e) {
    return {
      frontmatter: {},
      body,
      bodyStartLine,
      error: {
        file,
        line: 2,
        message: `Invalid YAML: ${e instanceof Error ? e.message : String(e)}`,
        suggestion: 'Check YAML syntax - colons, indentation, quoting',
        severity: 'error',
      },
    };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd content_processor && npm test -- frontmatter`
Expected: PASS

**Step 5: Commit**

```bash
git add content_processor/src/parser/
git commit -m "feat: implement frontmatter parser"
```

---

### Task 2.2: Section Parser

**Files:**
- Create: `content_processor/src/parser/sections.ts`
- Create: `content_processor/src/parser/sections.test.ts`

**Step 1: Write failing test**

```typescript
// src/parser/sections.test.ts
import { describe, it, expect } from 'vitest';
import { parseSections, MODULE_SECTION_TYPES, LENS_SECTION_TYPES } from './sections';

describe('parseSections', () => {
  it('splits content by H1 headers for modules', () => {
    const content = `
# Learning Outcome: First Section
source:: [[../Learning Outcomes/lo1.md|LO1]]

# Page: Second Section
id:: 123

Some content here.
`;

    const result = parseSections(content, 1, MODULE_SECTION_TYPES);

    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].type).toBe('learning-outcome');
    expect(result.sections[0].title).toBe('First Section');
    expect(result.sections[1].type).toBe('page');
    expect(result.sections[1].title).toBe('Second Section');
  });

  it('splits content by H3 headers for lens files', () => {
    const content = `
### Text: Introduction

#### Text
content:: Hello world.

### Article: Deep Dive
source:: [[../articles/deep.md|Article]]
`;

    const result = parseSections(content, 3, LENS_SECTION_TYPES);

    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].type).toBe('text');
    expect(result.sections[1].type).toBe('article');
  });

  it('extracts fields from section body', () => {
    const content = `
# Learning Outcome: Test
source:: [[../Learning Outcomes/lo1.md|LO1]]
optional:: true
`;

    const result = parseSections(content, 1, MODULE_SECTION_TYPES);

    expect(result.sections[0].fields.source).toBe('[[../Learning Outcomes/lo1.md|LO1]]');
    expect(result.sections[0].fields.optional).toBe('true');
  });

  it('returns error for unknown section type', () => {
    const content = `
# Unknown: Bad Section
content:: here
`;

    const result = parseSections(content, 1, MODULE_SECTION_TYPES);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('Unknown section type');
  });
});
```

**Step 2: Run test, verify failure**

Run: `cd content_processor && npm test -- sections`
Expected: FAIL

**Step 3: Implement section parser**

```typescript
// src/parser/sections.ts
import type { ContentError } from '../index';

export interface ParsedSection {
  type: string;
  title: string;
  rawType: string;
  fields: Record<string, string>;
  body: string;
  line: number;
}

export interface SectionsResult {
  sections: ParsedSection[];
  errors: ContentError[];
}

// Valid section types per file type (exported for use by other parsers)
export const MODULE_SECTION_TYPES = new Set(['learning outcome', 'page', 'uncategorized']);
export const LO_SECTION_TYPES = new Set(['lens', 'test']);
// Lens sections: input headers are `### Article:`, `### Video:`, `### Text:`
// Output types are `lens-article`, `lens-video`, `text` (v2 format)
export const LENS_SECTION_TYPES = new Set(['text', 'article', 'video']);

// Map input section names to output types for Lens files
export const LENS_OUTPUT_TYPE: Record<string, string> = {
  'text': 'text',
  'article': 'lens-article',
  'video': 'lens-video',
};

// Header pattern is parameterized by level (1-4)
function makeSectionPattern(level: number): RegExp {
  const hashes = '#'.repeat(level);
  return new RegExp(`^${hashes}\\s+([^:]+):\\s*(.*)$`, 'i');
}

export function parseSections(
  content: string,
  headerLevel: 1 | 2 | 3 | 4,
  validTypes: Set<string>,
  file: string = ''
): SectionsResult {
  const SECTION_HEADER_PATTERN = makeSectionPattern(headerLevel);
  const lines = content.split('\n');
  const sections: ParsedSection[] = [];
  const errors: ContentError[] = [];

  let currentSection: ParsedSection | null = null;
  let currentBody: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    const headerMatch = line.match(SECTION_HEADER_PATTERN);

    if (headerMatch) {
      // Save previous section
      if (currentSection) {
        currentSection.body = currentBody.join('\n');
        parseFields(currentSection);
        sections.push(currentSection);
      }

      const rawType = headerMatch[1].trim();
      const normalizedType = rawType.toLowerCase();
      const title = headerMatch[2].trim();

      if (!validTypes.has(normalizedType)) {
        errors.push({
          file,
          line: lineNum,
          message: `Unknown section type: ${rawType}`,
          suggestion: `Valid types: ${[...validTypes].join(', ')}`,
          severity: 'error',
        });
      }

      currentSection = {
        type: normalizedType.replaceAll(' ', '-'),
        title,
        rawType,
        fields: {},
        body: '',
        line: lineNum,
      };
      currentBody = [];
    } else if (currentSection) {
      currentBody.push(line);
    }
  }

  // Don't forget last section
  if (currentSection) {
    currentSection.body = currentBody.join('\n');
    parseFields(currentSection);
    sections.push(currentSection);
  }

  return { sections, errors };
}

const FIELD_PATTERN = /^(\w+)::\s*(.*)$/;

function parseFields(section: ParsedSection): void {
  for (const line of section.body.split('\n')) {
    const match = line.match(FIELD_PATTERN);
    if (match) {
      section.fields[match[1]] = match[2];
    }
  }
}
```

**Step 4: Run test, verify pass**

Run: `cd content_processor && npm test -- sections`
Expected: PASS

**Step 5: Commit**

```bash
git add content_processor/src/parser/
git commit -m "feat: implement section parser"
```

---

### Task 2.3: Wikilink Parser

**Files:**
- Create: `content_processor/src/parser/wikilink.ts`
- Create: `content_processor/src/parser/wikilink.test.ts`

**Step 1: Write failing test**

```typescript
// src/parser/wikilink.test.ts
import { describe, it, expect } from 'vitest';
import { parseWikilink, resolveWikilinkPath } from './wikilink';

describe('parseWikilink', () => {
  it('extracts path and display text', () => {
    const result = parseWikilink('[[../Learning Outcomes/lo1.md|My LO]]');

    expect(result?.path).toBe('../Learning Outcomes/lo1.md');
    expect(result?.display).toBe('My LO');
  });

  it('handles wikilink without display text', () => {
    const result = parseWikilink('[[path/to/file.md]]');

    expect(result?.path).toBe('path/to/file.md');
    expect(result?.display).toBeUndefined();
  });

  it('returns null for non-wikilink', () => {
    expect(parseWikilink('not a wikilink')).toBeNull();
    expect(parseWikilink('[regular](link)')).toBeNull();
  });

  it('handles embed syntax ![[path]]', () => {
    const result = parseWikilink('![[images/diagram.png]]');

    expect(result?.path).toBe('images/diagram.png');
    expect(result?.isEmbed).toBe(true);
  });

  it('handles embed with display text ![[path|alt text]]', () => {
    const result = parseWikilink('![[images/diagram.png|Architecture diagram]]');

    expect(result?.path).toBe('images/diagram.png');
    expect(result?.display).toBe('Architecture diagram');
    expect(result?.isEmbed).toBe(true);
  });
});

describe('resolveWikilinkPath', () => {
  it('resolves relative path from source file', () => {
    const resolved = resolveWikilinkPath(
      '../Learning Outcomes/lo1.md',
      'modules/intro.md'
    );

    expect(resolved).toBe('Learning Outcomes/lo1.md');
  });

  it('handles nested paths', () => {
    const resolved = resolveWikilinkPath(
      '../Lenses/category/lens1.md',
      'Learning Outcomes/lo1.md'
    );

    expect(resolved).toBe('Lenses/category/lens1.md');
  });
});
```

**Step 2: Run test, verify failure**

**Step 3: Implement wikilink parser**

```typescript
// src/parser/wikilink.ts
import { join, dirname, normalize } from 'path';

export interface WikilinkParts {
  path: string;
  display?: string;
  isEmbed?: boolean;  // true for ![[embed]] syntax
}

// Matches [[path]], [[path|display]], ![[embed]], ![[embed|display]]
const WIKILINK_PATTERN = /^!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/;

export function parseWikilink(text: string): WikilinkParts | null {
  const match = text.match(WIKILINK_PATTERN);
  if (!match) return null;

  return {
    path: match[1].trim(),
    display: match[2]?.trim(),
    isEmbed: text.startsWith('!'),
  };
}

export function resolveWikilinkPath(linkPath: string, sourceFile: string): string {
  // Use Node's path module - normalize handles .. and . segments
  return normalize(join(dirname(sourceFile), linkPath)).replace(/\\/g, '/');
}
```

**Step 4: Run test, verify pass**

**Step 5: Commit**

```bash
git add content_processor/src/parser/
git commit -m "feat: implement wikilink parser"
```

---

### Task 2.4: Module Parser (Orchestrator)

**Files:**
- Create: `content_processor/src/parser/module.ts`
- Create: `content_processor/src/parser/module.test.ts`

**Step 1: Write failing test**

```typescript
// src/parser/module.test.ts
import { describe, it, expect } from 'vitest';
import { parseModule } from './module';

describe('parseModule', () => {
  it('parses complete module', () => {
    const content = `---
slug: intro
title: Introduction
---

# Learning Outcome: First Topic
source:: [[../Learning Outcomes/lo1.md|LO1]]
`;

    const result = parseModule(content, 'modules/intro.md');

    expect(result.module?.slug).toBe('intro');
    expect(result.module?.title).toBe('Introduction');
    expect(result.module?.sections).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
  });

  it('collects errors from all parsing stages', () => {
    const content = `# No frontmatter

# Unknown: Bad Type
`;

    const result = parseModule(content, 'modules/bad.md');

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.message.includes('frontmatter'))).toBe(true);
  });
});
```

**Step 2: Run test, verify failure**

**Step 3: Implement module parser**

```typescript
// src/parser/module.ts
import type { ContentError } from '../index';
import { parseFrontmatter } from './frontmatter';
import { parseSections, MODULE_SECTION_TYPES, type ParsedSection } from './sections';

export interface ParsedModule {
  slug: string;
  title: string;
  contentId: string | null;
  sections: ParsedSection[];
}

export interface ModuleParseResult {
  module: ParsedModule | null;
  errors: ContentError[];
}

export function parseModule(content: string, file: string): ModuleParseResult {
  const errors: ContentError[] = [];

  // Parse frontmatter
  const frontmatterResult = parseFrontmatter(content, file);
  if (frontmatterResult.error) {
    errors.push(frontmatterResult.error);
    return { module: null, errors };
  }

  const { frontmatter, body, bodyStartLine } = frontmatterResult;

  // Validate required frontmatter fields
  if (!frontmatter.slug) {
    errors.push({
      file,
      line: 2,
      message: 'Missing required field: slug',
      suggestion: "Add 'slug: your-module-slug' to frontmatter",
      severity: 'error',
    });
  }

  if (!frontmatter.title) {
    errors.push({
      file,
      line: 2,
      message: 'Missing required field: title',
      suggestion: "Add 'title: Your Module Title' to frontmatter",
      severity: 'error',
    });
  }

  if (errors.length > 0) {
    return { module: null, errors };
  }

  // Parse sections (H1 headers for module files)
  const sectionsResult = parseSections(body, 1, MODULE_SECTION_TYPES, file);

  // Adjust line numbers to account for frontmatter
  for (const error of sectionsResult.errors) {
    if (error.line) {
      error.line += bodyStartLine - 1;
    }
  }
  errors.push(...sectionsResult.errors);

  for (const section of sectionsResult.sections) {
    section.line += bodyStartLine - 1;
  }

  const module: ParsedModule = {
    slug: frontmatter.slug as string,
    title: frontmatter.title as string,
    contentId: (frontmatter.id as string) ?? null,
    sections: sectionsResult.sections,
  };

  return { module, errors };
}
```

**Step 4: Run test, verify pass**

**Step 5: Commit**

```bash
git add content_processor/src/parser/
git commit -m "feat: implement module parser orchestrator"
```

---

## Phase 3: Flattener

The flattener resolves references: Module → Learning Outcomes → Lenses → Segments.

### Task 3.1: Learning Outcome Parser

**Files:**
- Create: `content_processor/src/parser/learning-outcome.ts`
- Create: `content_processor/src/parser/learning-outcome.test.ts`

**Step 1: Write failing test**

```typescript
// src/parser/learning-outcome.test.ts
import { describe, it, expect } from 'vitest';
import { parseLearningOutcome } from './learning-outcome';

describe('parseLearningOutcome', () => {
  it('parses LO with multiple lenses', () => {
    const content = `---
id: 550e8400-e29b-41d4-a716-446655440001
---

## Lens: First Lens
source:: [[../Lenses/lens1.md|Lens 1]]

## Lens: Second Lens
source:: [[../Lenses/lens2.md|Lens 2]]
optional:: true

## Test: Knowledge Check
source:: [[../Tests/test1.md|Test]]
`;

    const result = parseLearningOutcome(content, 'Learning Outcomes/lo1.md');

    expect(result.learningOutcome?.id).toBe('550e8400-e29b-41d4-a716-446655440001');
    expect(result.learningOutcome?.lenses).toHaveLength(2);
    expect(result.learningOutcome?.lenses[1].optional).toBe(true);
    expect(result.learningOutcome?.test?.source).toContain('test1.md');
  });

  it('requires id in frontmatter', () => {
    const content = `---
title: Missing ID
---

## Lens: Test
source:: [[../Lenses/lens1.md|Lens]]
`;

    const result = parseLearningOutcome(content, 'Learning Outcomes/bad.md');

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('id');
  });

  it('requires at least one lens', () => {
    const content = `---
id: 550e8400-e29b-41d4-a716-446655440001
---

No lenses here.
`;

    const result = parseLearningOutcome(content, 'Learning Outcomes/empty.md');

    expect(result.errors.some(e => e.message.includes('Lens'))).toBe(true);
  });
});
```

**Step 2-5: Implement following TDD cycle**

```typescript
// src/parser/learning-outcome.ts
export interface ParsedLensRef {
  source: string;       // Raw wikilink
  resolvedPath: string; // Resolved file path
  optional: boolean;
}

export interface ParsedTestRef {
  source: string;
  resolvedPath: string;
}

export interface ParsedLearningOutcome {
  id: string;
  lenses: ParsedLensRef[];
  test?: ParsedTestRef;
  discussion?: string;
}
```

### Task 3.2: Lens Parser

**Files:**
- Create: `content_processor/src/parser/lens.ts`
- Create: `content_processor/src/parser/lens.test.ts`

**Step 1: Write failing test**

```typescript
// src/parser/lens.test.ts
import { describe, it, expect } from 'vitest';
import { parseLens } from './lens';

describe('parseLens', () => {
  it('parses lens with text segment (H3 section, H4 segment)', () => {
    const content = `---
id: 550e8400-e29b-41d4-a716-446655440002
---

### Text: Introduction

#### Text
content:: This is introductory content.
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    expect(result.lens?.id).toBe('550e8400-e29b-41d4-a716-446655440002');
    expect(result.lens?.sections).toHaveLength(1);
    expect(result.lens?.sections[0].type).toBe('text');
    expect(result.lens?.sections[0].segments[0].type).toBe('text');
  });

  it('parses article section with excerpt', () => {
    const content = `---
id: 550e8400-e29b-41d4-a716-446655440002
---

### Article: Deep Dive
source:: [[../articles/deep-dive.md|Article]]

#### Article-excerpt
from:: "The key insight is"
to:: "understanding this concept."
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    expect(result.lens?.sections[0].type).toBe('lens-article');
    expect(result.lens?.sections[0].segments[0].type).toBe('article-excerpt');
    // Note: from/to are parsed as strings here, converted to anchors during bundling
    expect(result.lens?.sections[0].segments[0].fromAnchor).toBe('The key insight is');
    expect(result.lens?.sections[0].segments[0].toAnchor).toBe('understanding this concept.');
  });

  it('parses video section with timestamp excerpt', () => {
    const content = `---
id: 550e8400-e29b-41d4-a716-446655440002
---

### Video: Expert Interview
source:: [[../video_transcripts/interview.md|Video]]

#### Video-excerpt
from:: 1:30
to:: 5:45
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    expect(result.lens?.sections[0].type).toBe('lens-video');
    expect(result.lens?.sections[0].segments[0].type).toBe('video-excerpt');
    // Parsed as strings, converted to seconds during bundling
    expect(result.lens?.sections[0].segments[0].fromTimeStr).toBe('1:30');
    expect(result.lens?.sections[0].segments[0].toTimeStr).toBe('5:45');
  });

  it('requires source field in article/video sections', () => {
    const content = `---
id: 550e8400-e29b-41d4-a716-446655440002
---

### Article: No Source

#### Article-excerpt
from:: "Start"
to:: "End"
`;

    const result = parseLens(content, 'Lenses/bad.md');

    expect(result.errors.some(e => e.message.includes('source'))).toBe(true);
  });
});
```

### Task 3.3: Article Content Extractor

**Files:**
- Create: `content_processor/src/bundler/article.ts`
- Create: `content_processor/src/bundler/article.test.ts`

This is critical—extracts text between anchors from article markdown.

**Step 1: Write failing test**

```typescript
// src/bundler/article.test.ts
import { describe, it, expect } from 'vitest';
import { extractArticleExcerpt } from './article';

describe('extractArticleExcerpt', () => {
  it('extracts content between anchors', () => {
    const article = `# Article Title

Some intro text.

The key insight is that AI alignment requires careful consideration
of human values. This is a complex problem that involves
understanding this concept.

More content after.
`;

    const result = extractArticleExcerpt(
      article,
      'The key insight is',
      'understanding this concept.',
      'articles/test.md'
    );

    expect(result.content).toContain('AI alignment');
    expect(result.content).toContain('human values');
    expect(result.error).toBeUndefined();
  });

  it('returns error for missing start anchor', () => {
    const article = 'Some content without the anchor.';

    const result = extractArticleExcerpt(
      article,
      'nonexistent anchor',
      'also missing',
      'articles/test.md'
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('not found');
    expect(result.error?.suggestion).toContain('anchor');
  });

  it('returns error for duplicate anchor', () => {
    const article = `First occurrence of the phrase here.

And another occurrence of the phrase here.`;

    const result = extractArticleExcerpt(
      article,
      'occurrence of the phrase',
      'here',
      'articles/test.md'
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('multiple');
  });

  it('is case-insensitive for matching', () => {
    const article = 'THE KEY INSIGHT is important.';

    const result = extractArticleExcerpt(
      article,
      'the key insight',
      'important.',
      'articles/test.md'
    );

    expect(result.content).toBeDefined();
    expect(result.error).toBeUndefined();
  });
});
```

**Step 2-5: Implement** (matches Python's `find_excerpt_bounds` logic)

### Task 3.4: Collapsed Content Bundler

**Files:**
- Modify: `content_processor/src/bundler/article.ts`
- Create: `content_processor/src/bundler/article-collapsed.test.ts`

This task adds `collapsed_before` and `collapsed_after` fields for the collapsible UI.

**Step 1: Write failing test**

```typescript
// src/bundler/article-collapsed.test.ts
import { describe, it, expect } from 'vitest';
import { bundleArticleWithCollapsed } from './article';

describe('collapsed content bundling', () => {
  it('computes collapsed_before for non-first excerpt', () => {
    const article = `# Article

Intro paragraph.

First important section that we want to show.

Middle content that gets collapsed.

Second important section to show.

Conclusion.
`;
    const excerpts = [
      { from: 'First important', to: 'want to show.' },
      { from: 'Second important', to: 'section to show.' },
    ];

    const result = bundleArticleWithCollapsed(article, excerpts, 'articles/test.md');

    expect(result[0].collapsed_before).toBeUndefined(); // First excerpt has no collapsed_before
    expect(result[1].collapsed_before).toContain('Middle content');
  });

  it('computes collapsed_after for last excerpt', () => {
    const article = `Intro.

Main content here.

Conclusion paragraph at the end.
`;
    const excerpts = [
      { from: 'Main content', to: 'content here.' },
    ];

    const result = bundleArticleWithCollapsed(article, excerpts, 'articles/test.md');

    expect(result[0].collapsed_after).toContain('Conclusion paragraph');
  });

  it('handles adjacent excerpts with no collapsed content', () => {
    const article = `First sentence. Second sentence.`;
    const excerpts = [
      { from: 'First', to: 'sentence.' },
      { from: 'Second', to: 'sentence.' },
    ];

    const result = bundleArticleWithCollapsed(article, excerpts, 'articles/test.md');

    expect(result[0].collapsed_after).toBeUndefined();
    expect(result[1].collapsed_before).toBeUndefined();
  });
});
```

**Step 2-5: Implement** following TDD cycle

### Task 3.5: Video Transcript Extractor

**Files:**
- Create: `content_processor/src/bundler/video.ts`
- Create: `content_processor/src/bundler/video.test.ts`

**Step 1: Write failing test**

```typescript
// src/bundler/video.test.ts
import { describe, it, expect } from 'vitest';
import { extractVideoExcerpt, parseTimestamp } from './video';

describe('parseTimestamp', () => {
  it('converts MM:SS to seconds', () => {
    expect(parseTimestamp('1:30')).toBe(90);
    expect(parseTimestamp('5:45')).toBe(345);
    expect(parseTimestamp('0:00')).toBe(0);
  });

  it('converts H:MM:SS to seconds', () => {
    expect(parseTimestamp('1:30:00')).toBe(5400);
    expect(parseTimestamp('2:15:30')).toBe(8130);
  });

  it('returns null for invalid format', () => {
    expect(parseTimestamp('invalid')).toBeNull();
    expect(parseTimestamp('abc:def')).toBeNull();
  });
});

describe('extractVideoExcerpt', () => {
  it('extracts transcript between timestamps and returns seconds', () => {
    const transcript = `0:00 - Welcome to this video.
0:30 - Today we'll discuss AI safety.
1:30 - The first key point is alignment.
2:00 - This means ensuring AI does what we want.
5:45 - Moving on to the next topic.
6:00 - Let's talk about interpretability.
`;

    const result = extractVideoExcerpt(
      transcript,
      '1:30',   // 90 seconds
      '5:45',   // 345 seconds
      'video_transcripts/test.md'
    );

    expect(result.from).toBe(90);           // Seconds as number
    expect(result.to).toBe(345);            // Seconds as number
    expect(result.transcript).toContain('alignment');
    expect(result.transcript).toContain('what we want');
    expect(result.transcript).not.toContain('Welcome');
    expect(result.transcript).not.toContain('interpretability');
  });

  it('returns error for invalid timestamp format', () => {
    const transcript = '0:00 - Content here.';

    const result = extractVideoExcerpt(
      transcript,
      'invalid',
      '1:00',
      'video_transcripts/test.md'
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('timestamp');
    expect(result.error?.suggestion).toContain('MM:SS');
  });

  it('returns error when timestamp not found in transcript', () => {
    const transcript = '0:00 - Short video.\n0:30 - End.';

    const result = extractVideoExcerpt(
      transcript,
      '5:00',
      '10:00',
      'video_transcripts/test.md'
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('not found');
  });
});
```

### Task 3.6: Flattener Core

**Files:**
- Create: `content_processor/src/flattener/index.ts`
- Create: `content_processor/src/flattener/index.test.ts`

**Step 1: Write failing test using fixture**

```typescript
// src/flattener/index.test.ts
import { describe, it, expect } from 'vitest';
import { flattenModule } from './index';

describe('flattenModule', () => {
  it('resolves learning outcome references', () => {
    const files = new Map([
      ['modules/intro.md', `---
slug: intro
title: Intro
---

# Learning Outcome: Topic
source:: [[../Learning Outcomes/lo1.md|LO1]]
`],
      ['Learning Outcomes/lo1.md', `---
id: 550e8400-e29b-41d4-a716-446655440001
---

## Lens: Basic
source:: [[../Lenses/lens1.md|Lens]]
`],
      ['Lenses/lens1.md', `---
id: 550e8400-e29b-41d4-a716-446655440002
---

### Text: Content

#### Text
content:: The actual content here.
`],
    ]);

    const result = flattenModule('modules/intro.md', files);

    expect(result.module).toBeDefined();
    expect(result.module?.sections[0].segments[0].content).toBe('The actual content here.');
  });

  it('returns error for missing reference', () => {
    const files = new Map([
      ['modules/broken.md', `---
slug: broken
title: Broken
---

# Learning Outcome: Missing
source:: [[../Learning Outcomes/nonexistent.md|Missing]]
`],
    ]);

    const result = flattenModule('modules/broken.md', files);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain('not found');
  });
});
```

**Step 2-5: Implement and iterate** (following TDD cycle)

---

## Phase 4: Main Processor

### Task 4.1: Process Content Orchestrator

**Files:**
- Modify: `content_processor/src/index.ts`

**Step 1: The fixture tests from Task 1.2 are our failing tests**

Run: `cd content_processor && npm test -- process-fixtures`
Expected: FAIL (still returning empty result)

**Step 2: Implement processContent**

```typescript
// src/index.ts
import { parseModule } from './parser/module';
import { parseCourse } from './parser/course';
import { flattenModule } from './flattener';

export function processContent(files: Map<string, string>): ProcessResult {
  const modules: FlattenedModule[] = [];
  const courses: Course[] = [];
  const errors: ContentError[] = [];

  // Identify file types by path
  for (const [path, content] of files) {
    if (path.startsWith('modules/')) {
      const result = flattenModule(path, files);

      if (result.module) {
        modules.push(result.module);
      }

      errors.push(...result.errors);
    } else if (path.startsWith('courses/')) {
      const result = parseCourse(content, path);

      if (result.course) {
        courses.push(result.course);
      }

      errors.push(...result.errors);
    }
    // Learning Outcomes, Lenses, articles are processed via references
  }

  return { modules, courses, errors };
}
```

**Step 3: Run fixture tests**

Run: `cd content_processor && npm test -- process-fixtures`
Expected: PASS (once all components are implemented)

**Step 4: Commit**

```bash
git add content_processor/
git commit -m "feat: implement main processContent orchestrator"
```

---

## Phase 5: CLI and Python Integration

### Task 5.1: CLI Interface

**Files:**
- Create: `content_processor/src/cli.ts`

```typescript
// src/cli.ts
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { processContent } from './index';

const [,, command, dir = '.'] = process.argv;

if (command === 'validate') {
  // Load all .md files recursively
  const files = new Map<string, string>();
  const loadDir = (base: string, prefix = '') => {
    for (const name of readdirSync(join(base, prefix))) {
      const rel = prefix ? `${prefix}/${name}` : name;
      if (statSync(join(base, rel)).isDirectory()) loadDir(base, rel);
      else if (name.endsWith('.md')) files.set(rel, readFileSync(join(base, rel), 'utf-8'));
    }
  };
  loadDir(dir);

  const { errors } = processContent(files);
  if (errors.length) {
    console.error(JSON.stringify({ errors }, null, 2));
    process.exit(1);
  }
  console.log('OK');

} else if (command === 'process') {
  // Read file map from stdin (for Python subprocess)
  const input = readFileSync(0, 'utf-8');
  const files = new Map(Object.entries(JSON.parse(input)));
  console.log(JSON.stringify(processContent(files)));

} else {
  console.error('Usage: tsx src/cli.ts <validate|process> [directory]');
  process.exit(1);
}
```

### Task 5.2: Python Subprocess Caller

**Files:**
- Create: `core/content/ts_processor.py`

```python
# core/content/ts_processor.py
import asyncio
import json
from pathlib import Path

PROCESSOR_DIR = Path(__file__).parent.parent.parent / "content_processor"


async def process_content(files: dict[str, str]) -> dict:
    """Call TypeScript content processor as subprocess."""
    proc = await asyncio.create_subprocess_exec(
        "npx", "tsx", "src/cli.ts", "process",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=PROCESSOR_DIR,
    )
    out, err = await proc.communicate(json.dumps(files).encode())
    if proc.returncode:
        raise RuntimeError(f"Content processor failed: {err.decode()}")
    return json.loads(out)
```

### Task 5.3: Integration Test

**Files:**
- Create: `core/content/tests/test_ts_processor.py`

```python
# core/content/tests/test_ts_processor.py
import pytest
from core.content.ts_processor import process_content


@pytest.mark.asyncio
async def test_process_simple_module():
    files = {
        "modules/intro.md": """---
slug: intro
title: Introduction
---

# Learning Outcome: First
source:: [[../Learning Outcomes/lo1.md|LO1]]
""",
        "Learning Outcomes/lo1.md": """---
id: 550e8400-e29b-41d4-a716-446655440001
---

## Lens: Basic
source:: [[../Lenses/lens1.md|Lens]]
""",
        "Lenses/lens1.md": """---
id: 550e8400-e29b-41d4-a716-446655440002
---

### Text: Content

#### Text
content:: Hello world.
""",
    }

    result = await process_content(files)

    assert len(result["modules"]) == 1
    assert result["modules"][0]["slug"] == "intro"
    assert len(result["errors"]) == 0
```

---

## Phase 6: CI Integration

### Task 6.1: GitHub Actions Workflow

**Files:**
- Modify: `.github/workflows/ci.yml`

Add step:

```yaml
- name: Validate content
  run: |
    cd content_processor
    npm ci
    npm run validate ../path/to/content/repo
```

---

---

## Phase 3.5: Course Parser

### Task 3.7: Course Parser

**Files:**
- Create: `content_processor/src/parser/course.ts`
- Create: `content_processor/src/parser/course.test.ts`

**Step 1: Write failing test**

```typescript
// src/parser/course.test.ts
import { describe, it, expect } from 'vitest';
import { parseCourse } from './course';

describe('parseCourse', () => {
  it('parses course with module references', () => {
    const content = `---
slug: intro-course
title: Introduction to AI Safety
---

# Module: [[../modules/intro.md|Introduction]]

# Module: [[../modules/advanced.md|Advanced Topics]]
optional:: true

# Meeting: 1

# Module: [[../modules/conclusion.md|Conclusion]]
`;

    const result = parseCourse(content, 'courses/intro.md');

    expect(result.course?.slug).toBe('intro-course');
    expect(result.course?.progression).toHaveLength(4);
    expect(result.course?.progression[0].type).toBe('module');
    expect(result.course?.progression[0].slug).toBe('intro');
    expect(result.course?.progression[1].optional).toBe(true);
    expect(result.course?.progression[2].type).toBe('meeting');
    expect(result.course?.progression[2].number).toBe(1);
  });

  it('validates module references exist', () => {
    const content = `---
slug: broken-course
title: Broken Course
---

# Module: [[../modules/nonexistent.md|Missing]]
`;

    // Note: Reference validation happens in processContent, not parseCourse
    const result = parseCourse(content, 'courses/broken.md');

    expect(result.course).toBeDefined();
    // Errors about missing modules added during flattening
  });
});
```

---

## Errors vs Warnings

The processor distinguishes between:

**Errors** (severity: 'error') - Content cannot be served correctly:
- Missing frontmatter
- Missing required fields (slug, title, id)
- Broken wikilinks (referenced file doesn't exist)
- Missing anchors in articles
- Duplicate/ambiguous anchors
- Invalid timestamps in video excerpts

**Warnings** (severity: 'warning') - Content works but could be improved:
- Style suggestions (e.g., "Consider adding a description")
- Unused files (Lens defined but never referenced)
- Very long content without sections

Note: There is no backward compatibility with v1 formats. Invalid formats produce errors, not warnings.

---

## Fixture Checklist

Before considering this implementation complete, ensure fixtures exist for:

**Golden master (Python compatibility):**
- [x] `golden/actual-content` - 28 files traced from real course (1 course, 3 modules, 4 LOs, 9 lenses, 7 articles, 4 video files)
- [x] `golden/software-demo` - 11 files with alternative formatting (uncategorized sections, chat flags, multiple video excerpts)

**Valid cases:**
- [ ] `valid/minimal-module` - Single module with one LO, one lens, one text segment
- [ ] `valid/module-with-article` - Module referencing article with excerpt anchors
- [ ] `valid/module-with-video` - Module referencing video transcript with timestamps
- [ ] `valid/multi-section-module` - Module with Page, LO, Uncategorized sections
- [ ] `valid/course-with-modules` - Course referencing multiple modules with meetings
- [ ] `valid/optional-segments` - LO with optional lenses marked `optional:: true`
- [ ] `valid/chat-segment` - Module with chat segment and all chat fields
- [ ] `valid/mixed-segments` - Lens with text, chat, and excerpt segments together
- [ ] `valid/nested-lo` - Module with multiple LOs, each with multiple lenses

**Invalid cases (each should produce specific error):**
- [ ] `invalid/missing-frontmatter` - No YAML frontmatter
- [ ] `invalid/missing-slug` - Frontmatter without slug
- [ ] `invalid/missing-title` - Frontmatter without title
- [ ] `invalid/invalid-yaml` - Malformed YAML syntax
- [ ] `invalid/unknown-section-type` - `# BadType: Title` (not LO/Page/Uncategorized)
- [ ] `invalid/broken-wikilink` - Reference to nonexistent file
- [ ] `invalid/missing-lo-source` - LO section without source:: field
- [ ] `invalid/missing-lens-source` - Lens without source:: in parent LO
- [ ] `invalid/missing-lo-id` - Learning Outcome file without id in frontmatter
- [ ] `invalid/missing-lens-id` - Lens file without id in frontmatter
- [ ] `invalid/missing-anchor-start` - Article excerpt with from:: anchor not in article
- [ ] `invalid/missing-anchor-end` - Article excerpt with to:: anchor not in article
- [ ] `invalid/duplicate-anchor` - Article with ambiguous (non-unique) anchor text
- [ ] `invalid/anchor-wrong-order` - to:: anchor appears before from:: anchor
- [ ] `invalid/missing-required-segment` - Article section without article-excerpt segment
- [ ] `invalid/video-invalid-timestamp` - Video excerpt with malformed timestamp
- [ ] `invalid/video-timestamp-not-found` - Video timestamp not in transcript
- [ ] `invalid/no-lenses-in-lo` - Learning Outcome with zero ## Lens sections
- [ ] `invalid/multiple-tests-in-lo` - Learning Outcome with more than one ## Test section
- [ ] `invalid/course-missing-module` - Course referencing module that doesn't exist
- [ ] `invalid/circular-reference` - File A references file B which references file A

---

## Design Decisions

### Partial Success

When processing multiple modules, **continue on error**. If module A fails to flatten, still process modules B, C, D. Each module gets its own error in the output:

```typescript
{
  modules: [
    { slug: "a", error: "Missing anchor in article", sections: [] },
    { slug: "b", sections: [...] },  // Processed successfully
    { slug: "c", sections: [...] },  // Processed successfully
  ],
  errors: [
    { file: "modules/a.md", line: 15, message: "Missing anchor..." }
  ]
}
```

This allows the frontend to show what it can while indicating errors.

### Critic Markup Stripping

Obsidian's Critic Markup (for track changes) must be stripped before processing:

```markdown
This is {++added++} and {--deleted--} text with {~~old~>new~~} substitutions.
```

Becomes: `This is added text with new substitutions.`

Add a preprocessing step that strips critic markup (reject all changes mode, matching Python behavior).

### Case Insensitivity

- Header types are case-insensitive: `# Learning Outcome:` = `# learning outcome:`
- Anchor matching is case-insensitive (but preserves original text in output)
- Field names are case-sensitive: `source::` not `Source::`

### Error Location Precision

Errors include:
- `line`: 1-indexed line number

Column-level precision (`column`, `endLine`, `endColumn`) can be added later when building the Obsidian plugin. For CLI/CI use cases, line numbers provide sufficient localization.

---

## Summary

**Total tasks:** ~35 bite-sized tasks across 6 phases

**Key principle:** Every feature starts with a fixture. Fixtures ARE the specification.

**Commands:**
```bash
# Run tests
cd content_processor && npm test

# Run specific test file
cd content_processor && npm test -- frontmatter

# Validate a content directory
cd content_processor && npm run validate <content-dir>

# Process content (outputs JSON to stdout)
cd content_processor && npm run process < files.json
```

**Success criteria:**
1. All fixture tests pass
2. Python integration test passes
3. CI validation runs on content repo
4. Error messages include line numbers and suggestions
