// src/fs/read-vault.ts
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

export async function readVaultFiles(
  vaultPath: string
): Promise<Map<string, string>> {
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
    } else if (entry.name.endsWith('.md') || entry.name.endsWith('.timestamps.json')) {
      // Load both .md files and .timestamps.json files (for video transcript timing data)
      const content = await readFile(fullPath, 'utf-8');
      result.set(relativePath, content);
    }
  }
}
