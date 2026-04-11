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
