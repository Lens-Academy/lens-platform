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
