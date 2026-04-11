# TypeScript Markdown Validator & Obsidian Plugin Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a TypeScript markdown validator that runs in an Obsidian plugin, with shared test fixtures ensuring parity with the Python validator.

**Architecture:** Extract test fixtures to shared JSON/MD files. Port Python validator logic to TypeScript. Build Obsidian plugin that fetches validator from GitHub at runtime. Both Python and TypeScript test suites validate against same fixtures.

**Tech Stack:** TypeScript, Vitest, Obsidian Plugin API, Node.js fs for tests

---

## Phase 1: Shared Test Fixtures

### Task 1: Create fixtures directory structure

**Files:**
- Create: `core/modules/tests/fixtures/validator/valid/`
- Create: `core/modules/tests/fixtures/validator/invalid/`
- Create: `core/modules/tests/fixtures/validator/manifest.json`

**Step 1: Create directory structure**

```bash
mkdir -p core/modules/tests/fixtures/validator/valid
mkdir -p core/modules/tests/fixtures/validator/invalid
```

**Step 2: Create manifest.json skeleton**

Create file `core/modules/tests/fixtures/validator/manifest.json`:

```json
{
  "version": 1,
  "description": "Shared test fixtures for Python and TypeScript validators",
  "valid": [],
  "invalid": []
}
```

**Step 3: Commit**

```bash
git add core/modules/tests/fixtures/validator/
git commit -m "chore: create shared validator fixtures directory structure"
```

---

### Task 2: Extract valid module fixtures from Python tests

**Files:**
- Create: `core/modules/tests/fixtures/validator/valid/module-page-basic.md`
- Create: `core/modules/tests/fixtures/validator/valid/module-page-with-segments.md`
- Create: `core/modules/tests/fixtures/validator/valid/module-learning-outcome-ref.md`
- Create: `core/modules/tests/fixtures/validator/valid/module-uncategorized-with-lens.md`
- Modify: `core/modules/tests/fixtures/validator/manifest.json`

**Step 1: Create module-page-basic.md**

```markdown
---
slug: test-lesson
title: Test Lesson
---

# Page: Introduction
id:: 11111111-1111-1111-1111-111111111111
## Text
content::
Hello world
```

**Step 2: Create module-page-with-segments.md**

```markdown
---
slug: test
title: Test
---

# Page: Test Page
id:: 11111111-1111-1111-1111-111111111111

## Text
content::
Watch this.

## Chat
instructions::
Discuss what you saw.
```

**Step 3: Create module-learning-outcome-ref.md**

```markdown
---
slug: test
title: Test
---

# Learning Outcome:
source:: [[../Learning Outcomes/Core Concepts]]
```

**Step 4: Create module-uncategorized-with-lens.md**

```markdown
---
slug: test
title: Test
---

# Uncategorized:
## Lens:
source:: [[../Lenses/Some Lens]]
```

**Step 5: Update manifest.json**

```json
{
  "version": 1,
  "description": "Shared test fixtures for Python and TypeScript validators",
  "valid": [
    {
      "file": "valid/module-page-basic.md",
      "type": "module",
      "description": "Minimal valid module with Page section"
    },
    {
      "file": "valid/module-page-with-segments.md",
      "type": "module",
      "description": "Page with Text and Chat segments"
    },
    {
      "file": "valid/module-learning-outcome-ref.md",
      "type": "module",
      "description": "Module referencing Learning Outcome"
    },
    {
      "file": "valid/module-uncategorized-with-lens.md",
      "type": "module",
      "description": "Uncategorized section with Lens"
    }
  ],
  "invalid": []
}
```

**Step 6: Commit**

```bash
git add core/modules/tests/fixtures/validator/
git commit -m "feat: add valid module fixtures for shared testing"
```

---

### Task 3: Extract invalid module fixtures from Python tests

**Files:**
- Create: `core/modules/tests/fixtures/validator/invalid/module-missing-frontmatter.md`
- Create: `core/modules/tests/fixtures/validator/invalid/module-missing-slug.md`
- Create: `core/modules/tests/fixtures/validator/invalid/module-missing-title.md`
- Create: `core/modules/tests/fixtures/validator/invalid/module-page-missing-id.md`
- Create: `core/modules/tests/fixtures/validator/invalid/module-page-missing-title.md`
- Create: `core/modules/tests/fixtures/validator/invalid/module-invalid-section-type.md`
- Create: `core/modules/tests/fixtures/validator/invalid/module-invalid-segment-type.md`
- Create: `core/modules/tests/fixtures/validator/invalid/module-text-missing-content.md`
- Create: `core/modules/tests/fixtures/validator/invalid/module-chat-missing-instructions.md`
- Create: `core/modules/tests/fixtures/validator/invalid/module-unknown-field.md`
- Create: `core/modules/tests/fixtures/validator/invalid/module-old-video-section.md`
- Create: `core/modules/tests/fixtures/validator/invalid/module-lo-section-with-title.md`
- Create: `core/modules/tests/fixtures/validator/invalid/module-uncategorized-with-title.md`
- Modify: `core/modules/tests/fixtures/validator/manifest.json`

**Step 1: Create module-missing-frontmatter.md**

```markdown
# Page: Introduction
id:: 11111111-1111-1111-1111-111111111111
## Text
content::
Hello world
```

**Step 2: Create module-missing-slug.md**

```markdown
---
title: Test
---

# Page: Intro
id:: 11111111-1111-1111-1111-111111111111
## Text
content::
Hello
```

**Step 3: Create module-missing-title.md**

```markdown
---
slug: test
---

# Page: Intro
id:: 11111111-1111-1111-1111-111111111111
## Text
content::
Hello
```

**Step 4: Create module-page-missing-id.md**

```markdown
---
slug: test
title: Test
---

# Page: Test Page

## Text
content::
Hello
```

**Step 5: Create module-invalid-section-type.md**

```markdown
---
slug: test
title: Test
---

# Invalid: Something
content::
Hello
```

**Step 6: Create module-text-missing-content.md**

```markdown
---
slug: test
title: Test
---

# Page: Test
id:: 11111111-1111-1111-1111-111111111111

## Text
```

**Step 7: Create module-chat-missing-instructions.md**

```markdown
---
slug: test
title: Test
---

# Page: Test
id:: 11111111-1111-1111-1111-111111111111

## Chat
hidePreviousContentFromUser:: true
```

**Step 8: Create module-unknown-field.md**

```markdown
---
slug: test
title: Test
---

# Page: Test
id:: 11111111-1111-1111-1111-111111111111
foo:: bar
```

**Step 9: Create module-old-video-section.md**

```markdown
---
slug: test
title: Test
---

# Video: Old Style
source:: [[../video_transcripts/foo]]

## Video-excerpt
```

**Step 10: Create module-page-missing-title.md**

```markdown
---
slug: test
title: Test
---

# Page:
id:: 11111111-1111-1111-1111-111111111111

## Text
content::
Hello
```

**Step 11: Create module-invalid-segment-type.md**

```markdown
---
slug: test
title: Test
---

# Page: Test
id:: 11111111-1111-1111-1111-111111111111

## InvalidSegment
content::
Hello
```

**Step 12: Create module-lo-section-with-title.md**

```markdown
---
slug: test
title: Test
---

# Learning Outcome: Unexpected Title
source:: [[../Learning Outcomes/Core Concepts]]
```

**Step 13: Create module-uncategorized-with-title.md**

```markdown
---
slug: test
title: Test
---

# Uncategorized: Unexpected Title
## Lens:
source:: [[../Lenses/Some Lens]]
```

**Step 14: Update manifest.json with invalid entries**

Add to the "invalid" array:

```json
{
  "invalid": [
    {
      "file": "invalid/module-missing-frontmatter.md",
      "type": "module",
      "description": "Module without frontmatter",
      "expectedErrors": ["frontmatter"]
    },
    {
      "file": "invalid/module-missing-slug.md",
      "type": "module",
      "description": "Module missing slug field",
      "expectedErrors": ["slug"]
    },
    {
      "file": "invalid/module-missing-title.md",
      "type": "module",
      "description": "Module missing title field",
      "expectedErrors": ["title"]
    },
    {
      "file": "invalid/module-page-missing-id.md",
      "type": "module",
      "description": "Page section without id",
      "expectedErrors": ["id"]
    },
    {
      "file": "invalid/module-invalid-section-type.md",
      "type": "module",
      "description": "Invalid section type",
      "expectedErrors": ["Invalid section type"]
    },
    {
      "file": "invalid/module-text-missing-content.md",
      "type": "module",
      "description": "Text segment missing content",
      "expectedErrors": ["content"]
    },
    {
      "file": "invalid/module-chat-missing-instructions.md",
      "type": "module",
      "description": "Chat segment missing instructions",
      "expectedErrors": ["instructions"]
    },
    {
      "file": "invalid/module-unknown-field.md",
      "type": "module",
      "description": "Unknown field on section",
      "expectedErrors": ["foo", "unknown"]
    },
    {
      "file": "invalid/module-old-video-section.md",
      "type": "module",
      "description": "Old v1 Video section (disallowed in modules)",
      "expectedErrors": ["not allowed"]
    },
    {
      "file": "invalid/module-page-missing-title.md",
      "type": "module",
      "description": "Page section without title after colon",
      "expectedErrors": ["title", "missing"]
    },
    {
      "file": "invalid/module-invalid-segment-type.md",
      "type": "module",
      "description": "Invalid segment type within Page",
      "expectedErrors": ["invalid", "segment"]
    },
    {
      "file": "invalid/module-lo-section-with-title.md",
      "type": "module",
      "description": "Learning Outcome section with unexpected title",
      "expectedErrors": ["title", "unexpected"]
    },
    {
      "file": "invalid/module-uncategorized-with-title.md",
      "type": "module",
      "description": "Uncategorized section with unexpected title",
      "expectedErrors": ["title", "unexpected"]
    }
  ]
}
```

**Step 15: Commit**

```bash
git add core/modules/tests/fixtures/validator/
git commit -m "feat: add invalid module fixtures for shared testing"
```

---

### Task 4: Add Learning Outcome and Lens fixtures

**Files:**
- Create: `core/modules/tests/fixtures/validator/valid/learning-outcome-basic.md`
- Create: `core/modules/tests/fixtures/validator/valid/lens-video-basic.md`
- Create: `core/modules/tests/fixtures/validator/valid/lens-article-basic.md`
- Create: `core/modules/tests/fixtures/validator/invalid/learning-outcome-missing-id.md`
- Create: `core/modules/tests/fixtures/validator/invalid/learning-outcome-missing-lens.md`
- Create: `core/modules/tests/fixtures/validator/invalid/lens-missing-id.md`
- Create: `core/modules/tests/fixtures/validator/invalid/lens-has-title.md`
- Create: `core/modules/tests/fixtures/validator/invalid/lens-missing-excerpt.md`
- Modify: `core/modules/tests/fixtures/validator/manifest.json`

**Step 1: Create learning-outcome-basic.md**

```markdown
---
id: 11111111-1111-1111-1111-111111111111
---
## Lens:
source:: [[../Lenses/Some Lens]]
```

**Step 2: Create lens-video-basic.md**

```markdown
---
id: 11111111-1111-1111-1111-111111111111
---
### Video: Title
source:: [[../video_transcripts/vid]]

#### Video-excerpt
```

**Step 3: Create lens-article-basic.md**

```markdown
---
id: 22222222-2222-2222-2222-222222222222
---
### Article: My Article
source:: [[../articles/foo]]

#### Article-excerpt
from:: "## Start"
to:: "end paragraph."
```

**Step 4: Create learning-outcome-missing-id.md**

```markdown
---
discussion: https://example.com
---
## Lens:
source:: [[../Lenses/Some Lens]]
```

**Step 5: Create learning-outcome-missing-lens.md**

```markdown
---
id: 11111111-1111-1111-1111-111111111111
---
## Test:
source:: [[../Tests/Quiz]]
```

**Step 6: Create lens-missing-id.md**

```markdown
---
---
### Video: Title
source:: [[../video_transcripts/vid]]

#### Video-excerpt
```

**Step 7: Create lens-has-title.md**

```markdown
---
id: 11111111-1111-1111-1111-111111111111
title: My Lens Title
---
### Video: Title
source:: [[../video_transcripts/vid]]

#### Video-excerpt
```

**Step 8: Create lens-missing-excerpt.md**

```markdown
---
id: 11111111-1111-1111-1111-111111111111
---
### Video: Title
source:: [[../video_transcripts/vid]]

#### Text
content::
No excerpt here
```

**Step 9: Update manifest.json**

Add to valid array:
```json
{
  "file": "valid/learning-outcome-basic.md",
  "type": "learning_outcome",
  "description": "Minimal valid Learning Outcome"
},
{
  "file": "valid/lens-video-basic.md",
  "type": "lens",
  "description": "Lens with Video section"
},
{
  "file": "valid/lens-article-basic.md",
  "type": "lens",
  "description": "Lens with Article section"
}
```

Add to invalid array:
```json
{
  "file": "invalid/learning-outcome-missing-id.md",
  "type": "learning_outcome",
  "description": "Learning Outcome without id",
  "expectedErrors": ["id"]
},
{
  "file": "invalid/learning-outcome-missing-lens.md",
  "type": "learning_outcome",
  "description": "Learning Outcome without Lens section",
  "expectedErrors": ["Lens"]
},
{
  "file": "invalid/lens-missing-id.md",
  "type": "lens",
  "description": "Lens without id",
  "expectedErrors": ["id"]
},
{
  "file": "invalid/lens-has-title.md",
  "type": "lens",
  "description": "Lens with prohibited title field",
  "expectedErrors": ["title", "not allowed"]
},
{
  "file": "invalid/lens-missing-excerpt.md",
  "type": "lens",
  "description": "Lens section without required excerpt",
  "expectedErrors": ["excerpt"]
}
```

**Step 10: Commit**

```bash
git add core/modules/tests/fixtures/validator/
git commit -m "feat: add Learning Outcome and Lens fixtures"
```

---

### Task 5: Update Python tests to use shared fixtures

**Files:**
- Create: `core/modules/tests/test_validator_fixtures.py`

**Step 1: Write the failing test**

Create file `core/modules/tests/test_validator_fixtures.py`:

```python
"""Test that Python validator agrees with shared fixtures."""

import json
from pathlib import Path
import pytest

from core.modules.markdown_validator import (
    validate_module,
    validate_learning_outcome,
    validate_lens,
    validate_course,
)

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "validator"


def load_manifest():
    """Load the shared fixtures manifest."""
    manifest_path = FIXTURES_DIR / "manifest.json"
    return json.loads(manifest_path.read_text())


def get_validator_for_type(file_type: str):
    """Return appropriate validator function for file type."""
    validators = {
        "module": validate_module,
        "learning_outcome": validate_learning_outcome,
        "lens": validate_lens,
        "course": validate_course,
    }
    return validators.get(file_type)


# Load fixtures at module level for parametrization
manifest = load_manifest()
valid_fixtures = [(f["file"], f["type"], f["description"]) for f in manifest["valid"]]
invalid_fixtures = [
    (f["file"], f["type"], f["description"], f["expectedErrors"])
    for f in manifest["invalid"]
]


@pytest.mark.parametrize("file,file_type,description", valid_fixtures)
def test_valid_fixture(file, file_type, description):
    """Valid fixtures should pass validation."""
    content = (FIXTURES_DIR / file).read_text()
    validator = get_validator_for_type(file_type)
    errors = validator(content)
    assert errors == [], f"{description}: expected no errors, got {errors}"


@pytest.mark.parametrize("file,file_type,description,expected_errors", invalid_fixtures)
def test_invalid_fixture(file, file_type, description, expected_errors):
    """Invalid fixtures should fail validation with expected errors."""
    content = (FIXTURES_DIR / file).read_text()
    validator = get_validator_for_type(file_type)
    errors = validator(content)

    assert len(errors) > 0, f"{description}: expected errors but got none"

    # Check that at least one expected error substring appears
    error_messages = " ".join(str(e) for e in errors).lower()
    for expected in expected_errors:
        assert expected.lower() in error_messages, (
            f"{description}: expected '{expected}' in errors, got: {errors}"
        )
```

**Step 2: Run test to verify it fails (fixtures don't exist yet or manifest incomplete)**

```bash
pytest core/modules/tests/test_validator_fixtures.py -v
```

Expected: Tests should pass once fixtures are complete from previous tasks.

**Step 3: Commit**

```bash
git add core/modules/tests/test_validator_fixtures.py
git commit -m "feat: add Python fixture-based validator tests"
```

---

## Phase 2: TypeScript Validator Package

### Task 6: Create TypeScript validator package structure

**Files:**
- Create: `typescript-validator/package.json`
- Create: `typescript-validator/tsconfig.json`
- Create: `typescript-validator/vitest.config.ts`
- Create: `typescript-validator/src/index.ts`
- Create: `typescript-validator/.gitignore`

**Step 1: Create package.json**

```json
{
  "name": "@lens-academy/markdown-validator",
  "version": "0.1.0",
  "description": "Markdown validator for Lens Academy educational content",
  "main": "dist/index.js",
  "module": "dist/index.mjs",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsup src/index.ts --format cjs,esm --dts",
    "test": "vitest",
    "test:run": "vitest run",
    "lint": "eslint src/"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.0.0",
    "vitest": "^2.0.0",
    "@types/node": "^20.0.0"
  },
  "files": [
    "dist"
  ]
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});
```

**Step 4: Create src/index.ts skeleton**

```typescript
// TypeScript Markdown Validator for Lens Academy
// Validates educational content markdown files

export interface ValidationError {
  message: string;
  line?: number;
  context?: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

export function validateModule(text: string): ValidationError[] {
  // TODO: Implement
  return [];
}

export function validateLearningOutcome(text: string): ValidationError[] {
  // TODO: Implement
  return [];
}

export function validateLens(text: string): ValidationError[] {
  // TODO: Implement
  return [];
}

export function validateCourse(text: string): ValidationError[] {
  // TODO: Implement
  return [];
}
```

**Step 5: Create .gitignore**

```gitignore
node_modules/
dist/
*.log
```

**Step 6: Install dependencies**

```bash
cd typescript-validator
npm install
```

**Step 7: Commit**

```bash
git add typescript-validator/
git commit -m "chore: create TypeScript validator package structure"
```

---

### Task 7: Add TypeScript fixture tests (RED phase)

**Files:**
- Create: `typescript-validator/src/validator.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, test, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { validateModule, validateLearningOutcome, validateLens, validateCourse } from './index';

const FIXTURES_DIR = path.join(__dirname, '../../core/modules/tests/fixtures/validator');

interface FixtureEntry {
  file: string;
  type: 'module' | 'learning_outcome' | 'lens' | 'course';
  description: string;
  expectedErrors?: string[];
}

interface Manifest {
  version: number;
  description: string;
  valid: FixtureEntry[];
  invalid: FixtureEntry[];
}

function loadManifest(): Manifest {
  const manifestPath = path.join(FIXTURES_DIR, 'manifest.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
}

function getValidator(fileType: string) {
  const validators: Record<string, (text: string) => { message: string }[]> = {
    module: validateModule,
    learning_outcome: validateLearningOutcome,
    lens: validateLens,
    course: validateCourse,
  };
  return validators[fileType];
}

const manifest = loadManifest();

describe('Valid fixtures', () => {
  test.each(manifest.valid.map(f => [f.file, f.type, f.description]))(
    '%s should pass validation',
    (file, fileType, description) => {
      const content = fs.readFileSync(path.join(FIXTURES_DIR, file as string), 'utf-8');
      const validator = getValidator(fileType as string);
      const errors = validator(content);

      expect(errors).toEqual([]);
    }
  );
});

describe('Invalid fixtures', () => {
  test.each(manifest.invalid.map(f => [f.file, f.type, f.description, f.expectedErrors]))(
    '%s should fail validation',
    (file, fileType, description, expectedErrors) => {
      const content = fs.readFileSync(path.join(FIXTURES_DIR, file as string), 'utf-8');
      const validator = getValidator(fileType as string);
      const errors = validator(content);

      expect(errors.length).toBeGreaterThan(0);

      const errorMessages = errors.map(e => e.message).join(' ').toLowerCase();
      for (const expected of (expectedErrors as string[])) {
        expect(errorMessages).toContain(expected.toLowerCase());
      }
    }
  );
});
```

**Step 2: Run test to verify it fails**

```bash
cd typescript-validator
npm test
```

Expected: FAIL - validateModule returns [] for invalid fixtures.

**Step 3: Commit**

```bash
git add typescript-validator/src/validator.test.ts
git commit -m "test: add TypeScript fixture tests (RED)"
```

---

### Task 8: Implement TypeScript utility functions

**Files:**
- Create: `typescript-validator/src/utils.ts`

**Step 1: Write tests for utilities**

Create `typescript-validator/src/utils.test.ts`:

```typescript
import { describe, test, expect } from 'vitest';
import { parseFrontmatter, parseFields, extractWikiLinkPath } from './utils';

describe('parseFrontmatter', () => {
  test('extracts frontmatter from markdown', () => {
    const text = `---
slug: test
title: Test Title
---

# Content`;

    const [metadata, content] = parseFrontmatter(text);

    expect(metadata).toEqual({ slug: 'test', title: 'Test Title' });
    expect(content.trim()).toBe('# Content');
  });

  test('returns empty metadata if no frontmatter', () => {
    const text = '# Content without frontmatter';

    const [metadata, content] = parseFrontmatter(text);

    expect(metadata).toEqual({});
    expect(content).toBe(text);
  });
});

describe('parseFields', () => {
  test('parses single-line fields', () => {
    const text = `id:: 12345
optional:: true`;

    const fields = parseFields(text);

    expect(fields).toEqual({ id: '12345', optional: 'true' });
  });

  test('parses multi-line fields', () => {
    const text = `content::
First line.

Second paragraph.`;

    const fields = parseFields(text);

    expect(fields.content).toContain('First line.');
    expect(fields.content).toContain('Second paragraph.');
  });

  test('stops at segment headers', () => {
    const text = `id:: 12345

## Text
content::
Hello`;

    const fields = parseFields(text);

    expect(fields).toEqual({ id: '12345' });
    expect(fields.content).toBeUndefined();
  });
});

describe('extractWikiLinkPath', () => {
  test('extracts path from wiki-link', () => {
    expect(extractWikiLinkPath('[[../path/to/file]]')).toBe('../path/to/file');
  });

  test('extracts path from embed syntax', () => {
    expect(extractWikiLinkPath('![[../path/to/file]]')).toBe('../path/to/file');
  });

  test('strips display name', () => {
    expect(extractWikiLinkPath('[[../path/to/file|Display Name]]')).toBe('../path/to/file');
  });

  test('returns null for no wiki-link', () => {
    expect(extractWikiLinkPath('plain text')).toBeNull();
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: FAIL - utils functions don't exist

**Step 3: Implement utils.ts**

```typescript
// Utility functions for markdown validation
// Ported from Python markdown_validator.py

const FRONTMATTER_PATTERN = /^---\s*\n([\s\S]*?)---\s*\n/;
const WIKI_LINK_PATTERN = /!?\[\[([^\]]+)\]\]/;
const FIELD_PATTERN = /^(\w+)::\s*(.*)$/;
const H2_HEADER_PATTERN = /^## \S+(?::\s*.+)?$/;

export function parseFrontmatter(text: string): [Record<string, string>, string] {
  const match = text.match(FRONTMATTER_PATTERN);

  if (!match) {
    return [{}, text];
  }

  const frontmatterText = match[1].trim();
  const content = text.slice(match[0].length);

  const metadata: Record<string, string> = {};
  for (const line of frontmatterText.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.includes(':')) {
      const [key, ...valueParts] = trimmed.split(':');
      const value = valueParts.join(':').trim().replace(/^["']|["']$/g, '');
      metadata[key.trim()] = value;
    }
  }

  return [metadata, content];
}

export function parseFields(
  text: string,
  stopPattern: RegExp = new RegExp(H2_HEADER_PATTERN)
): Record<string, string> {
  const fields: Record<string, string> = {};
  const lines = text.split('\n');
  let currentKey: string | null = null;
  let currentValueLines: string[] = [];

  for (const line of lines) {
    // Stop at headers
    if (stopPattern.test(line)) {
      if (currentKey !== null) {
        fields[currentKey] = currentValueLines.join('\n').trim();
      }
      break;
    }

    // Check for new field
    const fieldMatch = line.match(FIELD_PATTERN);

    if (fieldMatch) {
      // Save previous field
      if (currentKey !== null) {
        fields[currentKey] = currentValueLines.join('\n').trim();
      }

      currentKey = fieldMatch[1];
      const valueOnLine = fieldMatch[2] || '';

      if (valueOnLine) {
        currentValueLines = [valueOnLine];
      } else {
        currentValueLines = [];
      }
    } else if (currentKey !== null) {
      currentValueLines.push(line);
    }
  }

  // Save last field
  if (currentKey !== null) {
    fields[currentKey] = currentValueLines.join('\n').trim();
  }

  return fields;
}

export function extractWikiLinkPath(text: string): string | null {
  const match = text.match(WIKI_LINK_PATTERN);
  if (match) {
    let path = match[1];
    // Strip Obsidian display name
    if (path.includes('|')) {
      path = path.split('|')[0];
    }
    return path;
  }
  return null;
}

export function stripCriticMarkup(text: string): string {
  // {>>comment<<} → remove entirely
  text = text.replace(/\{>>[\s\S]*?<<\}/g, '');
  // {++addition++} → remove entirely (reject addition)
  text = text.replace(/\{\+\+[\s\S]*?\+\+\}/g, '');
  // {--deletion--} → keep inner content (reject deletion)
  text = text.replace(/\{--([\s\S]*?)--\}/g, '$1');
  // {~~old~>new~~} → keep old (reject substitution)
  text = text.replace(/\{~~([\s\S]*?)~>[\s\S]*?~~\}/g, '$1');
  // {==highlight==} → keep inner content
  text = text.replace(/\{==([\s\S]*?)==\}/g, '$1');
  return text;
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test
```

Expected: PASS for utils tests

**Step 5: Commit**

```bash
git add typescript-validator/src/utils.ts typescript-validator/src/utils.test.ts
git commit -m "feat: implement TypeScript validator utilities"
```

---

### Task 9: Implement validateModule function

**Files:**
- Modify: `typescript-validator/src/index.ts`

**Step 1: The fixture tests are already failing (from Task 7) - verify RED state**

```bash
npm test
```

Expected: FAIL - validateModule returns [] for all inputs

**Step 2: Implement validateModule**

Update `typescript-validator/src/index.ts`:

```typescript
import { parseFrontmatter, parseFields, stripCriticMarkup } from './utils';

export interface ValidationError {
  message: string;
  line?: number;
  context?: string;
}

// Valid types for H1 sections in v2 modules
const VALID_SECTION_TYPES = new Set(['page', 'learning outcome', 'uncategorized']);

// Old v1 section types - disallowed in modules
const OLD_SECTION_TYPES: Record<string, string> = {
  video: 'Use Lens files instead',
  article: 'Use Lens files instead',
  text: 'Use # Page: with ## Text segment instead',
  chat: 'Use # Page: with ## Chat segment instead',
};

const VALID_SEGMENT_TYPES = new Set(['text', 'chat', 'video-excerpt', 'article-excerpt', 'lens']);

// Allowed fields per section type
const ALLOWED_SECTION_FIELDS: Record<string, Set<string>> = {
  page: new Set(['id', 'optional']),
  'learning outcome': new Set(['source', 'optional']),
  uncategorized: new Set(),
};

// Allowed fields per segment type
const ALLOWED_SEGMENT_FIELDS: Record<string, Set<string>> = {
  text: new Set(['content']),
  chat: new Set(['instructions', 'hidePreviousContentFromUser', 'hidePreviousContentFromTutor']),
  'video-excerpt': new Set(['from', 'to']),
  'article-excerpt': new Set(['from', 'to']),
  lens: new Set(['source', 'optional']),
};

const TITLE_REQUIRED_SECTION_TYPES = new Set(['page']);
const TITLE_FORBIDDEN_SECTION_TYPES = new Set(['learning outcome', 'uncategorized']);

const SECTION_PATTERN = /^# ([^:]+):\s*(.*)$/;
const SEGMENT_PATTERN = /^## (\S+)(?::\s*.+)?$/;

export function validateModule(text: string): ValidationError[] {
  text = stripCriticMarkup(text);
  const errors: ValidationError[] = [];

  // 1. Validate frontmatter
  const [metadata, content] = parseFrontmatter(text);

  if (Object.keys(metadata).length === 0) {
    errors.push({ message: 'Missing frontmatter (---)', line: 1 });
  } else {
    if (!metadata.slug) {
      errors.push({ message: 'Missing required field: slug', context: 'frontmatter' });
    }
    if (!metadata.title) {
      errors.push({ message: 'Missing required field: title', context: 'frontmatter' });
    }
  }

  // 2. Parse and validate sections
  const lines = text.split('\n');
  const sections: Array<{
    lineNum: number;
    type: string;
    title: string;
    content: string;
  }> = [];

  let currentSection: typeof sections[0] | null = null;
  let currentLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const match = line.match(SECTION_PATTERN);

    if (match) {
      if (currentSection) {
        currentSection.content = currentLines.join('\n');
        sections.push(currentSection);
      }

      currentSection = {
        lineNum,
        type: match[1].trim().toLowerCase(),
        title: match[2]?.trim() || '',
        content: '',
      };
      currentLines = [];
    } else if (currentSection) {
      currentLines.push(line);
    }
  }

  if (currentSection) {
    currentSection.content = currentLines.join('\n');
    sections.push(currentSection);
  }

  // 3. Validate each section
  for (const section of sections) {
    const context = section.title
      ? `# ${capitalize(section.type)}: ${section.title}`
      : `# ${capitalize(section.type)}:`;

    // Check for old v1 types
    if (section.type in OLD_SECTION_TYPES) {
      errors.push({
        message: `Section type '# ${capitalize(section.type)}:' is not allowed in v2 modules. ${OLD_SECTION_TYPES[section.type]}`,
        line: section.lineNum,
        context,
      });
      continue;
    }

    // Check valid section type
    if (!VALID_SECTION_TYPES.has(section.type)) {
      errors.push({
        message: `Invalid section type: ${section.type}`,
        line: section.lineNum,
        context,
      });
      continue;
    }

    // Validate title requirements
    if (TITLE_REQUIRED_SECTION_TYPES.has(section.type) && !section.title) {
      errors.push({
        message: `Missing title: ${capitalize(section.type)} sections require a title after the colon`,
        line: section.lineNum,
        context,
      });
    } else if (TITLE_FORBIDDEN_SECTION_TYPES.has(section.type) && section.title) {
      errors.push({
        message: `Unexpected title: ${capitalize(section.type)} sections should not have a title`,
        line: section.lineNum,
        context,
      });
    }

    // Parse and validate fields
    const fields = parseFields(section.content);
    const allowedFields = ALLOWED_SECTION_FIELDS[section.type] || new Set();

    for (const fieldName of Object.keys(fields)) {
      if (!allowedFields.has(fieldName)) {
        errors.push({
          message: `Unknown field: ${fieldName}::`,
          line: section.lineNum,
          context,
        });
      }
    }

    // Type-specific validation
    if (section.type === 'page') {
      if (!fields.id) {
        errors.push({
          message: 'Missing required field: id::',
          line: section.lineNum,
          context,
        });
      }
      // Validate segments
      const segmentErrors = validateSegments(section.content, section.lineNum, context, 'page');
      errors.push(...segmentErrors);
    } else if (section.type === 'learning outcome') {
      if (!fields.source) {
        errors.push({
          message: 'Missing required field: source::',
          line: section.lineNum,
          context,
        });
      }
    } else if (section.type === 'uncategorized') {
      const lensErrors = validateUncategorizedSection(section.content, section.lineNum, context);
      errors.push(...lensErrors);
    }
  }

  return errors;
}

function validateSegments(
  content: string,
  sectionLine: number,
  sectionContext: string,
  sectionType: string
): ValidationError[] {
  const errors: ValidationError[] = [];
  const lines = content.split('\n');

  const segments: Array<{
    relativeLine: number;
    type: string;
    content: string;
  }> = [];

  let currentSegment: typeof segments[0] | null = null;
  let currentLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(SEGMENT_PATTERN);

    if (match) {
      if (currentSegment) {
        currentSegment.content = currentLines.join('\n');
        segments.push(currentSegment);
      }

      currentSegment = {
        relativeLine: i + 1,
        type: match[1].toLowerCase(),
        content: '',
      };
      currentLines = [];
    } else if (currentSegment) {
      currentLines.push(line);
    }
  }

  if (currentSegment) {
    currentSegment.content = currentLines.join('\n');
    segments.push(currentSegment);
  }

  for (const segment of segments) {
    const approxLine = sectionLine + segment.relativeLine;
    const context = `${sectionContext} > ## ${capitalize(segment.type)}`;

    if (!VALID_SEGMENT_TYPES.has(segment.type)) {
      errors.push({
        message: `Invalid segment type: ${segment.type}`,
        line: approxLine,
        context,
      });
      continue;
    }

    // Check segment type is valid for section type
    if (sectionType === 'page' && (segment.type === 'video-excerpt' || segment.type === 'article-excerpt')) {
      errors.push({
        message: `${capitalize(segment.type)} segment not allowed in Page section`,
        line: approxLine,
        context,
      });
    }

    const fields = parseFields(segment.content);
    const allowedFields = ALLOWED_SEGMENT_FIELDS[segment.type] || new Set();

    for (const fieldName of Object.keys(fields)) {
      if (!allowedFields.has(fieldName)) {
        errors.push({
          message: `Unknown field: ${fieldName}::`,
          line: approxLine,
          context,
        });
      }
    }

    // Type-specific validation
    if (segment.type === 'text' && !fields.content) {
      errors.push({
        message: 'Missing required field: content::',
        line: approxLine,
        context,
      });
    } else if (segment.type === 'chat' && !fields.instructions) {
      errors.push({
        message: 'Missing required field: instructions::',
        line: approxLine,
        context,
      });
    }
  }

  return errors;
}

function validateUncategorizedSection(
  content: string,
  sectionLine: number,
  sectionContext: string
): ValidationError[] {
  const errors: ValidationError[] = [];
  const LENS_PATTERN = /^## Lens:\s*$/;

  const lines = content.split('\n');
  const lenses: Array<{ relativeLine: number; content: string }> = [];

  let currentLens: typeof lenses[0] | null = null;
  let currentLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (LENS_PATTERN.test(line)) {
      if (currentLens) {
        currentLens.content = currentLines.join('\n');
        lenses.push(currentLens);
      }
      currentLens = { relativeLine: i + 1, content: '' };
      currentLines = [];
    } else if (currentLens) {
      currentLines.push(line);
    }
  }

  if (currentLens) {
    currentLens.content = currentLines.join('\n');
    lenses.push(currentLens);
  }

  if (lenses.length === 0) {
    errors.push({
      message: 'Uncategorized section must contain at least one ## Lens: subsection',
      line: sectionLine,
      context: sectionContext,
    });
    return errors;
  }

  for (const lens of lenses) {
    const approxLine = sectionLine + lens.relativeLine;
    const context = `${sectionContext} > ## Lens:`;

    const fields = parseFields(lens.content);
    const allowedFields = ALLOWED_SEGMENT_FIELDS.lens;

    for (const fieldName of Object.keys(fields)) {
      if (!allowedFields.has(fieldName)) {
        errors.push({
          message: `Unknown field: ${fieldName}::`,
          line: approxLine,
          context,
        });
      }
    }

    if (!fields.source) {
      errors.push({
        message: 'Missing required field: source::',
        line: approxLine,
        context,
      });
    }
  }

  return errors;
}

function capitalize(str: string): string {
  return str.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

export function validateLearningOutcome(text: string): ValidationError[] {
  // TODO: Implement in Task 10
  return [];
}

export function validateLens(text: string): ValidationError[] {
  // TODO: Implement in Task 11
  return [];
}

export function validateCourse(text: string): ValidationError[] {
  // TODO: Implement in Task 12
  return [];
}
```

**Step 3: Run tests to verify module validation passes**

```bash
npm test
```

Expected: Module fixtures should pass, Learning Outcome and Lens fixtures still fail.

**Step 4: Commit**

```bash
git add typescript-validator/src/index.ts
git commit -m "feat: implement validateModule function"
```

---

### Task 10: Implement validateLearningOutcome function

**Files:**
- Modify: `typescript-validator/src/index.ts`

**Step 1: Verify fixture tests are failing for learning_outcome type**

```bash
npm test -- --grep "learning-outcome"
```

Expected: FAIL

**Step 2: Implement validateLearningOutcome**

Add to `typescript-validator/src/index.ts`:

```typescript
const LO_SECTION_PATTERN = /^## (Test|Lens):\s*$/;

export function validateLearningOutcome(text: string): ValidationError[] {
  text = stripCriticMarkup(text);
  const errors: ValidationError[] = [];

  // 1. Validate frontmatter
  const [metadata] = parseFrontmatter(text);

  if (Object.keys(metadata).length === 0) {
    errors.push({ message: 'Missing frontmatter (---)', line: 1 });
  } else {
    if (!metadata.id) {
      errors.push({ message: 'Missing required field: id', context: 'frontmatter' });
    }
  }

  // 2. Parse sections (## Test: and ## Lens:)
  const lines = text.split('\n');
  const sections: Array<{
    lineNum: number;
    type: string;
    content: string;
  }> = [];

  let currentSection: typeof sections[0] | null = null;
  let currentLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(LO_SECTION_PATTERN);

    if (match) {
      if (currentSection) {
        currentSection.content = currentLines.join('\n');
        sections.push(currentSection);
      }

      currentSection = {
        lineNum: i + 1,
        type: match[1].toLowerCase(),
        content: '',
      };
      currentLines = [];
    } else if (currentSection) {
      currentLines.push(line);
    }
  }

  if (currentSection) {
    currentSection.content = currentLines.join('\n');
    sections.push(currentSection);
  }

  // 3. Validate section counts
  const testSections = sections.filter(s => s.type === 'test');
  const lensSections = sections.filter(s => s.type === 'lens');

  if (testSections.length > 1) {
    errors.push({
      message: 'Multiple ## Test: sections found (only 0 or 1 allowed)',
      line: testSections[1].lineNum,
    });
  }

  if (lensSections.length === 0) {
    errors.push({
      message: 'Missing required ## Lens: section (at least one required)',
    });
  }

  // 4. Validate each section's fields
  for (const section of sections) {
    const context = `## ${capitalize(section.type)}:`;
    const fields = parseFields(section.content);

    if (section.type === 'lens' && !fields.source) {
      errors.push({
        message: 'Missing required field: source::',
        line: section.lineNum,
        context,
      });
    }
  }

  return errors;
}
```

**Step 3: Run tests to verify learning outcome fixtures pass**

```bash
npm test
```

Expected: Learning Outcome fixtures should pass.

**Step 4: Commit**

```bash
git add typescript-validator/src/index.ts
git commit -m "feat: implement validateLearningOutcome function"
```

---

### Task 11: Implement validateLens function

**Files:**
- Modify: `typescript-validator/src/index.ts`

**Step 1: Verify fixture tests are failing for lens type**

```bash
npm test -- --grep "lens"
```

Expected: FAIL

**Step 2: Implement validateLens**

Add to `typescript-validator/src/index.ts`:

```typescript
const LENS_SECTION_PATTERN = /^### (Article|Video):\s*(.+)$/;
const LENS_SEGMENT_PATTERN = /^#### (\S+)(?::\s*.*)?$/;

export function validateLens(text: string): ValidationError[] {
  text = stripCriticMarkup(text);
  const errors: ValidationError[] = [];

  // 1. Validate frontmatter
  const [metadata] = parseFrontmatter(text);

  if (Object.keys(metadata).length === 0) {
    errors.push({ message: 'Missing frontmatter (---)', line: 1 });
  } else {
    if (!metadata.id) {
      errors.push({ message: 'Missing required field: id', context: 'frontmatter' });
    }
    if ('title' in metadata) {
      errors.push({
        message: "Field 'title' is not allowed in Lens frontmatter (title comes from ### Article/Video header)",
        context: 'frontmatter',
      });
    }
  }

  // 2. Parse sections (### Article: or ### Video:)
  const lines = text.split('\n');
  const sections: Array<{
    lineNum: number;
    type: string;
    title: string;
    content: string;
  }> = [];

  let currentSection: typeof sections[0] | null = null;
  let currentLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(LENS_SECTION_PATTERN);

    if (match) {
      if (currentSection) {
        currentSection.content = currentLines.join('\n');
        sections.push(currentSection);
      }

      currentSection = {
        lineNum: i + 1,
        type: match[1].toLowerCase(),
        title: match[2].trim(),
        content: '',
      };
      currentLines = [];
    } else if (currentSection) {
      currentLines.push(line);
    }
  }

  if (currentSection) {
    currentSection.content = currentLines.join('\n');
    sections.push(currentSection);
  }

  // 3. Validate at least one section exists
  if (sections.length === 0) {
    errors.push({
      message: 'Missing required ### Article: or ### Video: section (at least one required)',
    });
    return errors;
  }

  // 4. Validate each section
  for (const section of sections) {
    const context = `### ${capitalize(section.type)}: ${section.title}`;

    // Parse fields (stop at #### headers)
    const fields = parseFields(section.content, /^#### \S+(?::\s*.*)?$/);

    if (!fields.source) {
      errors.push({
        message: 'Missing required field: source::',
        line: section.lineNum,
        context,
      });
    }

    // Validate segments
    const segmentErrors = validateLensSegments(section.content, section.lineNum, context, section.type);
    errors.push(...segmentErrors);
  }

  return errors;
}

function validateLensSegments(
  content: string,
  sectionLine: number,
  sectionContext: string,
  sectionType: string
): ValidationError[] {
  const errors: ValidationError[] = [];
  const lines = content.split('\n');

  const segments: Array<{
    relativeLine: number;
    type: string;
    content: string;
  }> = [];

  let currentSegment: typeof segments[0] | null = null;
  let currentLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(LENS_SEGMENT_PATTERN);

    if (match) {
      if (currentSegment) {
        currentSegment.content = currentLines.join('\n');
        segments.push(currentSegment);
      }

      currentSegment = {
        relativeLine: i + 1,
        type: match[1].toLowerCase(),
        content: '',
      };
      currentLines = [];
    } else if (currentSegment) {
      currentLines.push(line);
    }
  }

  if (currentSegment) {
    currentSegment.content = currentLines.join('\n');
    segments.push(currentSegment);
  }

  // Check for at least one appropriate excerpt
  const expectedExcerpt = `${sectionType}-excerpt`;
  const hasExcerpt = segments.some(s => s.type === expectedExcerpt);

  if (!hasExcerpt) {
    errors.push({
      message: `Missing required #### ${capitalize(expectedExcerpt)} segment`,
      line: sectionLine,
      context: sectionContext,
    });
  }

  // Valid segment types in Lens files
  const VALID_LENS_SEGMENT_TYPES = new Set(['text', 'chat', 'video-excerpt', 'article-excerpt']);

  // Allowed fields per segment type in Lens
  const LENS_SEGMENT_FIELDS: Record<string, Set<string>> = {
    'text': new Set(['content']),
    'chat': new Set(['instructions', 'hidePreviousContentFromUser', 'hidePreviousContentFromTutor']),
    'video-excerpt': new Set(['from', 'to']),
    'article-excerpt': new Set(['from', 'to']),
  };

  // Required fields per segment type
  const REQUIRED_SEGMENT_FIELDS: Record<string, string[]> = {
    'text': ['content'],
    'chat': ['instructions'],
  };

  // Validate each segment
  for (const segment of segments) {
    const approxLine = sectionLine + segment.relativeLine;
    const context = `${sectionContext} > #### ${capitalize(segment.type)}`;

    // Check for invalid segment type
    if (!VALID_LENS_SEGMENT_TYPES.has(segment.type)) {
      errors.push({
        message: `Invalid segment type: ${segment.type}`,
        line: approxLine,
        context,
      });
      continue;
    }

    // Check for mismatched excerpt types
    if (sectionType === 'video' && segment.type === 'article-excerpt') {
      errors.push({
        message: 'Article-excerpt segment not allowed in Video section',
        line: approxLine,
        context,
      });
    } else if (sectionType === 'article' && segment.type === 'video-excerpt') {
      errors.push({
        message: 'Video-excerpt segment not allowed in Article section',
        line: approxLine,
        context,
      });
    }

    // Validate segment fields
    const fields = parseFields(segment.content);
    const allowedFields = LENS_SEGMENT_FIELDS[segment.type] || new Set();

    // Check for unknown fields
    for (const fieldName of Object.keys(fields)) {
      if (!allowedFields.has(fieldName)) {
        errors.push({
          message: `Unknown field: ${fieldName}::`,
          line: approxLine,
          context,
        });
      }
    }

    // Check for required fields
    const requiredFields = REQUIRED_SEGMENT_FIELDS[segment.type] || [];
    for (const required of requiredFields) {
      if (!fields[required]) {
        errors.push({
          message: `Missing required field: ${required}::`,
          line: approxLine,
          context,
        });
      }
    }
  }

  return errors;
}
```

**Step 3: Run tests to verify lens fixtures pass**

```bash
npm test
```

Expected: All fixtures should pass.

**Step 4: Commit**

```bash
git add typescript-validator/src/index.ts
git commit -m "feat: implement validateLens function"
```

---

### Task 12: Add course fixtures and implement validateCourse

**Files:**
- Create: `core/modules/tests/fixtures/validator/valid/course-basic.md`
- Create: `core/modules/tests/fixtures/validator/invalid/course-missing-wiki-link.md`
- Create: `core/modules/tests/fixtures/validator/invalid/course-malformed-header.md`
- Modify: `core/modules/tests/fixtures/validator/manifest.json`
- Modify: `typescript-validator/src/index.ts`

**Step 1: Create course-basic.md**

```markdown
---
slug: test-course
title: Test Course
---

# Lesson: [[../modules/intro]]

# Meeting: 1

# Lesson: [[../modules/advanced]]
optional:: true

# Meeting: 2
```

**Step 2: Create course-missing-wiki-link.md**

```markdown
---
slug: test
title: Test
---

# Lesson: modules/intro
```

**Step 3: Create course-malformed-header.md**

```markdown
---
slug: test
title: Test
---

# Lesson without colon
# Meeting without number
# Lesson:
```

**Step 4: Update manifest.json**

Add to valid:
```json
{
  "file": "valid/course-basic.md",
  "type": "course",
  "description": "Valid course with lessons and meetings"
}
```

Add to invalid:
```json
{
  "file": "invalid/course-missing-wiki-link.md",
  "type": "course",
  "description": "Lesson without wiki-link syntax",
  "expectedErrors": ["wiki-link"]
},
{
  "file": "invalid/course-malformed-header.md",
  "type": "course",
  "description": "Malformed lesson/meeting headers",
  "expectedErrors": ["malformed"]
}
```

**Step 5: Implement validateCourse**

```typescript
const LESSON_PATTERN = /^# Lesson:\s*(.+)$/;
const MEETING_PATTERN = /^# Meeting:\s*(\d+)$/;
const WIKI_LINK_IN_TEXT = /\[\[([^\]]+)\]\]/;

// Patterns for detecting malformed headers
const MALFORMED_LESSON_PATTERN = /^# Lesson\s*$/i;  // "# Lesson" without colon
const MALFORMED_LESSON_EMPTY = /^# Lesson:\s*$/;     // "# Lesson:" with nothing after
const MALFORMED_MEETING_PATTERN = /^# Meeting\s*$/i; // "# Meeting" without colon
const MALFORMED_MEETING_NO_NUM = /^# Meeting:\s*[^\d]/; // "# Meeting:" without number

export function validateCourse(text: string): ValidationError[] {
  const errors: ValidationError[] = [];

  // 1. Validate frontmatter
  const [metadata] = parseFrontmatter(text);

  if (Object.keys(metadata).length === 0) {
    errors.push({ message: 'Missing frontmatter (---)', line: 1 });
  } else {
    if (!metadata.slug) {
      errors.push({ message: 'Missing required field: slug', context: 'frontmatter' });
    }
    if (!metadata.title) {
      errors.push({ message: 'Missing required field: title', context: 'frontmatter' });
    }
  }

  // 2. Validate progression items
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNum = i + 1;

    // Check for malformed headers
    if (MALFORMED_LESSON_PATTERN.test(line) || MALFORMED_LESSON_EMPTY.test(line)) {
      errors.push({
        message: 'Malformed Lesson header: must be "# Lesson: [[path/to/module]]"',
        line: lineNum,
        context: line,
      });
      continue;
    }

    if (MALFORMED_MEETING_PATTERN.test(line) || MALFORMED_MEETING_NO_NUM.test(line)) {
      errors.push({
        message: 'Malformed Meeting header: must be "# Meeting: <number>"',
        line: lineNum,
        context: line,
      });
      continue;
    }

    // Check valid lesson format
    const lessonMatch = line.match(LESSON_PATTERN);

    if (lessonMatch) {
      const lessonRef = lessonMatch[1];
      if (!WIKI_LINK_IN_TEXT.test(lessonRef)) {
        errors.push({
          message: 'Lesson reference must use [[wiki-link]] syntax',
          line: lineNum,
          context: `# Lesson: ${lessonRef}`,
        });
      }
    }
  }

  return errors;
}
```

**Step 6: Run tests**

```bash
npm test
```

Expected: All fixtures pass.

**Step 7: Commit**

```bash
git add core/modules/tests/fixtures/validator/ typescript-validator/src/index.ts
git commit -m "feat: add course validation"
```

---

<!--
## Phase 3: Obsidian Plugin (OUT OF SCOPE)

> **Note:** Phase 3 is deferred. Focus is on the TypeScript validator package first.
> The Obsidian plugin can be implemented later once the validator is stable.

### Task 13: Create Obsidian plugin structure

**Files:**
- Create: `obsidian-validator-plugin/manifest.json`
- Create: `obsidian-validator-plugin/package.json`
- Create: `obsidian-validator-plugin/tsconfig.json`
- Create: `obsidian-validator-plugin/src/main.ts`

**Step 1: Create manifest.json**

```json
{
  "id": "lens-validator",
  "name": "Lens Academy Validator",
  "version": "0.1.0",
  "minAppVersion": "1.0.0",
  "description": "Validates Lens Academy educational content markdown files",
  "author": "Lens Academy",
  "isDesktopOnly": false
}
```

**Step 2: Create package.json**

```json
{
  "name": "obsidian-lens-validator",
  "version": "0.1.0",
  "description": "Obsidian plugin for Lens Academy content validation",
  "main": "main.js",
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "tsc -noEmit -skipLibCheck && node esbuild.config.mjs production"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "builtin-modules": "^3.3.0",
    "esbuild": "^0.20.0",
    "obsidian": "latest",
    "typescript": "^5.0.0"
  }
}
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "inlineSourceMap": true,
    "inlineSources": true,
    "module": "ESNext",
    "target": "ES6",
    "allowJs": true,
    "noImplicitAny": true,
    "moduleResolution": "node",
    "importHelpers": true,
    "isolatedModules": true,
    "strictNullChecks": true,
    "lib": ["DOM", "ES5", "ES6", "ES7"]
  },
  "include": ["**/*.ts"]
}
```

**Step 4: Create src/main.ts**

```typescript
import { Plugin, Notice, TFile, MarkdownView } from 'obsidian';

// Validator will be loaded dynamically from GitHub
let validator: {
  validateModule: (text: string) => Array<{ message: string; line?: number; context?: string }>;
  validateLearningOutcome: (text: string) => Array<{ message: string; line?: number; context?: string }>;
  validateLens: (text: string) => Array<{ message: string; line?: number; context?: string }>;
  validateCourse: (text: string) => Array<{ message: string; line?: number; context?: string }>;
} | null = null;

const VALIDATOR_URL = 'https://raw.githubusercontent.com/lucbrinkman/ai-safety-course-platform/main/typescript-validator/dist/validator.js';

export default class LensValidatorPlugin extends Plugin {
  async onload() {
    console.log('Loading Lens Validator plugin');

    // Load validator from GitHub
    await this.loadValidator();

    // Add command to validate current file
    this.addCommand({
      id: 'validate-current-file',
      name: 'Validate current file',
      callback: () => this.validateCurrentFile(),
    });

    // Validate on file save
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.validateFile(file);
        }
      })
    );
  }

  async loadValidator() {
    try {
      const response = await fetch(VALIDATOR_URL);
      const code = await response.text();

      // Execute the code to get validator functions
      const module = { exports: {} as any };
      const fn = new Function('module', 'exports', code);
      fn(module, module.exports);

      validator = module.exports;
      new Notice('Lens Validator: loaded successfully');
    } catch (error) {
      console.error('Failed to load validator:', error);
      new Notice('Lens Validator: failed to load - check console');
    }
  }

  async validateCurrentFile() {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) {
      new Notice('No active markdown file');
      return;
    }

    const file = activeView.file;
    if (file) {
      await this.validateFile(file);
    }
  }

  async validateFile(file: TFile) {
    if (!validator) {
      new Notice('Validator not loaded');
      return;
    }

    const content = await this.app.vault.read(file);
    const fileType = this.detectFileType(file.path);

    let errors: Array<{ message: string; line?: number; context?: string }> = [];

    switch (fileType) {
      case 'module':
        errors = validator.validateModule(content);
        break;
      case 'learning_outcome':
        errors = validator.validateLearningOutcome(content);
        break;
      case 'lens':
        errors = validator.validateLens(content);
        break;
      case 'course':
        errors = validator.validateCourse(content);
        break;
      default:
        return; // Don't validate unknown file types
    }

    if (errors.length === 0) {
      new Notice(`✓ ${file.name}: Valid`);
    } else {
      new Notice(`✗ ${file.name}: ${errors.length} error(s)`, 5000);
      console.log(`Validation errors in ${file.path}:`, errors);
    }
  }

  detectFileType(path: string): string {
    const pathLower = path.toLowerCase();
    if (pathLower.includes('modules/')) return 'module';
    if (pathLower.includes('learning outcomes/') || pathLower.includes('learning_outcomes/')) return 'learning_outcome';
    if (pathLower.includes('lenses/')) return 'lens';
    if (pathLower.includes('courses/')) return 'course';
    return 'unknown';
  }

  onunload() {
    console.log('Unloading Lens Validator plugin');
  }
}
```

**Step 5: Create esbuild.config.mjs**

```javascript
import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const banner = `/*
Lens Academy Validator Plugin
*/`;

const prod = process.argv[2] === "production";

esbuild.build({
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
}).catch(() => process.exit(1));
```

**Step 6: Install and build**

```bash
cd obsidian-validator-plugin
npm install
npm run build
```

**Step 7: Commit**

```bash
git add obsidian-validator-plugin/
git commit -m "feat: create Obsidian validator plugin structure"
```

---

### Task 14: Build validator for browser/Obsidian consumption

**Files:**
- Modify: `typescript-validator/package.json`
- Create: `typescript-validator/tsup.config.ts`

**Step 1: Update package.json build script**

```json
{
  "scripts": {
    "build": "tsup",
    "build:browser": "tsup --format iife --global-name LensValidator"
  }
}
```

**Step 2: Create tsup.config.ts**

```typescript
import { defineConfig } from 'tsup';

export default defineConfig([
  // Node.js / bundler usage
  {
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
  },
  // Browser / Obsidian usage (self-contained)
  {
    entry: ['src/index.ts'],
    format: ['iife'],
    globalName: 'LensValidator',
    outDir: 'dist',
    outExtension: () => ({ js: '.browser.js' }),
    minify: true,
  },
]);
```

**Step 3: Build and verify**

```bash
cd typescript-validator
npm run build
ls dist/
```

Expected: `index.js`, `index.mjs`, `index.d.ts`, `index.browser.js`

**Step 4: Commit**

```bash
git add typescript-validator/
git commit -m "feat: add browser build for Obsidian plugin"
```

---

### Task 15: Add CI workflow for both Python and TypeScript tests

**Files:**
- Create: `.github/workflows/test-validators.yml`

**Step 1: Create workflow file**

```yaml
name: Test Validators

on:
  push:
    branches: [main, staging]
    paths:
      - 'core/modules/**'
      - 'typescript-validator/**'
  pull_request:
    paths:
      - 'core/modules/**'
      - 'typescript-validator/**'

jobs:
  test-python:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Install dependencies
        run: pip install pytest

      - name: Run Python validator tests
        run: pytest core/modules/tests/test_validator_fixtures.py -v

  test-typescript:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        working-directory: typescript-validator
        run: npm install

      - name: Run TypeScript validator tests
        working-directory: typescript-validator
        run: npm test

  parity-check:
    needs: [test-python, test-typescript]
    runs-on: ubuntu-latest
    steps:
      - name: Confirm parity
        run: echo "Both Python and TypeScript validators pass all shared fixtures"
```

**Step 2: Commit**

```bash
git add .github/workflows/test-validators.yml
git commit -m "ci: add workflow for Python and TypeScript validator tests"
```

END OF PHASE 3 (OUT OF SCOPE)
-->

---

## Summary

This plan creates:

1. **Shared test fixtures** in `core/modules/tests/fixtures/validator/` with a manifest.json
2. **Python fixture tests** that validate against shared fixtures
3. **TypeScript validator package** with full validation logic ported from Python
4. **TypeScript fixture tests** that validate against the same shared fixtures

The TypeScript validator can be updated independently, and the shared fixtures ensure both implementations agree on what's valid/invalid.

**Out of scope (Phase 3):** Obsidian plugin and CI workflow - deferred until the TypeScript validator is stable.
