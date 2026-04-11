# Python-TypeScript Content Processor Integration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Python's markdown parser and flattener with the TypeScript content processor, called via subprocess.

**Architecture:** Python fetches raw markdown files from GitHub, serializes them to JSON, pipes to TypeScript CLI via stdin, parses the JSON result back into Python's ContentCache. The API serves this cache to the frontend unchanged.

**Tech Stack:** Python 3.11+ (asyncio subprocess), TypeScript/Node.js (tsx), FastAPI, Vitest, pytest

**Design Doc:** `content_processor/docs/python-integration-design.md`

**Review Fixes Applied:**
- Task 1: Increased test timeout from 30s to 60s (first `npx tsx` run compiles)
- Removed separate contract fixture (Task 2) and Python API contract test (Task 3) - use existing TypeScript expected.json as contract instead
- Task 2 (was 4): Frontend contract test now uses TypeScript's expected.json fixture directly
- Task 5 (was 7): Added Step 1 to move `ParsedCourse` to `flattened_types.py`; provided complete `fetch_all_content()` function replacement
- Task 6 (was 8): Added note about updating `cache.py` import

---

## Task 1: TypeScript CLI `--stdin` Flag

**Files:**
- Modify: `content_processor/src/cli.ts`
- Create: `content_processor/src/cli.test.ts`

### Step 1: Write the failing test

Create `content_processor/src/cli.test.ts`:

```typescript
// src/cli.test.ts
import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import { join } from 'path';

describe('CLI --stdin flag', () => {
  it('produces same output as file-based input', async () => {
    const fixturePath = join(__dirname, '../fixtures/valid/minimal-module/input');
    const expectedPath = join(__dirname, '../fixtures/valid/minimal-module/expected.json');

    // Read fixture files into a Map-like object
    const { readVaultFiles } = await import('./fs/read-vault.js');
    const files = await readVaultFiles(fixturePath);
    const filesObject: Record<string, string> = {};
    for (const [path, content] of files.entries()) {
      filesObject[path] = content;
    }

    // Run CLI with --stdin
    const result = await new Promise<string>((resolve, reject) => {
      const child = spawn('npx', ['tsx', 'src/cli.ts', '--stdin'], {
        cwd: join(__dirname, '..'),
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => { stdout += data; });
      child.stderr.on('data', (data) => { stderr += data; });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`CLI exited with code ${code}: ${stderr}`));
        } else {
          resolve(stdout);
        }
      });

      // Write JSON to stdin
      child.stdin.write(JSON.stringify(filesObject));
      child.stdin.end();
    });

    // Parse and compare (ignore whitespace differences)
    const actual = JSON.parse(result);
    const expected = JSON.parse(await readFile(expectedPath, 'utf-8'));

    expect(actual).toEqual(expected);
  }, 60000); // 60s timeout for subprocess (first run compiles)
});
```

### Step 2: Run test to verify it fails

```bash
cd content_processor && npm test src/cli.test.ts
```

Expected: FAIL with error about `--stdin` not being recognized or similar.

### Step 3: Implement `--stdin` flag

Modify `content_processor/src/cli.ts`:

```typescript
// src/cli.ts
import { readVaultFiles } from './fs/read-vault.js';
import { processContent, ProcessResult } from './index.js';
import { writeFile } from 'fs/promises';

export interface CliOptions {
  vaultPath: string | null;
  outputPath: string | null;
  includeWip: boolean;
  stdin: boolean;  // NEW
}

export function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);
  let vaultPath: string | null = null;
  let outputPath: string | null = null;
  let includeWip = false;
  let stdin = false;  // NEW

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' || args[i] === '-o') {
      outputPath = args[i + 1] || null;
      i++; // skip next arg
    } else if (args[i] === '--include-wip') {
      includeWip = true;
    } else if (args[i] === '--stdin') {  // NEW
      stdin = true;
    } else if (!args[i].startsWith('-')) {
      vaultPath = args[i];
    }
  }

  return { vaultPath, outputPath, includeWip, stdin };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

export async function run(options: CliOptions): Promise<ProcessResult> {
  let files: Map<string, string>;

  if (options.stdin) {
    // Read JSON from stdin: { "path": "content", ... }
    const input = await readStdin();
    const parsed = JSON.parse(input) as Record<string, string>;
    files = new Map(Object.entries(parsed));
  } else {
    if (!options.vaultPath) {
      throw new Error('Vault path is required (or use --stdin)');
    }
    files = await readVaultFiles(options.vaultPath, { includeWip: options.includeWip });
  }

  return processContent(files);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv);

  if (!options.vaultPath && !options.stdin) {
    console.error('Usage: npx tsx src/cli.ts <vault-path> [--output <file>] [--include-wip]');
    console.error('       npx tsx src/cli.ts --stdin [--output <file>]');
    process.exit(1);
  }

  try {
    const result = await run(options);
    const json = JSON.stringify(result, null, 2);

    if (options.outputPath) {
      await writeFile(options.outputPath, json, 'utf-8');
      console.error(`Written to ${options.outputPath}`);
    } else {
      console.log(json);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run if executed directly (not imported as a module)
const isMainModule = process.argv[1]?.includes('cli.ts') || process.argv[1]?.includes('cli.js');
if (isMainModule) {
  main();
}
```

### Step 4: Run test to verify it passes

```bash
cd content_processor && npm test src/cli.test.ts
```

Expected: PASS

### Step 5: Run all tests to ensure no regressions

```bash
cd content_processor && npm test
```

Expected: All tests pass

### Step 6: Commit

```bash
git add content_processor/src/cli.ts content_processor/src/cli.test.ts
git commit -m "feat(content-processor): add --stdin flag to CLI for subprocess usage

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Frontend Contract Test

**Files:**
- Create: `web_frontend/src/types/module.contract.test.ts`

**Key insight:** We use the TypeScript processor's `expected.json` fixtures as the contract. This ensures frontend types match what TypeScript actually produces - no separate fixture that could drift.

### Step 1: Write the failing test

Create `web_frontend/src/types/module.contract.test.ts`:

```typescript
// src/types/module.contract.test.ts
import { describe, it, expect } from "vitest";
import type { Module, FlattenedModule, ModuleSection } from "./module";

// Import the TypeScript processor's expected output as the contract
// This is what TypeScript actually produces - the source of truth
import processResult from "../../../content_processor/fixtures/valid/uncategorized-multiple-lenses/expected.json";

// The expected.json has ProcessResult shape: { modules: [...], courses: [...], errors: [...] }
const contract = processResult.modules[0];

describe("Frontend types match TypeScript processor output", () => {
  it("module from expected.json is valid Module type", () => {
    // This is primarily a compile-time check.
    // If the fixture doesn't match the Module type, TypeScript errors.
    const module: Module = contract as Module;

    expect(module.slug).toBe("test-uncategorized");
    expect(module.title).toBe("Test Uncategorized Lenses");
    expect(module.sections.length).toBe(2);
  });

  it("lens-video section matches LensVideoSection type", () => {
    const section = contract.sections[0] as ModuleSection;
    expect(section.type).toBe("lens-video");

    if (section.type === "lens-video") {
      expect(section.meta.title).toBe("AI Safety Introduction");
      expect(section.meta.channel).toBe("Safety Channel");
      expect(section.optional).toBe(false);
    }
  });

  it("lens-article section matches LensArticleSection type", () => {
    const section = contract.sections[1] as ModuleSection;
    expect(section.type).toBe("lens-article");

    if (section.type === "lens-article") {
      expect(section.meta.title).toBe("Deep Dive Article");
      expect(section.meta.author).toBe("Jane Doe");
      expect(section.optional).toBe(false);
    }
  });

  it("segments have correct types", () => {
    // Video section segments
    const videoSection = contract.sections[0];
    expect(videoSection.segments[0].type).toBe("text");
    expect(videoSection.segments[1].type).toBe("video-excerpt");

    // Article section segments
    const articleSection = contract.sections[1];
    expect(articleSection.segments[0].type).toBe("text");
    expect(articleSection.segments[1].type).toBe("article-excerpt");
  });
});
```

### Step 2: Run test to verify it fails

```bash
cd web_frontend && npm test src/types/module.contract.test.ts
```

Expected: FAIL (likely TypeScript error about JSON import or type mismatch)

### Step 3: Configure vitest for JSON imports (if needed)

Check `web_frontend/tsconfig.json` has `"resolveJsonModule": true`. If not, add it.

### Step 4: Run test to verify it passes

```bash
cd web_frontend && npm test src/types/module.contract.test.ts
```

Expected: PASS

### Step 5: Run all frontend tests

```bash
cd web_frontend && npm test
```

Expected: All tests pass

### Step 6: Commit

```bash
git add web_frontend/src/types/module.contract.test.ts
git commit -m "test: add frontend contract test using TypeScript expected.json

Verifies frontend types can parse what TypeScript processor produces.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Python Subprocess Wrapper

**Files:**
- Create: `core/content/typescript_processor.py`
- Create: `core/content/tests/test_typescript_processor.py`

### Step 1: Write the failing test

Create `core/content/tests/test_typescript_processor.py`:

```python
# core/content/tests/test_typescript_processor.py
"""Tests for TypeScript subprocess processor."""

import json
import pytest
from pathlib import Path


@pytest.fixture
def fixture_files() -> dict[str, str]:
    """Load the minimal-module fixture files into a dict."""
    fixture_dir = Path(__file__).parent.parent.parent.parent / "content_processor" / "fixtures" / "valid" / "minimal-module" / "input"
    files = {}
    for file_path in fixture_dir.rglob("*.md"):
        relative_path = file_path.relative_to(fixture_dir)
        files[str(relative_path)] = file_path.read_text()
    # Also load .timestamps.json files if any
    for file_path in fixture_dir.rglob("*.timestamps.json"):
        relative_path = file_path.relative_to(fixture_dir)
        files[str(relative_path)] = file_path.read_text()
    return files


@pytest.fixture
def expected_output() -> dict:
    """Load the expected output for the minimal-module fixture."""
    expected_path = Path(__file__).parent.parent.parent.parent / "content_processor" / "fixtures" / "valid" / "minimal-module" / "expected.json"
    return json.loads(expected_path.read_text())


@pytest.mark.asyncio
async def test_process_content_via_subprocess(fixture_files, expected_output):
    """Verify Python can call TypeScript CLI and get correct output."""
    from core.content.typescript_processor import process_content_typescript

    result = await process_content_typescript(fixture_files)

    # Compare modules
    assert len(result["modules"]) == len(expected_output["modules"])
    for actual_mod, expected_mod in zip(result["modules"], expected_output["modules"]):
        assert actual_mod["slug"] == expected_mod["slug"]
        assert actual_mod["title"] == expected_mod["title"]
        assert actual_mod["sections"] == expected_mod["sections"]

    # Compare errors (should be empty for valid fixture)
    assert result["errors"] == expected_output["errors"]
```

### Step 2: Run test to verify it fails

```bash
pytest core/content/tests/test_typescript_processor.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'core.content.typescript_processor'`

### Step 3: Implement the subprocess wrapper

Create `core/content/typescript_processor.py`:

```python
# core/content/typescript_processor.py
"""TypeScript content processor subprocess wrapper.

Calls the TypeScript CLI via subprocess, piping content through stdin.
"""

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


class TypeScriptProcessorError(Exception):
    """Raised when TypeScript processing fails."""
    pass


def _get_content_processor_dir() -> Path:
    """Get the path to the content_processor directory."""
    # This file is at core/content/typescript_processor.py
    # content_processor is at repo_root/content_processor
    return Path(__file__).parent.parent.parent / "content_processor"


async def process_content_typescript(files: dict[str, str]) -> dict[str, Any]:
    """Process content files using the TypeScript CLI.

    Args:
        files: Dict mapping file paths to content strings.
               e.g., {"modules/intro.md": "---\nslug: intro\n...", ...}

    Returns:
        ProcessResult dict with keys: modules, courses, errors

    Raises:
        TypeScriptProcessorError: If subprocess fails or returns invalid JSON.
    """
    content_processor_dir = _get_content_processor_dir()

    # Serialize files to JSON
    input_json = json.dumps(files)

    # Build command
    # Use npx tsx to run TypeScript directly
    cmd = ["npx", "tsx", "src/cli.ts", "--stdin"]

    logger.info(f"Running TypeScript processor with {len(files)} files")

    try:
        # Run subprocess
        process = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=str(content_processor_dir),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        stdout, stderr = await process.communicate(input=input_json.encode("utf-8"))

        # Log stderr as warnings (TypeScript may log there)
        if stderr:
            stderr_text = stderr.decode("utf-8").strip()
            if stderr_text:
                logger.warning(f"TypeScript stderr: {stderr_text}")

        # Check exit code
        if process.returncode != 0:
            stderr_text = stderr.decode("utf-8") if stderr else "No stderr"
            raise TypeScriptProcessorError(
                f"TypeScript CLI exited with code {process.returncode}: {stderr_text}"
            )

        # Parse output
        stdout_text = stdout.decode("utf-8")
        try:
            result = json.loads(stdout_text)
        except json.JSONDecodeError as e:
            raise TypeScriptProcessorError(
                f"TypeScript CLI returned invalid JSON: {e}"
            )

        logger.info(
            f"TypeScript processed {len(result.get('modules', []))} modules, "
            f"{len(result.get('errors', []))} errors"
        )

        return result

    except FileNotFoundError:
        raise TypeScriptProcessorError(
            "npx not found. Is Node.js installed?"
        )
    except Exception as e:
        if isinstance(e, TypeScriptProcessorError):
            raise
        raise TypeScriptProcessorError(f"Subprocess failed: {e}")
```

### Step 4: Run test to verify it passes

```bash
pytest core/content/tests/test_typescript_processor.py -v
```

Expected: PASS

### Step 5: Run all core tests

```bash
pytest core/tests/ core/content/tests/ -v
```

Expected: All tests pass

### Step 6: Commit

```bash
git add core/content/typescript_processor.py core/content/tests/test_typescript_processor.py
git commit -m "feat: add Python subprocess wrapper for TypeScript processor

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: GitHub Test Fixture and Shallow Integration Test

**Files:**
- Create: `_test-fixture.md` in GitHub repo (Lens-Academy/lens-edu-relay)
- Create: `core/content/tests/test_github_integration.py`

**Note:** This task requires creating a file in the GitHub content repo. The test verifies GitHub credentials and basic fetch functionality.

### Step 1: Create the test fixture in GitHub

In the `Lens-Academy/lens-edu-relay` repository, create `_test-fixture.md`:

```markdown
---
test: true
---

# Test Fixture

This file is used by automated tests to verify GitHub API connectivity.
DO NOT MODIFY - content is hardcoded in tests.
```

### Step 2: Write the failing test

Create `core/content/tests/test_github_integration.py`:

```python
# core/content/tests/test_github_integration.py
"""Shallow integration test for GitHub fetching.

This test hits the real GitHub API to verify:
1. Credentials work (GITHUB_TOKEN)
2. Can reach the content repository
3. Basic fetch functionality works

Uses a dedicated test fixture file that never changes.
"""

import os
import pytest

# Skip if no GitHub token configured
pytestmark = pytest.mark.skipif(
    not os.getenv("GITHUB_TOKEN"),
    reason="GITHUB_TOKEN not set - skipping GitHub integration test"
)


@pytest.mark.asyncio
async def test_fetch_test_fixture():
    """Fetch the test fixture file and verify its content."""
    # Must set branch for the test
    os.environ.setdefault("EDUCATIONAL_CONTENT_BRANCH", "staging")

    from core.content.github_fetcher import fetch_file

    content = await fetch_file("_test-fixture.md")

    # Verify expected content (hardcoded - fixture must not change)
    assert "# Test Fixture" in content
    assert "test: true" in content
    assert "DO NOT MODIFY" in content
```

### Step 3: Run test to verify it fails

```bash
GITHUB_TOKEN=your_token EDUCATIONAL_CONTENT_BRANCH=staging pytest core/content/tests/test_github_integration.py -v
```

Expected: FAIL if `_test-fixture.md` doesn't exist in GitHub yet.

### Step 4: Create the fixture in GitHub

Use the GitHub web UI or gh CLI to create `_test-fixture.md` in the `Lens-Academy/lens-edu-relay` repo.

### Step 5: Run test to verify it passes

```bash
GITHUB_TOKEN=your_token EDUCATIONAL_CONTENT_BRANCH=staging pytest core/content/tests/test_github_integration.py -v
```

Expected: PASS

### Step 6: Commit

```bash
git add core/content/tests/test_github_integration.py
git commit -m "test: add shallow GitHub integration test

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Wire TypeScript Processor into GitHub Fetcher

**Files:**
- Modify: `core/modules/flattened_types.py` (add ParsedCourse)
- Modify: `core/content/github_fetcher.py`

This is the final integration step. Replace the Python flattener calls with TypeScript subprocess calls.

### Step 1: Move ParsedCourse to flattened_types.py

Since we're deleting `markdown_parser.py` in Task 8, we need to preserve `ParsedCourse` which is still used by the cache.

Add to `core/modules/flattened_types.py`:

```python
@dataclass
class ParsedCourse:
    """A parsed course definition."""
    slug: str
    title: str
    progression: list[dict] = field(default_factory=list)
```

### Step 2: Identify existing tests that will verify the change

The existing tests in `core/content/tests/test_cache_flattening.py` and `web_api/tests/test_modules_v2.py` should continue passing after this change.

```bash
pytest core/content/tests/test_cache_flattening.py web_api/tests/test_modules_v2.py -v
```

Run these first to establish baseline.

### Step 3: Modify github_fetcher.py imports

In `core/content/github_fetcher.py`:

**Remove these imports (lines 13-27):**
```python
from core.modules.markdown_parser import (
    parse_module,
    parse_course,
    parse_learning_outcome,
    parse_lens,
    ParsedModule,
    ParsedCourse,
    ParsedLearningOutcome,
    ParsedLens,
)
from core.modules.flattener import flatten_module, ContentLookup
from core.modules.path_resolver import extract_filename_stem
```

**Add these imports:**
```python
from uuid import UUID  # Should already exist, verify
from core.modules.flattened_types import FlattenedModule, ParsedCourse
from core.content.typescript_processor import process_content_typescript, TypeScriptProcessorError
```

### Step 4: Replace fetch_all_content function body

The entire `fetch_all_content()` function (lines 342-513) needs to be replaced. The new version:
1. Fetches all files from GitHub (same as before)
2. Collects them into a dict
3. Calls TypeScript subprocess instead of Python flattener
4. Converts result to cache format

**Replace the function body starting after the httpx.AsyncClient context manager opens (line 354):**

```python
async def fetch_all_content() -> ContentCache:
    """Fetch all educational content from GitHub.

    Modules are flattened by TypeScript subprocess - all Learning Outcome and
    Uncategorized references are resolved to lens-video/lens-article sections.

    Returns:
        ContentCache with all content loaded, including latest commit SHA

    Raises:
        GitHubFetchError: If any fetch fails
    """
    async with httpx.AsyncClient() as client:
        # Get the latest commit SHA for tracking
        commit_sha = await _get_latest_commit_sha_with_client(client)

        # List all files in each directory
        module_files = await _list_directory_with_client(client, "modules")
        course_files = await _list_directory_with_client(client, "courses")
        article_files = await _list_directory_with_client(client, "articles")
        transcript_files = await _list_directory_with_client(client, "video_transcripts")
        learning_outcome_files = await _list_directory_with_client(client, "Learning Outcomes")
        lens_files = await _list_directory_with_client(client, "Lenses")

        # Collect ALL files for TypeScript processing
        all_files: dict[str, str] = {}

        # Fetch and collect all markdown files
        for path in module_files:
            if path.endswith(".md"):
                content = await _fetch_file_with_client(client, path, ref=commit_sha)
                all_files[path] = content

        for path in course_files:
            if path.endswith(".md"):
                content = await _fetch_file_with_client(client, path, ref=commit_sha)
                all_files[path] = content

        for path in learning_outcome_files:
            if path.endswith(".md"):
                content = await _fetch_file_with_client(client, path, ref=commit_sha)
                all_files[path] = content

        for path in lens_files:
            if path.endswith(".md"):
                content = await _fetch_file_with_client(client, path, ref=commit_sha)
                all_files[path] = content

        # Fetch articles (also stored separately for metadata extraction)
        articles: dict[str, str] = {}
        for path in article_files:
            if path.endswith(".md"):
                content = await _fetch_file_with_client(client, path, ref=commit_sha)
                articles[path] = content
                all_files[path] = content

        # Fetch video transcripts (also stored separately)
        video_transcripts: dict[str, str] = {}
        for path in transcript_files:
            if path.endswith(".md"):
                content = await _fetch_file_with_client(client, path, ref=commit_sha)
                video_transcripts[path] = content
                all_files[path] = content

        # Fetch timestamp files
        video_timestamps: dict[str, list[dict]] = {}
        for path in transcript_files:
            if path.endswith(".timestamps.json"):
                content = await _fetch_file_with_client(client, path, ref=commit_sha)
                all_files[path] = content
                # Also parse for video_timestamps dict (keyed by video_id)
                try:
                    timestamps_data = json.loads(content)
                    md_path = path.replace(".timestamps.json", ".md")
                    if md_path in video_transcripts:
                        metadata = _parse_frontmatter(video_transcripts[md_path])
                        video_id = metadata.get("video_id", "")
                        if not video_id and metadata.get("url"):
                            url = metadata["url"].strip("\"'")
                            import re
                            match = re.search(
                                r"(?:youtube\.com/watch\?v=|youtu\.be/)([a-zA-Z0-9_-]+)",
                                url,
                            )
                            if match:
                                video_id = match.group(1)
                        if video_id:
                            video_timestamps[video_id] = timestamps_data
                except Exception as e:
                    logger.warning(f"Failed to parse timestamps {path}: {e}")

        # Process all content with TypeScript subprocess
        try:
            ts_result = await process_content_typescript(all_files)
        except TypeScriptProcessorError as e:
            logger.error(f"TypeScript processing failed: {e}")
            raise GitHubFetchError(f"Content processing failed: {e}")

        # Convert TypeScript result to Python cache format
        flattened_modules: dict[str, FlattenedModule] = {}
        for mod in ts_result.get("modules", []):
            flattened_modules[mod["slug"]] = FlattenedModule(
                slug=mod["slug"],
                title=mod["title"],
                content_id=UUID(mod["contentId"]) if mod.get("contentId") else None,
                sections=mod["sections"],
                error=mod.get("error"),
            )

        # Convert courses from TypeScript result
        courses: dict[str, ParsedCourse] = {}
        for course in ts_result.get("courses", []):
            courses[course["slug"]] = ParsedCourse(
                slug=course["slug"],
                title=course["title"],
                progression=course.get("progression", []),
            )

        # Build and return cache
        cache = ContentCache(
            courses=courses,
            flattened_modules=flattened_modules,
            parsed_learning_outcomes={},  # No longer needed - TS handles
            parsed_lenses={},  # No longer needed - TS handles
            articles=articles,
            video_transcripts=video_transcripts,
            video_timestamps=video_timestamps,
            last_refreshed=datetime.now(),
            last_commit_sha=commit_sha,
        )
        set_cache(cache)
        return cache
```

### Step 5: Run tests to verify the change works

```bash
pytest core/content/tests/ web_api/tests/test_modules_v2.py -v
```

Expected: All tests pass

### Step 6: Run full test suite

```bash
pytest
```

Expected: All tests pass (some may need adjustment if they depend on removed Python parsing)

### Step 7: Commit

```bash
git add core/content/github_fetcher.py
git commit -m "feat: replace Python flattener with TypeScript subprocess

BREAKING: Python markdown_parser and flattener no longer used.
Content processing now done by TypeScript CLI via subprocess.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Delete Obsolete Python Code

**Files:**
- Delete: `core/modules/markdown_parser.py`
- Delete: `core/modules/flattener.py`
- Delete: `core/modules/content.py` (if it exists and only contains bundling)
- Update: `core/modules/__init__.py` (remove exports)
- Update: Any files that imported `ParsedCourse` from `markdown_parser` (now in `flattened_types`)

### Step 1: Identify files to delete

```bash
ls -la core/modules/markdown_parser.py core/modules/flattener.py
```

### Step 2: Check for remaining imports

```bash
grep -r "from core.modules.markdown_parser" . --include="*.py" | grep -v __pycache__
grep -r "from core.modules.flattener" . --include="*.py" | grep -v __pycache__
```

For each file found:
- If it imports `ParsedCourse`, update to: `from core.modules.flattened_types import ParsedCourse`
- Remove any other imports from the deleted modules

**Known file to update:** `core/content/cache.py` imports `ParsedCourse` from `markdown_parser`.

### Step 3: Delete the files

```bash
rm core/modules/markdown_parser.py
rm core/modules/flattener.py
```

### Step 4: Update __init__.py exports

Remove deleted imports from `core/modules/__init__.py`.

### Step 5: Run tests to verify nothing breaks

```bash
pytest
```

Expected: All tests pass (any tests for deleted code should also be removed)

### Step 6: Delete obsolete tests

```bash
rm core/modules/tests/test_flattener.py  # If it exists and tests deleted code
```

### Step 7: Commit

```bash
git add -u  # Stage deletions
git commit -m "chore: delete obsolete Python markdown_parser and flattener

These modules have been replaced by the TypeScript content processor.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Summary

| Task | Description | Tests |
|------|-------------|-------|
| 1 | TypeScript `--stdin` flag | `cli.test.ts` |
| 2 | Frontend contract test | `module.contract.test.ts` (uses TS expected.json) |
| 3 | Python subprocess wrapper | `test_typescript_processor.py` |
| 4 | GitHub integration test | `test_github_integration.py` |
| 5 | Wire TS processor into fetcher | Existing tests |
| 6 | Delete obsolete Python code | Run full suite |

**Total new tests:** 4 (TS stdin, Frontend contract, Python subprocess, GitHub integration)
**Total commits:** 6

**Contract testing approach:** Frontend types are validated against the TypeScript processor's `expected.json` fixtures. This ensures frontend can parse what TypeScript actually produces - no separate contract fixture that could drift.
