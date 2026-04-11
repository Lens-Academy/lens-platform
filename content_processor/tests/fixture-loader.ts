// tests/fixture-loader.ts
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import type { ProcessResult } from '../src/index.js';

const FIXTURES_DIR = join(import.meta.dirname, '../fixtures');

export interface Fixture {
  name: string;
  input: Map<string, string>;
  expected: ProcessResult;
  expectErrors?: boolean;
}

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
    } else if (entry.name.endsWith('.md') || entry.name.endsWith('.timestamps.json')) {
      // Load both .md files and .timestamps.json files (for video transcript timing data)
      const content = await readFile(fullPath, 'utf-8');
      result.set(relativePath, content);
    }
  }
}
