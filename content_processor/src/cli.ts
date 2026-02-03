// src/cli.ts
import { readVaultFiles } from './fs/read-vault.js';
import { processContent, ProcessResult } from './index.js';

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

export async function run(options: CliOptions): Promise<ProcessResult> {
  if (!options.vaultPath) {
    throw new Error('Vault path is required');
  }

  const files = await readVaultFiles(options.vaultPath);
  return processContent(files);
}
