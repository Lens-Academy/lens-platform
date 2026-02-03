// src/fs/read-vault.ts
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

export interface ReadVaultOptions {
  includeWip?: boolean;
}

export async function readVaultFiles(
  vaultPath: string,
  options: ReadVaultOptions = {}
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  await readFilesRecursive(vaultPath, '', files, options);
  return files;
}

async function readFilesRecursive(
  dir: string,
  prefix: string,
  result: Map<string, string>,
  options: ReadVaultOptions
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip WIP directories unless includeWip is true
      if (!options.includeWip && entry.name.toLowerCase().includes('wip')) {
        continue;
      }
      await readFilesRecursive(fullPath, relativePath, result, options);
    } else if (entry.name.endsWith('.md')) {
      const content = await readFile(fullPath, 'utf-8');
      result.set(relativePath, content);
    }
  }
}
