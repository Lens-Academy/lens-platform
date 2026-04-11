# CLI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add CLI entry point that reads a vault directory and outputs JSON to stdout.

**Architecture:** Create `src/cli.ts` that reads all `.md` files from a directory into a `Map<string, string>`, passes to existing `processContent()`, and outputs JSON. Extract file reading into testable `readVaultFiles()` function.

**Tech Stack:** Node.js fs/promises, vitest for testing

---

## Task 1: Create readVaultFiles function

**Files:**
- Create: `src/fs/read-vault.ts`
- Create: `src/fs/read-vault.test.ts`

### Step 1: Write all failing tests first

```typescript
// src/fs/read-vault.test.ts
import { describe, it, expect } from 'vitest';
import { readVaultFiles } from './read-vault.js';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

describe('readVaultFiles', () => {
  it('reads all .md files from fixture directory', async () => {
    const fixturesDir = join(import.meta.dirname, '../../fixtures/valid/minimal-module/input');

    const files = await readVaultFiles(fixturesDir);

    expect(files.has('modules/intro.md')).toBe(true);
    expect(files.get('modules/intro.md')).toContain('slug: intro');
  });

  it('reads files from nested directories with correct relative paths', async () => {
    const fixturesDir = join(import.meta.dirname, '../../fixtures/golden/actual-content/input');

    const files = await readVaultFiles(fixturesDir);

    // Should have files in nested paths like "modules/intro.md", "Lenses/..."
    const paths = Array.from(files.keys());
    expect(paths.some(p => p.includes('/'))).toBe(true);

    // Paths should NOT start with leading slash
    expect(paths.every(p => !p.startsWith('/'))).toBe(true);
  });

  it('returns empty map for directory with no .md files', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'empty-vault-'));
    try {
      const files = await readVaultFiles(tempDir);
      expect(files.size).toBe(0);
    } finally {
      rmSync(tempDir, { recursive: true });
    }
  });

  it('throws descriptive error for non-existent directory', async () => {
    await expect(readVaultFiles('/nonexistent/path')).rejects.toThrow(/ENOENT|no such file/i);
  });
});
```

### Step 2: Run tests to verify they fail

Run: `npm test src/fs/read-vault.test.ts`
Expected: FAIL with "Cannot find module './read-vault.js'"

### Step 3: Write minimal implementation

```typescript
// src/fs/read-vault.ts
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

export async function readVaultFiles(vaultPath: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  await readFilesRecursive(vaultPath, '', files);
  return files;
}

async function readFilesRecursive(
  dir: string,
  prefix: string,
  result: Map<string, string>
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      await readFilesRecursive(fullPath, relativePath, result);
    } else if (entry.name.endsWith('.md')) {
      const content = await readFile(fullPath, 'utf-8');
      result.set(relativePath, content);
    }
  }
}
```

### Step 4: Run tests to verify they pass

Run: `npm test src/fs/read-vault.test.ts`
Expected: PASS (all 4 tests)

### Step 5: Commit

```bash
git add src/fs/read-vault.ts src/fs/read-vault.test.ts
git commit -m "feat(cli): add readVaultFiles function"
```

---

## Task 2: Create CLI entry point with argument parsing

**Files:**
- Create: `src/cli.ts`
- Create: `src/cli.test.ts`

### Step 1: Write the failing test

```typescript
// src/cli.test.ts
import { describe, it, expect } from 'vitest';
import { parseArgs } from './cli.js';

describe('parseArgs', () => {
  it('extracts vault path from positional argument', () => {
    const args = parseArgs(['node', 'cli.ts', '/path/to/vault']);

    expect(args.vaultPath).toBe('/path/to/vault');
    expect(args.outputPath).toBeNull();
  });

  it('returns null vaultPath when no argument provided', () => {
    const args = parseArgs(['node', 'cli.ts']);

    expect(args.vaultPath).toBeNull();
  });

  it('extracts --output flag', () => {
    const args = parseArgs(['node', 'cli.ts', '/path/to/vault', '--output', '/path/to/output.json']);

    expect(args.vaultPath).toBe('/path/to/vault');
    expect(args.outputPath).toBe('/path/to/output.json');
  });

  it('extracts -o shorthand', () => {
    const args = parseArgs(['node', 'cli.ts', '/path/to/vault', '-o', 'output.json']);

    expect(args.outputPath).toBe('output.json');
  });
});
```

### Step 2: Run test to verify it fails

Run: `npm test src/cli.test.ts`
Expected: FAIL with "Cannot find module './cli.js'"

### Step 3: Write minimal implementation

```typescript
// src/cli.ts
export interface CliOptions {
  vaultPath: string | null;
  outputPath: string | null;
}

export function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);
  let vaultPath: string | null = null;
  let outputPath: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' || args[i] === '-o') {
      outputPath = args[i + 1] || null;
      i++; // skip next arg
    } else if (!args[i].startsWith('-')) {
      vaultPath = args[i];
    }
  }

  return { vaultPath, outputPath };
}
```

### Step 4: Run test to verify it passes

Run: `npm test src/cli.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add src/cli.ts src/cli.test.ts
git commit -m "feat(cli): add argument parsing with --output flag"
```

---

## Task 3: Add CLI run function

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/cli.test.ts`

### Step 1: Write the failing test

Add to `src/cli.test.ts`:

```typescript
import { parseArgs, run } from './cli.js';
import { join } from 'path';

describe('run', () => {
  it('processes vault and returns ProcessResult', async () => {
    const vaultPath = join(import.meta.dirname, '../fixtures/valid/minimal-module/input');

    const result = await run({ vaultPath, outputPath: null });

    expect(result.modules).toBeDefined();
    expect(result.modules.length).toBeGreaterThan(0);
    expect(result.errors).toBeDefined();
  });
});
```

### Step 2: Run test to verify it fails

Run: `npm test src/cli.test.ts`
Expected: FAIL with "run is not exported" or similar

### Step 3: Write minimal implementation

Add to `src/cli.ts`:

```typescript
import { readVaultFiles } from './fs/read-vault.js';
import { processContent, ProcessResult } from './index.js';

export async function run(options: CliOptions): Promise<ProcessResult> {
  if (!options.vaultPath) {
    throw new Error('Vault path is required');
  }

  const files = await readVaultFiles(options.vaultPath);
  return processContent(files);
}
```

### Step 4: Run test to verify it passes

Run: `npm test src/cli.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add src/cli.ts src/cli.test.ts
git commit -m "feat(cli): add run function"
```

---

## Task 4: Add main function with stdout and file output

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/cli.test.ts`

### Step 1: Write all failing tests for CLI execution

Add to `src/cli.test.ts`:

```typescript
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';

describe('CLI executable', () => {
  it('outputs JSON to stdout', () => {
    const vaultPath = join(import.meta.dirname, '../fixtures/valid/minimal-module/input');

    const stdout = execSync(`npx tsx src/cli.ts "${vaultPath}"`, {
      cwd: join(import.meta.dirname, '..'),
      encoding: 'utf-8',
    });

    const result = JSON.parse(stdout);
    expect(result.modules).toBeDefined();
  });

  it('writes JSON to file when --output specified', () => {
    const vaultPath = join(import.meta.dirname, '../fixtures/valid/minimal-module/input');
    const tempDir = mkdtempSync(join(tmpdir(), 'cli-test-'));
    const outputPath = join(tempDir, 'output.json');

    try {
      execSync(`npx tsx src/cli.ts "${vaultPath}" --output "${outputPath}"`, {
        cwd: join(import.meta.dirname, '..'),
        encoding: 'utf-8',
      });

      const content = readFileSync(outputPath, 'utf-8');
      const result = JSON.parse(content);
      expect(result.modules).toBeDefined();
    } finally {
      rmSync(tempDir, { recursive: true });
    }
  });
});
```

### Step 2: Run tests to verify they fail

Run: `npm test src/cli.test.ts`
Expected: FAIL (cli.ts doesn't have main entry point yet)

### Step 3: Write minimal implementation

Add to bottom of `src/cli.ts`:

```typescript
import { writeFile } from 'fs/promises';

async function main(): Promise<void> {
  const options = parseArgs(process.argv);

  if (!options.vaultPath) {
    console.error('Usage: npx tsx src/cli.ts <vault-path> [--output <file>]');
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

### Step 4: Run tests to verify they pass

Run: `npm test src/cli.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add src/cli.ts src/cli.test.ts
git commit -m "feat(cli): add main function with stdout and file output"
```

---

## Task 5: Add exit code tests

**Files:**
- Modify: `src/cli.test.ts`

### Step 1: Write the tests (characterization tests for existing behavior)

Add to `src/cli.test.ts`:

```typescript
describe('CLI exit codes', () => {
  it('exits with 0 on success', () => {
    const vaultPath = join(import.meta.dirname, '../fixtures/valid/minimal-module/input');

    // execSync throws on non-zero exit
    expect(() => {
      execSync(`npx tsx src/cli.ts "${vaultPath}"`, {
        cwd: join(import.meta.dirname, '..'),
        stdio: 'pipe',
      });
    }).not.toThrow();
  });

  it('exits with 1 when no vault path provided', () => {
    expect(() => {
      execSync('npx tsx src/cli.ts', {
        cwd: join(import.meta.dirname, '..'),
        stdio: 'pipe',
      });
    }).toThrow();
  });

  it('exits with 1 when vault path does not exist', () => {
    expect(() => {
      execSync('npx tsx src/cli.ts /nonexistent/path', {
        cwd: join(import.meta.dirname, '..'),
        stdio: 'pipe',
      });
    }).toThrow();
  });
});
```

### Step 2: Run tests to verify they pass

Run: `npm test src/cli.test.ts`
Expected: PASS (these are characterization tests documenting existing behavior)

### Step 3: Commit

```bash
git add src/cli.test.ts
git commit -m "test(cli): add exit code characterization tests"
```

---

## Task 6: Add golden master integration test

**Files:**
- Modify: `src/cli.test.ts`

### Step 1: Write the integration test

Add to `src/cli.test.ts`:

```typescript
describe('CLI golden master integration', () => {
  it('produces same output as processContent for golden fixture', () => {
    const vaultPath = join(import.meta.dirname, '../fixtures/golden/actual-content/input');
    const expectedPath = join(import.meta.dirname, '../fixtures/golden/actual-content/expected.json');

    const stdout = execSync(`npx tsx src/cli.ts "${vaultPath}"`, {
      cwd: join(import.meta.dirname, '..'),
      encoding: 'utf-8',
    });

    const cliResult = JSON.parse(stdout);
    const expected = JSON.parse(readFileSync(expectedPath, 'utf-8'));

    expect(cliResult).toEqual(expected);
  });
});
```

### Step 2: Run test to verify it passes

Run: `npm test src/cli.test.ts`
Expected: PASS

### Step 3: Commit

```bash
git add src/cli.test.ts
git commit -m "test(cli): add golden master integration test"
```

---

## Task 7: Run all tests and final commit

**Files:** None (verification only)

### Step 1: Run all tests

Run: `npm test`
Expected: All tests pass (150+ tests)

### Step 2: Create final commit

```bash
git add -A
git commit -m "feat(content-processor): complete CLI implementation

- Add readVaultFiles() to read .md files from directory
- Add CLI with argument parsing (vault path, --output flag)
- Support stdout or file output
- Full test coverage including golden master integration"
```

---

## Summary

After completing all tasks, the CLI will:

1. **Read vault**: `npx tsx src/cli.ts /path/to/vault` reads all `.md` files
2. **Output JSON**: Prints `ProcessResult` JSON to stdout
3. **File output**: `--output file.json` writes to file instead
4. **Error handling**: Exit code 1 on errors with descriptive messages

**Python integration** can then call:
```python
import subprocess
import json

result = subprocess.run(
    ['npx', 'tsx', 'content_processor/src/cli.ts', vault_path],
    capture_output=True,
    text=True,
    check=True
)
parsed = json.loads(result.stdout)
```
