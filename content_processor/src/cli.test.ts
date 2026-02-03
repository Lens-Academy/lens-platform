// src/cli.test.ts
import { describe, it, expect } from 'vitest';
import { parseArgs, run } from './cli.js';
import { join } from 'path';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';

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

describe('run', () => {
  it('processes vault and returns ProcessResult', async () => {
    const vaultPath = join(import.meta.dirname, '../fixtures/valid/minimal-module/input');

    const result = await run({ vaultPath, outputPath: null });

    expect(result.modules).toBeDefined();
    expect(result.modules.length).toBeGreaterThan(0);
    expect(result.errors).toBeDefined();
  });
});

describe('CLI executable', () => {
  it('outputs JSON to stdout', () => {
    const vaultPath = join(import.meta.dirname, '../fixtures/valid/minimal-module/input');

    const stdout = execSync(`npx tsx src/cli.ts "${vaultPath}"`, {
      cwd: join(import.meta.dirname, '..'),
      encoding: 'utf-8',
      timeout: 30000,
    });

    const result = JSON.parse(stdout);
    expect(result.modules).toBeDefined();
  }, 35000);

  it('writes JSON to file when --output specified', () => {
    const vaultPath = join(import.meta.dirname, '../fixtures/valid/minimal-module/input');
    const tempDir = mkdtempSync(join(tmpdir(), 'cli-test-'));
    const outputPath = join(tempDir, 'output.json');

    try {
      execSync(`npx tsx src/cli.ts "${vaultPath}" --output "${outputPath}"`, {
        cwd: join(import.meta.dirname, '..'),
        encoding: 'utf-8',
        timeout: 30000,
      });

      const content = readFileSync(outputPath, 'utf-8');
      const result = JSON.parse(content);
      expect(result.modules).toBeDefined();
    } finally {
      rmSync(tempDir, { recursive: true });
    }
  }, 35000);
});

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

describe('CLI golden master integration', () => {
  it('produces same output as processContent for golden fixture', () => {
    const vaultPath = join(import.meta.dirname, '../fixtures/golden/actual-content/input');
    const expectedPath = join(import.meta.dirname, '../fixtures/golden/actual-content/expected.json');

    const stdout = execSync(`npx tsx src/cli.ts "${vaultPath}"`, {
      cwd: join(import.meta.dirname, '..'),
      encoding: 'utf-8',
      timeout: 30000,
    });

    const cliResult = JSON.parse(stdout);
    const expected = JSON.parse(readFileSync(expectedPath, 'utf-8'));

    expect(cliResult).toEqual(expected);
  }, 35000);
});
